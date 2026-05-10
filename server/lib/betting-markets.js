// server/lib/betting-markets.js
//
// Phase 9.2 (idea #14) — Spectator betting markets.
//
// Currency: SPARKS (in-game). Non-extractive — losers can't lose real
// money, winners gain in-game weight. Treasury is bookmaker; pool
// resolution is parimutuel (winners split losing-side pool minus
// platform cut).
//
// Markets resolve via substrate signals:
//   - faction_war:  faction_strategy_state.kind transition to 'war'
//   - deity_pilgrim:player_deities.pilgrim_count >= threshold
//   - drift_event:  next world:drift-alert event before close
//   - manual:       admin resolves via CLI
//
// Intentionally not user-resolved — substrate is the oracle.

const PLATFORM_CUT_BPS = 400; // 4% to treasury

export function openMarket(db, { worldId, question, resolutionKind, resolutionRef, closesAt }) {
  if (!db || !question || !resolutionKind) return { ok: false, reason: "missing_inputs" };
  try {
    const r = db.prepare(`
      INSERT INTO prediction_markets (world_id, question, resolution_kind, resolution_ref, closes_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(worldId || null, question, resolutionKind, resolutionRef || null, closesAt || null);
    return { ok: true, marketId: r.lastInsertRowid, currency: "SPARKS" };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function placeBet(db, { marketId, userId, side, stakeSparks }) {
  if (!db || !marketId || !userId || !side || !stakeSparks) return { ok: false, reason: "missing_inputs" };
  if (side !== "yes" && side !== "no") return { ok: false, reason: "bad_side" };
  const stake = Math.max(1, Math.floor(Number(stakeSparks)));

  const market = db.prepare(`SELECT * FROM prediction_markets WHERE id = ?`).get(marketId);
  if (!market) return { ok: false, reason: "market_not_found" };
  if (market.status !== "open") return { ok: false, reason: "market_closed" };
  if (market.closes_at && market.closes_at < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "market_expired" };
  }

  // Debit sparks from user's in-game balance (separate from CC wallet).
  // Lazy schema check — if sparks_balance table is absent, fall through
  // and assume the caller has already debited.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sparks_balances (
        user_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    const bal = db.prepare(`SELECT balance FROM sparks_balances WHERE user_id = ?`).get(userId);
    const have = bal?.balance ?? 0;
    if (have < stake) return { ok: false, reason: "insufficient_sparks", have, need: stake };
    db.prepare(`
      INSERT INTO sparks_balances (user_id, balance, updated_at) VALUES (?, ?, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET balance = balance - ?, updated_at = unixepoch()
    `).run(userId, have - stake, stake);
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }

  try {
    db.prepare(`
      INSERT INTO market_positions (market_id, user_id, side, stake_sparks)
      VALUES (?, ?, ?, ?)
    `).run(marketId, userId, side, stake);
    const poolCol = side === "yes" ? "pool_yes_sparks" : "pool_no_sparks";
    db.prepare(`UPDATE prediction_markets SET ${poolCol} = ${poolCol} + ? WHERE id = ?`).run(stake, marketId);
    return { ok: true, marketId, side, stake, currency: "SPARKS" };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function resolveMarket(db, marketId, outcome) {
  if (!db || !marketId || !outcome) return { ok: false, reason: "missing_inputs" };
  if (outcome !== "yes" && outcome !== "no") return { ok: false, reason: "bad_outcome" };
  const market = db.prepare(`SELECT * FROM prediction_markets WHERE id = ?`).get(marketId);
  if (!market) return { ok: false, reason: "market_not_found" };
  if (market.status !== "open") return { ok: false, reason: "already_resolved" };

  const winningPool = outcome === "yes" ? market.pool_yes_sparks : market.pool_no_sparks;
  const losingPool  = outcome === "yes" ? market.pool_no_sparks  : market.pool_yes_sparks;
  if (winningPool === 0) {
    db.prepare(`UPDATE prediction_markets SET status = 'resolved', resolved_at = unixepoch(), resolved_outcome = ? WHERE id = ?`).run(outcome, marketId);
    return { ok: true, marketId, outcome, paidOut: 0, note: "no_winners" };
  }

  const platformCut = Math.floor(losingPool * PLATFORM_CUT_BPS / 10000);
  const distributable = losingPool - platformCut;
  const winners = db.prepare(`SELECT * FROM market_positions WHERE market_id = ? AND side = ?`).all(marketId, outcome);

  let totalPaid = 0;
  for (const w of winners) {
    const share = w.stake_sparks / winningPool;
    const winnings = Math.floor(distributable * share);
    const totalReturn = w.stake_sparks + winnings;
    db.prepare(`UPDATE market_positions SET payout_sparks = ?, paid_at = unixepoch() WHERE id = ?`).run(totalReturn, w.id);
    db.prepare(`
      INSERT INTO sparks_balances (user_id, balance, updated_at) VALUES (?, ?, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = unixepoch()
    `).run(w.user_id, totalReturn, totalReturn);
    totalPaid += totalReturn;
  }

  db.prepare(`UPDATE prediction_markets SET status = 'resolved', resolved_at = unixepoch(), resolved_outcome = ? WHERE id = ?`).run(outcome, marketId);
  return { ok: true, marketId, outcome, paidOut: totalPaid, winnerCount: winners.length, platformCut, currency: "SPARKS" };
}

export function listOpenMarkets(db, worldId = null, limit = 50) {
  if (!db) return [];
  try {
    const args = worldId ? [worldId, limit] : [limit];
    const where = worldId ? "WHERE world_id = ? AND status = 'open'" : "WHERE status = 'open'";
    return db.prepare(`
      SELECT id, world_id, question, resolution_kind, pool_yes_sparks, pool_no_sparks,
             opened_at, closes_at
      FROM prediction_markets ${where}
      ORDER BY opened_at DESC LIMIT ?
    `).all(...args);
  } catch { return []; }
}

export function userPositions(db, userId, limit = 100) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT p.id, p.market_id, p.side, p.stake_sparks, p.payout_sparks, p.placed_at, p.paid_at,
             m.question, m.status, m.resolved_outcome
      FROM market_positions p
      JOIN prediction_markets m ON m.id = p.market_id
      WHERE p.user_id = ?
      ORDER BY p.placed_at DESC LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}
