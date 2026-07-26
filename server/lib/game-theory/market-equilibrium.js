// server/lib/game-theory/market-equilibrium.js
//
// Applies mixed-nash.js + replicator.js, plus the real Tarjan SCC in
// collusion-detector.js (imported, NOT reimplemented — this is the second
// consumer of that engine, after economy-anomaly-cycle.js), to the REAL
// economy_ledger. This is normal-form.js's own header claim ("the core
// primitives for ... auction/mechanism design") made load-bearing on live
// data instead of sitting unimported.
//
// OBSERVE-AND-REPORT ONLY — the same posture as the existing
// emergent/economy-anomaly-cycle.js precedent, which is explicitly
// observe-and-alert and never blocks a trade or mutates a balance. This
// module reads economy_ledger via an injected `db` handle through prepared
// SELECT statements only; it never INSERTs, UPDATEs, or DELETEs, and it never
// calls a function that would.
//
// Honest boundary — what this can and cannot prove:
//   - detectCollusionRings gives the STRUCTURAL signature: cyclic
//     (A→B→C→A) or reciprocal (A↔B) trading patterns in the real wash-trade
//     graph built from ledger edges. That part is exact, not heuristic.
//   - The "is ring behavior a Nash equilibrium / evolutionarily favored
//     strategy" question is answered by collapsing the market into a
//     simplified two-strategy ("ring" vs. "diversify") population game,
//     parameterized from the OBSERVED average net-per-trade for each
//     from/to-ring-membership pairing. That average is a proxy for "value
//     captured per interaction," not a rigorous utility model of any
//     individual agent's real incentives — it is a descriptive statistic fed
//     into a real solver, not a claim about ground truth.
//   - The combined classification is "consistent with a cartel" or
//     "consistent with a competitive equilibrium" — NEVER proof of intent or
//     of manipulation. A human reviews any flagged ring before anything is
//     done about it; this module has no mutation path at all.

import { detectCollusionRings } from "../collusion-detector.js";
import { transpose } from "../compute/numerical.js";
import { mixedNashEquilibria } from "./mixed-nash.js";
import { replicatorDynamics } from "./replicator.js";

const THIRTY_DAYS_MS = 30 * 86400000;
const DEFAULT_MIN_RING_VOLUME_FRACTION = 0.05;
const TRADE_TYPES = ["TRANSFER", "MARKETPLACE_PURCHASE"];

const DISCLAIMER =
  "Descriptive and observational only. 'Consistent with a cartel' is a structural " +
  "+ game-theoretic reading of ledger data, not proof of intent or manipulation. " +
  "This function never mutates balances and never blocks a trade.";

