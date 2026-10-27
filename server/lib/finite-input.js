// server/lib/finite-input.js
//
// Non-finite number guard (probe 2026-10-27, class 1: Infinity/NaN accepted).
//
// JSON cannot spell Infinity, but JSON.parse("1e999") returns Infinity and
// Number("Infinity") / Number("1e999") do too, so `Number(x) || 0` and
// `Math.max(0, Number(x) || 0)` let an infinite money value straight into a
// handler. Two layers use this file:
//   1. findNonFiniteInput — the global gate in invokeLensHandler and
//      /api/lens/run. Refuses any input that holds a non-finite number, or a
//      numeric-looking string that parses to a non-finite value, at any depth.
//      Bounded (depth and node count) so a huge body costs little; free-text
//      keys (name, title, description, ...) are never string-checked.
//   2. finiteOrNull / money / rate helpers — handler-level checks for
//      entry points that skip the gate (internal calls, tests, MCP shims).

const MAX_DEPTH = 12;
const MAX_NODES = 5000;

// Keys whose string values are free text. "NaN" or "Infinity" there is a
// word, not a number, so the string rule skips them (numbers still count).
const TEXT_KEYS = new Set([
  "name", "title", "description", "desc", "content", "text", "message", "msg",
  "body", "notes", "note", "prompt", "query", "q", "label", "bio", "comment",
  "summary", "subject", "caption", "question", "answer", "reply", "expression",
  "expr", "formula", "code", "source", "script", "tags", "tag", "keywords",
  "displayname", "username", "handle", "alias", "nickname", "slug", "search",
]);

// Only strings shaped like a number literal (or the words Infinity / NaN,
// optionally signed) are candidates. "abc", "Nancy", "infinity pool" pass.
const NUMERIC_LIKE = /^\s*[+-]?(?:Infinity|NaN|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

/** True for a string that looks numeric and parses to a non-finite value. */
export function isNonFiniteNumericString(s) {
  if (typeof s !== "string" || s.length > 400) return false;
  if (!NUMERIC_LIKE.test(s)) return false;
  return !Number.isFinite(Number(s));
}

/**
 * Walk `input` (bounded) and return the dotted path of the first non-finite
 * value, or null when clean. Past MAX_DEPTH / MAX_NODES it stops looking
 * rather than refusing.
 */
export function findNonFiniteInput(input) {
  let nodes = 0;
  const walk = (v, path, key, depth) => {
    if (++nodes > MAX_NODES) return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : (path || "(root)");
    if (typeof v === "string") {
      if (key && TEXT_KEYS.has(String(key).toLowerCase())) return null;
      return isNonFiniteNumericString(v) ? (path || "(root)") : null;
    }
    if (!v || typeof v !== "object" || depth >= MAX_DEPTH) return null;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = walk(v[i], `${path}[${i}]`, key, depth + 1);
        if (hit) return hit;
        if (nodes > MAX_NODES) return null;
      }
      return null;
    }
    // Plain objects only; skip Buffers, Dates, Maps and class instances.
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return null;
    for (const k of Object.keys(v)) {
      const hit = walk(v[k], path ? `${path}.${k}` : k, k, depth + 1);
      if (hit) return hit;
      if (nodes > MAX_NODES) return null;
    }
    return null;
  };
  return walk(input, "", null, 0);
}

/** invalid_input envelope (same shape as validateLensActionInput) or null. */
export function rejectNonFiniteInput(input) {
  const field = findNonFiniteInput(input);
  if (!field) return null;
  return { ok: false, error: "invalid_input", field, reason: "non_finite_number" };
}

/** Finite number or null. Blank / null / undefined → null. Accepts numeric strings. */
export function finiteOrNull(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Optional bounded number. Missing → fallback. Present but not finite or out
 * of [min, max] → null (caller refuses). Use: `const x = boundedNum(v, {min:0}, 0); if (x === null) return bad`.
 */
export function boundedNum(v, { min = -Infinity, max = Infinity } = {}, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = finiteOrNull(v);
  if (n === null || n < min || n > max) return null;
  return n;
}

// Upper bound for a single money field. Well above any honest value, well
// below the range where float math stops being exact to the cent.
export const MAX_MONEY = 1e12;

/** Optional money: missing → fallback, else finite in [0, MAX_MONEY] or null. */
export function moneyOrNull(v, fallback = 0) {
  return boundedNum(v, { min: 0, max: MAX_MONEY }, fallback);
}

/** Standard handler refusal for a bad numeric field. */
export function badNumber(field, message = "must be a finite number in range") {
  return { ok: false, error: "invalid_input", field, reason: "out_of_range", message: `${field} ${message}` };
}
