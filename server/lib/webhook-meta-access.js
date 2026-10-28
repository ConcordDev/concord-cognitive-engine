// server/lib/webhook-meta-access.js
//
// SECURITY (fix/sec-webhook-hmac): per-webhook HMAC metadata (the signing
// secret + delivery history) is keyed by webhookId alone, so ownership must
// be enforced on every access. This module holds the ownership verdict and
// a constant-time signature comparison shared by the integrations webhook
// actions in server/domains/integrations.js.

import crypto from "node:crypto";

/**
 * Ownership verdict for webhook metadata.
 *
 * @param {{ meta?: object, actorId?: string, isAdmin?: boolean }} input
 *   - meta: the per-webhook record ({ ownerId?, secret, deliveries, … })
 *   - actorId: the calling account id ("anon"/null/undefined = not signed in)
 *   - isAdmin: pre-computed elevated-role flag
 * @returns {null} when the actor may access this webhook's meta
 * @returns {{ ok:false, status:number, code:string, error:string }} denial
 *   - 401 AUTH_REQUIRED  anonymous caller (never sees secrets)
 *   - 403 FORBIDDEN      different owner, or a legacy meta with no ownerId
 */
export function webhookMetaAccess({ meta, actorId, isAdmin } = {}) {
  // SECURITY: anonymous callers get nothing — not even an ownership probe.
  if (!actorId || actorId === "anon") {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };
  }
  if (isAdmin) return null;
  if (meta && meta.ownerId === actorId) return null;
  // SECURITY: a different owner, or a legacy meta created before ownerId was
  // stamped (ownerId undefined), is denied — legacy metas stay admin-only.
  return { ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: not your webhook" };
}

/**
 * SECURITY: constant-time string equality for signature comparison, so a
 * valid/invalid verdict cannot leak how many leading bytes matched.
 * Returns false (never throws) for non-strings or differing lengths.
 */
export function safeSignatureEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // crypto.timingSafeEqual throws on length mismatch, and HMAC signatures
  // are fixed-length anyway, so an upfront length check leaks nothing useful.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}