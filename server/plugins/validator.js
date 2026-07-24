/**
 * Plugin Security Validator
 *
 * Every plugin — human-authored or emergent-generated — passes through
 * four sequential gates before it can be loaded:
 *
 *   Gate 1: Shape Validation
 *     - Must export { id, name, version, init, destroy }
 *     - id must match namespace.name format (a-z0-9 + dots)
 *     - version must be valid semver (loose: x.y.z)
 *     - `version` above is the PLUGIN's own release number — it says
 *       nothing about which host ctx surface the plugin was written
 *       against. Gate 1 separately checks `manifest.apiVersion` (a loose
 *       semver contract version for the host ctx surface itself, see
 *       server/lib/plugin-api-version.js + docs/PLUGIN_API_CONTRACT.md)
 *       against the host's currently-supported major-version range. A
 *       plugin with no `manifest.apiVersion` at all is treated as
 *       implicitly declaring the pre-versioning baseline ("1.0.0") for
 *       back-compat with every plugin written before this check existed.
 *
 *   Gate 2: Namespace Collision
 *     - Plugin id must not collide with existing loaded plugins
 *     - Macro names must not shadow core macros (emergent.*, system.*, loaf.*)
 *     - Emergent-gen plugins are force-namespaced under "emergent-gen."
 *
 *   Gate 3: Prohibited Patterns
 *     - No process.exit, eval, Function constructor
 *     - No require() / import() of node:child_process, node:fs, node:net
 *     - No __proto__, constructor.prototype manipulation
 *     - Emergent-gen plugins: no setTimeout/setInterval (use tick instead)
 *
 *   Gate 4: Dependency Check
 *     - Declared reads/writes must be valid state paths
 *     - Write intents checked against allowed write targets
 *     - Emergent-gen plugins: writes limited to dtus.tags, dtus.meta
 */

import {
  isCompatible as isApiVersionCompatible,
  CURRENT_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  IMPLICIT_LEGACY_API_VERSION,
} from "../lib/plugin-api-version.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;
const SEMVER_LOOSE = /^\d+\.\d+\.\d+/;

const RESERVED_NAMESPACES = Object.freeze([
  "emergent", "system", "loaf", "grc", "council", "ingest",
  "plugin", "marketplace", "federation", "atlas",
]);

