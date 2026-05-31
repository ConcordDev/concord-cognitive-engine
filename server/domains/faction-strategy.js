// server/domains/faction-strategy.js
//
// Sprint B Phase 10 — exposes a small read-only + witness surface for
// faction-strategy state. Pairs with the cross-world signature quest's
// `faction-strategy.witness_next_move` objective (the_handshake_revelation
// step 10).
//
// The substrate (server/lib/embodied/faction-strategy.js + migration 117)
// already runs the state machine on a heartbeat. This domain is purely
// the player-facing read + witness side: list recent moves for the UI,
// and confirm presence at the next move for quest objective completion.

import {
  getRecentMoves,
  getRelation,
} from "../lib/embodied/faction-strategy.js";

export default function registerFactionStrategyMacros(register) {
  // recent_moves — used by the Crucible HUD + player-witness UI to
  // show "what just happened" for every faction in scope.
  register("faction_strategy", "recent_moves", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const factionId = input.factionId || null;
    const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
    if (!factionId) {
      // Cross-faction read — useful for the witness UI on the Crucible
      // Observation Lattice anchor where Witnesses can see all moves.
      try {
        const rows = db.prepare(`
          SELECT *
            FROM faction_strategy_log
           ORDER BY occurred_at DESC
           LIMIT ?
        `).all(limit);
        return { ok: true, moves: rows, count: rows.length };
      } catch { return { ok: true, moves: [], count: 0 }; }
    }
    return { ok: true, moves: getRecentMoves(db, factionId, limit) };
  });

  // get_relation — read a single faction relation. Used by the
  // Crucible's diplomatic-status HUD chip.
  register("faction_strategy", "get_relation", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.a || !input.b) return { ok: false, reason: "missing_factions" };
    const rel = getRelation(db, input.a, input.b);
    return { ok: true, relation: rel };
  });

  // witness_next_move — quest objective completion macro. The
  // player calls this (typically via the quest objective dispatcher)
  // to register intent to witness the next faction-strategy move
  // anywhere in their current world. The substrate's per-faction
  // applyMove cycle continues independently; this macro just confirms
  // a move exists in the recent log so the objective can mark complete.
  //
  // Used by Phase 10's the_handshake_revelation step 10: Orla presents
  // the player-conditional drift corpus, and the player has to be
  // present when Orla's faction-strategy state machine emits its next
  // move for the objective to clear.
  register("faction_strategy", "witness_next_move", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };

    const worldId = input.worldId || null;

    // The player can witness any move in the recent window
    // (default: last 10 minutes). If at least one has fired, the
    // objective passes.
    let moveCount = 0;
    let mostRecent = null;
    try {
      const rows = db.prepare(`
        SELECT *
          FROM faction_strategy_log
         WHERE occurred_at >= unixepoch() - 600
         ORDER BY occurred_at DESC
         LIMIT 5
      `).all();
      moveCount = rows.length;
      mostRecent = rows[0] || null;
    } catch { /* table missing in some test builds */ }

    if (moveCount === 0) {
      return {
        ok: false,
        reason: "no_recent_move",
        retry_after: "Wait for the faction-strategy heartbeat to advance a move (every ~50 minutes), or visit the Crucible Observation Lattice to accelerate by interacting with active drifts.",
      };
    }

    // Best-effort: log the witnessing to a tiny ledger table so future
    // quests can prove the player was here. Idempotent on
    // (user_id, faction_id, move_id).
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS faction_witness_log (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      TEXT NOT NULL,
          world_id     TEXT,
          faction_id   TEXT,
          move_id      TEXT,
          witnessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(user_id, faction_id, move_id)
        );
      `);
      if (mostRecent?.id) {
        db.prepare(`
          INSERT OR IGNORE INTO faction_witness_log
            (user_id, world_id, faction_id, move_id)
          VALUES (?, ?, ?, ?)
        `).run(userId, worldId, mostRecent.faction_id, String(mostRecent.id));
      }
    } catch { /* witness log is best-effort */ }

    return {
      ok: true,
      witnessed: {
        moveId: mostRecent?.id || null,
        factionId: mostRecent?.faction_id || null,
        moveType: mostRecent?.move_type || null,
        moveCount,
      },
    };
  });
}
