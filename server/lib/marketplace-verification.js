// server/lib/marketplace-verification.js
//
// V1.2 Wave C — Creation → Economy Loop, closing the "verified means nothing"
// gap a grounding audit found: the marketplace has real royalty math and
// real provenance, but until now zero code anywhere tied a REAL check
// (an FEA structural pass, a `reason.verify` verdict) to a marketplace
// listing's presentation. "Verified" effectively meant "has royalty math,"
// not "was actually checked."
//
// This module is the honest, PURE classifier: given a resolved DTU/listing
// object, decide what — if anything — was genuinely checked, and report
// exactly that. It never calls a macro, never hits the DB, never infers
// verification from an indirect signal (price, purchase count, royalty
// cascade depth, or "has a listing at all" are NOT verification proxies).
//
// The one real, already-landed source of "was this actually checked" data
// for a marketplace listing today is server/lib/asset-gen/asset-marketplace.js
// #mintGeneratedAssetAsDtu, which stamps a verbatim FEA summary onto the
// minted DTU's `meta` field:
//   meta: {
//     kind: "generated_asset",
//     feaVerified: boolean,       // true only when the real FEA check passed
//     feaSummary: {               // copied verbatim from fea-gate.js, never
//       ok, maxUtilization, worstStress, allowable, safetyFactor,
//       tipLoadN, material, reason,
//     } | null,
//     ...
//   }
// (see that file's `summarizeFeaResult`/`mintGeneratedAssetAsDtu` — this
// module reads that exact shape and NOTHING else invents these numbers.)
//
// Checked and rejected as a second real source: `reason.verify`
// (server/lib/reason-verify.js, registered as the `reason.verify` macro).
// It IS wired elsewhere in the app (ConKay's per-message CapabilityBadge,
// concord-frontend/components/common/CapabilityBadge.tsx), but every call
// site that produces a verdict (ConKayOverlay.tsx) stores it only in
// ephemeral React state on a chat message — nothing anywhere persists a
// reason.verify verdict onto a DTU's `meta`, and no marketplace/listing
// macro calls it. There is currently no real path from "a DTU is listed on
// the marketplace" to "reason.verify has ever run on it." Per CLAUDE.md's
// honest-by-construction rule, this module does NOT fabricate that branch —
// it only classifies the state that can actually occur today (FEA verified,
// FEA present-but-failed, or no verification data at all). If a real
// DTU->reason.verify persistence path is ever added, extend this classifier
// then, backed by the new real field it would read.

/**
 * @typedef {"fea_verified"|"fea_failed"|"no_data"} ListingVerificationState
 */

export const LISTING_VERIFICATION_STATES = Object.freeze({
  FEA_VERIFIED: "fea_verified",
  FEA_FAILED: "fea_failed",
  NO_DATA: "no_data",
});

/**
 * Pull the FEA-summary-shaped fields off either a full resolved DTU object
 * (`dtu.meta.feaSummary`, `dtu.meta.feaVerified` — the shape
 * `mintGeneratedAssetAsDtu` writes) OR a flattened listing-row projection
 * (`listing.feaSummary`, `listing.feaVerified` — the shape
 * `marketplace.myListings` forwards for exactly this purpose). Reading both
 * shapes lets one classifier serve both the DTU-level and listing-level
 * callers without either one needing to know the other's field layout.
 *
 * @param {object|null|undefined} source
 * @returns {{feaSummary: object|null, feaVerified: boolean|null}}
 */
function _extractFea(source) {
  if (!source || typeof source !== "object") return { feaSummary: null, feaVerified: null };
  const feaSummary = source.feaSummary ?? source.meta?.feaSummary ?? null;
  const rawVerified = source.feaVerified ?? source.meta?.feaVerified;
  const feaVerified = typeof rawVerified === "boolean" ? rawVerified : null;
  return {
    feaSummary: feaSummary && typeof feaSummary === "object" ? feaSummary : null,
    feaVerified,
  };
}

/**
 * @typedef {object} ListingVerification
 * @property {ListingVerificationState} state
 * @property {boolean} verified        true only in the `fea_verified` state
 * @property {string} label            short, honest human-readable label
 * @property {string} detail           one-line explanation of what was (or
 *   was not) checked — never overstates what ran
 * @property {object|null} feaSummary  the REAL, verbatim FEA numbers when
 *   present (maxUtilization/worstStress/allowable/safetyFactor/tipLoadN/
 *   material) — null when no FEA check was ever attached to this listing
 */

/**
 * Classify a marketplace listing's real verification state.
 *
 * PURE function — no macro calls, no DB reads, no network. Accepts either a
 * full resolved DTU object (as returned by `dtu.get`/`resolveMarketplaceDtu`,
 * or the object `mintGeneratedAssetAsDtu` mints) or a flattened listing row
 * (as returned by `marketplace.myListings`/`marketplace.dtu_browse`) — both
 * shapes are read via `_extractFea` above.
 *
 * Three honest states, never a fourth fabricated one:
 *   - `fea_verified` — a real FEA structural check is attached AND it
 *     genuinely passed (`feaSummary.ok === true`). The only state the
 *     function calls "verified: true".
 *   - `fea_failed`   — a real FEA structural check is attached but it did
 *     NOT pass (`feaSummary.ok !== true`) — this is the honest
 *     `allowUnverified:true` mint path from asset-marketplace.js. A check
 *     genuinely ran; it did not pass. Never softened into "verified".
 *   - `no_data`      — no FEA summary object is present at all. This is the
 *     default for every non-engineering listing (music, art, plugins, DTU
 *     packs, forge apps, …) and for any engineering listing minted before
 *     this pipeline existed. NEVER defaults to looking "verified".
 *
 * The authoritative signal is `feaSummary.ok` (the verbatim engine result),
 * not the `feaVerified` convenience flag — if the two ever disagreed, this
 * function trusts the underlying summary over the mirror flag.
 *
 * @param {object|null|undefined} dtuOrListing
 * @returns {ListingVerification}
 */
export function getListingVerification(dtuOrListing) {
  const { feaSummary } = _extractFea(dtuOrListing);

  if (!feaSummary) {
    return {
      state: LISTING_VERIFICATION_STATES.NO_DATA,
      verified: false,
      label: "Not verified",
      detail: "No verification data is attached to this listing.",
      feaSummary: null,
    };
  }

  const passed = feaSummary.ok === true;
  if (passed) {
    return {
      state: LISTING_VERIFICATION_STATES.FEA_VERIFIED,
      verified: true,
      label: "FEA Verified",
      detail: `Structural FEA check passed (max utilization ${_fmt(feaSummary.maxUtilization)}` +
        `, safety factor ${_fmt(feaSummary.safetyFactor)}).`,
      feaSummary,
    };
  }

  return {
    state: LISTING_VERIFICATION_STATES.FEA_FAILED,
    verified: false,
    label: "Unverified (FEA failed)",
    detail: `A structural FEA check ran and did NOT pass (max utilization ${_fmt(feaSummary.maxUtilization)}` +
      `, safety factor ${_fmt(feaSummary.safetyFactor)}) — listed unverified at the seller's explicit request.`,
    feaSummary,
  };
}

function _fmt(n) {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(3);
  return String(Math.round(n * 1000) / 1000);
}

export default { getListingVerification, LISTING_VERIFICATION_STATES };