function parseLedgerTime(s) {
  if (!s) return Date.now();
  const iso = String(s).includes("T") ? String(s) : String(s).replace(" ", "T");
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Pull the real buyer→seller trade edges from the ledger, read-only.
 *
 * Both TRANSFER and MARKETPLACE_PURCHASE are written (economy/transfer.js) as
 * a two-row debit+credit pair where the DEBIT row carries BOTH from_user_id
 * (payer) and to_user_id (recipient) — that row is the real (payer, recipient,
 * timestamp) linkage; the separate credit-only row (from_user_id IS NULL) is
 * not a trade edge at all. Filtering on `from_user_id IS NOT NULL AND
 * to_user_id IS NOT NULL` selects exactly the debit-half rows, mirroring the
 * same wash-trade graph shape collusion-detector.js already consumes.
 */
function loadTradeEdges(db, { sinceMs } = {}) {
  const placeholders = TRADE_TYPES.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT from_user_id AS fromUser, to_user_id AS toUser, amount, net, fee, created_at AS createdAt
    FROM economy_ledger
    WHERE status = 'complete'
      AND from_user_id IS NOT NULL AND to_user_id IS NOT NULL
      AND type IN (${placeholders})
    ORDER BY created_at ASC
  `).all(...TRADE_TYPES);
  return sinceMs ? rows.filter((r) => parseLedgerTime(r.createdAt) >= sinceMs) : rows;
}

/** Build the Map<"a:b",[{ts}]> shape collusion-detector.js#detectCollusionRings expects. */
function buildTradeHistory(edges) {
  const history = new Map();
  for (const e of edges) {
    const key = `${e.fromUser}:${e.toUser}`;
    if (!history.has(key)) history.set(key, []);
    history.get(key).push({ ts: parseLedgerTime(e.createdAt) });
  }
  return history;
}

function avg(values, fallback) {
  if (!values.length) return fallback;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Build a symmetric 2-strategy ("ring" vs. "diversify") population-game
 * payoff matrix from observed average net-per-trade, bucketed by whether the
 * payer/recipient of each historical trade are members of a detected
 * ring/reciprocal-pair. See the file header for the honest-boundary note on
 * what this proxy does and does not claim.
 */
function buildRingGame(edges, ringMembers) {
  const bucket = { ring_ring: [], ring_div: [], div_ring: [], div_div: [] };
  for (const e of edges) {
    const fromRing = ringMembers.has(e.fromUser);
    const toRing = ringMembers.has(e.toUser);
    bucket[`${fromRing ? "ring" : "div"}_${toRing ? "ring" : "div"}`].push(e.net);
  }
  const overall = avg(edges.map((e) => e.net), 0);
  const netOf = (fromRing, toRing) =>
    avg(bucket[`${fromRing ? "ring" : "div"}_${toRing ? "ring" : "div"}`], overall);

  // A[i][j] = payoff to a RECIPIENT using strategy i, matched against a payer
  // using strategy j. Index 0 = ring, 1 = diversify.
  return [
    [netOf(true, true), netOf(false, true)],
    [netOf(true, false), netOf(false, false)],
  ];
}

/**
 * Analyze the real economy_ledger for equilibrium/cartel structure.
 * Read-only: only ever issues SELECT statements against `db`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {number} [opts.minEdgeTrades=3]              collusion-detector: min trades on an edge to count it
 * @param {number} [opts.minRingSize=3]                collusion-detector: min SCC size to call it a "ring"
 * @param {number} [opts.windowMs=30d]                 collusion-detector: recency window
 * @param {number} [opts.sinceMs]                       only consider ledger rows at/after this time
 * @param {number} [opts.minRingVolumeFraction=0.05]    fraction of total trade volume inside rings required to flag a cartel
 * @param {number} [opts.nowMs=Date.now()]
 * @returns {object}
 */
export function analyzeMarketEquilibrium(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const {
    minEdgeTrades = 3,
    minRingSize = 3,
    windowMs = THIRTY_DAYS_MS,
    sinceMs,
    minRingVolumeFraction = DEFAULT_MIN_RING_VOLUME_FRACTION,
    nowMs = Date.now(),
  } = opts;

  let edges;
  try {
    edges = loadTradeEdges(db, { sinceMs });
  } catch (e) {
    return { ok: false, reason: "ledger_read_failed", error: String(e?.message || e) };
  }

  if (!edges.length) {
    return {
      ok: true,
      classification: "insufficient_data",
      tradeCount: 0,
      agentCount: 0,
      rings: [],
      reciprocalPairs: [],
      disclaimer: DISCLAIMER,
    };
  }

  const history = buildTradeHistory(edges);
  const collusion = detectCollusionRings(history, { minEdgeTrades, minRingSize, windowMs, nowMs });

  const ringMembers = new Set();
  for (const ring of collusion.rings || []) for (const a of ring.accounts) ringMembers.add(a);
  for (const pair of collusion.reciprocalPairs || []) { ringMembers.add(pair.a); ringMembers.add(pair.b); }

  const totalVolume = edges.reduce((s, e) => s + (e.amount || 0), 0);
  const ringVolume = edges.reduce(
    (s, e) => (ringMembers.has(e.fromUser) && ringMembers.has(e.toUser) ? s + (e.amount || 0) : s),
    0
  );
  const ringVolumeFraction = totalVolume > 0 ? ringVolume / totalVolume : 0;

  const agents = new Set();
  for (const e of edges) { agents.add(e.fromUser); agents.add(e.toUser); }

  const A = buildRingGame(edges, ringMembers);
  // Standard translation of a symmetric population game into a bimatrix game
  // for Nash-equilibrium computation: (A, Aᵀ) — reuses numerical.js#transpose.
  const B = transpose(A);

  const nash = mixedNashEquilibria(A, B, { maxSupportSize: 2 });
  const nashSupportsRing = !!(
    nash.ok &&
    nash.equilibria.some(
      (eq) => eq.support1.length === 1 && eq.support1[0] === 0 && eq.support2.length === 1 && eq.support2[0] === 0
    )
  );

  const replicator = replicatorDynamics(A, [0.5, 0.5]);
  const replicatorFavorsRing = replicator.converged && replicator.x[0] > 0.75;

  const structuralSignal = (collusion.rings || []).length > 0 || (collusion.reciprocalPairs || []).length > 0;
  const cartelConsistent =
    structuralSignal &&
    ringVolumeFraction >= minRingVolumeFraction &&
    (nashSupportsRing || replicatorFavorsRing);

  return {
    ok: true,
    classification: cartelConsistent ? "cartel_consistent" : "competitive_equilibrium_consistent",
    tradeCount: edges.length,
    agentCount: agents.size,
    rings: collusion.rings || [],
    reciprocalPairs: collusion.reciprocalPairs || [],
    ringVolumeFraction: Math.round(ringVolumeFraction * 10000) / 10000,
    signals: { structuralSignal, nashSupportsRing, replicatorFavorsRing },
    ringGame: { A, B },
    nash,
    replicator: { converged: replicator.converged, x: replicator.x, reason: replicator.reason },
    disclaimer: DISCLAIMER,
  };
}

export default analyzeMarketEquilibrium;
