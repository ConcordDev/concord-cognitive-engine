/**
 * Purchase-scoped DTU licenses.
 *
 * License object lives on the DTU (`dtu.license`). Scopes control what
 * holders / the public may do. Buying a marketplace listing grants the
 * scopes declared on that listing (via scopesGrantedByPurchase).
 *
 * Scopes:
 *   private          — owner-only; no public listen/view/post/sale
 *   public_listen    — others may stream/listen
 *   public_view      — others may view
 *   social_post      — may post/share to social feed
 *   marketplace_sale — may list for sale
 *   commercial       — commercial use
 */

export const LICENSE_SCOPES = Object.freeze([
  "private",
  "public_listen",
  "public_view",
  "social_post",
  "marketplace_sale",
  "commercial",
]);

const SCOPE_SET = new Set(LICENSE_SCOPES);

/** Aliases accepted from callers / listings. */
const SCOPE_ALIASES = Object.freeze({
  listen: "public_listen",
  listen_public: "public_listen",
  "listen/view": "public_view",
  "listen/view public": "public_view",
  view: "public_view",
  view_public: "public_view",
  public: "public_view",
  social: "social_post",
  share: "social_post",
  post: "social_post",
  sale: "marketplace_sale",
  sell: "marketplace_sale",
  marketplace: "marketplace_sale",
  list: "marketplace_sale",
});

function _now() {
  return new Date().toISOString();
}

function _uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Normalize a single scope string to a canonical LICENSE_SCOPES value.
 * @returns {string|null}
 */
export function normalizeScope(scope) {
  if (scope == null) return null;
  const raw = String(scope).trim().toLowerCase();
  if (!raw) return null;
  if (SCOPE_SET.has(raw)) return raw;
  if (SCOPE_ALIASES[raw]) return SCOPE_ALIASES[raw];
  // tolerate "public_listen|public_view" style
  return null;
}

/**
 * Normalize an array of scopes (deduped, canonical).
 */
export function normalizeScopes(scopes) {
  if (!scopes) return [];
  const list = Array.isArray(scopes) ? scopes : [scopes];
  return _uniq(list.map(normalizeScope).filter(Boolean));
}

/**
 * Build / normalize a license object for a DTU.
 *
 * Shape:
 * {
 *   scopes: string[],          // granted to the DTU itself (creator-set)
 *   holderScopes: {},          // userId -> scopes[] (purchase grants)
 *   listingScopes: string[],   // what a purchase of this listing grants
 *   version: 1,
 *   updatedAt: ISO
 * }
 */
export function normalizeLicense(input = {}, opts = {}) {
  const src = input && typeof input === "object" ? input : {};
  const scopes = normalizeScopes(
    src.scopes || src.granted || opts.defaultScopes || ["private"]
  );
  // Ensure at least private when empty
  const baseScopes = scopes.length ? scopes : ["private"];

  const holderScopes = {};
  const hs = src.holderScopes && typeof src.holderScopes === "object" ? src.holderScopes : {};
  for (const [uid, sc] of Object.entries(hs)) {
    if (!uid) continue;
    holderScopes[uid] = normalizeScopes(sc);
  }

  const listingScopes = normalizeScopes(
    src.listingScopes || src.purchaseGrants || opts.listingScopes || []
  );

  return {
    scopes: baseScopes,
    holderScopes,
    listingScopes,
    version: typeof src.version === "number" ? src.version : 1,
    updatedAt: src.updatedAt || _now(),
  };
}

/**
 * Default license at create time.
 * Personal saves start private; callers may pass scopes / license.
 */
export function defaultLicenseForCreate(input = {}) {
  const fromInput = input.license && typeof input.license === "object" ? input.license : null;
  const scopes = normalizeScopes(
    input.scopes || fromInput?.scopes || (input.visibility === "public" ? ["public_view", "public_listen"] : ["private"])
  );
  const listingScopes = normalizeScopes(
    input.listingScopes || fromInput?.listingScopes || []
  );
  return normalizeLicense({
    ...(fromInput || {}),
    scopes: scopes.length ? scopes : ["private"],
    listingScopes,
  });
}

function _licenseOf(dtu) {
  if (!dtu) return normalizeLicense({ scopes: ["private"] });
  if (dtu.license && typeof dtu.license === "object") return normalizeLicense(dtu.license);
  // Legacy fallbacks
  if (Array.isArray(dtu.scopes)) return normalizeLicense({ scopes: dtu.scopes });
  return normalizeLicense({ scopes: ["private"] });
}

function _ownerId(dtu) {
  return dtu?.ownerId || dtu?.authorId || dtu?.createdBy || dtu?.createdByUser || dtu?.meta?.createdBy || null;
}

/**
 * Effective scopes for an actor against a DTU:
 * owner → all scopes on the DTU (creator control)
 * holder → holderScopes[userId]
 * public → only public_* scopes present on the DTU itself
 */
export function effectiveScopes(dtu, actorId = null) {
  const lic = _licenseOf(dtu);
  const owner = _ownerId(dtu);
  if (actorId && owner && actorId === owner) {
    // Owner always has the scopes they set (and can act as if they hold them)
    return new Set(lic.scopes);
  }
  const held = actorId && lic.holderScopes?.[actorId] ? lic.holderScopes[actorId] : [];
  const set = new Set(held);
  // Public listen/view are ambient when present on the DTU (no purchase needed)
  for (const s of lic.scopes) {
    if (s === "public_listen" || s === "public_view") set.add(s);
  }
  return set;
}

