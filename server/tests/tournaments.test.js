// Phase S — tournaments shape contract.
//
// Uses a sqlite in-memory stub via plain JS Maps so we can run this test
// without better-sqlite3 installed. Real-DB integration is covered by the
// boot smoke. This is the unit contract.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTournament, registerForTournament, getTournament, recordMatch, finalizeTournament, listActiveTournaments } from "../lib/tournaments.js";

function memDb() {
  const tables = {
    tournaments: new Map(),
    tournament_entries: new Map(), // key: tournamentId|userId
    tournament_matches: new Map(),
  };
  const stmts = new Map();
  function prep(sql) {
    if (stmts.has(sql)) return stmts.get(sql);
    const stmt = {
      run(...args) { return _execute(sql, args); },
      get(...args) { return _execute(sql, args, "get"); },
      all(...args) { return _execute(sql, args, "all"); },
    };
    stmts.set(sql, stmt);
    return stmt;
  }
  function _execute(sql, args, mode = "run") {
    const normalised = sql.replace(/\s+/g, " ").trim();
    // INSERT INTO tournaments
    if (normalised.startsWith("INSERT INTO tournaments")) {
      const [id, worldId, kind, title, buyinCc, startsAt, endsAt, rulesetDtuId, organizerUserId] = args;
      tables.tournaments.set(id, { id, world_id: worldId, kind, title, buyin_cc: buyinCc, prize_pool_cc: 0, starts_at: startsAt, ends_at: endsAt, status: "open", ruleset_dtu_id: rulesetDtuId, organizer_user_id: organizerUserId });
      return { changes: 1 };
    }
    if (normalised.startsWith("SELECT buyin_cc, status FROM tournaments WHERE id =")) {
      return tables.tournaments.get(args[0]) || null;
    }
    if (normalised.startsWith("INSERT INTO tournament_entries")) {
      const [tournamentId, userId] = args;
      const k = `${tournamentId}|${userId}`;
      if (!tables.tournament_entries.has(k)) {
        tables.tournament_entries.set(k, { tournament_id: tournamentId, user_id: userId, registered_at: Math.floor(Date.now() / 1000), eliminated_at: null, placement: null });
      }
      return { changes: 1 };
    }
    if (normalised.startsWith("UPDATE tournaments SET prize_pool_cc = prize_pool_cc")) {
      const [amount, id] = args;
      const t = tables.tournaments.get(id);
      if (t) t.prize_pool_cc += amount;
      return { changes: 1 };
    }
    if (normalised.startsWith("SELECT * FROM tournaments WHERE id =")) {
      return tables.tournaments.get(args[0]) || null;
    }
    if (normalised.startsWith("SELECT user_id, registered_at, eliminated_at, placement")) {
      const [tournamentId] = args;
      return [...tables.tournament_entries.values()]
        .filter(e => e.tournament_id === tournamentId)
        .map(e => ({ user_id: e.user_id, registered_at: e.registered_at, eliminated_at: e.eliminated_at, placement: e.placement }));
    }
    if (normalised.startsWith("SELECT id, round, players_json, winner_user_id")) {
      const [tournamentId] = args;
      return [...tables.tournament_matches.values()]
        .filter(m => m.tournament_id === tournamentId)
        .map(m => ({ id: m.id, round: m.round, players_json: m.players_json, winner_user_id: m.winner_user_id, replay_dtu_id: m.replay_dtu_id, played_at: m.played_at }));
    }
    if (normalised.startsWith("SELECT id, world_id, kind, title")) {
      return [...tables.tournaments.values()]
        .filter(t => t.status === "open" || t.status === "running");
    }
    if (normalised.startsWith("INSERT INTO tournament_matches")) {
      const [id, tournamentId, round, playersJson, winnerUserId, replayDtuId] = args;
      tables.tournament_matches.set(id, { id, tournament_id: tournamentId, round, players_json: playersJson, winner_user_id: winnerUserId, replay_dtu_id: replayDtuId, played_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (normalised.startsWith("UPDATE tournament_entries SET eliminated_at")) {
      const [tournamentId, userId] = args;
      const k = `${tournamentId}|${userId}`;
      const e = tables.tournament_entries.get(k);
      if (e && !e.eliminated_at) e.eliminated_at = Math.floor(Date.now() / 1000);
      return { changes: 1 };
    }
    if (normalised.startsWith("SELECT user_id, eliminated_at FROM tournament_entries")) {
      const [tournamentId] = args;
      return [...tables.tournament_entries.values()]
        .filter(e => e.tournament_id === tournamentId)
        .sort((a, b) => {
          // NULLS FIRST in SQL → entries with no elimination come first (the winner).
          if (a.eliminated_at == null && b.eliminated_at != null) return -1;
          if (a.eliminated_at != null && b.eliminated_at == null) return 1;
          return (b.eliminated_at ?? 0) - (a.eliminated_at ?? 0);
        })
        .map(e => ({ user_id: e.user_id, eliminated_at: e.eliminated_at }));
    }
    if (normalised.startsWith("UPDATE tournament_entries SET placement")) {
      const [placement, tournamentId, userId] = args;
      const k = `${tournamentId}|${userId}`;
      const e = tables.tournament_entries.get(k);
      if (e) e.placement = placement;
      return { changes: 1 };
    }
    if (normalised.startsWith("UPDATE tournaments SET status =")) {
      const [id] = args;
      const t = tables.tournaments.get(id);
      if (t) { t.status = "complete"; t.ends_at = Math.floor(Date.now() / 1000); }
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  return { prepare: prep, tables };
}

describe("Phase S — tournaments", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("creates a tournament with prize pool 0", () => {
    const r = createTournament(db, { worldId: "lattice-crucible", kind: "pvp", title: "Spring Crucible", buyinCc: 50, startsAt: Math.floor(Date.now()/1000) + 3600, organizerUserId: "u1" });
    assert.equal(r.ok, true);
    const t = getTournament(db, r.tournamentId);
    assert.equal(t.title, "Spring Crucible");
    assert.equal(t.prize_pool_cc, 0);
  });

  it("registering adds the buy-in to the prize pool", () => {
    const c = createTournament(db, { worldId: "lattice-crucible", kind: "pvp", title: "Cup", buyinCc: 100, startsAt: Math.floor(Date.now()/1000) + 3600, organizerUserId: "u1" });
    registerForTournament(db, c.tournamentId, "p1");
    registerForTournament(db, c.tournamentId, "p2");
    registerForTournament(db, c.tournamentId, "p3");
    const t = getTournament(db, c.tournamentId);
    assert.equal(t.prize_pool_cc, 300); // 3 × 100
  });

  it("finalize distributes 60/25/10 with 5% platform fee", () => {
    const c = createTournament(db, { worldId: "lattice-crucible", kind: "pvp", title: "Cup", buyinCc: 100, startsAt: Math.floor(Date.now()/1000), organizerUserId: "u1" });
    registerForTournament(db, c.tournamentId, "p1");
    registerForTournament(db, c.tournamentId, "p2");
    registerForTournament(db, c.tournamentId, "p3");
    // p1 wins (no elimination), p2 then p3 eliminated.
    recordMatch(db, c.tournamentId, { round: 1, players: ["p2", "p3"], winnerUserId: "p2" });
    recordMatch(db, c.tournamentId, { round: 2, players: ["p1", "p2"], winnerUserId: "p1" });
    const r = finalizeTournament(db, c.tournamentId);
    assert.equal(r.ok, true);
    assert.equal(r.grossPool, 300);
    assert.equal(r.platformFee, 15); // 5%
    assert.equal(r.netPool, 285);
    assert.equal(r.payouts.length, 3);
    assert.equal(r.payouts[0].userId, "p1");
    assert.equal(r.payouts[0].placement, 1);
    assert.equal(r.payouts[0].amountCC, 171); // 285 * 0.60
    assert.equal(r.payouts[1].placement, 2);
    assert.equal(r.payouts[1].amountCC, 71.25); // 285 * 0.25
    assert.equal(r.payouts[2].placement, 3);
    assert.equal(r.payouts[2].amountCC, 28.5);  // 285 * 0.10
  });

  it("cannot finalize twice", () => {
    const c = createTournament(db, { worldId: "lattice-crucible", kind: "pvp", title: "Cup", buyinCc: 0, startsAt: Math.floor(Date.now()/1000), organizerUserId: "u1" });
    registerForTournament(db, c.tournamentId, "p1");
    finalizeTournament(db, c.tournamentId);
    const r2 = finalizeTournament(db, c.tournamentId);
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "already_complete");
  });
});
