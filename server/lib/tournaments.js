// server/lib/tournaments.js
//
// Phase S — real-money tournaments per world. Lattice-crucible PvP, sports
// leagues in concord-link-frontier, heists in crime. Buy-in feeds the
// prize pool; placement distributes 60/25/10 with 5% platform fee.

import logger from "../logger.js";
import crypto from "node:crypto";

const PRIZE_DISTRIBUTION = [0.60, 0.25, 0.10]; // 1st / 2nd / 3rd
const PLATFORM_FEE_RATE = 0.05;

export function createTournament(db, input) {
  const { worldId, kind = "pvp", title, buyinCc = 0, startsAt, endsAt = null, rulesetDtuId = null, organizerUserId } = input || {};
  if (!db || !worldId || !title || !startsAt) return { ok: false, error: "missing_inputs" };
  if (!["pvp", "league", "heist", "custom"].includes(kind)) return { ok: false, error: "bad_kind" };
  const id = `tour_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO tournaments
        (id, world_id, kind, title, buyin_cc, prize_pool_cc, starts_at, ends_at, ruleset_dtu_id, organizer_user_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(id, worldId, kind, title, Number(buyinCc) || 0, Math.floor(Number(startsAt)), endsAt ? Math.floor(Number(endsAt)) : null, rulesetDtuId, organizerUserId);
    return { ok: true, tournamentId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function registerForTournament(db, tournamentId, userId) {
  if (!db || !tournamentId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const t = db.prepare(`SELECT buyin_cc, status FROM tournaments WHERE id = ?`).get(tournamentId);
    if (!t) return { ok: false, error: "no_tournament" };
    if (t.status !== "open") return { ok: false, error: "registration_closed" };
    db.prepare(`
      INSERT INTO tournament_entries (tournament_id, user_id) VALUES (?, ?)
      ON CONFLICT DO NOTHING
    `).run(tournamentId, userId);
    // Buy-in: increment the prize pool. Caller's wallet debit is the
    // caller's responsibility (the route does walletDebit before this
    // function is invoked).
    if (t.buyin_cc > 0) {
      db.prepare(`UPDATE tournaments SET prize_pool_cc = prize_pool_cc + ? WHERE id = ?`).run(t.buyin_cc, tournamentId);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getTournament(db, tournamentId) {
  if (!db) return null;
  try {
    const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
    if (!t) return null;
    const entries = db.prepare(`
      SELECT user_id, registered_at, eliminated_at, placement
      FROM tournament_entries WHERE tournament_id = ?
      ORDER BY placement ASC NULLS LAST, registered_at ASC
    `).all(tournamentId);
    const matches = db.prepare(`
      SELECT id, round, players_json, winner_user_id, replay_dtu_id, played_at
      FROM tournament_matches WHERE tournament_id = ?
      ORDER BY round ASC, played_at ASC
    `).all(tournamentId);
    return { ...t, entries, matches };
  } catch {
    return null;
  }
}

export function listActiveTournaments(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    return db.prepare(`
      SELECT id, world_id, kind, title, buyin_cc, prize_pool_cc, starts_at, status
      FROM tournaments
      WHERE status IN ('open', 'running')
      ORDER BY starts_at ASC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

/**
 * Record a match result. Bracket logic lives in playMatch (existing
 * combat substrate) or is supplied by the caller; this function just
 * persists the outcome.
 */
export function recordMatch(db, tournamentId, { round, players, winnerUserId, replayDtuId = null }) {
  const id = `tm_${crypto.randomBytes(6).toString("hex")}`;
  try {
    db.prepare(`
      INSERT INTO tournament_matches
        (id, tournament_id, round, players_json, winner_user_id, replay_dtu_id, played_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, tournamentId, Number(round) || 1, JSON.stringify(players || []), winnerUserId, replayDtuId);
    // Eliminate losers.
    for (const playerId of (players || [])) {
      if (playerId !== winnerUserId) {
        db.prepare(`
          UPDATE tournament_entries SET eliminated_at = unixepoch()
          WHERE tournament_id = ? AND user_id = ? AND eliminated_at IS NULL
        `).run(tournamentId, playerId);
      }
    }
    return { ok: true, matchId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Finalise the tournament — assign placements based on elimination order,
 * compute payouts via the placement distribution, return the payout plan.
 * Wallet credits are the caller's responsibility (routes call walletCredit
 * with the returned plan).
 */
export function finalizeTournament(db, tournamentId) {
  try {
    const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
    if (!t) return { ok: false, error: "no_tournament" };
    if (t.status === "complete") return { ok: false, error: "already_complete" };

    // Placement order: not eliminated → 1st; latest eliminated → 2nd; etc.
    const entries = db.prepare(`
      SELECT user_id, eliminated_at FROM tournament_entries
      WHERE tournament_id = ?
      ORDER BY eliminated_at DESC NULLS FIRST
    `).all(tournamentId);

    // Compute payouts.
    const grossPool = Number(t.prize_pool_cc) || 0;
    const platformFee = grossPool * PLATFORM_FEE_RATE;
    const netPool = grossPool - platformFee;
    const payouts = [];
    for (let i = 0; i < entries.length && i < PRIZE_DISTRIBUTION.length; i++) {
      const share = PRIZE_DISTRIBUTION[i];
      const amount = Math.round(netPool * share * 100) / 100;
      if (amount > 0) {
        payouts.push({ userId: entries[i].user_id, placement: i + 1, amountCC: amount });
        db.prepare(`UPDATE tournament_entries SET placement = ? WHERE tournament_id = ? AND user_id = ?`)
          .run(i + 1, tournamentId, entries[i].user_id);
      }
    }

    db.prepare(`UPDATE tournaments SET status = 'complete', ends_at = unixepoch() WHERE id = ?`).run(tournamentId);
    logger.info?.("tournaments", "finalized", { tournamentId, payouts, platformFee });
    return { ok: true, payouts, platformFee, netPool, grossPool };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
