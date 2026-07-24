/**
 * Plugin Loader — Core Lifecycle Manager
 *
 * Manages the full plugin lifecycle:
 *   loadPluginsFromDisk   → Discovery + validation + activation
 *   validatePlugin         → 4-gate security check (delegated to validator.js)
 *   buildSandboxedContext  → Read-only STATE view + controlled helpers
 *   compileEmergentPlugin  → Emergent-generated plugin (delegated to runtime-compiler.js)
 *   unloadPlugin           → Graceful teardown
 *   getPluginMetrics       → Health + performance stats
 *   hotReload              → Unload + reload without restart
 *
 * Plugin directory structure:
 *   server/plugins/
 *     installed/          — Human-authored plugins (one dir per plugin)
 *     emergent-gen/       — Emergent-generated plugins (compiled in-memory, persisted here)
 *     templates/          — Plugin templates for authoring
 *     loader.js           — This file
 *     validator.js        — Security validation gates
 *     runtime-compiler.js — Emergent-gen compilation
 *
 * Integration points:
 *   - Macros: plugins register domain-namespaced macros
 *   - Hooks: plugins subscribe to DTU lifecycle events
 *   - Tick: plugins can run per-heartbeat logic
 *   - Scheduler: plugin work items can be scheduled
 *   - Governance: emergent-gen plugins require council approval
 *   - Purpose tracking: plugin activations create needs
 *   - Trust network: plugin actions influence trust
 *   - Entity emergence: plugin authorship counts toward entity metrics
 *   - Consequence cascade: plugin-triggered DTU changes cascade
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEmergentState } from "../emergent/store.js";
import { validatePlugin as runValidation, RESERVED_NAMESPACES } from "./validator.js";
import { makeConfinedCtx } from "../lib/confined-ctx.js";
import { PluginSandbox, bridgeFromHostCtx } from "../lib/plugin-sandbox.js";
import {
  compileEmergentPlugin as _compileEmergentPlugin,
  createPluginGovernanceProposal,
  MAX_EMERGENT_PLUGINS,
  checkRateLimit,
  getRateLimitStatus,
} from "./runtime-compiler.js";

// ── Default capability grants ───────────────────────────────────────────────
//
// The macro-namespace grants a plugin is confined to when it declares no
// manifest of its own (see `buildSandboxedContext` below). Exported so any
// caller that needs to DISPLAY what a plugin will actually be permitted to
// call (e.g. the gallery's capability-disclosure field) reads the exact same
// literal the enforcement path uses — never a hand-maintained parallel copy.
export const DEFAULT_PLUGIN_MACRO_GRANTS = Object.freeze(["dtu.*", "discovery.*", "art.*", "music.*", "glyph-spells.*"]);
export const DEFAULT_EMERGENT_GEN_MACRO_GRANTS = Object.freeze(["dtu.*", "discovery.*"]);

// ── Plugin Store ────────────────────────────────────────────────────────────

function getPluginStore(STATE) {
  const es = getEmergentState(STATE);
  if (!es._plugins) {
    es._plugins = {
      loaded: new Map(),        // pluginId → PluginRecord
      hooks: {                  // hookName → [{ pluginId, handler }]
        "dtu:beforeCreate":  [],
        "dtu:afterCreate":   [],
        "dtu:beforeUpdate":  [],
        "dtu:afterUpdate":   [],
        "dtu:beforeDelete":  [],
        "dtu:afterDelete":   [],
        "macro:beforeExecute": [],
        "macro:afterExecute":  [],
      },
      pendingGovernance: new Map(), // pluginId → { proposal, compiledModule, submittedAt }
      metrics: {
        totalLoaded: 0,
        totalUnloaded: 0,
        totalFailed: 0,
        totalEmergentGen: 0,
        totalHookCalls: 0,
        totalTickCalls: 0,
        totalMacroCalls: 0,
        loadErrors: [],        // last 20
      },
    };
  }
  return es._plugins;
}

// ── Core Functions ──────────────────────────────────────────────────────────

function defaultInstalledDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "installed");
}

/**
 * 1. Load plugins from disk (installed/ directory).
 *
 * Scans server/plugins/installed/ for subdirectories with index.js, reads
 * each plugin's raw source text, and activates it through the sandboxed
 * path (`loadPluginFromSource`) — NEVER via a native `import()` of the
 * file. A disk-authored plugin is the one genuinely-untrusted case (a
 * third-party file on disk, as opposed to an in-memory module object
 * constructed by trusted server code), so this is the real call site the
 * plugin-sandbox hardening targets.
 *
 * Activation itself is async (the sandbox spins up a worker thread per
 * plugin and evaluates its source before it's known to be safe), but this
 * function's callers expect a synchronous return — so activation runs in
 * the background and this returns immediately with whatever's already
 * loaded. Failures land in `store.metrics.loadErrors` (see
 * `getPluginMetrics`). Callers that need to await full activation (tests)
 * should call `loadPluginFromSource` directly per file instead.
 *
 * @param {Object} STATE
 * @param {Object} opts
 * @param {Function} opts.register - Macro registration function
 * @param {Object} opts.helpers - Helper functions
 * @param {Function} [opts.runMacro] - Macro runner for plugin use
 * @param {string} [opts.installedDir] - Override the installed/ directory (tests)
 * @returns {{ ok, loaded: string[], failed: { id, error }[], pluginCount, scanning }}
 */
