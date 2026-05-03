/**
 * Creator dashboard + reputation surfaces.
 *
 * Single module that produces:
 *   • computeCreatorDashboard(userId, STATE)
 *       — earnings, lineage stats, promotion progress for one user
 *   • computeReputationLeaderboard(STATE, opts)
 *       — top creators by earnings / citations / lineage depth
 *   • computeTrendingCitations(STATE)
 *       — DTUs whose citation graph grew most in the last 24h
 *   • computeInfluenceDrift(STATE)
 *       — creators whose share of total citations is rising or falling fastest
 *
 * All four are read-only views over STATE.dtus + STATE.marketplaceListings.
 */

const TRENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Per-creator dashboard.
 *
 * @param {string} userId
 * @param {object} STATE
 * @returns {{
 *   userId: string,
 *   summary: {
 *     dtuCount: number,
 *     listingCount: number,
 *     totalDownloads: number,
 *     totalEarnings: number,
 *     citationsReceived: number,
 *     citationsMade: number,
 *     lineageDepth: number,
 *     reputationScore: number,
 *   },
 *   recentDTUs: object[],
 *   recentListings: object[],
 *   topCitedDTUs: object[],
 * }}
 */
export function computeCreatorDashboard(userId, STATE) {
  if (!userId) return { ok: false, error: "user_id_required" };

  const myDtus = [];
  const myListings = [];
  let citationsReceived = 0;
  let citationsMade = 0;
  let totalDownloads = 0;
  let totalEarnings = 0;
  let maxLineageDepth = 0;

  const myDtuIds = new Set();

  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    if (dtu.ownerId === userId || dtu.creatorId === userId) {
      myDtus.push(dtu);
      myDtuIds.add(dtu.id);
      const cited = dtu.lineage?.citations?.length ?? 0;
      citationsMade += cited;
      const depth = dtu.lineage?.depth ?? 0;
      if (depth > maxLineageDepth) maxLineageDepth = depth;
    }
  }

  // Pass 2: count incoming citations (DTUs that cite my DTUs).
  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    const parents = dtu.lineage?.parents ?? [];
    const cites   = dtu.lineage?.citations ?? [];
    for (const p of parents) {
      if (myDtuIds.has(p)) citationsReceived++;
    }
    for (const c of cites) {
      const cId = typeof c === "string" ? c : c?.dtuId;
      if (cId && myDtuIds.has(cId)) citationsReceived++;
    }
  }

  // Listings + earnings + downloads.
  for (const l of (STATE.marketplaceListings?.values?.() ?? [])) {
    if (l.sellerId === userId) {
      myListings.push(l);
      totalDownloads += l.downloads || 0;
      totalEarnings += (l.downloads || 0) * (l.price || 0);
    }
  }

  // Reputation score: weighted combination.
  const reputationScore = Math.round(
    (citationsReceived * 4 +
     totalDownloads * 1 +
     myDtus.length * 0.5 +
     maxLineageDepth * 8) * 10,
  ) / 10;

  // Top cited DTUs by reputation effect.
  const myDtusWithCites = myDtus.map(d => ({
    id: d.id,
    title: d.title,
    domain: d.domain,
    citationsReceived: countIncomingCitations(d.id, STATE),
    createdAt: d.createdAt,
  }));
  myDtusWithCites.sort((a, b) => b.citationsReceived - a.citationsReceived);

  const recentDTUs = [...myDtus]
    .sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt))
    .slice(0, 8)
    .map(d => ({ id: d.id, title: d.title, domain: d.domain, createdAt: d.createdAt }));

  const recentListings = myListings
    .sort((a, b) => parseTime(b.listedAt) - parseTime(a.listedAt))
    .slice(0, 8)
    .map(l => ({
      id: l.id,
      sourceDtuId: l.sourceDtuId,
      title: l.title,
      price: l.price,
      downloads: l.downloads,
      promotionSource: l.promotionSource ?? null,
      listedAt: l.listedAt,
    }));

  return {
    ok: true,
    userId,
    summary: {
      dtuCount: myDtus.length,
      listingCount: myListings.length,
      totalDownloads,
      totalEarnings,
      citationsReceived,
      citationsMade,
      lineageDepth: maxLineageDepth,
      reputationScore,
    },
    recentDTUs,
    recentListings,
    topCitedDTUs: myDtusWithCites.slice(0, 8),
  };
}

/**
 * Top creators leaderboard.
 *
 * @returns {{ ok: true, creators: Array<{ userId, dtuCount, citations, downloads, score }> }}
 */
