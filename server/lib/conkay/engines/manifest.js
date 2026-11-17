/**
 * Engine manifest — SXE-00 (ConKay solver catalogue, Wave 0).
 *
 * Every external engine ConKay can drive is declared here, once, with a
 * version pin, its licence re-read from the pinned release, how it links,
 * where its binary lives, what its health operation is, and what it costs.
 * Solvers never spawn processes directly; they go through runEngine,
 * which reads this manifest. An engine with no manifest entry does not
 * exist as far as ConKay is concerned.
 *
 * Licence discipline (catalogue rule): GPL engines run only as separate
 * processes; AGPL engines run only as separate processes AND unmodified.
 * The validator refuses entries that break either rule.
 */

const ENGINES = new Map();

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateManifestEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") return ["entry must be an object"];
  if (!ID_RE.test(entry.id || "")) errors.push("id: required, kebab-case");
  if (!entry.version || typeof entry.version !== "string") {
    errors.push("version: a pinned version string is required (no floating versions)");
  }
  if (!entry.licence || typeof entry.licence !== "string") {
    errors.push("licence: required, re-read from the pinned release");
  }
  if (!["process", "in-process"].includes(entry.linkMode)) {
    errors.push('linkMode: must be "process" or "in-process"');
  }
  const licence = String(entry.licence || "");
  if (/AGPL/i.test(licence)) {
    if (entry.linkMode !== "process") errors.push("licence: AGPL engines run only as separate processes");
    if (entry.unmodified !== true) errors.push("licence: AGPL engines must be declared unmodified: true");
  } else if (/GPL/i.test(licence)) {
    if (entry.linkMode !== "process") errors.push("licence: GPL engines run only as separate processes");
  }
  if (!entry.envVar || typeof entry.envVar !== "string") {
    errors.push("envVar: required (names the env var that overrides the binary path)");
  }
  if (!entry.defaultPath || typeof entry.defaultPath !== "string") {
    errors.push("defaultPath: required (where the binary is expected when the env var is unset)");
  }
  if (!entry.healthOp || typeof entry.healthOp !== "string") {
    errors.push("healthOp: required (the op runEngine uses as the health check)");
  }
  if (!Array.isArray(entry.ops) || entry.ops.length === 0) {
    errors.push("ops: a non-empty array of operation names is required");
  } else if (entry.healthOp && !entry.ops.includes(entry.healthOp)) {
    errors.push("healthOp: must be one of ops");
  }
  if (!entry.kernel || typeof entry.kernel !== "string") {
    errors.push("kernel: required (path of the kernel script the binary runs)");
  }
  if (!entry.installHint || typeof entry.installHint !== "string") {
    errors.push("installHint: required (surfaced verbatim in engine_unavailable results)");
  }
  if (entry.footprint != null && typeof entry.footprint !== "object") {
    errors.push("footprint: must be an object when present ({diskMb, memoryMb, threads})");
  }
  return errors;
}

export function defineEngine(entry) {
  const errors = validateManifestEntry(entry);
  if (errors.length) {
    throw new Error(`invalid engine manifest entry (${entry?.id || "?"}): ${errors.join("; ")}`);
  }
  if (ENGINES.has(entry.id)) throw new Error(`engine already defined: ${entry.id}`);
  ENGINES.set(entry.id, Object.freeze({ ...entry }));
  return ENGINES.get(entry.id);
}

export function getEngine(id) {
  return ENGINES.get(id) || null;
}

export function listEngines() {
  return [...ENGINES.values()];
}

/** Test/maintenance helper: drop all entries (never used by production paths). */
export function _clearEngines() {
  ENGINES.clear();
}