export function loadPluginsFromDisk(STATE, opts = {}) {
  const store = getPluginStore(STATE);
  const loaded = [];
  const failed = [];

  const installedDir = opts.installedDir || defaultInstalledDir();
  let entries = [];
  try {
    entries = fs.readdirSync(installedDir, { withFileTypes: true });
  } catch (_err) {
    // No installed/ directory (or unreadable) — nothing to load, not an error.
    return { ok: true, loaded, failed, pluginCount: store.loaded.size, scanning: 0 };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory || !entry.isDirectory()) continue;
    const indexPath = path.join(installedDir, entry.name, "index.js");
    if (!fs.existsSync(indexPath)) continue;
    candidates.push({ dirName: entry.name, indexPath });
  }

  for (const { dirName, indexPath } of candidates) {
    let source;
    try {
      source = fs.readFileSync(indexPath, "utf8");
    } catch (err) {
      failed.push({ id: dirName, error: `read_failed: ${err.message}` });
      store.metrics.loadErrors.push({ pluginId: dirName, error: `read_failed: ${err.message}`, at: new Date().toISOString() });
      continue;
    }

    void loadPluginFromSource(STATE, source, opts)
      .then((result) => {
        if (!result.ok) {
          store.metrics.loadErrors.push({
            pluginId: dirName,
            error: typeof result.error === "string" ? result.error : "load_failed",
            at: new Date().toISOString(),
          });
        }
      })
      .catch((err) => {
        store.metrics.loadErrors.push({ pluginId: dirName, error: `unexpected: ${err.message}`, at: new Date().toISOString() });
      });
  }

  return { ok: true, loaded, failed, pluginCount: store.loaded.size, scanning: candidates.length };
}

/**
 * Load + activate a plugin from RAW SOURCE TEXT — the hardened path for
 * genuinely untrusted (disk-authored) plugin code.
 *
 * Flow:
 *   1. Fast pattern-gate pre-check on the raw source (unchanged validator.js
 *      logic) — rejects obviously-malicious source before paying for a
 *      worker spin-up. Defense-in-depth layer 1.
 *   2. The source is evaluated ONCE, safely, inside `plugin-sandbox.js`'s
 *      worker+vm isolation (see that file's header for the full isolation
 *      story). We recover the plugin's reflected shape (id/name/version/
 *      macro+hook names/etc) from that SAME evaluated module — there is no
 *      window where a validated shape could differ from the code that
 *      later executes.
 *   3. The full 4-gate validator runs again against the reflected shape
 *      (shape/namespace/patterns/dependencies) — unchanged validator.js,
 *      defense-in-depth layer 2.
 *   4. On success, the plugin is activated: `init()` is called inside the
 *      sandbox, and its macros/hooks/tick are registered as thin async
 *      proxies that message the worker — the plugin's own code never
 *      leaves the sandbox.
 *
 * @param {Object} STATE
 * @param {string} sourceCode - raw plugin ESM source text
 * @param {Object} opts - { register, helpers, runMacro, isEmergentGen, manifest, timeoutMs, resourceLimits }
 * @returns {Promise<{ ok, pluginId?, macros?, hooks?, error?, validation? }>}
 */
