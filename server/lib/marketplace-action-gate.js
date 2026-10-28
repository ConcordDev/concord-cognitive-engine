// Marketplace action gate — ownership/checkout checks for artifact-scoped
// marketplace lens actions (`marketplace.buy`, `marketplace.sell`,
// `marketplace.issue_license` in server/server.js).
//
// SECURITY: `marketplace` is a LENS_SOCIAL_DOMAINS domain, so the generic lens
// run path lets ANY signed-in member act on ANY member's listing artifact:
//   * `buy` appended a "purchase" record with NO payment — fake sales counts
//     that feed `distribute_royalties` (computed from artifact.data.purchases);
//   * `sell` set status "listed" on anyone's artifact;
//   * `issue_license` granted a license to params.grantedTo (anyone) on
//     anyone's listing.
// Safest product default: only the listing owner (or admin/internal callers)
// may mutate a listing, and purchases must go through the paid marketplace
// checkout instead of this free lens action.

const _AUTH_REQUIRED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });
const _FORBIDDEN = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the listing owner can do this" });
const _CHECKOUT_REQUIRED = Object.freeze({ ok: false, status: 409, code: "CHECKOUT_REQUIRED", error: "purchases go through the paid marketplace checkout; this action does not record purchases" });

/**
 * Gate for owner-scoped marketplace actions (sell, issue_license).
 * Returns null when the actor is allowed (internal callers, admin-class
 * roles, or the listing's owner); otherwise a denial result the caller must
 * return verbatim. Order matters: internal/admin/owner allow first, then
 * signed-in check (401), then everyone else is a signed-in non-owner (403).
 * @param {{ isOwner?: boolean, isAdmin?: boolean, internal?: boolean, userId?: string }} input
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function marketplaceOwnerDenial(input) {
  const { isOwner, isAdmin, internal, userId } = input || {};
  if (internal === true || isAdmin === true || isOwner === true) return null;
  if (!userId || userId === "anon") return { ..._AUTH_REQUIRED };
  return { ..._FORBIDDEN };
}

/**
 * Gate for `marketplace.buy`. Returns null when the actor is internal or
 * admin-class (legacy record-appending behavior preserved for those
 * callers); otherwise a denial result the caller must return verbatim —
 * this lens action must not record purchases for members.
 * @param {{ isAdmin?: boolean, internal?: boolean }} input
 * @returns {null | { ok: false, status: number, code: string, error: string }}
 */
export function marketplaceBuyDenial(input) {
  const { isAdmin, internal } = input || {};
  if (internal === true || isAdmin === true) return null;
  return { ..._CHECKOUT_REQUIRED };
}