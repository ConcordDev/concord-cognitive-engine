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
 * All four are read-only views over STATE.dtus (including each DTU's own
 * .marketplace listing, when present) + the legacy STATE.marketplaceListings
 * map (kept for any pre-existing data; no longer written to — see
 * docs/lens-specs/creator-capability-map.md finding #3).
 */

import { CREDIT_ROW_PREDICATE } from "../economy/balances.js";
import { earnedWithdrawableBalance } from "../economy/withdrawals.js";
import { getAncestorChain } from "../economy/royalty-cascade.js";

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
  // Legacy store — kept for any pre-existing data, but it has had no
  // frontend writer since the Creator lens's Listings tab was redirected to
  // the real dtu.marketplace store (docs/lens-specs/creator-capability-map.md
  // finding #3), so new listings never land here anymore.
  for (const l of (STATE.marketplaceListings?.values?.() ?? [])) {
    if (l.sellerId === userId) {
      myListings.push(l);
      totalDownloads += l.downloads || 0;
      totalEarnings += (l.downloads || 0) * (l.price || 0);
    }
  }
  // dtu.marketplace listings — the real, purchasable store every listing
  // created through the Creator lens now lives in. Merged into the same
  // shape so the Overview tab's stat tiles stay coherent with the Listings
  // tab on the same page (both read the same underlying data now).
  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    if (dtu.ownerId !== userId || !dtu.marketplace) continue;
    const downloads = dtu.marketplace.purchases || 0;
    const price = dtu.marketplace.price || 0;
    myListings.push({
      id: dtu.id,
      sourceDtuId: dtu.id,
      sellerId: userId,
      title: dtu.marketplace.title || dtu.title,
      price,
      downloads,
      listedAt: dtu.marketplace.listedAt,
      promotionSource: null,
    });
    totalDownloads += downloads;
    totalEarnings += downloads * price;
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
  // dtu.marketplace listings — see computeCreatorDashboard's matching
  // comment. Keeps the leaderboard coherent with real sales.
  for (const dtu of (STATE.dtus?.values?.() ?? [])) {
    if (!dtu.marketplace) continue;
    const owner = dtu.ownerId || dtu.creatorId;
    const t = totals.get(owner);
    if (t) t.downloads += dtu.marketplace.purchases || 0;
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
 *   nodes: Array<{ id: string, title: string, domain: string|null, depth: number, parentIds: string[] }>,
 * }}
 */
export function computeCascadeTree(rootDtuId, STATE, opts = {}) {
  if (!rootDtuId) return { ok: false, error: "root_required" };
  const maxDepth = Math.min(50, Math.max(1, Number(opts.maxDepth) || 6));
  // Default base rate of 0.21 mirrors `DEFAULT_INITIAL_RATE` in
  // royalty-cascade.js. Halves per generation, floor 0.0005.
  const baseRate = Number(opts.baseRate) || 0.21;
  const dtus = STATE?.dtus;
  if (!dtus?.values) return { ok: true, rootId: rootDtuId, generations: [], totalDownstream: 0, maxObservedDepth: 0, nodes: [] };

  const rootDtu = dtus.get?.(rootDtuId);
  // `nodes` is the real per-DTU node-link graph underneath the aggregated
  // `generations` counts above — added so a real tree/graph UI can render
  // actual citing DTUs and the specific parent(s) each one cites, instead
  // of only a per-generation bar count. Kept additive alongside the
  // pre-existing `generations` shape so no existing caller is affected.
  const nodes = [{
    id: rootDtuId,
    title: rootDtu?.title || rootDtu?.human?.title || rootDtuId,
    domain: rootDtu?.domain || rootDtu?.machine?.domain || null,
    depth: 0,
    parentIds: [],
  }];

  // Build ancestor set per generation. Generation 0 = the root itself.
  // Generation N = DTUs whose lineage cites a generation N-1 DTU.
  const seen = new Set([rootDtuId]);
  let currentGen = new Set([rootDtuId]);
  const generations = [];
  let totalDownstream = 0;
  // Caps how many individual node records we build PER DEPTH — a viral DTU
  // can have thousands of downstream citations at depth 4+, and the
  // aggregated `generations.count` above already reports the true total
  // honestly; the per-node list is for rendering an actual tree, which has
  // no legible use past a few dozen siblings at any one depth anyway.
  const MAX_NODES_PER_GENERATION = 60;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextGen = new Set();
    let nodesAddedThisDepth = 0;
    for (const dtu of dtus.values()) {
      if (seen.has(dtu.id)) continue;
      const parents = dtu.lineage?.parents ?? [];
      const cites = dtu.lineage?.citations ?? [];
      const matchedParentIds = [];
      for (const p of (parents.length ? parents : [])) {
        if (currentGen.has(p)) matchedParentIds.push(p);
      }
      for (const c of (cites.length ? cites : [])) {
        const id = typeof c === "string" ? c : c?.dtuId;
        if (id && currentGen.has(id) && !matchedParentIds.includes(id)) matchedParentIds.push(id);
      }
      if (matchedParentIds.length > 0) {
        nextGen.add(dtu.id);
        if (nodesAddedThisDepth < MAX_NODES_PER_GENERATION) {
          nodes.push({
            id: dtu.id,
            title: dtu.title || dtu.human?.title || dtu.id,
            domain: dtu.domain || dtu.machine?.domain || null,
            depth,
            parentIds: matchedParentIds,
          });
          nodesAddedThisDepth += 1;
        }
      }
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
    nodes,
  };
}