export async function loadPluginFromSource(STATE, sourceCode, opts = {}) {
  const store = getPluginStore(STATE);
  const { register, helpers, runMacro, isEmergentGen = false, manifest = null, timeoutMs, resourceLimits } = opts;

  if (typeof sourceCode !== "string" || !sourceCode.trim()) {
    return { ok: false, error: "source_code_required" };
  }

  // Layer 1 (defense in depth, unchanged validator.js): fast pattern
  // pre-check on the raw source before a worker is even spun up.
  const patternProbe = runValidation(
    { id: "probe.pending", name: "pending", version: "0.0.0", init() {}, destroy() {} },
    { sourceCode, isEmergentGen },
  );
  const patternsGate = patternProbe.gates.find((g) => g.name === "patterns");
  if (patternsGate && !patternsGate.passed) {
    return {
      ok: false,
      error: "validation_failed",
      validation: { valid: false, gates: [patternsGate], errors: patternsGate.errors.map((e) => `[patterns] ${e}`) },
    };
  }

  const pendingId = `pending.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;

  // The host ctx already carries the FULL existing confinement (capability
  // manifest allowlist, forbidden domains, per-actor rate cap) — the sandbox
  // reuses it verbatim rather than re-implementing (and risking divergence
  // from) that policy. This is the "sanctioned API surface" the plugin can
  // reach through, and nothing else.
  const hostCtx = buildSandboxedContext(STATE, pendingId, { runMacro, log: helpers?.log, isEmergentGen, manifest });

  const sandbox = new PluginSandbox({
    pluginId: pendingId,
    sourceCode,
    timeoutMs,
    resourceLimits,
    bridge: bridgeFromHostCtx(hostCtx),
  });

  let shape;
  try {
    shape = await sandbox.load();
  } catch (err) {
    await sandbox.destroy().catch(() => {});
    return { ok: false, error: `sandbox_load_failed: ${err.message || err}` };
  }

  // Layer 2 (defense in depth, unchanged validator.js): the full 4-gate
  // pipeline against the plugin's REAL reflected shape.
  const reflectionModule = reflectionModuleFromShape(shape);
  const validation = runValidation(reflectionModule, {
    loadedPlugins: store.loaded,
    isEmergentGen,
    sourceCode,
  });

  if (!validation.valid) {
    await sandbox.destroy().catch(() => {});
    return { ok: false, error: "validation_failed", validation };
  }

  if (!shape.id || store.loaded.has(shape.id)) {
    await sandbox.destroy().catch(() => {});
    const reason = !shape.id ? "missing_id_after_reflection" : `id_collision: plugin '${shape.id}' is already loaded`;
    return {
      ok: false,
      error: "validation_failed",
      validation: { valid: false, gates: [{ name: "namespace", passed: false, errors: [reason] }], errors: [`[namespace] ${reason}`] },
    };
  }

  return activateSandboxedPlugin(STATE, sandbox, shape, { register, isEmergentGen });
}

/**
 * Build a stub "reflection" module object from a sandbox-reported shape,
 * so the EXISTING (unmodified) validator.js gates — which expect a module
 * object with real `typeof x === "function"` exports — can run against a
 * plugin whose actual functions never leave the worker. Only typeof/shape
 * matters to the validator; the stub bodies are never invoked.
 */
function reflectionModuleFromShape(shape) {
  const stub = () => ({ ok: true });
  const macros = {};
  for (const name of shape?.macroNames || []) macros[name] = stub;
  const hooks = {};
  for (const name of shape?.hookNames || []) hooks[name] = stub;
  return {
    id: shape?.id,
    name: shape?.name,
    version: shape?.version,
    description: shape?.description,
    author: shape?.author,
    license: shape?.license,
    intent: shape?.intent || null,
    init: shape?.hasInit ? stub : undefined,
    destroy: shape?.hasDestroy ? stub : undefined,
    macros,
    hooks,
    tick: shape?.hasTick ? stub : undefined,
  };
}

/**
 * Activate a plugin whose code lives inside a `PluginSandbox` worker
 * (as opposed to `activatePlugin` below, which calls a live in-process
 * module — used by the trusted in-memory registration path, e.g.
 * emergent-gen governance activation and existing tests).
 */
async function activateSandboxedPlugin(STATE, sandbox, shape, opts = {}) {
  const store = getPluginStore(STATE);
  const { register, isEmergentGen = false } = opts;
  const pluginId = shape.id;

  let initResult;
  try {
    initResult = await sandbox.callInit();
  } catch (err) {
    store.metrics.totalFailed++;
    store.metrics.loadErrors.push({ pluginId, error: `init_threw: ${err.message || err}`, at: new Date().toISOString() });
    await sandbox.destroy().catch(() => {});
    return { ok: false, error: `init_threw: ${err.message || err}` };
  }
  if (initResult && initResult.ok === false) {
    store.metrics.totalFailed++;
    store.metrics.loadErrors.push({ pluginId, error: `init_returned_not_ok: ${initResult.error || "unknown"}`, at: new Date().toISOString() });
    await sandbox.destroy().catch(() => {});
    return { ok: false, error: `init_failed: ${initResult.error || "unknown"}` };
  }

  const registeredMacros = [];
  if (register) {
    for (const macroName of shape.macroNames || []) {
      const dotIdx = macroName.indexOf(".");
      if (dotIdx < 0) continue;
      const domain = macroName.slice(0, dotIdx);
      const action = macroName.slice(dotIdx + 1);

      // Thin proxy: the plugin's actual macro handler code never leaves the
      // sandboxed worker. Every invocation is a message round-trip, gated by
      // the same confined ctx / capability manifest used for init above.
      const wrappedHandler = async (_ctx, input = {}) => {
        store.metrics.totalMacroCalls++;
        return sandbox.callMacroHandler(macroName, input);
      };

      try {
        register(domain, action, wrappedHandler, {
          description: `[plugin:${pluginId}] ${macroName}`,
          public: true,
          plugin: pluginId,
        });
        registeredMacros.push(macroName);
      } catch (err) {
        store.metrics.loadErrors.push({ pluginId, error: `macro_register_failed: ${macroName}: ${err.message}`, at: new Date().toISOString() });
      }
    }
  }

  const registeredHooks = [];
  for (const hookName of shape.hookNames || []) {
    if (!store.hooks[hookName]) continue; // unknown hook
    if (isEmergentGen && hookName.includes("before")) continue;

    store.hooks[hookName].push({
      pluginId,
      // Hooks are historically fire-and-forget (fireHook doesn't await
      // handlers) — the proxy swallows its own rejection into loadErrors
      // rather than becoming an unhandled promise rejection.
      handler: (payload) => {
        sandbox.callHook(hookName, payload).catch((err) => {
          store.metrics.loadErrors.push({ pluginId, error: `hook_error: ${hookName}: ${err.message}`, at: new Date().toISOString() });
        });
      },
    });
    registeredHooks.push(hookName);
  }

  const record = {
    module: {
      id: pluginId,
      name: shape.name,
      version: shape.version,
      description: shape.description || "",
      author: shape.author || "unknown",
      intent: shape.intent || null,
      // Display-only sentinel for getPluginMetrics/listPlugins' `!!tick`
      // check — real tick dispatch always goes through record.sandbox.
      tick: shape.hasTick ? true : undefined,
    },
    _emergentGen: isEmergentGen,
    _sandboxed: true,
    sandbox,
    registeredMacros,
    registeredHooks,
    loadedAt: new Date().toISOString(),
    ctx: null,
  };
  store.loaded.set(pluginId, record);
  store.metrics.totalLoaded++;
  if (isEmergentGen) store.metrics.totalEmergentGen++;

  if (store.metrics.loadErrors.length > 20) {
    store.metrics.loadErrors = store.metrics.loadErrors.slice(-20);
  }

  return { ok: true, pluginId, macros: registeredMacros, hooks: registeredHooks };
}

/**
 * 2. Validate a plugin module through all 4 security gates.
 *
 * @param {Object} pluginModule - The plugin's exports
 * @param {Object} opts
 * @param {Object} STATE
 * @param {boolean} [opts.isEmergentGen=false]
 * @param {string} [opts.sourceCode]
 * @returns {{ valid, gates, errors }}
 */
export function validatePlugin(STATE, pluginModule, opts = {}) {
  const store = getPluginStore(STATE);
  return runValidation(pluginModule, {
    loadedPlugins: store.loaded,
    isEmergentGen: opts.isEmergentGen || false,
    sourceCode: opts.sourceCode,
  });
}

/**
 * 3. Build a sandboxed context for plugin initialization.
 *
 * Plugins receive a restricted view of STATE:
 *   - Read-only DTU access (via getter proxies)
 *   - Controlled macro invocation (rate-limited for emergent-gen)
 *   - Logging function
 *   - Plugin-local storage
 *
 * @param {Object} STATE
 * @param {string} pluginId
 * @param {Object} opts
 * @param {Function} [opts.runMacro] - Macro runner for plugin use
 * @param {Function} [opts.log] - Logging function
 * @param {boolean} [opts.isEmergentGen=false]
 * @returns {Object} Sandboxed context
 */
export function buildSandboxedContext(STATE, pluginId, opts = {}) {
  const { runMacro, log: logFn, isEmergentGen = false, manifest = null } = opts;

  // Item 5 — confine plugin macro access to its DECLARED manifest (default a
  // read-only creative/knowledge set; emergent-gen gets the tightest). The
  // confined runMacro enforces the capability allowlist + the forbidden-domain
  // set (code/repair/admin/config) + a per-actor rate cap. The RESERVED_NAMESPACES
  // + emergent rate-limit in callMacro below stay as defense-in-depth.
  const grants = Array.isArray(manifest?.macros) && manifest.macros.length
    ? manifest.macros
    : (isEmergentGen ? DEFAULT_EMERGENT_GEN_MACRO_GRANTS : DEFAULT_PLUGIN_MACRO_GRANTS);
  let confinedRun = runMacro;
  if (runMacro) {
    try {
      confinedRun = makeConfinedCtx({ userId: `plugin:${pluginId}`, runMacro, db: STATE?.db, manifest: { macros: grants } }).runMacro;
    } catch { confinedRun = runMacro; }
  }

  // Plugin-local storage (sandboxed per plugin)
  const localStorage = new Map();

  const ctx = {
    pluginId,

    // Read-only state access
    getDTU(id) {
      const dtu = STATE.dtus?.get(id);
      return dtu ? Object.freeze({ ...dtu }) : null;
    },

    getDTUCount() {
      return STATE.dtus?.size || 0;
    },

    getEmergent(id) {
      const es = getEmergentState(STATE);
      const emergent = es.emergents?.get(id);
      return emergent ? Object.freeze({ id: emergent.id, role: emergent.role, active: emergent.active }) : null;
    },

    // Controlled macro invocation
    callMacro(domain, name, input = {}) {
      if (!runMacro) return { ok: false, error: "macro_runner_not_available" };

      // Block reserved domains for emergent-gen
      if (isEmergentGen && RESERVED_NAMESPACES.includes(domain)) {
        return { ok: false, error: `emergent_gen_cannot_call: ${domain}.*` };
      }

      // Rate limit for emergent-gen
      if (isEmergentGen && !checkRateLimit(pluginId)) {
        return { ok: false, error: "rate_limit_exceeded" };
      }

      try {
        // Route through the confined gate (capability manifest + forbidden
        // domains + rate cap). Falls back to the raw runner only if confinement
        // couldn't be constructed.
        return confinedRun(domain, name, input);
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    },

    // Logging
    log(level, message, data) {
      if (logFn) {
        logFn(`plugin.${pluginId}`, `[${level}] ${message}`, data);
      }
    },

    // Plugin-local storage
    store: {
      get(key) { return localStorage.get(key); },
      set(key, value) { localStorage.set(key, value); },
      delete(key) { return localStorage.delete(key); },
      has(key) { return localStorage.has(key); },
      clear() { localStorage.clear(); },
    },

    // Rate limit status (emergent-gen only)
    getRateLimit() {
      return isEmergentGen ? getRateLimitStatus(pluginId) : { remaining: Infinity };
    },
  };

  return Object.freeze(ctx);
}

/**
 * 4. Compile an emergent-generated plugin.
 *
 * Delegates to runtime-compiler.js, then optionally submits for governance.
 *
 * @param {Object} STATE
 * @param {Object} proposal - Emergent plugin proposal
 * @param {Object} opts
 * @returns {{ ok, compiledModule?, pluginId?, requiresGovernance? }}
 */
export function compileEmergentPlugin(STATE, proposal, opts = {}) {
  const store = getPluginStore(STATE);

  // Count current emergent-gen plugins
  let emergentCount = 0;
  for (const plugin of store.loaded.values()) {
    if (plugin._emergentGen) emergentCount++;
  }

  const result = _compileEmergentPlugin(proposal, {
    loadedPlugins: store.loaded,
    emergentPluginCount: emergentCount,
  });

  if (!result.ok) return result;

  // Submit for governance
  const govResult = createPluginGovernanceProposal(result);
  if (govResult.ok) {
    store.pendingGovernance.set(result.pluginId, {
      proposal: govResult.proposal,
      compiledModule: result.compiledModule,
      submittedAt: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    pluginId: result.pluginId,
    requiresGovernance: true,
    governanceProposal: govResult.ok ? govResult.proposal : null,
    validation: result.validation,
  };
}

/**
 * Activate an emergent-gen plugin after governance approval.
 *
 * @param {Object} STATE
 * @param {string} pluginId
 * @param {Object} opts
 * @param {Function} opts.register - Macro registration function
 * @param {Object} opts.helpers
 * @returns {{ ok, error? }}
 */
export function activateApprovedPlugin(STATE, pluginId, opts = {}) {
  const store = getPluginStore(STATE);
  const pending = store.pendingGovernance.get(pluginId);

  if (!pending) {
    return { ok: false, error: "no_pending_plugin_with_id" };
  }

  const result = activatePlugin(STATE, pending.compiledModule, opts);
  if (result.ok) {
    store.pendingGovernance.delete(pluginId);
  }

  return result;
}

/**
 * 5. Unload a plugin gracefully.
 *
 * Calls plugin.destroy(), removes macros and hooks, cleans up state.
 *
 * @param {Object} STATE
 * @param {string} pluginId
 * @returns {{ ok, error? }}
 */
export function unloadPlugin(STATE, pluginId) {
  const store = getPluginStore(STATE);
  const record = store.loaded.get(pluginId);

  if (!record) {
    return { ok: false, error: "plugin_not_loaded" };
  }

  // Call destroy
  try {
    if (record._sandboxed && record.sandbox) {
      // Async worker teardown — fire-and-forget (unloadPlugin's contract is
      // synchronous); the worker is terminated regardless of whether the
      // plugin's own destroy() resolves cleanly.
      void record.sandbox.destroy().catch((err) => {
        store.metrics.loadErrors.push({
          pluginId,
          error: `sandbox_destroy_error: ${err.message}`,
          at: new Date().toISOString(),
        });
      });
    } else if (record.module.destroy) {
      record.module.destroy();
    }
  } catch (err) {
    // Log but don't fail — we still want to clean up
    store.metrics.loadErrors.push({
      pluginId,
      error: `destroy_error: ${err.message}`,
      at: new Date().toISOString(),
    });
  }

  // Remove hooks
  for (const [hookName, handlers] of Object.entries(store.hooks)) {
    store.hooks[hookName] = handlers.filter(h => h.pluginId !== pluginId);
  }

  // Remove from loaded
  store.loaded.delete(pluginId);
  store.metrics.totalUnloaded++;

  return { ok: true, pluginId };
}

/**
 * 6. Get plugin system metrics.
 *
 * @param {Object} STATE
 * @returns {{ ok, loaded, pending, metrics, plugins }}
 */
export function getPluginMetrics(STATE) {
  const store = getPluginStore(STATE);

  const plugins = [];
  for (const [id, record] of store.loaded) {
    plugins.push({
      id,
      name: record.module.name,
      version: record.module.version,
      isEmergentGen: !!record._emergentGen,
      macroCount: record.registeredMacros?.length || 0,
      hookCount: record.registeredHooks?.length || 0,
      hasTick: !!record.module.tick,
      loadedAt: record.loadedAt,
      author: record.module.author || "unknown",
    });
  }

  return {
    ok: true,
    loadedCount: store.loaded.size,
    pendingGovernanceCount: store.pendingGovernance.size,
    hookCounts: Object.fromEntries(
      Object.entries(store.hooks).map(([k, v]) => [k, v.length])
    ),
    metrics: { ...store.metrics, loadErrors: store.metrics.loadErrors.slice(-10) },
    plugins,
  };
}

/**
 * 7. Hot-reload a plugin (unload + reload).
 *
 * @param {Object} STATE
 * @param {string} pluginId
 * @param {Object} newModule - Updated plugin module
 * @param {Object} opts
 * @returns {{ ok, error? }}
 */
export function hotReload(STATE, pluginId, newModule, opts = {}) {
  const store = getPluginStore(STATE);

  if (!store.loaded.has(pluginId)) {
    return { ok: false, error: "plugin_not_loaded" };
  }

  // Validate new module
  const validation = validatePlugin(STATE, newModule, {
    isEmergentGen: !!newModule._emergentGen,
  });
  if (!validation.valid) {
    return { ok: false, error: "validation_failed", validation };
  }

  // Unload old
  const unloadResult = unloadPlugin(STATE, pluginId);
  if (!unloadResult.ok) return unloadResult;

  // Load new
  return activatePlugin(STATE, newModule, opts);
}

// ── Internal: Plugin Activation ─────────────────────────────────────────────

/**
 * Activate a validated plugin module.
 *
 * @param {Object} STATE
 * @param {Object} pluginModule
 * @param {Object} opts
 * @param {Function} [opts.register] - Macro registration function
 * @param {Object} [opts.helpers]
 * @param {Function} [opts.runMacro]
 * @returns {{ ok, pluginId?, error? }}
 */
function activatePlugin(STATE, pluginModule, opts = {}) {
  const store = getPluginStore(STATE);
  const { register, helpers, runMacro } = opts;
  const pluginId = pluginModule.id;
  const isEmergentGen = !!pluginModule._emergentGen;

  // Build sandboxed context
  const ctx = buildSandboxedContext(STATE, pluginId, {
    runMacro,
    log: helpers?.log,
    isEmergentGen,
    manifest: pluginModule.manifest || null,
  });

  // Call init
  try {
    const initResult = pluginModule.init(ctx);
    if (initResult && !initResult.ok) {
      store.metrics.totalFailed++;
      store.metrics.loadErrors.push({
        pluginId,
        error: `init_returned_not_ok: ${initResult.error || "unknown"}`,
        at: new Date().toISOString(),
      });
      return { ok: false, error: `init_failed: ${initResult.error || "unknown"}` };
    }
  } catch (err) {
    store.metrics.totalFailed++;
    store.metrics.loadErrors.push({
      pluginId,
      error: `init_threw: ${err.message}`,
      at: new Date().toISOString(),
    });
    return { ok: false, error: `init_threw: ${err.message}` };
  }

  // Register macros
  const registeredMacros = [];
  if (pluginModule.macros && register) {
    for (const [macroName, handler] of Object.entries(pluginModule.macros)) {
      if (typeof handler !== "function") continue;

      // Parse domain.action from macro name
      const dotIdx = macroName.indexOf(".");
      if (dotIdx < 0) continue;

      const domain = macroName.slice(0, dotIdx);
      const action = macroName.slice(dotIdx + 1);

      // Track calls
      const wrappedHandler = (_ctx, input = {}) => {
        store.metrics.totalMacroCalls++;
        return handler(_ctx, input);
      };

      try {
        register(domain, action, wrappedHandler, {
          description: `[plugin:${pluginId}] ${macroName}`,
          public: true,
          plugin: pluginId,
        });
        registeredMacros.push(macroName);
      } catch (err) {
        // Macro registration failed — log but continue
        store.metrics.loadErrors.push({
          pluginId,
          error: `macro_register_failed: ${macroName}: ${err.message}`,
          at: new Date().toISOString(),
        });
      }
    }
  }

  // Register hooks
  const registeredHooks = [];
  if (pluginModule.hooks) {
    for (const [hookName, handler] of Object.entries(pluginModule.hooks)) {
      if (typeof handler !== "function") continue;
      if (!store.hooks[hookName]) continue; // unknown hook

      // Emergent-gen: only read-only hooks (after* events)
      if (isEmergentGen && hookName.includes("before")) continue;

      store.hooks[hookName].push({ pluginId, handler });
      registeredHooks.push(hookName);
    }
  }

  // Store plugin record
  const record = {
    module: pluginModule,
    _emergentGen: isEmergentGen,
    registeredMacros,
    registeredHooks,
    loadedAt: new Date().toISOString(),
    ctx,
  };
  store.loaded.set(pluginId, record);
  store.metrics.totalLoaded++;
  if (isEmergentGen) store.metrics.totalEmergentGen++;

  // Cap load errors
  if (store.metrics.loadErrors.length > 20) {
    store.metrics.loadErrors = store.metrics.loadErrors.slice(-20);
  }

  return { ok: true, pluginId, macros: registeredMacros, hooks: registeredHooks };
}

// ── Hook Dispatch ───────────────────────────────────────────────────────────

/**
 * Fire a hook for all subscribed plugins.
 *
 * @param {Object} STATE
 * @param {string} hookName - e.g., "dtu:afterCreate"
 * @param {*} payload - Data to pass to hook handlers
 * @returns {{ ok, called, errors }}
 */
export function fireHook(STATE, hookName, payload) {
  const store = getPluginStore(STATE);
  const handlers = store.hooks[hookName];
  if (!handlers || handlers.length === 0) return { ok: true, called: 0, errors: [] };

  const errors = [];
  let called = 0;

  for (const { pluginId, handler } of handlers) {
    try {
      handler(payload);
      called++;
      store.metrics.totalHookCalls++;
    } catch (err) {
      errors.push({ pluginId, error: err.message });
    }
  }

  return { ok: true, called, errors };
}

// ── Tick Dispatch ───────────────────────────────────────────────────────────

// Maximum time a single plugin's tick() can run before we consider it
// a DoS attempt and unload the plugin. 2 seconds is generous — well-
// behaved plugins tick in milliseconds.
const PLUGIN_TICK_TIMEOUT_MS = 2000;
const PLUGIN_TICK_FAILURE_THRESHOLD = 5; // unload after N consecutive timeouts

/**
 * Run a plugin tick with a hard timeout. Works for both sync and async
 * tick functions. Returns { ok, timedOut, error }.
 */
function runTickWithTimeout(record, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, timedOut: true, error: `tick exceeded ${timeoutMs}ms budget` });
    }, timeoutMs);
    try {
      // Sandboxed plugins: the tick call is itself an async message
      // round-trip that ALSO self-terminates the worker on its own timeout
      // (see PluginSandbox#tick) — this outer race is a harmless second
      // guard, not the load-bearing one, for that case.
      const ret = record._sandboxed && record.sandbox
        ? record.sandbox.tick()
        : record.module.tick(record.ctx);
      if (ret && typeof ret.then === "function") {
        ret.then(
          () => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: true }); },
          (err) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: false, error: err?.message || String(err) }); }
        );
      } else {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true });
      }
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

/**
 * Run tick() on all loaded plugins that have a tick function.
 *
 * SECURITY: each tick runs under a hard timeout so a misbehaving plugin
 * (infinite loop, hung promise, runaway computation) can't freeze the
 * entire server. Plugins that repeatedly time out are unloaded.
 *
 * @param {Object} STATE
 * @returns {Promise<{ ok, ticked, errors, unloaded }>}
 */
export async function tickPlugins(STATE) {
  const store = getPluginStore(STATE);
  const errors = [];
  const unloaded = [];
  let ticked = 0;

  for (const [pluginId, record] of store.loaded) {
    if (!record.module.tick) continue;

    const result = await runTickWithTimeout(record, PLUGIN_TICK_TIMEOUT_MS);
    if (result.ok) {
      record._consecutiveTickFailures = 0;
      ticked++;
      store.metrics.totalTickCalls++;
    } else {
      errors.push({ pluginId, error: result.error, timedOut: !!result.timedOut });
      record._consecutiveTickFailures = (record._consecutiveTickFailures || 0) + 1;
      if (record._consecutiveTickFailures >= PLUGIN_TICK_FAILURE_THRESHOLD) {
        try {
          store.loaded.delete(pluginId);
          unloaded.push(pluginId);
          store.metrics.loadErrors.push({
            pluginId,
            error: `tick_unload: ${PLUGIN_TICK_FAILURE_THRESHOLD} consecutive failures (last: ${result.error})`,
            at: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }
    }
  }

  return { ok: true, ticked, errors, unloaded };
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Get list of loaded plugins (summary).
 */
export function listPlugins(STATE) {
  const store = getPluginStore(STATE);
  const plugins = [];

  for (const [id, record] of store.loaded) {
    plugins.push({
      id,
      name: record.module.name,
      version: record.module.version,
      description: record.module.description || "",
      author: record.module.author || "unknown",
      isEmergentGen: !!record._emergentGen,
      macros: record.registeredMacros,
      hooks: record.registeredHooks,
      hasTick: !!record.module.tick,
      loadedAt: record.loadedAt,
    });
  }

  return { ok: true, plugins, count: plugins.length };
}

/**
 * Get pending governance proposals for emergent-gen plugins.
 */
export function getPendingGovernance(STATE) {
  const store = getPluginStore(STATE);
  const pending = [];

  for (const [id, entry] of store.pendingGovernance) {
    pending.push({
      pluginId: id,
      proposal: entry.proposal,
      submittedAt: entry.submittedAt,
    });
  }

  return { ok: true, pending, count: pending.length };
}

/**
 * Get a single plugin's details.
 */
export function getPlugin(STATE, pluginId) {
  const store = getPluginStore(STATE);
  const record = store.loaded.get(pluginId);
  if (!record) return { ok: false, error: "plugin_not_loaded" };

  return {
    ok: true,
    plugin: {
      id: pluginId,
      name: record.module.name,
      version: record.module.version,
      description: record.module.description || "",
      author: record.module.author || "unknown",
      isEmergentGen: !!record._emergentGen,
      intent: record.module.intent || null,
      macros: record.registeredMacros,
      hooks: record.registeredHooks,
      hasTick: !!record.module.tick,
      loadedAt: record.loadedAt,
      rateLimit: record._emergentGen ? getRateLimitStatus(pluginId) : null,
    },
  };
}

/**
 * Register a plugin directly (in-memory, e.g. from server startup).
 * Validates + activates in one step.
 *
 * @param {Object} STATE
 * @param {Object} pluginModule
 * @param {Object} opts - { register, helpers, runMacro }
 * @returns {{ ok, pluginId?, error? }}
 */
export function registerPlugin(STATE, pluginModule, opts = {}) {
  // Validate
  const validation = validatePlugin(STATE, pluginModule, {
    isEmergentGen: !!pluginModule._emergentGen,
  });
  if (!validation.valid) {
    return { ok: false, error: "validation_failed", validation };
  }

  // Activate
  return activatePlugin(STATE, pluginModule, opts);
}
