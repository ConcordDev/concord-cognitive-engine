/**
 * Dream → marketplace promotion bridge.
 *
 * The dream cycle produces consolidated DTUs, ghost-thread insights, and
 * cross-domain connections. Until now, none of those flowed into the
 * marketplace surface — they sat in the dream cycle's morning brief and
 * were forgotten by the next cycle.
 *
 * This module runs after each dream cycle. For each candidate produced
 * during consolidate/connect, it:
 *   1. Runs the repair-brain pre-flight (same gate as user-published DTUs)
 *   2. Scores the candidate (cross-domain breadth × novelty × consolidation
 *      factor — DTUs that came from MEGA/HYPER consolidation rank higher
 *      because they already represent compressed insight)
 *   3. Auto-creates a marketplace listing under the system creator (price 0
 *      so they're surfaced as free, with a 95% royalty back to original
 *      authors via the existing citation cascade)
 *
 * Promotion floor: dream-produced DTUs need to clear repair-brain >= 60 to
 * auto-list (vs 40 for user-published; we hold dream output to a higher bar
 * because no human is in the loop reviewing it).
 */

import { vetDTUForPublish } from "./repair-brain.js";
import { requireConsent } from "./consent.js";

const DREAM_PROMOTION_FLOOR = 60;
// Bumped 8 → 50 for 32GB / RTX PRO 4500 deployments. Override via env.
const MAX_PROMOTIONS_PER_CYCLE = Number(process.env.CONCORD_DREAM_PROMOTIONS_PER_CYCLE) || 50;

/**
 * Score a dream-produced candidate for marketplace promotion.
 * Higher score = more promotion-worthy.
 *
 * @param {object} candidate
 *    { dtuId, title, body, domains, novelty, consolidatedFrom, citations }
 * @returns {number} score 0..1
 */
export function scoreDreamCandidate(candidate) {
  if (!candidate) return 0;
  const novelty = clamp01(candidate.novelty ?? 0.5);
  const breadth = clamp01((candidate.domains?.length ?? 1) / 5);
  const consolidationFactor = candidate.consolidatedFrom?.length
    ? clamp01(Math.log(candidate.consolidatedFrom.length + 1) / Math.log(20))
    : 0.2;
  const citationStrength = clamp01((candidate.citations?.length ?? 0) / 8);
  // Weighted: novelty 35% / breadth 25% / consolidation 25% / citations 15%
  return Math.round(
    (novelty * 0.35 + breadth * 0.25 + consolidationFactor * 0.25 + citationStrength * 0.15) * 100,
  );
}

/**
 * Kind-agnostic promote/list seam. Any "X-as-DTU" promotion pipeline (dream
 * cycle today; future candidates — recipes, quotes, whatever) can reuse this
 * without duplicating the repair-brain gate + listing-shape boilerplate.
 *
 * Kind-specific behavior is supplied via `opts`:
 *   - scoreFn(candidate)          -> number 0..100 (defaults to scoreDreamCandidate
 *                                     for back-compat with the dream caller)
 *   - scoreFloor                  -> minimum score to promote (default 50)
 *   - repairFloor                 -> minimum repair-brain score (default DREAM_PROMOTION_FLOOR)
 *   - sellerLabel                 -> string written to listing.sellerId (default "system_dream_cycle")
 *   - idPrefix                    -> string prefix for the generated listing id (default "dream-listing")
 *   - promotionSource             -> string written to listing.promotionSource (default "dream_cycle")
 *   - dtuType                     -> optional string written to listing.dtuType (metadata only; undefined by default)
 *   - licenseTerms                -> optional metadata object copied onto the listing verbatim (default undefined)
 *   - userPrice                   -> optional caller-supplied price; when omitted, listing.price stays 0
 *                                     (byte-identical to the pre-refactor dream behavior)
 *   - userId                      -> the user attempting the listing; REQUIRED whenever userPrice is a
 *                                     real positive price, since a priced listing of a phenomenal-derived
 *                                     artifact (a dream DTU) requires the `allow_phenomenal_monetization`
 *                                     consent gate (docs/GOVERNANCE_DESIGN.md §2.2). Not needed for free
 *                                     (price 0/undefined) listings.
 *   - listingDefaults             -> optional object of extra fields shallow-merged onto the listing
 *
 * This function does NOT call into server/economy/* — price/licenseTerms are
 * metadata on the listing row only. Royalty distribution remains whatever it
 * already was (the citation cascade, unchanged, out of scope for this seam).
 *
 * Consent gate: a real, positive `opts.userPrice` is monetization, not mere
 * listing — it requires `requireConsent(STATE.db, opts.userId, "allow_phenomenal_monetization")`
 * to pass BEFORE anything else runs. Missing db/userId, or consent not
 * granted, is an honest `{ promoted: false, reason: "consent_required" }` —
 * never a silent priced listing. Free listings (price 0/undefined) are
 * unaffected and need no consent, matching the existing dream-cycle default.
 *
 * @returns {Promise<{ promoted: boolean, listingId?: string, score?: number, repair?: object, reason?: string, listing?: object }>}
 */
