/**
 * Reputation badges + milestone notifications.
 *
 * Watches creator metrics (citations received, downloads, lineage depth,
 * listings published) and grants tiered badges as thresholds cross.
 *
 * Tier table:
 *   citations_received: bronze 5, silver 25, gold 100, platinum 500, diamond 2000
 *   downloads:          bronze 10, silver 100, gold 1000, platinum 10000, diamond 100000
 *   lineage_depth:      bronze 2, silver 4, gold 6, platinum 8, diamond 10
 *   listings:           bronze 1, silver 5, gold 25, platinum 100, diamond 500
 *
 * Each badge is awarded once per (userId, badgeKey). Award fires a
 * realtime "reputation:badge-earned" event scoped to the user.
 */

const TIER_TABLE = {
  citations_received: [
    { tier: "bronze",   threshold: 5,    label: "First Citation" },
    { tier: "silver",   threshold: 25,   label: "Cited Voice" },
    { tier: "gold",     threshold: 100,  label: "Influential" },
    { tier: "platinum", threshold: 500,  label: "Pillar" },
    { tier: "diamond",  threshold: 2000, label: "Cornerstone" },
  ],
  downloads: [
    { tier: "bronze",   threshold: 10,     label: "First Reach" },
    { tier: "silver",   threshold: 100,    label: "Spreading" },
    { tier: "gold",     threshold: 1000,   label: "Distributor" },
    { tier: "platinum", threshold: 10000,  label: "Multiplier" },
    { tier: "diamond",  threshold: 100000, label: "Cultural Force" },
  ],
  lineage_depth: [
    { tier: "bronze",   threshold: 2,  label: "Forked" },
    { tier: "silver",   threshold: 4,  label: "Deep Tree" },
    { tier: "gold",     threshold: 6,  label: "Founding Lineage" },
    { tier: "platinum", threshold: 8,  label: "Generational" },
    { tier: "diamond",  threshold: 10, label: "Mythic Lineage" },
  ],
  listings: [
    { tier: "bronze",   threshold: 1,   label: "Listed" },
    { tier: "silver",   threshold: 5,   label: "Curator" },
    { tier: "gold",     threshold: 25,  label: "Workshop" },
    { tier: "platinum", threshold: 100, label: "Studio" },
    { tier: "diamond",  threshold: 500, label: "Atelier" },
  ],
  // Knowledge Entrepreneur — composite tier evaluated from a weighted
  // combination of citations + downloads + listings + lineage. Distinct
  // from the four single-axis ladders above so a creator who's strong
  // across all axes earns a recognisable headline tier instead of a
  // patchwork of single-axis badges.
  //
  // Score formula (computed inline below): `score = citationsReceived
  // + downloads/10 + listings*5 + lineageDepth*20`. The weights mean a
  // single citation is worth ten downloads, a single listing is worth
  // five citations, and lineage depth is the strongest signal (a
  // generational creator is rare).
  knowledge_entrepreneur: [
    { tier: "bronze",   threshold: 50,    label: "Knowledge Trader" },
    { tier: "silver",   threshold: 250,   label: "Knowledge Operator" },
    { tier: "gold",     threshold: 1000,  label: "Knowledge Entrepreneur" },
    { tier: "platinum", threshold: 5000,  label: "Knowledge Magnate" },
    { tier: "diamond",  threshold: 20000, label: "Knowledge Sovereign" },
  ],
};

/**
 * Composite knowledge-entrepreneur score. Weights chosen so the four
 * underlying axes are commensurate at thresholds that feel earned:
 * citations are the canonical signal (1× weight), downloads are noisier
 * (1/10× weight), listings are work (5× weight), lineage depth is rare
 * (20× weight).
 */
function computeKnowledgeEntrepreneurScore({ citationsReceived = 0, downloads = 0, listings = 0, lineageDepth = 0 }) {
  return citationsReceived + (downloads / 10) + (listings * 5) + (lineageDepth * 20);
}

const _granted = new Map(); // userId -> Set<badgeKey>

function badgeKey(category, tier) { return `${category}:${tier}`; }

/**
 * Check creator metrics and grant any newly-qualified badges.
 *
 * @param {object} args
 *   userId, citationsReceived, downloads, lineageDepth, listings, emit?
 * @returns {{ ok, granted: Array<{key, label, tier, category}> }}
 */
export function evaluateBadges({ userId, citationsReceived = 0, downloads = 0, lineageDepth = 0, listings = 0, emit = null }) {
  if (!userId) return { ok: false, error: "userId_required", granted: [] };
  if (!_granted.has(userId)) _granted.set(userId, new Set());
  const have = _granted.get(userId);
  const newly = [];

  const keScore = computeKnowledgeEntrepreneurScore({ citationsReceived, downloads, listings, lineageDepth });
  const checks = [
    ["citations_received",     citationsReceived],
    ["downloads",              downloads],
    ["lineage_depth",          lineageDepth],
    ["listings",               listings],
    ["knowledge_entrepreneur", keScore],
  ];
  for (const [category, value] of checks) {
    for (const t of TIER_TABLE[category]) {
      if (value < t.threshold) break;
      const key = badgeKey(category, t.tier);
      if (have.has(key)) continue;
      have.add(key);
      newly.push({ key, label: t.label, tier: t.tier, category, threshold: t.threshold, ts: Date.now() });
    }
  }

  if (newly.length > 0 && typeof emit === "function") {
    for (const b of newly) {
      try { emit(userId, "reputation:badge-earned", b); } catch { /* emit silent */ }
    }
  }

  return { ok: true, granted: newly, total: have.size };
}

export function listBadges(userId) {
  if (!userId) return { ok: true, badges: [] };
  const set = _granted.get(userId) ?? new Set();
  const out = [];
  for (const key of set) {
    const [category, tier] = key.split(":");
    const meta = (TIER_TABLE[category] ?? []).find(t => t.tier === tier);
    if (meta) out.push({ key, category, tier, label: meta.label, threshold: meta.threshold });
  }
  return { ok: true, badges: out };
}

/**
 * Bulk evaluator: scan all known creators in STATE and award any badges
 * they've earned but don't yet hold. Designed for periodic invocation
 * from the heartbeat tick.
 */
export async function sweepAllCreators(STATE, emit = null) {
  const cd = await import("./creator-dashboard.js");
  const board = cd.computeReputationLeaderboard(STATE, { limit: 1000 });
  const creators = board?.creators ?? [];
  let totalGranted = 0;
  for (const c of creators) {
    const dash = cd.computeCreatorDashboard(c.userId, STATE);
    if (!dash?.summary) continue;
    const r = evaluateBadges({
      userId: c.userId,
      citationsReceived: dash.summary.citationsReceived,
      downloads: dash.summary.totalDownloads,
      lineageDepth: dash.summary.lineageDepth,
      listings: dash.summary.listingCount,
      emit,
    });
    totalGranted += r.granted.length;
  }
  return { ok: true, scanned: creators.length, granted: totalGranted };
}
