/**
 * Plugin Sandbox — genuine process isolation for plugin execution.
 *
 * Context: `server/plugins/loader.js` validates a plugin through 4 static
 * gates (shape / namespace / prohibited-patterns / dependency-check) before
 * activating it, but until now the plugin's actual `init`/macro/hook/tick
 * code ran as a plain in-process JS function — full Node runtime capability,
 * with ONLY the regex pattern-ban in validator.js standing between it and
 * `fs`/`child_process`/`net`. Regex is trivially evaded (string
 * concatenation, `globalThis['requi'+'re']`, dynamic property access), so a
 * plugin that dodges the regex still has complete host capability.
 *
 * This module is the SECOND, structural layer (the static validator stays —
 * defense in depth, not a replacement): plugin source text is executed
 * inside a Node `worker_threads` Worker, with three independent isolation
 * mechanisms stacked on top of each other:
 *
 *   1. Worker thread — a separate V8 isolate/heap from the host process,
 *      with its own `resourceLimits` (heap caps) and a hard kill switch
 *      (`worker.terminate()`) the host can invoke at any time, even mid
 *      synchronous busy-loop — proven in this file's test suite.
 *
 *   2. Node's experimental permission model (`--experimental-permission`,
 *      granted with ZERO `--allow-*` flags) on that worker's `execArgv` —
 *      blocks `fs` (read + write), `child_process`, native addons, WASI,
 *      and spawning further nested workers, at the runtime/binding layer,
 *      not by pattern-matching source text.
 *
 *   3. Inside the worker, the plugin's source is evaluated as an ES module
 *      (`vm.SourceTextModule`) inside a FRESH `vm` context created with
 *      `codeGeneration: { strings: false, wasm: false }` (blocks `eval()`
 *      and `new Function(str)` structurally — V8 refuses to compile code
 *      from strings in that context at all, not merely a lint rule) and a
 *      minimal global object exposing ONLY `console` (routed back to the
 *      host as a log message) and a `ctx` bridge object. There is no
 *      `require`, no `process`, no `fetch`, no `XMLHttpRequest`, no
 *      `WebSocket`, no `import` of anything (the module linker rejects
 *      every import specifier unconditionally) — those identifiers are
 *      simply undefined in that scope, so an obfuscated reference like
 *      `globalThis['requi' + 're']` resolves to `undefined`, not merely a
 *      pattern the validator failed to catch.
 *
 * The `ctx` bridge exposes exactly the same capability surface as
 * `server/plugins/loader.js#buildSandboxedContext` (getDTU, getDTUCount,
 * getEmergent, callMacro, log, store.{get,set,has,delete,clear},
 * getRateLimit) — a plugin that only used that sanctioned API keeps working
 * unchanged; nothing else is reachable. Every bridge call crosses the
 * worker boundary as a plain, JSON-safe message; the host validates and
 * executes it through the REAL macro runtime (via the confined ctx the
 * caller supplies) — the plugin's own worker-side scope never holds a live
 * `runMacro`/`db` reference, only this message protocol.
 *
 * Message protocol (see `WORKER_BOOTSTRAP_SRC` for the worker-side half):
 *   Host  -> Worker : { type: 'call_init'|'call_macro_handler'|'call_hook'
 *                            |'call_tick'|'call_destroy', id, ...payload }
 *   Worker-> Host   : { type: 'result', id, ok, value|error }
 *   Worker-> Host   : { type: 'macro_call'|'get_dtu'|'get_dtu_count'
 *                            |'get_emergent'|'get_rate_limit'
 *                            |'store_get'|'store_set'|'store_has'
 *                            |'store_delete'|'store_clear', id, ... }
 *   Host  -> Worker : { type: 'host_reply', id, ok, value|error }
 *   Worker-> Host   : { type: 'log', level, message, data }  (fire-and-forget)
 *   Worker-> Host   : { type: 'ready', shape }  or  { type: 'load_error', error }
 *
 * `shape` is the plugin's reflected exports (id/name/version/description/
 * author/license/intent/hasInit/hasDestroy/hasTick/macroNames/hookNames) —
 * derived from evaluating the SAME module instance that later executes, so
 * there is no window where a validated shape could differ from the code
 * that actually runs.
 */