/**
 * Royalty flow card (EC2) — the real-money counterpart to `computeCascadeTree`
 * above.
 *
 * `computeCascadeTree` is explicit that its numbers are an *estimate*
 * ("projected", "not a transactional ledger sum") derived from downstream
 * citation counts. This function is the honest complement: the ACTUAL
 * historical `ROYALTY_PAYOUT` rows that have already landed in the ledger,
 * so a creator can see WHERE their royalty income really came from —
 * lineage → earner → CC — instead of only a lump `totalEarnings` figure.
 *
 * Composes two REAL sources; nothing here is fabricated and nothing here
 * reimplements money math that already exists elsewhere:
 *   1. `economy_ledger` rows of type ROYALTY_PAYOUT, filtered through the
 *      canonical `CREDIT_ROW_PREDICATE` (economy/balances.js) — the SAME
 *      predicate `getBalance()` and `computeWithdrawalEligibility()` (above,
 *      this file) use, so this card's totals can never silently diverge from
 *      the user's real wallet math. (ROYALTY_PAYOUT rows are always
 *      single-sided credits — not the two-row TRANSFER/MARKETPLACE_PURCHASE
 *      debit-half pattern the predicate exists to exclude — so applying it
 *      here is a no-op today, but it keeps this query byte-for-byte pinned
 *      to the documented ledger-conservation invariant instead of silently
 *      assuming that shape can never change.)
 *   2. `getAncestorChain()` (economy/royalty-cascade.js) — the SAME function
 *      the real payout path (`distributeRoyalties`) and the EC1 DTU Lineage
 *      tab (`dtu.lineage` macro, server.js) call — for the structural
 *      generation/rate context around one DTU, so a DTU with real ancestors
 *      but zero sales yet still renders an honest "lineage exists, no
 *      royalties earned yet" card instead of a blank one.
 *
 * @param {object} db
 * @param {object} STATE
 * @param {{ userId?: string, dtuId?: string, limit?: number }} opts
 * @returns {{
 *   ok: boolean,
 *   userId: string|null,
 *   dtuId: string|null,
 *   totalCC: number,
 *   hopCount: number,
 *   byGeneration: Record<string, number>,
 *   hops: Array<{
 *     ledgerId: string, contentId: string|null, contentTitle: string|null,
 *     generation: number|null, royaltyRate: number|null, royaltyPercent: string|null,
 *     amount: number, fromUserId: string|null, toUserId: string|null,
 *     sourceTxId: string|null, crossWorldHop: boolean, createdAt: string,
 *   }>,
 *   lineage: Array<{ contentId: string, contentTitle: string|null, generation: number, royaltyRate: number, royaltyPercent: string }>,
 * }}
 */
