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

const DREAM_PROMOTION_FLOOR = 60;
const MAX_PROMOTIONS_PER_CYCLE = 8;

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
 * Promote a single dream-produced DTU to the marketplace if it clears the
 * repair-brain floor and the score threshold.
 *
 * @returns {Promise<{ promoted: boolean, listingId?: string, score?: number, repair?: object, reason?: string }>}
 */
export async function promoteDreamDTU(STATE, candidate, opts = {}) {
  const dtu = STATE?.dtus?.get?.(candidate.dtuId);
  if (!dtu) return { promoted: false, reason: "dtu_not_found" };

  const promotionScore = scoreDreamCandidate(candidate);
  if (promotionScore < (opts.scoreFloor ?? 50)) {
    return { promoted: false, score: promotionScore, reason: "score_below_floor" };
  }

  const repair = await vetDTUForPublish({
    title: dtu.title,
    body: dtu.human?.summary || dtu.body || "",
    tags: dtu.meta?.tags || [],
    content: dtu.content,
  });
  if (repair?.score !== null && repair?.score < DREAM_PROMOTION_FLOOR) {
    return { promoted: false, score: promotionScore, repair, reason: "repair_below_floor" };
  }

  // Generate listing id locally (dream-produced listings carry "dream:" prefix
  // so creator dashboards can surface them as algorithmically promoted).
  const listingId = `dream-listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listing = {
    id: listingId,
    sourceDtuId: candidate.dtuId,
    sellerId: "system_dream_cycle",
    scope: "marketplace",
    title: dtu.title,
    domain: dtu.domain,
    description: dtu.human?.summary || "",
    artifact: dtu.artifact ? { ...dtu.artifact } : null,
    price: 0, // Dream-promoted DTUs are free; royalties cascade via citations.
    currency: "concord_coin",
    listedAt: new Date().toISOString(),
    downloads: 0,
    ratings: [],
    status: "active",
    repairScore: repair?.score ?? null,
    repairFlags: repair?.flags ?? [],
    promotionScore,
    promotionSource: "dream_cycle",
    consolidatedFrom: candidate.consolidatedFrom ?? [],
  };

  if (!STATE.marketplaceListings) STATE.marketplaceListings = new Map();
  STATE.marketplaceListings.set(listing.id, listing);

  return { promoted: true, listingId, score: promotionScore, repair, listing };
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