import { Worker } from "node:worker_threads";

// ── Tunables ─────────────────────────────────────────────────────────────

export const PLUGIN_SANDBOX_LOAD_TIMEOUT_MS = 5000;
export const PLUGIN_SANDBOX_CALL_TIMEOUT_MS = 3000; // init / macro handler / hook
export const PLUGIN_SANDBOX_TICK_TIMEOUT_MS = 2000; // matches loader.js's existing tick budget

export const PLUGIN_SANDBOX_DEFAULT_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
  stackSizeMb: 4,
});

// No fs, no child_process, no native addons, no WASI, no nested workers —
// granted with ZERO --allow-* flags. Net (net/http/https/dns/tls) is not
// covered by Node's permission model as of this Node version, but the vm
// context below never exposes `require`/`fetch`/etc at all, so it is
// unreachable regardless (structural absence, not a permission decision).
const WORKER_EXEC_ARGV = Object.freeze(["--experimental-permission", "--experimental-vm-modules", "--no-warnings"]);

// ── Worker bootstrap (runs INSIDE the worker thread) ────────────────────
//
// Deliberately written without template-literal interpolation (string
// concatenation only) so it can be embedded as a plain JS string literal
// here without escaping collisions.
const WORKER_BOOTSTRAP_SRC = [
  "const { parentPort, workerData } = require('worker_threads');",
  "const vm = require('node:vm');",
  "",
  "const pending = new Map();",
  "let reqCounter = 0;",
  "function hostRequest(type, payload) {",
  "  return new Promise(function (resolve, reject) {",
  "    reqCounter += 1;",
  "    var id = 'w' + reqCounter + '_' + Date.now();",
  "    pending.set(id, { resolve: resolve, reject: reject });",
  "    var msg = Object.assign({ type: type, id: id }, payload || {});",
  "    parentPort.postMessage(msg);",
  "  });",
  "}",
  "",
  "function buildCtx(pluginId) {",
  "  return Object.freeze({",
  "    pluginId: pluginId,",
  "    getDTU: function (id) { return hostRequest('get_dtu', { dtuId: id }); },",
  "    getDTUCount: function () { return hostRequest('get_dtu_count', {}); },",
  "    getEmergent: function (id) { return hostRequest('get_emergent', { emergentId: id }); },",
  "    callMacro: function (domain, name, input) { return hostRequest('macro_call', { domain: domain, name: name, input: input }); },",
  "    log: function (level, message, data) { try { parentPort.postMessage({ type: 'log', level: level, message: message, data: data }); } catch (_e) { /* best effort */ } },",
  "    store: {",
  "      get: function (key) { return hostRequest('store_get', { key: key }); },",
  "      set: function (key, value) { return hostRequest('store_set', { key: key, value: value }); },",
  "      has: function (key) { return hostRequest('store_has', { key: key }); },",
  "      delete: function (key) { return hostRequest('store_delete', { key: key }); },",
  "      clear: function () { return hostRequest('store_clear', {}); },",
  "    },",
  "    getRateLimit: function () { return hostRequest('get_rate_limit', {}); },",
  "  });",
  "}",
  "",
  "let moduleNamespace = null;",
  "let namespaceShape = null;",
  "let ctx = null;",
  "",
  "function shapeOf(ns) {",
  "  return {",
  "    id: ns.id, name: ns.name, version: ns.version,",
  "    description: ns.description, author: ns.author, license: ns.license,",
  "    intent: ns.intent || null,",
  "    hasInit: typeof ns.init === 'function',",
  "    hasDestroy: typeof ns.destroy === 'function',",
  "    hasTick: typeof ns.tick === 'function',",
  "    macroNames: ns.macros && typeof ns.macros === 'object' ? Object.keys(ns.macros) : [],",
  "    hookNames: ns.hooks && typeof ns.hooks === 'object' ? Object.keys(ns.hooks) : [],",
  "  };",
  "}",
  "",
  "async function boot() {",
  "  ctx = buildCtx(workerData.pluginId);",
  "  var sandboxGlobal = {",
  "    console: {",
  "      log: function () { try { parentPort.postMessage({ type: 'log', level: 'debug', message: 'console.log', data: Array.prototype.slice.call(arguments) }); } catch (_e) { /* best effort */ } },",
  "    },",
  "  };",
  "  try {",
  "    var vmCtx = vm.createContext(sandboxGlobal, { codeGeneration: { strings: false, wasm: false } });",
  "    var mod = new vm.SourceTextModule(workerData.source, { context: vmCtx });",
  "    await mod.link(function () { throw new Error('plugin_imports_not_allowed'); });",
  "    await mod.evaluate({ timeout: workerData.evalTimeoutMs || 4000 });",
  "    moduleNamespace = mod.namespace;",
  "    namespaceShape = shapeOf(moduleNamespace);",
  "    parentPort.postMessage({ type: 'ready', shape: namespaceShape });",
  "  } catch (e) {",
  "    parentPort.postMessage({ type: 'load_error', error: String((e && e.message) || e) });",
  "    return;",
  "  }",
  "",
  "  parentPort.on('message', async function (msg) {",
  "    if (!msg || typeof msg !== 'object') return;",
  "    if (msg.type === 'host_reply') {",
  "      var p = pending.get(msg.id);",
  "      if (p) {",
  "        pending.delete(msg.id);",
  "        if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error || 'host_reply_error'));",
  "      }",
  "      return;",
  "    }",
  "    var isCall = msg.type === 'call_init' || msg.type === 'call_macro_handler' ||",
  "      msg.type === 'call_hook' || msg.type === 'call_tick' || msg.type === 'call_destroy';",
  "    if (!isCall) return;",
  "    var id = msg.id;",
  "    try {",
  "      var value;",
  "      if (msg.type === 'call_init') {",
  "        value = namespaceShape.hasInit ? await moduleNamespace.init(ctx) : { ok: true };",
  "      } else if (msg.type === 'call_macro_handler') {",
  "        var handler = moduleNamespace.macros && moduleNamespace.macros[msg.macroName];",
  "        if (typeof handler !== 'function') throw new Error('macro_not_found: ' + msg.macroName);",
  "        value = await handler(ctx, msg.input);",
  "      } else if (msg.type === 'call_hook') {",
  "        var hookHandler = moduleNamespace.hooks && moduleNamespace.hooks[msg.hookName];",
  "        value = typeof hookHandler === 'function' ? await hookHandler(msg.payload) : undefined;",
  "      } else if (msg.type === 'call_tick') {",
  "        value = namespaceShape.hasTick ? await moduleNamespace.tick(ctx) : undefined;",
  "      } else if (msg.type === 'call_destroy') {",
  "        value = namespaceShape.hasDestroy ? await moduleNamespace.destroy() : undefined;",
  "      }",
  "      parentPort.postMessage({ type: 'result', id: id, ok: true, value: value === undefined ? null : value });",
  "    } catch (e) {",
  "      parentPort.postMessage({ type: 'result', id: id, ok: false, error: String((e && e.message) || e) });",
  "    }",
  "  });",
  "}",
  "",
  "boot().catch(function (e) {",
  "  try { parentPort.postMessage({ type: 'boot_error', error: String((e && e.message) || e) }); } catch (_e) { /* best effort */ }",
  "});",
].join("\n");