export async function promoteCandidateAsDTU(STATE, candidate, opts = {}) {
  const dtu = STATE?.dtus?.get?.(candidate.dtuId);
  if (!dtu) return { promoted: false, reason: "dtu_not_found" };

  const isMonetized = typeof opts.userPrice === "number" && Number.isFinite(opts.userPrice) && opts.userPrice > 0;
  if (isMonetized) {
    const db = STATE?.db;
    const userId = opts.userId;
    if (!db || !userId) {
      return {
        promoted: false,
        reason: "consent_required",
        consentRequired: { action: "allow_phenomenal_monetization" },
      };
    }
    const consent = requireConsent(db, userId, "allow_phenomenal_monetization");
    if (!consent.allowed) {
      return { promoted: false, reason: "consent_required", consentRequired: consent.consentRequired };
    }
  }

  const scoreFn = opts.scoreFn ?? scoreDreamCandidate;
  const promotionScore = scoreFn(candidate);
  if (promotionScore < (opts.scoreFloor ?? 50)) {
    return { promoted: false, score: promotionScore, reason: "score_below_floor" };
  }

  const repair = await vetDTUForPublish({
    title: dtu.title,
    body: dtu.human?.summary || dtu.body || "",
    tags: dtu.meta?.tags || [],
    content: dtu.content,
  });
  const repairFloor = opts.repairFloor ?? DREAM_PROMOTION_FLOOR;
  if (repair?.score !== null && repair?.score < repairFloor) {
    return { promoted: false, score: promotionScore, repair, reason: "repair_below_floor" };
  }

  const idPrefix = opts.idPrefix ?? "dream-listing";
  const sellerLabel = opts.sellerLabel ?? "system_dream_cycle";
  const promotionSource = opts.promotionSource ?? "dream_cycle";

  // Generate listing id locally (promoted listings carry a kind-specific
  // prefix so creator dashboards can surface them as algorithmically promoted).
  const listingId = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listing = {
    id: listingId,
    sourceDtuId: candidate.dtuId,
    sellerId: sellerLabel,
    scope: "marketplace",
    title: dtu.title,
    domain: dtu.domain,
    description: dtu.human?.summary || "",
    artifact: dtu.artifact ? { ...dtu.artifact } : null,
    price: opts.userPrice ?? 0, // Free unless the caller supplies a price; royalties cascade via citations.
    currency: "concord_coin",
    listedAt: new Date().toISOString(),
    downloads: 0,
    ratings: [],
    status: "active",
    repairScore: repair?.score ?? null,
    repairFlags: repair?.flags ?? [],
    promotionScore,
    promotionSource,
    consolidatedFrom: candidate.consolidatedFrom ?? [],
    ...(opts.dtuType !== undefined ? { dtuType: opts.dtuType } : {}),
    ...(opts.licenseTerms !== undefined ? { licenseTerms: opts.licenseTerms } : {}),
    ...(opts.listingDefaults || {}),
  };

  if (!STATE.marketplaceListings) STATE.marketplaceListings = new Map();
  STATE.marketplaceListings.set(listing.id, listing);

  return { promoted: true, listingId, score: promotionScore, repair, listing };
}