export function computeRoyaltyFlow(db, STATE, { userId, dtuId, limit = 100 } = {}) {
  if (!db) return { ok: false, error: "no_db" };
  if (!userId && !dtuId) return { ok: false, error: "user_or_dtu_required" };
  const cappedLimit = Math.min(200, Math.max(1, Number(limit) || 100));

  // Real historical royalty credits. Every ROYALTY_PAYOUT row is written by
  // `distributeRoyalties` (economy/royalty-cascade.js) inside one atomic
  // db.transaction alongside the matching `royalty_payouts` record — this
  // reads the ledger directly (not the derived royalty_payouts side-table)
  // so the card's numbers are pinned to the same source getBalance() sums.
  const where = ["type = 'ROYALTY_PAYOUT'", "status = 'complete'", CREDIT_ROW_PREDICATE];
  const params = [];
  if (userId) { where.push("to_user_id = ?"); params.push(userId); }

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, from_user_id AS fromUserId, to_user_id AS toUserId, net,
             metadata_json AS metadataJson, created_at AS createdAt
      FROM economy_ledger
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, cappedLimit);
  } catch (e) {
    // Honest failure — no economy_ledger table on a minimal/legacy DB, or a
    // real query error. Never fabricate rows to fill the card.
    return { ok: false, error: String(e?.message || e) };
  }

  const titleFor = (id) => {
    if (!id) return null;
    const d = STATE?.dtus?.get?.(id);
    return d?.title || d?.human?.summary || null;
  };

  let hops = rows.map((r) => {
    let meta = {};
    try { meta = JSON.parse(r.metadataJson || "{}"); } catch { /* honest: malformed metadata renders no generation/rate rather than guessing one */ }
    const contentId = meta.contentId || null;
    return {
      ledgerId: r.id,
      contentId,
      contentTitle: titleFor(contentId),
      generation: typeof meta.generation === "number" ? meta.generation : null,
      royaltyRate: typeof meta.rate === "number" ? meta.rate : null,
      royaltyPercent: typeof meta.rate === "number" ? `${(meta.rate * 100).toFixed(2)}%` : null,
      amount: Math.round((Number(r.net) || 0) * 100) / 100,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      sourceTxId: meta.sourceTxId || null,
      crossWorldHop: !!meta.crossWorldHop,
      createdAt: r.createdAt,
    };
  });

  // Scoping to a specific DTU means "royalty income this DTU's citation
  // earned its creator" — filter to rows whose ledger metadata.contentId
  // (the ancestor DTU that earned the payout) is this DTU.
  if (dtuId) hops = hops.filter((h) => h.contentId === dtuId);

  // Structural context for a specific DTU: its full real ancestor chain
  // (generation + the rate that WOULD apply), via the same getAncestorChain
  // the payout math itself uses — never a duplicated/hand-rolled traversal.
  let lineage = [];
  if (dtuId) {
    try {
      lineage = getAncestorChain(db, dtuId).map((a) => ({
        contentId: a.contentId,
        contentTitle: titleFor(a.contentId),
        generation: a.generation,
        royaltyRate: a.rate,
        royaltyPercent: `${(a.rate * 100).toFixed(2)}%`,
      }));
    } catch { /* honest: royalty_lineage table absent on a minimal/legacy DB */ }
  }

  const totalCC = Math.round(hops.reduce((s, h) => s + h.amount, 0) * 100) / 100;
  const byGeneration = {};
  for (const h of hops) {
    const g = h.generation == null ? "unknown" : String(h.generation);
    byGeneration[g] = Math.round(((byGeneration[g] || 0) + h.amount) * 100) / 100;
  }

  return {
    ok: true,
    userId: userId || null,
    dtuId: dtuId || null,
    totalCC,
    hopCount: hops.length,
    byGeneration,
    hops,
    lineage,
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