export function computeReputationLeaderboard(STATE, opts = {}) {
  const limit = opts.limit ?? 25;
  const totals = new Map(); // userId -> { dtuCount, citations, downloads }

  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    const owner = dtu.ownerId || dtu.creatorId;
    if (!owner) continue;
    if (!totals.has(owner)) totals.set(owner, { dtuCount: 0, citations: 0, downloads: 0 });
    const t = totals.get(owner);
    t.dtuCount++;
    t.citations += countIncomingCitations(dtu.id, STATE);
  }
  for (const l of (STATE.marketplaceListings?.values?.() ?? [])) {
    const t = totals.get(l.sellerId);
    if (t) t.downloads += l.downloads || 0;
  }

  const creators = [...totals.entries()].map(([userId, t]) => ({
    userId,
    ...t,
    score: t.citations * 4 + t.downloads + t.dtuCount * 0.5,
  }));
  creators.sort((a, b) => b.score - a.score);
  return { ok: true, creators: creators.slice(0, limit) };
}

/**
 * DTUs whose citation graph grew most in the last 24h.
 */
export function computeTrendingCitations(STATE) {
  const now = Date.now();
  const recent = [];

  // For every DTU cited in a child created in the last 24h, increment a
  // counter on the cited DTU.
  const cited24h = new Map(); // dtuId -> count
  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    const created = parseTime(dtu.createdAt);
    if (now - created > TRENDING_WINDOW_MS) continue;
    const parents = dtu.lineage?.parents ?? [];
    const cites   = dtu.lineage?.citations ?? [];
    for (const p of parents) bump(cited24h, p);
    for (const c of cites) bump(cited24h, typeof c === "string" ? c : c?.dtuId);
  }

  for (const [id, count] of cited24h) {
    const dtu = STATE.dtus?.get?.(id);
    if (!dtu) continue;
    recent.push({
      id,
      title: dtu.title,
      domain: dtu.domain,
      ownerId: dtu.ownerId || dtu.creatorId,
      newCitations24h: count,
    });
  }
  recent.sort((a, b) => b.newCitations24h - a.newCitations24h);
  return { ok: true, trending: recent.slice(0, 25) };
}

/**
 * Influence drift: which creators are gaining/losing citation share fastest.
 */
export function computeInfluenceDrift(STATE) {
  const now = Date.now();
  const window = 7 * 24 * 60 * 60 * 1000;
  const buckets = new Map(); // userId -> { recent, prior }

  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    const created = parseTime(dtu.createdAt);
    if (!created) continue;
    const dt = now - created;
    if (dt > window * 2) continue;
    const parents = dtu.lineage?.parents ?? [];
    const cites   = dtu.lineage?.citations ?? [];
    for (const p of parents) bumpInfluence(buckets, p, STATE, dt < window ? "recent" : "prior");
    for (const c of cites) {
      const id = typeof c === "string" ? c : c?.dtuId;
      bumpInfluence(buckets, id, STATE, dt < window ? "recent" : "prior");
    }
  }

  const drift = [];
  for (const [userId, b] of buckets) {
    if (b.recent + b.prior < 3) continue;
    const change = b.recent - b.prior;
    drift.push({ userId, recentCitations: b.recent, priorCitations: b.prior, change });
  }
  drift.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return { ok: true, drift: drift.slice(0, 25) };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function countIncomingCitations(targetId, STATE) {
  if (!targetId || !STATE?.dtus) return 0;
  let count = 0;
  for (const dtu of STATE.dtus.values?.() ?? []) {
    const parents = dtu.lineage?.parents ?? [];
    const cites   = dtu.lineage?.citations ?? [];
    if (parents.includes?.(targetId)) count++;
    if (cites.some?.(c => (typeof c === "string" ? c : c?.dtuId) === targetId)) count++;
  }
  return count;
}

function bump(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}
function bumpInfluence(map, dtuId, STATE, slot) {
  if (!dtuId) return;
  const dtu = STATE.dtus?.get?.(dtuId);
  const userId = dtu?.ownerId || dtu?.creatorId;
  if (!userId) return;
  if (!map.has(userId)) map.set(userId, { recent: 0, prior: 0 });
  map.get(userId)[slot]++;
}
function parseTime(t) {
  if (!t) return 0;
  if (typeof t === "number") return t;
  const v = new Date(t).getTime();
  return Number.isFinite(v) ? v : 0;
}