/**
 * Promote a single dream-produced DTU to the marketplace if it clears the
 * repair-brain floor and the score threshold.
 *
 * Thin wrapper over `promoteCandidateAsDTU` with dream-specific opts baked
 * in — behaves exactly as before for any existing caller.
 *
 * @returns {Promise<{ promoted: boolean, listingId?: string, score?: number, repair?: object, reason?: string }>}
 */
export async function promoteDreamDTU(STATE, candidate, opts = {}) {
  return promoteCandidateAsDTU(STATE, candidate, {
    scoreFn: scoreDreamCandidate,
    scoreFloor: opts.scoreFloor ?? 50,
    repairFloor: DREAM_PROMOTION_FLOOR,
    sellerLabel: "system_dream_cycle",
    idPrefix: "dream-listing",
    promotionSource: "dream_cycle",
  });
}

/**
 * Run the bridge after a dream cycle completes. Reads candidates from the
 * cycle's connect + consolidate phases.
 */
export async function runPromotionPass(STATE, cycle) {
  if (!STATE || !cycle) return { ok: false, reason: "no_state_or_cycle" };

  const candidates = collectCandidates(STATE, cycle);
  if (!candidates.length) {
    return { ok: true, candidates: 0, promoted: 0 };
  }

  const ranked = candidates
    .map(c => ({ c, s: scoreDreamCandidate(c) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_PROMOTIONS_PER_CYCLE);

  const results = [];
  for (const { c } of ranked) {
    try {
      const r = await promoteDreamDTU(STATE, c);
      results.push({ dtuId: c.dtuId, ...r });
    } catch (e) {
      results.push({ dtuId: c.dtuId, promoted: false, reason: String(e.message || e) });
    }
  }

  const promoted = results.filter(r => r.promoted).length;
  return { ok: true, candidates: candidates.length, promoted, results };
}

function collectCandidates(STATE, cycle) {
  const candidates = [];

  // From consolidate phase: MEGA/HYPER DTUs created during this cycle.
  const consolidate = cycle.phases?.consolidate?.result;
  if (consolidate?.consolidatedDtus?.length) {
    for (const id of consolidate.consolidatedDtus) {
      const dtu = STATE.dtus?.get?.(id);
      if (!dtu) continue;
      candidates.push({
        dtuId: id,
        title: dtu.title,
        body: dtu.human?.summary || "",
        domains: domainsOf(dtu),
        novelty: dtu.meta?.novelty ?? 0.6,
        consolidatedFrom: dtu.lineage?.parents ?? [],
        citations: dtu.lineage?.citations ?? [],
      });
    }
  }

  // From connect phase: cross-domain insights.
  const connect = cycle.phases?.connect?.result;
  if (connect?.insights?.length) {
    for (const ins of connect.insights) {
      if (!ins?.dtuId) continue;
      const dtu = STATE.dtus?.get?.(ins.dtuId);
      if (!dtu) continue;
      candidates.push({
        dtuId: ins.dtuId,
        title: dtu.title,
        body: dtu.human?.summary || "",
        domains: ins.domains ?? domainsOf(dtu),
        novelty: ins.novelty ?? 0.7,
        consolidatedFrom: ins.sourceDtus ?? [],
        citations: ins.citations ?? [],
      });
    }
  }

  return candidates;
}

function domainsOf(dtu) {
  const domains = new Set();
  for (const tag of dtu.tags || dtu.meta?.tags || []) {
    if (typeof tag !== "string") continue;
    if (tag.startsWith("domain:") || tag.startsWith("lens:")) {
      domains.add(tag.split(":")[1]);
    }
  }
  if (dtu.domain) domains.add(dtu.domain);
  return [...domains];
}

function clamp01(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
