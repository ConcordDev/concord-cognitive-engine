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
import { registerCitation } from "../economy/royalty-cascade.js";

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
 *   - userPrice                   -> optional caller-supplied price; when omitted (or 0), the promotion
 *                                     takes the FREE path — byte-identical to the pre-P-D dream behavior
 *                                     (written into STATE.marketplaceListings, a display-only store).
 *   - userId                      -> the user attempting the listing; REQUIRED whenever userPrice is a
 *                                     real positive price, since a priced listing of a phenomenal-derived
 *                                     artifact (a dream DTU) requires the `allow_phenomenal_monetization`
 *                                     consent gate (docs/GOVERNANCE_DESIGN.md §2.2). Not needed for free
 *                                     (price 0/undefined) listings. For a real (monetized) promotion this
 *                                     user also becomes the listing's `seller` — the rights-holder who
 *                                     gets paid the sale remainder on top of the citation-cascade payouts
 *                                     to the source DTUs' authors.
 *   - listingDefaults             -> optional object of extra fields shallow-merged onto the listing
 *
 * Two different stores depending on price (P-D fix, 2026-07):
 *   - FREE (price 0/undefined): unchanged — writes into STATE.marketplaceListings, the display-only
 *     store `/api/marketplace/dream-promoted` reads. That store has zero purchase readers (server.js
 *     itself calls it "the dead STATE.marketplaceListings map") — fine for a free/display listing,
 *     which was never meant to be bought, but it CANNOT be the destination for a priced listing.
 *   - MONETIZED (real opts.userPrice > 0): writes onto the underlying DTU's own `dtu.marketplace` field
 *     — the exact shape `register("marketplace","list",...)` produces and the ONLY store
 *     `marketplace.purchaseWithRoyalties` (server.js) actually reads to sell something. This is the
 *     identical defect + fix pattern documented in docs/lens-specs/creator-capability-map.md finding #3
 *     (a well-built surface pointed at a store with zero purchase readers). Money math (fee split,
 *     royalty rates) is NOT touched here — purchaseWithRoyalties' own computeRoyaltyCascade(dtu) walks
 *     dtu.lineage.parents, unchanged; see registerRemixCitations() below for how sources get wired into
 *     that lineage so the cascade actually has someone to pay.
 *
 * Consent gate: a real, positive `opts.userPrice` is monetization, not mere
 * listing — it requires `requireConsent(STATE.db, opts.userId, "allow_phenomenal_monetization")`
 * to pass BEFORE anything else runs. Missing db/userId, or consent not
 * granted, is an honest `{ promoted: false, reason: "consent_required" }` —
 * never a silent priced listing. Free listings (price 0/undefined) are
 * unaffected and need no consent, matching the existing dream-cycle default.
 *
 * @returns {Promise<{ promoted: boolean, listingId?: string, dtuId?: string, score?: number, repair?: object, reason?: string, listing?: object }>}
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

  const promotionSource = opts.promotionSource ?? "dream_cycle";
  const sourceIds = Array.from(new Set([
    ...(candidate.consolidatedFrom ?? []),
    ...(candidate.citations ?? []),
  ].filter(Boolean)));

  if (isMonetized) {
    // ── REAL store ──────────────────────────────────────────────────────
    // Same shape marketplace.list produces; the only store
    // marketplace.purchaseWithRoyalties actually reads. See docstring above.
    dtu.scope = "marketplace";
    dtu.marketplace = {
      listed: true,
      listedAt: new Date().toISOString(),
      price: opts.userPrice,
      currency: "concord_coin",
      contentType: opts.dtuType || dtu.meta?.type || "dtu_pack",
      title: dtu.title,
      description: dtu.human?.summary || "",
      tags: dtu.meta?.tags || [],
      preview: null,
      seller: opts.userId,
      purchases: 0,
      rating: null,
      reviews: [],
      repairScore: repair?.score ?? null,
      repairFlags: repair?.flags ?? [],
      promotionScore,
      promotionSource,
      consolidatedFrom: candidate.consolidatedFrom ?? [],
      ...(opts.licenseTerms !== undefined ? { licenseTerms: opts.licenseTerms } : {}),
      ...(opts.listingDefaults || {}),
    };

    // Register each source in the SQL royalty_lineage graph FIRST
    // (server/economy/royalty-cascade.js#registerCitation) — this is the
    // consent gate: a source whose author hasn't consented to citation
    // (not public/published/global AND no allow_citation grant) is
    // rejected here. ONLY sources that pass this gate are then wired into
    // dtu.lineage.parents below — the actual payout mechanism
    // purchaseWithRoyalties reads. This keeps the two systems consistent:
    // a non-consented source can never get paid just because it doesn't
    // ALSO get an audit-trail row. Ordering matters — do not swap this.
    const childCreatorId = dtu.meta?.createdBy || dtu.ownerId || opts.userId || "system_dream_cycle";
    const citationResult = registerRemixCitations(STATE, {
      childId: candidate.dtuId,
      childCreatorId,
      sourceDtuIds: sourceIds,
    });
    const paidSourceIds = citationResult.results.filter(r => r.ok).map(r => r.parentId);

    // Wire ONLY the consented sources into dtu.lineage.parents — this is
    // what computeRoyaltyCascade()/purchaseWithRoyalties ACTUALLY walks to
    // decide who gets paid (unchanged money math). Merge, don't clobber,
    // any parents already recorded on the DTU.
    if (paidSourceIds.length) {
      const existingParents = new Set(dtu.lineage?.parents ?? []);
      for (const id of paidSourceIds) existingParents.add(id);
      dtu.lineage = { ...(dtu.lineage || {}), parents: Array.from(existingParents) };
    }

    return {
      promoted: true,
      listingId: candidate.dtuId,
      dtuId: candidate.dtuId,
      score: promotionScore,
      repair,
      listing: dtu.marketplace,
      citations: citationResult,
    };
  }

  // ── FREE path — UNCHANGED from before the P-D fix ──────────────────────
  const idPrefix = opts.idPrefix ?? "dream-listing";
  const sellerLabel = opts.sellerLabel ?? "system_dream_cycle";

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
 * Register a royalty_lineage citation edge (server/economy/royalty-cascade.js
 * #registerCitation) for every source a promoted DTU was stitched from —
 * "when a dream sells, its source authors get the cascade." This does NOT
 * drive purchaseWithRoyalties' own payout math (that's dtu.lineage.parents,
 * wired by the caller above); it's the parallel, consent-gated SQL lineage
 * graph other surfaces read (getAncestorChain, getCreatorRoyalties,
 * cross-lens-discovery). Both mechanisms independently cap total royalty at
 * the same constitutional 30% (ROYALTY_RATES.MAX_TOTAL in server.js /
 * MAX_ROYALTY_RATE in royalty-cascade.js) — no numeric conflict between them.
 *
 * A source is silently skipped (not force-cited) when:
 *   - it has no resolvable creator (no meta.createdBy / ownerId), or
 *   - registerCitation's own citation-consent gate rejects it (parent not
 *     public/published/global AND the parent's owner hasn't granted
 *     allow_citation) — see registerCitation's own docstring for the 3 paths.
 *
 * No-op (returns zero counts) when STATE.db is unavailable — matches this
 * module's existing "best-effort, additive, never blocks the caller" style.
 *
 * @returns {{ registered: number, skipped: number, results: array }}
 */