// ── Host-side bridge default (no-op / explicit-deny fallback) ───────────

function notWired(label) {
  return async () => ({ ok: false, error: `bridge_not_wired: ${label}` });
}

/**
 * Wraps a `buildSandboxedContext(...)`-shaped ctx (or any object exposing
 * the same methods) into the plain-function bridge `PluginSandbox` expects.
 * This is how loader.js should construct the bridge — it means the sandbox
 * inherits the EXACT SAME capability confinement (capability manifest,
 * forbidden domains, rate limiting) that already governs in-process plugins,
 * rather than re-implementing (and risking divergence from) that policy.
 */
export function bridgeFromHostCtx(hostCtx) {
  return {
    callMacro: (domain, name, input) => hostCtx.callMacro(domain, name, input),
    log: (level, message, data) => { try { hostCtx.log(level, message, data); } catch (_e) { /* best effort */ } },
    storeGet: (key) => hostCtx.store.get(key),
    storeSet: (key, value) => hostCtx.store.set(key, value),
    storeHas: (key) => hostCtx.store.has(key),
    storeDelete: (key) => hostCtx.store.delete(key),
    storeClear: () => hostCtx.store.clear(),
    getDTU: (id) => hostCtx.getDTU(id),
    getDTUCount: () => hostCtx.getDTUCount(),
    getEmergent: (id) => hostCtx.getEmergent(id),
    getRateLimit: () => hostCtx.getRateLimit(),
  };
}