const PROHIBITED_PATTERNS = Object.freeze([
  /\bprocess\s*\.\s*exit\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\brequire\s*\(\s*['"](?:child_process|node:child_process|fs|node:fs|net|node:net|dgram|node:dgram|cluster|node:cluster)/,
  /\bimport\s*\(\s*['"](?:child_process|node:child_process|fs|node:fs|net|node:net|dgram|node:dgram|cluster|node:cluster)/,
  /\b__proto__\b/,
  /\bconstructor\s*\.\s*prototype\b/,
  /\bglobalThis\s*\[/,
  /\bglobal\s*\[/,
]);

const EMERGENT_PROHIBITED_PATTERNS = Object.freeze([
  ...PROHIBITED_PATTERNS,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
]);

const VALID_READ_TARGETS = Object.freeze([
  "dtus", "edges", "emergents", "sessions", "sectors",
  "trust", "patterns", "needs", "cascades", "journal",
]);

const VALID_WRITE_TARGETS = Object.freeze([
  "dtus.tags", "dtus.meta", "dtus.confidence",
  "edges", "needs", "patterns",
]);

const EMERGENT_WRITE_TARGETS = Object.freeze([
  "dtus.tags", "dtus.meta",
]);

// ── Gate 1: Shape Validation ────────────────────────────────────────────────

function validateShape(pluginModule) {
  const errors = [];

  if (!pluginModule) {
    return { passed: false, errors: ["plugin_module_null"] };
  }

  // Required exports
  if (!pluginModule.id || typeof pluginModule.id !== "string") {
    errors.push("missing_or_invalid_id");
  } else if (!ID_PATTERN.test(pluginModule.id)) {
    errors.push(`id_format_invalid: must match namespace.name (got '${pluginModule.id}')`);
  }

  if (!pluginModule.name || typeof pluginModule.name !== "string") {
    errors.push("missing_or_invalid_name");
  }

  if (!pluginModule.version || typeof pluginModule.version !== "string") {
    errors.push("missing_or_invalid_version");
  } else if (!SEMVER_LOOSE.test(pluginModule.version)) {
    errors.push(`version_not_semver: '${pluginModule.version}'`);
  }

  if (typeof pluginModule.init !== "function") {
    errors.push("missing_init_function");
  }

  if (typeof pluginModule.destroy !== "function") {
    errors.push("missing_destroy_function");
  }

  // Optional shape checks
  if (pluginModule.macros && typeof pluginModule.macros !== "object") {
    errors.push("macros_must_be_object");
  }

  if (pluginModule.hooks && typeof pluginModule.hooks !== "object") {
    errors.push("hooks_must_be_object");
  }

  if (pluginModule.tick && typeof pluginModule.tick !== "function") {
    errors.push("tick_must_be_function");
  }

  // Host API contract version check. `manifest.apiVersion` declares which
  // major version of the ctx surface (buildSandboxedContext) the plugin was
  // written against — distinct from `pluginModule.version` (the plugin's own
  // release number, checked above). Absent apiVersion is treated as the
  // implicit pre-versioning baseline, so every plugin that predates this
  // check (including the shipped example plugin) keeps validating with zero
  // manifest change.
  const declaredApiVersion = pluginModule.manifest?.apiVersion;
  const effectiveApiVersion = (declaredApiVersion === undefined || declaredApiVersion === null)
    ? IMPLICIT_LEGACY_API_VERSION
    : declaredApiVersion;

  if (typeof effectiveApiVersion !== "string" || !isApiVersionCompatible(effectiveApiVersion)) {
    errors.push(
      `api_version_incompatible: plugin declares manifest.apiVersion '${effectiveApiVersion}', ` +
      `but this host only supports '${MIN_SUPPORTED_API_VERSION}' through '${CURRENT_API_VERSION}' ` +
      `(major version must match) — see docs/PLUGIN_API_CONTRACT.md`
    );
  }

  return { passed: errors.length === 0, errors };
}

// ── Gate 2: Namespace Collision ─────────────────────────────────────────────

function validateNamespace(pluginModule, loadedPlugins, isEmergentGen = false) {
  const errors = [];
  const id = pluginModule.id || "";

  // Emergent-gen must be namespaced
  if (isEmergentGen && !id.startsWith("emergent-gen.")) {
    errors.push(`emergent_gen_must_use_namespace: id must start with 'emergent-gen.' (got '${id}')`);
  }

  // Must not use reserved namespaces
  const topNamespace = id.split(".")[0];
  if (RESERVED_NAMESPACES.includes(topNamespace)) {
    errors.push(`reserved_namespace: '${topNamespace}' is reserved for core system`);
  }

  // Must not collide with loaded plugins
  if (loadedPlugins && loadedPlugins.has(id)) {
    errors.push(`id_collision: plugin '${id}' is already loaded`);
  }

  // Check macro name collisions
  if (pluginModule.macros) {
    for (const macroName of Object.keys(pluginModule.macros)) {
      const parts = macroName.split(".");
      if (parts.length >= 2 && RESERVED_NAMESPACES.includes(parts[0])) {
        errors.push(`macro_shadows_core: '${macroName}' uses reserved domain '${parts[0]}'`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

// ── Gate 3: Prohibited Patterns ─────────────────────────────────────────────

function validatePatterns(sourceCode, isEmergentGen = false) {
  const errors = [];
  if (!sourceCode || typeof sourceCode !== "string") {
    return { passed: true, errors: [] }; // No source to check (pre-compiled module)
  }

  const patterns = isEmergentGen ? EMERGENT_PROHIBITED_PATTERNS : PROHIBITED_PATTERNS;

  for (const pattern of patterns) {
    if (pattern.test(sourceCode)) {
      errors.push(`prohibited_pattern: ${pattern.source}`);
    }
  }

  return { passed: errors.length === 0, errors };
}

// ── Gate 4: Dependency Check ────────────────────────────────────────────────

function validateDependencies(pluginModule, isEmergentGen = false) {
  const errors = [];
  const intent = pluginModule.intent;

  if (!intent) {
    // No intent declared — that's fine for human-authored plugins
    return { passed: true, errors: [] };
  }

  // Validate read targets
  if (intent.reads) {
    for (const target of intent.reads) {
      const root = target.split(".")[0];
      if (!VALID_READ_TARGETS.includes(root)) {
        errors.push(`invalid_read_target: '${target}'`);
      }
    }
  }

  // Validate write targets
  if (intent.writes) {
    const allowed = isEmergentGen ? EMERGENT_WRITE_TARGETS : VALID_WRITE_TARGETS;
    for (const target of intent.writes) {
      if (!allowed.includes(target)) {
        errors.push(`${isEmergentGen ? "emergent_gen_" : ""}write_not_allowed: '${target}'`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

// ── Full Validation Pipeline ────────────────────────────────────────────────

/**
 * Run all 4 security gates on a plugin module.
 *
 * @param {Object} pluginModule - The plugin's exported module
 * @param {Object} opts
 * @param {Map} [opts.loadedPlugins] - Currently loaded plugin map
 * @param {boolean} [opts.isEmergentGen=false] - Whether this is emergent-generated
 * @param {string} [opts.sourceCode] - Raw source for pattern scanning
 * @returns {{ valid: boolean, gates: Object[], errors: string[] }}
 */
export function validatePlugin(pluginModule, opts = {}) {
  const { loadedPlugins, isEmergentGen = false, sourceCode } = opts;

  const gates = [
    { name: "shape", ...validateShape(pluginModule) },
    { name: "namespace", ...validateNamespace(pluginModule, loadedPlugins, isEmergentGen) },
    { name: "patterns", ...validatePatterns(sourceCode, isEmergentGen) },
    { name: "dependencies", ...validateDependencies(pluginModule, isEmergentGen) },
  ];

  const allErrors = gates.flatMap(g => g.errors.map(e => `[${g.name}] ${e}`));
  const valid = gates.every(g => g.passed);

  return { valid, gates, errors: allErrors };
}

export {
  RESERVED_NAMESPACES,
  VALID_READ_TARGETS,
  VALID_WRITE_TARGETS,
  EMERGENT_WRITE_TARGETS,
  ID_PATTERN,
};
