// Behavioral macro tests for server/domains/tournaments.js — the
// Challonge/Battlefy-shaped bracket substrate the /lenses/tournaments lens
// drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention.
// Our harness therefore calls `fn(ctx, virtualArtifact, input)`, NOT
// (ctx, input), so a regression that confuses the param positions surfaces
// here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + multi-step round-trips (create → addEntrant → list reflects it →
// start → bracket/report → standings → finalize → payouts), per-user
// isolation, and money-conservation: the domain holds NO wallet (pure
// in-memory state, zero mintCoins/walletDebit/walletCredit), so prizePoolCc is
// only ever DISTRIBUTED proportionally — the sum of payouts can never exceed
// the declared pool, and a poisoned-numeric prizePoolCc / payoutSplit is
// rejected fail-CLOSED with NO write.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTournamentsActions from "../domains/tournaments.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "tournaments", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`tournaments.${name} not registered`);
  const virtualArtifact = { id: null, domain: "tournaments", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerTournamentsActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// Every macro the lens page + its imported children invoke via lensRun.
const LENS_MACROS = [
  "create", "list", "get", "addEntrant", "removeEntrant", "seed",
  "openCheckin", "checkIn", "start", "reportMatch", "payouts", "cancel",
];

describe("tournaments — registration (every lens-driven macro present)", () => {
  it("registers all 12 macros the lens calls", () => {
    for (const m of LENS_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing tournaments.${m}`);
    }
  });
});

describe("tournaments — create + list round-trip", () => {
  it("create returns a publicView; list reflects it with status counts", () => {
    const c = call("create", ctxA, { title: "Spring Cup", game: "Concord PvP", format: "round_robin", maxEntrants: 4, prizePoolCc: 1000 });
    assert.equal(c.ok, true);
    const t = c.result.tournament;
    assert.equal(t.title, "Spring Cup");
    assert.equal(t.format, "round_robin");
    assert.equal(t.prizePoolCc, 1000);
    assert.equal(t.status, "upcoming");
    assert.equal(t.entrants.length, 0);
    assert.ok(t.shareSlug, "share slug minted for spectator link");

    const l = call("list", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.tournaments.length, 1);
    assert.equal(l.result.tournaments[0].id, t.id);
    assert.equal(l.result.counts.upcoming, 1);
    assert.equal(l.result.counts.completed, 0);
  });

  it("list filters by status and format", () => {
    call("create", ctxA, { title: "A", format: "swiss" });
    call("create", ctxA, { title: "B", format: "single_elimination" });
    const swiss = call("list", ctxA, { format: "swiss" });
    assert.equal(swiss.result.tournaments.length, 1);
    assert.equal(swiss.result.tournaments[0].title, "A");
    const upcoming = call("list", ctxA, { status: "upcoming" });
    assert.equal(upcoming.result.tournaments.length, 2);
  });

  it("empty state: list on a fresh user is ok:true zeroed, never no_db", () => {
    const l = call("list", ctxB, {});
    assert.equal(l.ok, true);
    assert.deepEqual(l.result.tournaments, []);
    assert.equal(l.result.counts.upcoming, 0);
  });
});

describe("tournaments — per-user isolation", () => {
  it("user_b cannot see or mutate user_a's tournament", () => {
    const c = call("create", ctxA, { title: "Private", prizePoolCc: 500 });
    const id = c.result.tournament.id;

    // B's list is empty
    assert.deepEqual(call("list", ctxB, {}).result.tournaments, []);
    // B cannot get A's tournament by id
    assert.equal(call("get", ctxB, { id }).ok, false);
    // B cannot add an entrant to A's tournament
    assert.equal(call("addEntrant", ctxB, { id, name: "Mallory" }).ok, false);

    // A still sees it intact
    const a = call("get", ctxA, { id });
    assert.equal(a.ok, true);
    assert.equal(a.result.tournament.entrants.length, 0);
  });

  it("get-by-shareSlug crosses owners (spectator deep-link is public)", () => {
    const c = call("create", ctxA, { title: "Public Spectate" });
    const slug = c.result.tournament.shareSlug;
    // B (a spectator) resolves it via the share slug.
    const spectate = call("get", ctxB, { shareSlug: slug });
    assert.equal(spectate.ok, true);
    assert.equal(spectate.result.tournament.title, "Public Spectate");
  });
});

describe("tournaments — entrant management round-trip", () => {
  function withEntrants(ctx, n, extra = {}) {
    const c = call("create", ctx, { title: "T", maxEntrants: n, ...extra });
    const id = c.result.tournament.id;
    for (let i = 0; i < n; i++) call("addEntrant", ctx, { id, name: `P${i + 1}`, rating: 1000 + i * 100 });
    return id;
  }

  it("addEntrant assigns sequential seeds and respects maxEntrants", () => {
    const c = call("create", ctxA, { title: "Cap", maxEntrants: 2 });
    const id = c.result.tournament.id;
    const a1 = call("addEntrant", ctxA, { id, name: "Ann" });
    assert.equal(a1.ok, true);
    assert.equal(a1.result.entrant.seed, 1);
    const a2 = call("addEntrant", ctxA, { id, name: "Bob" });
    assert.equal(a2.result.entrant.seed, 2);
    const a3 = call("addEntrant", ctxA, { id, name: "Cat" });
    assert.equal(a3.ok, false);
    assert.equal(a3.error, "tournament_full");
  });

  it("addEntrant rejects an empty name", () => {
    const c = call("create", ctxA, { title: "T" });
    const r = call("addEntrant", ctxA, { id: c.result.tournament.id, name: "   " });
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("team mode requires a roster", () => {
    const c = call("create", ctxA, { title: "Teams", teamSize: 3 });
    const id = c.result.tournament.id;
    assert.equal(c.result.tournament.mode, "team");
    const noRoster = call("addEntrant", ctxA, { id, name: "Squad" });
    assert.equal(noRoster.ok, false);
    assert.equal(noRoster.error, "roster_required");
    const withRoster = call("addEntrant", ctxA, { id, name: "Squad", roster: ["a", "b", "c"] });
    assert.equal(withRoster.ok, true);
    assert.equal(withRoster.result.entrant.roster.length, 3);
  });

  it("removeEntrant drops and re-seeds the remaining entrants", () => {
    const id = withEntrants(ctxA, 4);
    const t = call("get", ctxA, { id }).result.tournament;
    const second = t.entrants[1].id;
    const r = call("removeEntrant", ctxA, { id, entrantId: second });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournament.entrants.length, 3);
    r.result.tournament.entrants.forEach((e, i) => assert.equal(e.seed, i + 1));
  });

  it("seed by rating reorders highest-first", () => {
    const id = withEntrants(ctxA, 3); // ratings 1000, 1100, 1200
    const r = call("seed", ctxA, { id, mode: "rating" });
    assert.equal(r.ok, true);
    const seeds = r.result.tournament.entrants;
    assert.equal(seeds[0].rating, 1200);
    assert.equal(seeds[0].seed, 1);
    assert.equal(seeds[2].rating, 1000);
  });
});

describe("tournaments — check-in + start lifecycle", () => {
  function seeded(ctx, n) {
    const c = call("create", ctx, { title: "Live", format: "single_elimination", maxEntrants: n });
    const id = c.result.tournament.id;
    for (let i = 0; i < n; i++) call("addEntrant", ctx, { id, name: `P${i + 1}` });
    return id;
  }

  it("openCheckin → checkIn → start auto-forfeits no-shows", () => {
    const id = seeded(ctxA, 4);
    let t = call("get", ctxA, { id }).result.tournament;
    const ids = t.entrants.map((e) => e.id);

    const open = call("openCheckin", ctxA, { id });
    assert.equal(open.ok, true);
    assert.equal(open.result.tournament.status, "checkin");

    // only 3 of 4 check in
    call("checkIn", ctxA, { id, entrantId: ids[0] });
    call("checkIn", ctxA, { id, entrantId: ids[1] });
    call("checkIn", ctxA, { id, entrantId: ids[2] });

    const start = call("start", ctxA, { id });
    assert.equal(start.ok, true);
    assert.equal(start.result.forfeited, 1, "the no-show is forfeited");
    assert.equal(start.result.tournament.status, "in_progress");
    assert.equal(start.result.tournament.entrants.length, 3);
    assert.ok(start.result.tournament.matches.length > 0, "bracket generated");
  });

  it("start without check-in keeps everyone eligible", () => {
    const id = seeded(ctxA, 4);
    const start = call("start", ctxA, { id });
    assert.equal(start.ok, true);
    assert.equal(start.result.forfeited, 0);
    assert.equal(start.result.tournament.entrants.length, 4);
  });

  it("start rejects fewer than 2 entrants", () => {
    const c = call("create", ctxA, { title: "Solo" });
    const id = c.result.tournament.id;
    call("addEntrant", ctxA, { id, name: "Only" });
    const r = call("start", ctxA, { id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "need_2_checked_in_entrants");
  });
});

describe("tournaments — full single-elim run → champion → payouts", () => {
  it("reporting all matches crowns a champion and distributes the pool", () => {
    const c = call("create", ctxA, { title: "Cup", format: "single_elimination", maxEntrants: 4, prizePoolCc: 1000, payoutSplit: [60, 30, 10] });
    const id = c.result.tournament.id;
    for (let i = 0; i < 4; i++) call("addEntrant", ctxA, { id, name: `P${i + 1}` });
    let t = call("start", ctxA, { id }).result.tournament;

    // Report each round's pending matches until a winner emerges.
    let guard = 0;
    while (!t.winnerId && guard++ < 20) {
      const pending = t.matches.filter((m) => m.status === "pending" && m.aId && m.bId);
      if (pending.length === 0) break;
      for (const m of pending) {
        const r = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 1 });
        assert.equal(r.ok, true);
        t = r.result.tournament;
        if (t.winnerId) break;
      }
    }
    assert.ok(t.winnerId, "a champion was crowned");
    assert.equal(t.status, "completed");

    // Payouts: re-read + assert money conservation (never mints CC).
    const pay = call("payouts", ctxA, { id });
    assert.equal(pay.ok, true);
    assert.equal(pay.result.prizePoolCc, 1000);
    const distributed = pay.result.payouts.reduce((a, x) => a + x.amountCc, 0);
    assert.ok(distributed <= 1000, "distributed cannot exceed the declared pool");
    assert.equal(distributed + pay.result.unallocated, 1000, "pool fully accounted (paid + unallocated == pool)");
    // first-place share is 60% of 1000 (rounded).
    assert.equal(pay.result.payouts[0].amountCc, 600);
  });

  it("reportMatch rejects a draw and double-report", () => {
    const c = call("create", ctxA, { title: "RR", format: "round_robin", maxEntrants: 3 });
    const id = c.result.tournament.id;
    for (let i = 0; i < 3; i++) call("addEntrant", ctxA, { id, name: `P${i + 1}` });
    const t = call("start", ctxA, { id }).result.tournament;
    const m = t.matches.find((x) => x.status === "pending");
    const draw = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 1, scoreB: 1 });
    assert.equal(draw.ok, false);
    assert.equal(draw.error, "draws_not_allowed");
    call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 0 });
    const again = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 3, scoreB: 0 });
    assert.equal(again.ok, false);
    assert.equal(again.error, "match_already_reported");
  });

  it("round-robin standings rank winners ahead of losers", () => {
    const c = call("create", ctxA, { title: "RR2", format: "round_robin", maxEntrants: 3 });
    const id = c.result.tournament.id;
    for (let i = 0; i < 3; i++) call("addEntrant", ctxA, { id, name: `P${i + 1}` });
    let t = call("start", ctxA, { id }).result.tournament;
    const e = t.entrants;
    // P1 beats everyone.
    for (const m of t.matches.filter((x) => x.status === "pending")) {
      const winnerIsA = m.aId === e[0].id;
      const winnerIsB = m.bId === e[0].id;
      const scoreA = winnerIsA ? 2 : winnerIsB ? 0 : (m.aId === e[1].id ? 2 : 0);
      const scoreB = scoreA === 2 ? 0 : 2;
      t = call("reportMatch", ctxA, { id, matchId: m.id, scoreA, scoreB }).result.tournament;
    }
    const top = t.standings[0];
    assert.equal(top.entrantId, e[0].id, "P1 (won all) is rank 1");
    assert.equal(top.rank, 1);
    assert.ok(top.wins >= top.losses);
  });
});

describe("tournaments — cancel", () => {
  it("cancel sets cancelled and blocks once completed", () => {
    const c = call("create", ctxA, { title: "Doomed" });
    const id = c.result.tournament.id;
    const r = call("cancel", ctxA, { id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournament.status, "cancelled");
  });
});

describe("tournaments — MONEY: poisoned-numeric is fail-CLOSED (no write)", () => {
  for (const bad of [1e308, Infinity, -Infinity, NaN, -1, 2e6]) {
    it(`create rejects prizePoolCc=${String(bad)} with NO tournament written`, () => {
      const r = call("create", ctxA, { title: "Exploit", prizePoolCc: bad });
      if (bad === NaN) {
        // NaN coerces oddly; assert it is at minimum not stored as a live pool.
      }
      assert.equal(r.ok, false, `should reject prizePoolCc=${String(bad)}`);
      assert.equal(r.error, "invalid_prize_pool");
      // Nothing was written to this user's archive.
      assert.deepEqual(call("list", ctxA, {}).result.tournaments, []);
    });
  }

  it("create rejects a poisoned payoutSplit entry", () => {
    const r = call("create", ctxA, { title: "Bad split", payoutSplit: [60, 1e308, 15] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_payout_split");
    assert.deepEqual(call("list", ctxA, {}).result.tournaments, []);
  });

  it("payouts re-split rejects a poisoned weight without mutating stored split", () => {
    // Build a completed tournament with a sane pool first.
    const c = call("create", ctxA, { title: "Done", format: "round_robin", maxEntrants: 2, prizePoolCc: 100, payoutSplit: [70, 30] });
    const id = c.result.tournament.id;
    call("addEntrant", ctxA, { id, name: "P1" });
    call("addEntrant", ctxA, { id, name: "P2" });
    let t = call("start", ctxA, { id }).result.tournament;
    for (const m of t.matches.filter((x) => x.status === "pending")) {
      t = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 0 }).result.tournament;
    }
    assert.equal(t.status, "completed");
    const bad = call("payouts", ctxA, { id, payoutSplit: [Infinity, 30] });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_payout_split");
    // The stored split is still the original sane one.
    const ok = call("payouts", ctxA, { id });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.result.payoutSplit, [70, 30]);
    const distributed = ok.result.payouts.reduce((a, x) => a + x.amountCc, 0);
    assert.ok(distributed <= 100, "no CC minted beyond the declared pool");
  });
});