// ── Host-side sandbox handle ─────────────────────────────────────────────

export class PluginSandbox {
  /**
   * @param {object} o
   * @param {string} o.pluginId
   * @param {string} o.sourceCode - plugin ESM source text (untrusted)
   * @param {object} [o.bridge] - { callMacro, log, storeGet, storeSet,
   *   storeHas, storeDelete, storeClear, getDTU, getDTUCount, getEmergent,
   *   getRateLimit } — see `bridgeFromHostCtx`.
   * @param {number} [o.timeoutMs] - per-RPC timeout (init/macro/hook)
   * @param {number} [o.loadTimeoutMs]
   * @param {object} [o.resourceLimits] - Worker `resourceLimits` override
   */
  constructor({ pluginId, sourceCode, bridge = {}, timeoutMs, loadTimeoutMs, resourceLimits } = {}) {
    if (typeof sourceCode !== "string" || !sourceCode.trim()) {
      throw new Error("plugin_sandbox_requires_source_code");
    }
    this.pluginId = pluginId || "pending";
    this.sourceCode = sourceCode;
    this.bridge = bridge;
    this.timeoutMs = timeoutMs || PLUGIN_SANDBOX_CALL_TIMEOUT_MS;
    this.loadTimeoutMs = loadTimeoutMs || PLUGIN_SANDBOX_LOAD_TIMEOUT_MS;
    this.resourceLimits = resourceLimits || PLUGIN_SANDBOX_DEFAULT_RESOURCE_LIMITS;
    this.worker = null;
    this.shape = null;
    this.destroyed = false;
    this._pending = new Map(); // id -> { resolve, reject, timer }
    this._counter = 0;
    this._loadPromise = null;
  }

  /**
   * Spin up the worker, evaluate the plugin source inside the isolated vm
   * context, and resolve with the plugin's reflected shape (never with a
   * live function reference — the plugin's actual code stays inside the
   * worker for the rest of its lifecycle).
   */
  load() {
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, arg) => { if (settled) return; settled = true; clearTimeout(loadTimer); fn(arg); };

      const loadTimer = setTimeout(() => {
        this._terminate();
        settle(reject, new Error(`plugin_sandbox_load_timeout: exceeded ${this.loadTimeoutMs}ms`));
      }, this.loadTimeoutMs);

      let worker;
      try {
        worker = new Worker(WORKER_BOOTSTRAP_SRC, {
          eval: true,
          execArgv: [...WORKER_EXEC_ARGV],
          workerData: { pluginId: this.pluginId, source: this.sourceCode },
          resourceLimits: { ...this.resourceLimits },
        });
      } catch (err) {
        settle(reject, err);
        return;
      }
      this.worker = worker;

