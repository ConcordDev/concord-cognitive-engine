// Phase AA3 — tournament end-to-end test.
//
// Pins the chain: createTournament → registerForTournament → recordMatch →
// finalizeTournament → payout plan. The existing world_tournaments.test.js
// covered each step individually with a memDb stub; this test exercises
// the WHOLE LOOP and verifies the placement + payout math one last time
// so future regressions get caught.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createTournament,
  registerForTournament,
  recordMatch,
  finalizeTournament,
  getTournament,
} from "../lib/tournaments.js";

function memDb() {
  const t = {
    world_tournaments: new Map(),
    tournament_entries: new Map(),
    tournament_matches: new Map(),
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function _execute(sql, args, mode = "run") {
    const n = _trim(sql);

    if (n.startsWith("INSERT INTO world_tournaments")) {
      const [id, world_id, kind, title, buyin_cc, starts_at, ends_at, ruleset_dtu_id, organizer_user_id] = args;
      t.world_tournaments.set(id, {
        id, world_id, kind, title,
        buyin_cc, prize_pool_cc: 0, starts_at, ends_at,
        ruleset_dtu_id, organizer_user_id, status: "open",
      });
      return { changes: 1 };
    }
    if (n.startsWith("SELECT buyin_cc, status FROM world_tournaments WHERE id =")) {
      return t.world_tournaments.get(args[0]) || null;
    }
    if (n.startsWith("INSERT INTO tournament_entries")) {
      const [tid, uid] = args;
      const k = `${tid}|${uid}`;
      if (!t.tournament_entries.has(k)) {
        t.tournament_entries.set(k, { tournament_id: tid, user_id: uid, registered_at: Math.floor(Date.now() / 1000), eliminated_at: null, placement: null });
      }
      return { changes: 1 };
    }
    if (n.startsWith("UPDATE world_tournaments SET prize_pool_cc = prize_pool_cc + ?")) {
      const [amt, id] = args;
      const r = t.world_tournaments.get(id);
      if (r) r.prize_pool_cc += amt;
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO tournament_matches")) {
      const [id, tid, round, players_json, winner, replayDtuId] = args;
      t.tournament_matches.set(id, { id, tournament_id: tid, round, players_json, winner_user_id: winner, replay_dtu_id: replayDtuId, played_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (n.startsWith("UPDATE tournament_entries SET eliminated_at")) {
      const [tid, uid] = args;
      const e = t.tournament_entries.get(`${tid}|${uid}`);
      if (e && !e.eliminated_at) e.eliminated_at = Math.floor(Date.now() / 1000);
      return { changes: 1 };
    }
    if (n.startsWith("SELECT * FROM world_tournaments WHERE id =")) {
      return t.world_tournaments.get(args[0]) || null;
    }
    if (n.startsWith("SELECT user_id, registered_at, eliminated_at, placement")) {
      const [tid] = args;
      return [...t.tournament_entries.values()].filter(e => e.tournament_id === tid)
        .map(e => ({ user_id: e.user_id, registered_at: e.registered_at, eliminated_at: e.eliminated_at, placement: e.placement }));
    }
    if (n.startsWith("SELECT id, round, players_json")) {
      const [tid] = args;
      return [...t.tournament_matches.values()].filter(m => m.tournament_id === tid)
        .map(m => ({ id: m.id, round: m.round, players_json: m.players_json, winner_user_id: m.winner_user_id, replay_dtu_id: m.replay_dtu_id, played_at: m.played_at }));
    }
    if (n.startsWith("SELECT user_id, eliminated_at FROM tournament_entries")) {
      const [tid] = args;
      return [...t.tournament_entries.values()].filter(e => e.tournament_id === tid)
        .sort((a, b) => {
          if (a.eliminated_at == null && b.eliminated_at != null) return -1;
          if (a.eliminated_at != null && b.eliminated_at == null) return 1;
          return (b.eliminated_at ?? 0) - (a.eliminated_at ?? 0);
        })
        .map(e => ({ user_id: e.user_id, eliminated_at: e.eliminated_at }));
    }
    if (n.startsWith("UPDATE tournament_entries SET placement = ?")) {
      const [p, tid, uid] = args;
      const e = t.tournament_entries.get(`${tid}|${uid}`);
      if (e) e.placement = p;
      return { changes: 1 };
    }
    if (n.startsWith("UPDATE world_tournaments SET status = 'complete'")) {
      const r = t.world_tournaments.get(args[0]);
      if (r) { r.status = "complete"; r.ends_at = Math.floor(Date.now() / 1000); }
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  return {
    prepare(sql) {
      return {
        run: (...args) => _execute(sql, args),
        get: (...args) => _execute(sql, args, "get"),
        all: (...args) => _execute(sql, args, "all"),
      };
    },
    _t: t,
  };
}

describe("Phase AA3 — tournament end-to-end", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("full loop: create → register 3 → 2 matches → finalize → 60/25/10 distribution", () => {
    // 1. Create.
    const c = createTournament(db, {
      worldId: "lattice-crucible",
      kind: "pvp",
      title: "End-to-end cup",
      buyinCc: 100,
      startsAt: Math.floor(Date.now() / 1000),
      organizerUserId: "organizer",
    });
    assert.equal(c.ok, true);

    // 2. Register 3 entrants. Each one's buy-in flows to the prize pool.
    registerForTournament(db, c.tournamentId, "p1");
    registerForTournament(db, c.tournamentId, "p2");
    registerForTournament(db, c.tournamentId, "p3");

    const mid = getTournament(db, c.tournamentId);
    assert.equal(mid.prize_pool_cc, 300, "prize pool should equal 3× buy-in");
    assert.equal(mid.entries.length, 3);

    // 3. Round 1: p2 beats p3 (p3 eliminated).
    recordMatch(db, c.tournamentId, {
      round: 1, players: ["p2", "p3"], winnerUserId: "p2",
    });

    // 4. Round 2: p1 beats p2 (p2 eliminated, p1 stands alone = winner).
    recordMatch(db, c.tournamentId, {
      round: 2, players: ["p1", "p2"], winnerUserId: "p1",
    });

    // 5. Finalize.
    const f = finalizeTournament(db, c.tournamentId);
    assert.equal(f.ok, true);
    assert.equal(f.grossPool, 300);
    assert.equal(f.platformFee, 15, "5% platform fee on 300 = 15");
    assert.equal(f.netPool, 285);

    // 6. Verify placement + payout shape.
    assert.equal(f.payouts.length, 3);
    const [first, second, third] = f.payouts;
    assert.equal(first.userId, "p1");
    assert.equal(first.placement, 1);
    assert.equal(first.amountCC, 171, "1st = 285 × 0.60 = 171");
    assert.equal(second.userId, "p2");
    assert.equal(second.placement, 2);
    assert.equal(second.amountCC, 71.25, "2nd = 285 × 0.25 = 71.25");
    assert.equal(third.userId, "p3");
    assert.equal(third.placement, 3);
    assert.equal(third.amountCC, 28.5, "3rd = 285 × 0.10 = 28.5");

    // 7. Sum of payouts = netPool × (0.60+0.25+0.10) = 95% of netPool.
    //    The remaining 5% of netPool stays unallocated (reserved for ties /
    //    treasury at finalize time). The full invariant is therefore:
    //    payouts + platformFee + retained = grossPool.
    const sumPayouts = f.payouts.reduce((s, p) => s + p.amountCC, 0);
    assert.equal(sumPayouts, 270.75, "60%+25%+10% of net 285 = 270.75");
    const retained = f.grossPool - f.platformFee - sumPayouts;
    assert.equal(retained, 14.25, "5% of net pool retained (reserved bucket)");

    // 8. Tournament status is 'complete'.
    const after = getTournament(db, c.tournamentId);
    assert.equal(after.status, "complete");

    // 9. Placement is stamped on the entries (so the leaderboard can read them later).
    const placed = after.entries.filter(e => e.placement != null);
    assert.equal(placed.length, 3);
  });

  it("re-finalize is rejected (idempotency at the status level)", () => {
    const c = createTournament(db, {
      worldId: "lattice-crucible", kind: "pvp", title: "Idem cup",
      buyinCc: 0, startsAt: Math.floor(Date.now() / 1000), organizerUserId: "o",
    });
    registerForTournament(db, c.tournamentId, "p1");
    finalizeTournament(db, c.tournamentId);
    const r2 = finalizeTournament(db, c.tournamentId);
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "already_complete");
  });
});