export function hasScope(dtu, scope, actorId = null) {
  const want = normalizeScope(scope);
  if (!want) return false;
  if (want === "private") {
    // "private" means the DTU is private-only — not a grant to check
    const lic = _licenseOf(dtu);
    return lic.scopes.length === 1 && lic.scopes[0] === "private";
  }
  const owner = _ownerId(dtu);
  if (actorId && owner && actorId === owner) {
    // Owner may exercise any scope they put on the DTU, and always may
    // manage their own work even if they forgot to list it.
    const lic = _licenseOf(dtu);
    if (lic.scopes.includes(want)) return true;
    // Owner can always social_post / list their own if they grant it;
    // for enforcement of "must have scope on license", owner still needs
    // the scope present — except we treat owner+explicit grant only.
    return lic.scopes.includes(want);
  }
  return effectiveScopes(dtu, actorId).has(want);
}

export function canSocialPost(dtu, actorId = null) {
  return hasScope(dtu, "social_post", actorId);
}

export function canListForSale(dtu, actorId = null) {
  return hasScope(dtu, "marketplace_sale", actorId);
}

export function canPublicListen(dtu, actorId = null) {
  return hasScope(dtu, "public_listen", actorId);
}

export function canPublicView(dtu, actorId = null) {
  return hasScope(dtu, "public_view", actorId);
}

/**
 * Scopes a purchase of this listing grants the buyer.
 * Prefers listing.license.listingScopes / listing.purchaseScopes /
 * dtu.license.listingScopes; falls back to sensible defaults from price tier.
 */
export function scopesGrantedByPurchase(listing = {}) {
  const fromListing = normalizeScopes(
    listing.purchaseScopes ||
      listing.grantedScopes ||
      listing.license?.listingScopes ||
      listing.license?.purchaseGrants ||
      listing.listingScopes
  );
  if (fromListing.length) return fromListing;

  const dtuLic = listing.dtu?.license || listing.license;
  if (dtuLic) {
    const fromDtu = normalizeScopes(dtuLic.listingScopes || dtuLic.purchaseGrants);
    if (fromDtu.length) return fromDtu;
  }

  // Default purchase grant: listen + view (non-commercial, not resale)
  return ["public_listen", "public_view"];
}

/**
 * Assert an actor may use `scope` on `dtu`.
 * @returns {{ ok: true, scope } | { ok: false, error: string, scope: string, reason: string }}
 */
export function assertScope(dtu, scope, opts = {}) {
  const want = normalizeScope(scope);
  if (!want) {
    return { ok: false, error: "invalid_scope", scope: String(scope || ""), reason: "unknown_scope" };
  }
  const actorId = opts.actorId || opts.userId || null;
  if (hasScope(dtu, want, actorId)) {
    return { ok: true, scope: want };
  }
  return {
    ok: false,
    error: "license_scope_denied",
    scope: want,
    reason: `missing_scope:${want}`,
  };
}

/**
 * Grant purchase scopes onto dtu.license.holderScopes[buyerId].
 * Mutates dtu.license in place (normalized).
 */
export function grantPurchaseScopes(dtu, buyerId, listing = {}) {
  if (!dtu || !buyerId) return { ok: false, error: "missing_dtu_or_buyer" };
  const grants = scopesGrantedByPurchase(listing?.marketplace || listing || dtu.marketplace || {});
  // Prefer listingScopes on the DTU license if marketplace didn't declare
  const lic = normalizeLicense(dtu.license || {});
  const fromLic = normalizeScopes(lic.listingScopes);
  const finalGrants = fromLic.length ? fromLic : grants;

  const existing = lic.holderScopes[buyerId] || [];
  lic.holderScopes[buyerId] = _uniq([...existing, ...finalGrants]);
  lic.updatedAt = _now();
  dtu.license = lic;

  // Also stamp purchase meta for audit
  dtu.meta = dtu.meta || {};
  dtu.meta.licenseGrants = dtu.meta.licenseGrants || {};
  dtu.meta.licenseGrants[buyerId] = {
    scopes: lic.holderScopes[buyerId],
    grantedAt: _now(),
    fromListing: listing?.dtuId || dtu.id || null,
  };

  return { ok: true, scopes: lic.holderScopes[buyerId], license: lic };
}

/**
 * Ensure dtu.license exists (normalize in place).
 */
export function ensureLicense(dtu, input = {}) {
  if (!dtu) return null;
  dtu.license = normalizeLicense(dtu.license || defaultLicenseForCreate(input));
  return dtu.license;
}

export default {
  LICENSE_SCOPES,
  normalizeScope,
  normalizeScopes,
  normalizeLicense,
  defaultLicenseForCreate,
  effectiveScopes,
  hasScope,
  canSocialPost,
  canListForSale,
  canPublicListen,
  canPublicView,
  scopesGrantedByPurchase,
  assertScope,
  grantPurchaseScopes,
  ensureLicense,
};
