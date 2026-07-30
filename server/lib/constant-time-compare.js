// server/lib/constant-time-compare.js
//
// One shared, length-safe constant-time string comparison for secret material
// (webhook secrets, bearer tokens, signatures).
//
// WHY THIS EXISTS
//
// Two separate defects kept recurring across the webhook/auth surface:
//
//   1. Raw `===` on a secret. `token === WEBHOOK_SECRET` short-circuits at the
//      first differing byte, so how long the comparison takes depends on how
//      much of the secret the caller guessed correctly. (Over the public
//      internet this is a weak signal — network jitter dwarfs the difference —
//      but it is a real weakness, it is free to remove, and constant-time
//      compare is the standard for this class.)
//
//   2. Bare `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`.
//      timingSafeEqual THROWS a RangeError when the two buffers differ in
//      length, so a caller sending a wrong-length signature turns an
//      authentication failure into an unhandled exception — a 500 instead of a
//      clean 401, and a liveness problem rather than a rejected request. This
//      one is easy to miss precisely because the code *looks* like the secure
//      version.
//
// Both are fixed by hashing each side to a fixed-width SHA-256 digest first
// and comparing THOSE. The digests are always 32 bytes, so timingSafeEqual can
// never throw, and no early length check is needed — which also means this
// does not leak the secret's length the way an `if (a.length !== b.length)`
// guard does.
//
// SCOPE, honestly: this removes the data-dependent-timing and the throw. It is
// not a claim about microarchitectural side channels, and it does not make a
// guessable secret safe. Use it wherever a caller-supplied value is checked
// against a secret; it is not needed for comparing two non-secret strings.

import crypto from "node:crypto";

/**
 * Constant-time comparison of two strings holding secret material.
 *
 * Safe on length mismatch (returns false, never throws) and on non-string
 * input (returns false rather than coercing something surprising).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean} true only if both are non-empty strings and equal
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default timingSafeCompare;