      worker.on("message", (msg) => this._onMessage(msg, settle, resolve, reject));
      worker.on("error", (err) => {
        this._rejectAllPending(err);
        this._terminate();
        settle(reject, err);
      });
      worker.on("exit", (code) => {
        if (!settled && code !== 0) {
          settle(reject, new Error(`plugin_sandbox_exited_before_ready: code ${code}`));
        }
        this._rejectAllPending(new Error(`plugin_sandbox_exited: code ${code}`));
      });
    });

    return this._loadPromise;
  }

  _onMessage(msg, settleLoad, resolveLoad, rejectLoad) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "ready") {
      this.shape = msg.shape;
      settleLoad(resolveLoad, msg.shape);
      return;
    }
    if (msg.type === "load_error" || msg.type === "boot_error") {
      // The worker is still alive (its parentPort keeps the isolate
      // referenced even after it finishes reporting failure) — terminate it
      // explicitly so a rejected load() doesn't leak a live worker thread.
      this._terminate();
      settleLoad(rejectLoad, new Error(msg.error || "plugin_sandbox_load_failed"));
      return;
    }
    if (msg.type === "result") {
      const p = this._pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this._pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error || "plugin_call_failed"));
      }
      return;
    }
    if (msg.type === "log") {
      const fn = this.bridge.log || notWired("log");
      Promise.resolve(fn(msg.level, msg.message, msg.data)).catch(() => { /* best effort */ });
      return;
    }
    if (msg.type === "macro_call") {
      this._reply(msg, (m) => (this.bridge.callMacro || notWired("callMacro"))(m.domain, m.name, m.input));
      return;
    }
    if (msg.type === "get_dtu") {
      this._reply(msg, (m) => (this.bridge.getDTU || notWired("getDTU"))(m.dtuId));
      return;
    }
    if (msg.type === "get_dtu_count") {
      this._reply(msg, () => (this.bridge.getDTUCount || notWired("getDTUCount"))());
      return;
    }
    if (msg.type === "get_emergent") {
      this._reply(msg, (m) => (this.bridge.getEmergent || notWired("getEmergent"))(m.emergentId));
      return;
    }
    if (msg.type === "get_rate_limit") {
      this._reply(msg, () => (this.bridge.getRateLimit || notWired("getRateLimit"))());
      return;
    }
    if (msg.type === "store_get") {
      this._reply(msg, (m) => (this.bridge.storeGet || notWired("storeGet"))(m.key));
      return;
    }
    if (msg.type === "store_set") {
      this._reply(msg, (m) => (this.bridge.storeSet || notWired("storeSet"))(m.key, m.value));
      return;
    }
    if (msg.type === "store_has") {
      this._reply(msg, (m) => (this.bridge.storeHas || notWired("storeHas"))(m.key));
      return;
    }
    if (msg.type === "store_delete") {
      this._reply(msg, (m) => (this.bridge.storeDelete || notWired("storeDelete"))(m.key));
      return;
    }
    if (msg.type === "store_clear") {
      this._reply(msg, () => (this.bridge.storeClear || notWired("storeClear"))());
      
    }
  }

  async _reply(msg, fn) {
    try {
      const value = await fn(msg);
      this._postToWorker({ type: "host_reply", id: msg.id, ok: true, value: value === undefined ? null : value });
    } catch (err) {
      this._postToWorker({ type: "host_reply", id: msg.id, ok: false, error: String(err?.message || err) });
    }
  }

  _postToWorker(msg) {
    if (!this.worker || this.destroyed) return;
    try { this.worker.postMessage(msg); } catch (_e) { /* worker likely gone */ }
  }

  _rejectAllPending(err) {
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this._pending.delete(id);
    }
  }

  /** Generic host->worker RPC with a hard timeout that TERMINATES the worker. */
  _call(type, payload, timeoutMs) {
    if (this.destroyed) return Promise.reject(new Error("plugin_sandbox_destroyed"));
    if (!this.worker) return Promise.reject(new Error("plugin_sandbox_not_loaded"));

    this._counter += 1;
    const id = `h${this._counter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        // A runaway/malicious plugin (infinite loop, hung promise) gets
        // killed here — worker.terminate() forcibly ends the V8 isolate
        // even mid synchronous busy-loop (verified in the test suite).
        this._terminate();
        reject(new Error(`plugin_sandbox_timeout: ${type} exceeded ${timeoutMs}ms`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._postToWorker({ type, id, ...payload });
    });
  }

  async callInit() {
    return this._call("call_init", {}, this.timeoutMs);
  }

  async callMacroHandler(macroName, input) {
    return this._call("call_macro_handler", { macroName, input }, this.timeoutMs);
  }

  async callHook(hookName, payload) {
    return this._call("call_hook", { hookName, payload }, this.timeoutMs);
  }

  async tick() {
    return this._call("call_tick", {}, PLUGIN_SANDBOX_TICK_TIMEOUT_MS);
  }

  async destroy() {
    if (this.destroyed) return { ok: true };
    try {
      await this._call("call_destroy", {}, this.timeoutMs);
    } catch (_e) {
      // best effort — still tear down the worker below
    }
    await this._terminate();
    return { ok: true };
  }

  async _terminate() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._rejectAllPending(new Error("plugin_sandbox_terminated"));
    const w = this.worker;
    this.worker = null;
    if (w) {
      try { await w.terminate(); } catch (_e) { /* already exited */ }
    }
  }
}

export default PluginSandbox;
