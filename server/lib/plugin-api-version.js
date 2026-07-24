/**
 * Plugin API Contract Version
 *
 * The plugin system's Gate 1 validator (`server/plugins/validator.js`) checks
 * a plugin's OWN `version` field — that's the plugin's own release number,
 * meaningless as a compatibility signal for the HOST surface the plugin was
 * written against. This module is the missing other half: a versioned
 * contract for the ctx surface `buildSandboxedContext` (server/plugins/
 * loader.js) actually hands a plugin — so a future change to that surface
 * (e.g. renaming `callMacro`, changing `store`'s shape) has somewhere to
 * declare the break instead of silently orphaning every installed plugin.
 *
 * The contract a plugin declares against lives at `manifest.apiVersion` (a
 * loose semver string, e.g. "1.0.0"). See docs/PLUGIN_API_CONTRACT.md for
 * the full v1 surface + the grace-period policy for future major bumps.
 *
 * Versioning model: semver-MAJOR compatibility, VS Code `engines.vscode`
 * style. A plugin declaring major version N is compatible with this host
 * iff N falls within [major(MIN_SUPPORTED_API_VERSION), major(CURRENT_API_VERSION)]
 * inclusive — i.e. the host has not yet dropped support for that major line.
 * Minor/patch digits are documentation only; they are not compared.
 */

// The real ctx shape today (server/plugins/loader.js#buildSandboxedContext):
// pluginId, getDTU, getDTUCount, getEmergent, callMacro, log,
// store.{get,set,delete,has,clear}, getRateLimit. This is API v1.
export const CURRENT_API_VERSION = "1.0.0";

// The oldest apiVersion this host still accepts. Raise this only when a
// major version is formally retired (see docs/PLUGIN_API_CONTRACT.md's
// grace-period policy) — never as a casual edit.
export const MIN_SUPPORTED_API_VERSION = "1.0.0";

// The apiVersion an existing plugin is treated as declaring when its
// manifest omits the field entirely (every plugin written before this gate
// existed, including server/plugins/installed/example-knowledge-weather).
// Fixed at "1.0.0" forever — it names the original, pre-versioning ctx
// surface, independent of wherever MIN_SUPPORTED_API_VERSION drifts to next.
export const IMPLICIT_LEGACY_API_VERSION = "1.0.0";

const SEMVER_LOOSE = /^\s*(\d+)\.(\d+)\.(\d+)/;

/**
 * Extract the major version number from a loose semver string.
 * Returns null if the string doesn't parse as `x.y.z...`.
 *
 * @param {*} version
 * @returns {number|null}
 */
function majorOf(version) {
  if (typeof version !== "string") return null;
  const m = SEMVER_LOOSE.exec(version);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Is a declared apiVersion compatible with what this host currently serves?
 *
 * Compatible iff the declared string parses as semver AND its major version
 * falls within [majorOf(MIN_SUPPORTED_API_VERSION), majorOf(CURRENT_API_VERSION)].
 * With CURRENT and MIN both at "1.0.0" today, that's simply "major === 1".
 *
 * @param {string} declaredVersion
 * @returns {boolean}
 */
export function isCompatible(declaredVersion) {
  const declaredMajor = majorOf(declaredVersion);
  if (declaredMajor === null) return false;

  const minMajor = majorOf(MIN_SUPPORTED_API_VERSION);
  const curMajor = majorOf(CURRENT_API_VERSION);
  if (minMajor === null || curMajor === null) return false;

  return declaredMajor >= minMajor && declaredMajor <= curMajor;
}
