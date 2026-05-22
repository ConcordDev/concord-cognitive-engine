// Contract tests for server/domains/tournaments.js — Challonge / Battlefy
// parity macros: multi-format brackets, seeding, check-in window,
// live match reporting + auto-advance, spectator share links, team
// rosters, and prize-payout distribution.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTournamentsActions from "../domains/tournaments.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`tournaments.${name}`);
  if (!fn) throw new Error(`tournaments.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTournamentsActions(register); });

beforeEach(() => {
  // isolate per-test state
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function makeWithEntrants(format, names, extra = {}) {
  const c = call("create", ctxA, { title: "T", format, maxEntrants: 32, ...extra });
  assert.equal(c.ok, true, c.error);
  const id = c.result.tournament.id;
  let t = c.result.tournament;
  for (const n of names) {
    const r = call("addEntrant", ctxA, { id, name: n, rating: 1000 + names.indexOf(n) * 10, roster: extra.teamSize ? [n + "-p1", n + "-p2"] : [] });
    assert.equal(r.ok, true, r.error);
    t = r.result.tournament;
  }
  return { id, t };
}

describe("tournaments.create", () => {
  it("creates each bracket format", () => {
    for (const fmt of ["single_elimination", "double_elimination", "round_robin", "swiss"]) {
      const r = call("create", ctxA, { title: "X", format: fmt });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.result.tournament.format, fmt);
      assert.equal(r.result.tournament.status, "upcoming");
      assert.ok(r.result.tournament.shareSlug);
    }
  });
  it("defaults invalid format to single_elimination", () => {
    const r = call("create", ctxA, { title: "X", format: "nonsense" });
    assert.equal(r.result.tournament.format, "single_elimination");
  });
  it("team mode set via teamSize", () => {
    const r = call("create", ctxA, { title: "X", teamSize: 3 });
    assert.equal(r.result.tournament.mode, "team");
    assert.equal(r.result.tournament.teamSize, 3);
  });
});

describe("tournaments.list (lifecycle filters)", () => {
  it("returns status counts", () => {
    call("create", ctxA, { title: "A" });
    call("create", ctxA, { title: "B" });
    const r = call("list", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.tournaments.length, 2);
    assert.equal(r.result.counts.upcoming, 2);
  });
  it("filters by status", () => {
    call("create", ctxA, { title: "A" });
    const r = call("list", ctxA, { status: "completed" });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournaments.length, 0);
  });
});

describe("tournaments.addEntrant / removeEntrant", () => {
  it("adds solo entrants and assigns seeds", () => {
    const { t } = makeWithEntrants("single_elimination", ["Ann", "Bob"]);
    assert.equal(t.entrants.length, 2);
    assert.deepEqual(t.entrants.map((e) => e.seed), [1, 2]);
  });
  it("requires a roster for team mode", () => {
    const c = call("create", ctxA, { title: "Tm", teamSize: 2 });
    const r = call("addEntrant", ctxA, { id: c.result.tournament.id, name: "Team A", roster: [] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "roster_required");
  });
  it("removeEntrant re-seeds", () => {
    const { id, t } = makeWithEntrants("single_elimination", ["Ann", "Bob", "Cy"]);
    const r = call("removeEntrant", ctxA, { id, entrantId: t.entrants[0].id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournament.entrants.length, 2);
    assert.deepEqual(r.result.tournament.entrants.map((e) => e.seed), [1, 2]);
  });
});

describe("tournaments.seed", () => {
  it("auto-seeds by rating descending", () => {
    const { id } = makeWithEntrants("single_elimination", ["Ann", "Bob", "Cy"]);
    const r = call("seed", ctxA, { id, mode: "rating" });
    assert.equal(r.ok, true);
    const ratings = r.result.tournament.entrants.map((e) => e.rating);
    assert.deepEqual([...ratings].sort((a, b) => b - a), ratings);
  });
  it("manual move places entrant at target seed", () => {
    const { id, t } = makeWithEntrants("single_elimination", ["Ann", "Bob", "Cy"]);
    const r = call("seed", ctxA, { id, entrantId: t.entrants[2].id, seed: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournament.entrants[0].name, "Cy");
  });
});

describe("tournaments.openCheckin / checkIn / auto-forfeit", () => {
  it("opens check-in and forfeits no-shows on start", () => {
    const { id, t } = makeWithEntrants("single_elimination", ["Ann", "Bob", "Cy", "Dee"]);
    const oc = call("openCheckin", ctxA, { id });
    assert.equal(oc.ok, true);
    assert.equal(oc.result.tournament.status, "checkin");
    // only check in 2 of 4
    call("checkIn", ctxA, { id, entrantId: t.entrants[0].id });
    call("checkIn", ctxA, { id, entrantId: t.entrants[1].id });
    const s = call("start", ctxA, { id });
    assert.equal(s.ok, true, s.error);
    assert.equal(s.result.forfeited, 2);
    assert.equal(s.result.tournament.entrants.length, 2);
  });
});

describe("tournaments.start + reportMatch (single elim auto-advance)", () => {
  it("runs a 4-player single-elim to a champion", () => {
    const { id } = makeWithEntrants("single_elimination", ["A", "B", "C", "D"]);
    const s = call("start", ctxA, { id });
    assert.equal(s.ok, true, s.error);
    let t = s.result.tournament;
    assert.equal(t.status, "in_progress");
    // play round 1
    for (const m of t.matches.filter((x) => x.status === "pending")) {
      const r = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 1 });
      assert.equal(r.ok, true, r.error);
      t = r.result.tournament;
    }
    // play whatever rounds remain
    let guard = 0;
    while (t.status === "in_progress" && guard++ < 10) {
      const pending = t.matches.filter((x) => x.status === "pending" && x.aId && x.bId);
      if (!pending.length) break;
      const r = call("reportMatch", ctxA, { id, matchId: pending[0].id, scoreA: 3, scoreB: 0 });
      t = r.result.tournament;
    }
    assert.equal(t.status, "completed");
    assert.ok(t.winnerId);
  });
  it("rejects draw scores", () => {
    const { id } = makeWithEntrants("single_elimination", ["A", "B"]);
    const s = call("start", ctxA, { id });
    const m = s.result.tournament.matches.find((x) => x.status === "pending");
    const r = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 1, scoreB: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "draws_not_allowed");
  });
});

describe("tournaments round-robin + standings", () => {
  it("generates all pairings and computes standings", () => {
    const { id } = makeWithEntrants("round_robin", ["A", "B", "C"]);
    const s = call("start", ctxA, { id });
    assert.equal(s.ok, true, s.error);
    let t = s.result.tournament;
    assert.equal(t.matches.length, 3); // C(3,2)
    for (const m of t.matches) {
      const r = call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 0 });
      t = r.result.tournament;
    }
    assert.equal(t.status, "completed");
    assert.ok(t.standings.length === 3);
    assert.equal(t.standings[0].rank, 1);
  });
});

describe("tournaments swiss multi-round", () => {
  it("pairs new rounds until swissRounds reached", () => {
    const { id } = makeWithEntrants("swiss", ["A", "B", "C", "D"], { swissRounds: 2 });
    const s = call("start", ctxA, { id });
    assert.equal(s.ok, true, s.error);
    let t = s.result.tournament;
    let guard = 0;
    while (t.status === "in_progress" && guard++ < 20) {
      const pending = t.matches.filter((x) => x.status === "pending" && x.aId && x.bId);
      if (!pending.length) break;
      const r = call("reportMatch", ctxA, { id, matchId: pending[0].id, scoreA: 2, scoreB: 1 });
      t = r.result.tournament;
    }
    assert.equal(t.status, "completed");
    assert.ok(t.winnerId);
  });
});

describe("tournaments.payouts", () => {
  it("distributes the prize pool by split on completion", () => {
    const { id } = makeWithEntrants("single_elimination", ["A", "B"], { prizePoolCc: 1000 });
    const s = call("start", ctxA, { id });
    const m = s.result.tournament.matches.find((x) => x.status === "pending");
    call("reportMatch", ctxA, { id, matchId: m.id, scoreA: 2, scoreB: 0 });
    const r = call("payouts", ctxA, { id, payoutSplit: [70, 30] });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.prizePoolCc, 1000);
    assert.equal(r.result.payouts[0].amountCc, 700);
    assert.equal(r.result.payouts[0].rank, 1);
  });
  it("rejects payouts before completion", () => {
    const { id } = makeWithEntrants("single_elimination", ["A", "B"]);
    const r = call("payouts", ctxA, { id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "tournament_not_completed");
  });
});

describe("tournaments.get (spectator via shareSlug)", () => {
  it("resolves a tournament by its share slug", () => {
    const c = call("create", ctxA, { title: "Spec" });
    const slug = c.result.tournament.shareSlug;
    const r = call("get", ctxA, { shareSlug: slug });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.tournament.id, c.result.tournament.id);
  });
});

describe("tournaments.cancel", () => {
  it("cancels an un-started tournament", () => {
    const c = call("create", ctxA, { title: "Cancelme" });
    const r = call("cancel", ctxA, { id: c.result.tournament.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.tournament.status, "cancelled");
  });
});

describe("tournaments never throws on bad input", () => {
  it("returns ok:false for unknown tournament id", () => {
    for (const action of ["get", "addEntrant", "seed", "start", "reportMatch", "payouts", "cancel", "openCheckin", "checkIn", "removeEntrant"]) {
      const r = call(action, ctxA, { id: "missing" });
      assert.equal(r.ok, false, `${action} should fail gracefully`);
      assert.ok(typeof r.error === "string");
    }
  });
});
