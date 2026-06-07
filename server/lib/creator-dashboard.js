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

import { CREDIT_ROW_PREDICATE } from "../economy/balances.js";
import { earnedWithdrawableBalance } from "../economy/withdrawals.js";

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
 * Withdrawal eligibility for the creator dashboard.
 *
 * The 48-hour hold (`server/economy/withdrawals.js#WITHDRAWAL_HOLD_HOURS`)
 * is a constitutional anti-refund-exploit invariant. This helper turns
 * the gate into a tangible "what's available, what's still held"
 * surface so creators see exactly when their earnings unlock.
 *
 * @param {object} db
 * @param {string} userId
 * @returns {{
 *   ok: boolean,
 *   balance: number,
 *   eligibleAmount: number,
 *   pendingHoldAmount: number,
 *   nextEligibleAt: string | null,
 *   pendingWithdrawals: Array<{ id, amount, status, createdAt }>,
 *   minWithdraw: number,
 *   holdHours: number,
 * }}
 */
export function computeWithdrawalEligibility(db, userId) {
  if (!userId) return { ok: false, error: "user_id_required" };
  const HOLD_HOURS = 48;
  try {
    // Total balance via economy_ledger (double-sided: credits land as `net` to
    // to_user_id, debits as `amount` from from_user_id — the canonical
    // economy/balances.js#getBalance model; economy_ledger has no `user_id`).
    // CREDIT_ROW_PREDICATE excludes the redundant two-row debit halves so the
    // balance is not double-credited (see economy/balances.js).
    const balRow = db.prepare(
      `SELECT COALESCE((SELECT SUM(net) FROM economy_ledger WHERE to_user_id = ? AND status = 'complete' AND ${CREDIT_ROW_PREDICATE}), 0)
            - COALESCE((SELECT SUM(amount) FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'), 0) AS bal`
    ).get(userId, userId);
    const balance = Number(balRow?.bal || 0);

    // Eligible-to-withdraw uses the SAME earned-only, settled, claim-netted
    // logic as the withdrawal endpoint (economy/withdrawals.js) so this surface
    // never promises an amount requestWithdrawal would reject. Only EARNED CC
    // (marketplace sales + royalties), held 48h, is withdrawable; purchased CC
    // is spend-only store credit. Capped by live balance (can't withdraw coin
    // already spent on-platform).
    const earned = earnedWithdrawableBalance(db, userId);
    const eligibleAmount = Math.max(0, Math.min(earned.eligible, balance));
    const pendingHoldAmount = Math.max(0, balance - eligibleAmount);

    // The next credit that will unlock — earliest credit with age < HOLD_HOURS.
    let nextEligibleAt = null;
    try {
      const nextRow = db.prepare(
        `SELECT created_at AS ts
         FROM economy_ledger
         WHERE to_user_id = ?
           AND status = 'complete'
           AND created_at > datetime('now', '-${HOLD_HOURS} hours')
         ORDER BY created_at ASC
         LIMIT 1`
      ).get(userId);
      if (nextRow?.ts) {
        const t = new Date(nextRow.ts).getTime();
        if (Number.isFinite(t)) {
          nextEligibleAt = new Date(t + HOLD_HOURS * 3600 * 1000).toISOString();
        }
      }
    } catch { /* fall through */ }

    // Open withdrawal requests in the queue.
    let pendingWithdrawals = [];
    try {
      pendingWithdrawals = db.prepare(
        `SELECT id, amount, status, created_at AS createdAt
         FROM economy_withdrawals
         WHERE user_id = ? AND status IN ('pending','approved','processing')
         ORDER BY created_at DESC
         LIMIT 10`
      ).all(userId);
    } catch { /* table may not exist on minimal builds */ }

    const minWithdraw = Number(process.env.MIN_WITHDRAW_TOKENS) || 20;

    return {
      ok: true,
      balance,
      eligibleAmount,
      pendingHoldAmount,
      nextEligibleAt,
      pendingWithdrawals,
      minWithdraw,
      holdHours: HOLD_HOURS,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
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

/**
 * Cascade tree for one of a creator's DTUs.
 *
 * Walks the lineage forward from `rootDtuId` up to `maxDepth`
 * generations. At each generation we count downstream DTUs that cite
 * the root (or any ancestor in our walk) and estimate per-generation
 * royalty using the standard cascade rate
 * (`calculateGenerationalRate` from royalty-cascade.js).
 *
 * Estimated earnings = generation_count × generation_rate × baseRate.
 * This is an *expected-value* number, not a transactional ledger sum;
 * the dashboard surfaces it as "potential" so creators see the
 * compounding shape of their lineage even before sales close.
 *
 * @param {string} rootDtuId
 * @param {object} STATE
 * @param {object} [opts] — { maxDepth?: number, baseRate?: number }
 * @returns {{
 *   ok: boolean,
 *   rootId: string,
 *   generations: Array<{ depth: number, count: number, rate: number, projectedShare: number }>,
 *   totalDownstream: number,
 *   maxObservedDepth: number,
 * }}
 */
export function computeCascadeTree(rootDtuId, STATE, opts = {}) {
  if (!rootDtuId) return { ok: false, error: "root_required" };
  const maxDepth = Math.min(50, Math.max(1, Number(opts.maxDepth) || 6));
  // Default base rate of 0.21 mirrors `DEFAULT_INITIAL_RATE` in
  // royalty-cascade.js. Halves per generation, floor 0.0005.
  const baseRate = Number(opts.baseRate) || 0.21;
  const dtus = STATE?.dtus;
  if (!dtus?.values) return { ok: true, rootId: rootDtuId, generations: [], totalDownstream: 0, maxObservedDepth: 0 };

  // Build ancestor set per generation. Generation 0 = the root itself.
  // Generation N = DTUs whose lineage cites a generation N-1 DTU.
  const seen = new Set([rootDtuId]);
  let currentGen = new Set([rootDtuId]);
  const generations = [];
  let totalDownstream = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextGen = new Set();
    for (const dtu of dtus.values()) {
      if (seen.has(dtu.id)) continue;
      const parents = dtu.lineage?.parents ?? [];
      const cites = dtu.lineage?.citations ?? [];
      const refsAncestor = parents.some?.((p) => currentGen.has(p))
        || cites.some?.((c) => {
          const id = typeof c === "string" ? c : c?.dtuId;
          return id && currentGen.has(id);
        });
      if (refsAncestor) nextGen.add(dtu.id);
    }
    if (nextGen.size === 0) break;
    const rate = Math.max(baseRate / Math.pow(2, depth - 1), 0.0005);
    generations.push({
      depth,
      count: nextGen.size,
      rate,
      projectedShare: nextGen.size * rate,
    });
    totalDownstream += nextGen.size;
    for (const id of nextGen) seen.add(id);
    currentGen = nextGen;
  }

  return {
    ok: true,
    rootId: rootDtuId,
    generations,
    totalDownstream,
    maxObservedDepth: generations.length,
  };
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
