/**
 * canonical-result.js — canonical form for cross-surface result objects.
 *
 * Concord reaches the same action through more than one surface (a REST
 * route, the /api/lens/run dispatcher, the MCP bridge). Cohesive R-1's
 * discipline: two surfaces performing the same logical action must
 * produce the same canonical result — canonical JSON of the resulting
 * object, deep-compared — so drift between surfaces fails a test instead
 * of being caught live by a Product pass.
 *
 * This module is that comparison's normaliser, kept pure and standalone
 * so suites (and later, R-3's validator and R-5) can consume it:
 *
 *   canonicalize(value)  → a deterministic JSON string: object keys
 *                          sorted at every depth, volatile keys dropped
 *                          at every depth, undefined dropped. Arrays keep
 *                          their order (order is content).
 *   canonicalEqual(a, b) → canonicalize(a) === canonicalize(b)
 *   canonicalDiff(a, b)  → the list of paths whose normalised values
 *                          differ (a finding with locations, never just
 *                          a verdict word).
 *
 * VOLATILE_KEYS is the declared set of fields that legitimately differ
 * between two executions of the same action — the object's own identity
 * (id), its clock readings (createdAt / updatedAt), optimistic-lock
 * counters (_version), and request-scoped telemetry. The set is data,
 * exported, so a reviewer can see exactly what the comparison forgives.
 * Content-derived fields are NOT volatile: a DTU's `hash`, for example,
 * is a function of its title + rendered content, so two equivalent
 * creates must agree on it — stripping it would blind the comparison
 * to exactly the drift it exists to catch. The same holds for
 * actor-stamping fields (ownerId / authorId): two surfaces acting for
 * the same actor must stamp the same actor.
 *
 * Clean-room note: the mechanism (compare canonical serialisations of
 * two surfaces' results) is reimplemented here from the Research
 * brief's description, in Concord's own idiom. No Cohesive code was
 * read or copied — that repo carries no LICENSE (ideas yes, code no).
 */

export const VOLATILE_KEYS = Object.freeze([
  "id",
  "createdAt",
  "updatedAt",
  "_version",
  "requestId",
  "runId",
  "durationMs",
  "elapsedMs",
]);

const volatileSet = (extra) => new Set([...VOLATILE_KEYS, ...(extra || [])]);

/** Normalise a value into its canonical tree (volatile keys removed). */
export function canonicalTree(value, volatileKeys) {
  const drop = volatileSet(volatileKeys);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const key of Object.keys(v).sort()) {
        if (drop.has(key)) continue;
        const child = walk(v[key]);
        if (child !== undefined) out[key] = child;
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

/** The canonical JSON string for a result object. */
export function canonicalize(value, volatileKeys) {
  return JSON.stringify(canonicalTree(value, volatileKeys));
}

/** Deep equality over canonical forms. */
export function canonicalEqual(a, b, volatileKeys) {
  return canonicalize(a, volatileKeys) === canonicalize(b, volatileKeys);
}

/**
 * The paths at which two results' canonical forms differ — the evidence
 * a reviewer reads. Paths use dot notation with [i] for array indexes;
 * a path present on one side only is reported once, at the highest
 * missing level. Capped so a wholesale divergence stays readable.
 */
export function canonicalDiff(a, b, volatileKeys, cap = 50) {
  const ta = canonicalTree(a, volatileKeys);
  const tb = canonicalTree(b, volatileKeys);
  const diffs = [];
  const walk = (x, y, path) => {
    if (diffs.length >= cap) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const xObj = x && typeof x === "object";
    const yObj = y && typeof y === "object";
    if (!xObj || !yObj || Array.isArray(x) !== Array.isArray(y)) {
      diffs.push(path || "(root)");
      return;
    }
    if (Array.isArray(x)) {
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n && diffs.length < cap; i++) {
        if (i >= x.length || i >= y.length) { diffs.push(`${path}[${i}]`); continue; }
        walk(x[i], y[i], `${path}[${i}]`);
      }
      return;
    }
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    for (const key of keys) {
      if (diffs.length >= cap) return;
      const p = path ? `${path}.${key}` : key;
      if (!(key in x) || !(key in y)) { diffs.push(p); continue; }
      walk(x[key], y[key], p);
    }
  };
  walk(ta, tb, "");
  return diffs;
}

export default { VOLATILE_KEYS, canonicalTree, canonicalize, canonicalEqual, canonicalDiff };