export function registerRemixCitations(STATE, { childId, childCreatorId, sourceDtuIds }) {
  const db = STATE?.db;
  if (!db || !childId || !childCreatorId || !Array.isArray(sourceDtuIds) || sourceDtuIds.length === 0) {
    return { registered: 0, skipped: 0, results: [] };
  }

  const results = [];
  const seen = new Set();
  for (const parentId of sourceDtuIds) {
    if (!parentId || parentId === childId || seen.has(parentId)) continue;
    seen.add(parentId);

    const parent = STATE?.dtus?.get?.(parentId);
    const parentCreatorId = parent?.meta?.createdBy || parent?.ownerId || null;
    if (!parentCreatorId) {
      results.push({ parentId, ok: false, error: "missing_parent_creator" });
      continue;
    }

    const r = registerCitation(db, {
      childId,
      parentId,
      creatorId: childCreatorId,
      parentCreatorId,
      parentDtu: parent,
      generation: 1,
    });
    results.push({ parentId, ...r });
  }

  const registered = results.filter(r => r.ok).length;
  return { registered, skipped: results.length - registered, results };
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
 * Qualia Bazaar — promote a qualia-state snapshot DTU as a free,
 * citation-only listing. Thin wrapper over `promoteCandidateAsDTU` with
 * qualia-specific labels baked in, the same shape as `promoteDreamDTU`
 * above. Deliberately NEVER supplies `opts.userPrice`, so every call takes
 * the FREE branch of `promoteCandidateAsDTU` (STATE.marketplaceListings,
 * no consent required) — a qualia snapshot is exactly the kind of
 * phenomenal-derived artifact `allow_phenomenal_monetization` exists to
 * gate, and this seam intentionally doesn't build that payment path; it
 * only makes the snapshot discoverable + citable, reusing the proven
 * free-listing path (see the regression test pinning "free needs no
 * monetization consent"). If a real Qualia Bazaar sale path is ever built,
 * it should call `promoteCandidateAsDTU` directly with `userPrice`/`userId`
 * set — same seam, no new module needed.
 *
 * @returns {Promise<{ promoted: boolean, listingId?: string, score?: number, repair?: object, reason?: string }>}
 */
export async function promoteQualiaSnapshot(STATE, candidate, opts = {}) {
  return promoteCandidateAsDTU(STATE, candidate, {
    scoreFn: opts.scoreFn ?? scoreDreamCandidate,
    scoreFloor: opts.scoreFloor ?? 50,
    repairFloor: opts.repairFloor ?? DREAM_PROMOTION_FLOOR,
    sellerLabel: "system_qualia_bazaar",
    idPrefix: "qualia-listing",
    promotionSource: "qualia_bazaar",
    dtuType: "qualia_snapshot",
    // userPrice intentionally omitted — Qualia Bazaar is free/citation-only.
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
