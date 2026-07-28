// server/lib/chunked-json.js
//
// Event-loop-friendly JSON serialization for one large object.
//
// WHY. A single `JSON.stringify` of the ~19MB state snapshot is one
// uninterruptible block. Measured on a booted server by instrumenting
// JSON.stringify and attributing every >2MB call to its stack:
//
//   at Timeout._onTimeout (server.js, debounced saver)  n=12 maxMB=19.1 maxMs=348
//   at runBackup (server.js)                            n=1  maxMB=19.0 maxMs=317
//
// and up to 934ms for the same site under concurrent load. That is what trips
// `lib/request-admission.js`'s 300ms event-loop-lag bar and sheds live requests
// with a 503.
//
// WHAT THIS DOES AND DOES NOT DO. It does not reduce total work — the same
// bytes are produced. It caps the longest UNINTERRUPTED block at the largest
// single top-level value (~9.9MB ≈ 180ms for this snapshot), which is under the
// shed bar, by yielding between keys.
//
// `setImmediate` specifically, not `await` alone: awaiting a resolved promise
// only drains the microtask queue and never lets the poll phase run, so pending
// HTTP requests would still wait out the whole serialize. setImmediate schedules
// on the check phase, after poll — so requests are actually served in between.
//
// CALLER'S OBLIGATION — TEARING. Yielding means the object can mutate between
// keys, producing output that mixes pre- and post-mutation values. A single
// atomic stringify cannot do that. Any caller persisting the result MUST detect
// this (e.g. compare a mutation counter across the call) and discard rather
// than write a torn snapshot. This module cannot do it for them because only
// the caller knows what "changed" means for its data.

/**
 * Serialize `obj`'s own enumerable keys one at a time, yielding to the event
 * loop between each.
 *
 * Output is byte-identical to `JSON.stringify(obj)` for plain objects —
 * including key order (both follow own-enumerable insertion order) and the
 * omission of keys whose value serializes to `undefined` (functions, symbols,
 * literal undefined). Pinned by tests/chunked-json.test.js.
 *
 * @param {object} obj plain object (not an array, not null)
 * @param {(fn: () => void) => void} [scheduler] yield mechanism; injectable for tests
 * @returns {Promise<string>}
 */
export async function stringifyChunked(obj, scheduler = setImmediate) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    // Not the shape this is for — fall back to the atomic form so callers
    // can't silently get malformed output from a bad argument.
    return JSON.stringify(obj);
  }
  const keys = Object.keys(obj);
  const parts = [];
  for (const k of keys) {
    const v = JSON.stringify(obj[k]);
    // JSON.stringify returns undefined for functions/symbols/undefined. A whole
    // object stringify DROPS such keys; emitting `"k":undefined` here would
    // produce invalid JSON, so mirror the drop exactly.
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${v}`);
    await new Promise((resolve) => scheduler(resolve));
  }
  return `{${parts.join(",")}}`;
}

export default { stringifyChunked };
