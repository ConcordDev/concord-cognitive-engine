/**
 * Vector clocks — causal ordering with no global clock.
 *
 * A vector clock is a plain object mapping `nodeId -> counter`. Missing keys
 * are treated as 0. This is the mechanism that replaces wall-clock
 * last-write-wins (the pattern `server/emergent/merge.js` uses for its scalar
 * merge path, with a naive 1-second "concurrency window") with genuine
 * causal history: two events with no causal path between them are
 * **concurrent**, not arbitrarily ordered by whichever machine's clock
 * happened to be ahead.
 *
 * Four operations, deliberately minimal:
 *   - create(nodeId?)         — a fresh clock, optionally seeded at 0 for nodeId
 *   - increment(vc, nodeId)   — bump nodeId's own counter (monotone, immutable)
 *   - merge(a, b)             — pointwise max across the union of keys
 *   - compare(a, b)           — 'before' | 'after' | 'concurrent' | 'equal'
 *
 * All functions are pure — they never mutate their inputs, so a caller can
 * safely hand the same clock object to multiple call sites.
 */

/**
 * A fresh vector clock. With no argument, an empty clock (all implicit 0s).
 * With a nodeId, a clock seeded at 0 for that node (equivalent to `{}` under
 * `compare`/`merge` since 0 is the implicit default — provided purely so
 * callers have an explicit starting point to `increment` from).
 *
 * @param {string} [nodeId]
 * @returns {Object<string, number>}
 */
export function create(nodeId) {
  if (nodeId === undefined || nodeId === null) return {};
  return { [nodeId]: 0 };
}

/**
 * Bump `nodeId`'s own counter by 1. Immutable — returns a new object, never
 * mutates `vc`. Monotone: the returned clock's `nodeId` entry is always
 * exactly one greater than the input's (0 if absent).
 *
 * @param {Object<string, number>} vc
 * @param {string} nodeId
 * @returns {Object<string, number>}
 */
export function increment(vc, nodeId) {
  if (!nodeId || typeof nodeId !== "string") {
    throw new Error("increment requires a non-empty nodeId");
  }
  const next = { ...(vc || {}) };
  next[nodeId] = (Number.isFinite(next[nodeId]) ? next[nodeId] : 0) + 1;
  return next;
}

/**
 * Pointwise max across the union of both clocks' keys. This is how a
 * replica that has observed two independent causal branches folds them into
 * a single clock that dominates both.
 *
 * @param {Object<string, number>} a
 * @param {Object<string, number>} b
 * @returns {Object<string, number>}
 */
export function merge(a, b) {
  const out = {};
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const av = Number.isFinite(a?.[k]) ? a[k] : 0;
    const bv = Number.isFinite(b?.[k]) ? b[k] : 0;
    out[k] = av > bv ? av : bv;
  }
  return out;
}

/**
 * Compare two vector clocks and classify their causal relationship.
 *
 * Returns, from a's perspective:
 *   - 'equal'      — a and b are componentwise identical
 *   - 'before'     — a happened-before b (a <= b componentwise, and a != b)
 *   - 'after'      — a happened-after b  (a >= b componentwise, and a != b)
 *   - 'concurrent' — neither dominates the other (some component of a is
 *                    greater, some component of b is greater) — genuinely
 *                    unordered, the case wall-clock LWW gets wrong.
 *
 * @param {Object<string, number>} a
 * @param {Object<string, number>} b
 * @returns {'before'|'after'|'concurrent'|'equal'}
 */
export function compare(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  let aLessOrEqualB = true; // a[k] <= b[k] for every key seen so far
  let bLessOrEqualA = true; // b[k] <= a[k] for every key seen so far
  for (const k of keys) {
    const av = Number.isFinite(a?.[k]) ? a[k] : 0;
    const bv = Number.isFinite(b?.[k]) ? b[k] : 0;
    if (av > bv) aLessOrEqualB = false;
    if (bv > av) bLessOrEqualA = false;
  }
  if (aLessOrEqualB && bLessOrEqualA) return "equal";
  if (aLessOrEqualB) return "before"; // a <= b componentwise, not equal
  if (bLessOrEqualA) return "after"; // a >= b componentwise, not equal
  return "concurrent";
}
