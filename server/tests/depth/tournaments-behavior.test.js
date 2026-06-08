// tests/depth/tournaments-behavior.test.js — REAL behavioral tests for the
// tournaments domain (registerLensAction family, invoked via lensRun).
//
// The tournaments lens is a bracket platform (Challonge/Battlefy parity):
// create → addEntrant → seed → openCheckin → checkIn → start → reportMatch →
// payouts, plus list/get/removeEntrant/cancel. Persistent per-user state lives
// in globalThis._concordSTATE.tournamentsLens keyed by userId, so a shared ctx
// gives state round-trips.
//
// NB: lens.run reports outer ok:true on dispatch and nests a handler refusal
// under result — a rejection is r.result.ok === false + r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("tournaments — create + defaults (exact computed values)", () => {
  it("create: defaults are applied exactly (format, mode, caps, split)", async () => {
    const r = await lensRun("tournaments", "create", { params: { title: "Default Cup" } });
    assert.equal(r.ok, true);
    const t = r.result.tournament;
    assert.equal(t.title, "Default Cup");
    assert.equal(t.format, "single_elimination"); // default format
    assert.equal(t.mode, "solo");                  // teamSize 1 → solo
    assert.equal(t.status, "upcoming");
    assert.equal(t.maxEntrants, 8);                // default cap
    assert.equal(t.prizePoolCc, 0);
    assert.deepEqual(t.payoutSplit, [60, 25, 15]); // default split
    assert.equal(t.locked, false);
    assert.equal(t.entrants.length, 0);
  });

  it("create: an unknown format falls back to single_elimination; caps clamp", async () => {
    const r = await lensRun("tournaments", "create", {
      params: { title: "Clamp Cup", format: "bo3_ladder", maxEntrants: 9999, teamSize: 99 },
    });
    const t = r.result.tournament;
    assert.equal(t.format, "single_elimination"); // invalid format → fallback
    assert.equal(t.maxEntrants, 128);             // clamped to max 128
    assert.equal(t.mode, "team");                 // teamSize > 1 → team
    assert.equal(t.teamSize, 10);                 // clamped to max 10
  });

  it("create: a round_robin format with team size sets mode team", async () => {
    const r = await lensRun("tournaments", "create", {
      params: { title: "RR Team", format: "round_robin", teamSize: 3, swissRounds: 99 },
    });
    const t = r.result.tournament;
    assert.equal(t.format, "round_robin");
    assert.equal(t.mode, "team");
    assert.equal(t.teamSize, 3);
    assert.equal(t.swissRounds, 12); // clamped to max 12 even when format isn't swiss
  });
});

describe("tournaments — entrant CRUD + seeding round-trips (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("tournaments-crud"); });

  it("create → addEntrant: entrant reads back with auto-incrementing seed + clamped rating", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Roster Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    const a = await lensRun("tournaments", "addEntrant", { params: { id, name: "Alice", rating: 99999 } }, ctx);
    assert.equal(a.ok, true);
    assert.equal(a.result.entrant.name, "Alice");
    assert.equal(a.result.entrant.seed, 1);     // first entrant
    assert.equal(a.result.entrant.rating, 5000); // clamped to max 5000
    assert.equal(a.result.entrant.checkedIn, false);

    const b = await lensRun("tournaments", "addEntrant", { params: { id, name: "Bob", rating: 1500 } }, ctx);
    assert.equal(b.result.entrant.seed, 2);     // second entrant

    // get reads both back.
    const got = await lensRun("tournaments", "get", { params: { id } }, ctx);
    assert.equal(got.result.tournament.entrants.length, 2);
    assert.ok(got.result.tournament.entrants.some((e) => e.name === "Alice"));
  });

  it("addEntrant: a blank name is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Name Cup" } }, ctx);
    const bad = await lensRun("tournaments", "addEntrant", { params: { id: cr.result.tournament.id, name: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "name_required");
  });

  it("addEntrant: a team tournament requires a roster", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Team Cup", teamSize: 2 } }, ctx);
    const id = cr.result.tournament.id;
    const noRoster = await lensRun("tournaments", "addEntrant", { params: { id, name: "Team A" } }, ctx);
    assert.equal(noRoster.result.ok, false);
    assert.equal(noRoster.result.error, "roster_required");
    // With a roster it succeeds and is truncated to teamSize.
    const ok = await lensRun("tournaments", "addEntrant", { params: { id, name: "Team B", roster: ["p1", "p2", "p3"] } }, ctx);
    assert.equal(ok.result.entrant.roster.length, 2); // sliced to teamSize 2
    assert.deepEqual(ok.result.entrant.roster, ["p1", "p2"]);
  });

  it("addEntrant: a full tournament is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Tiny Cup", maxEntrants: 2 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "E1" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "E2" } }, ctx);
    const full = await lensRun("tournaments", "addEntrant", { params: { id, name: "E3" } }, ctx);
    assert.equal(full.result.ok, false);
    assert.equal(full.result.error, "tournament_full");
  });

  it("removeEntrant: drops an entrant and re-numbers seeds compactly", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Remove Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    const e1 = await lensRun("tournaments", "addEntrant", { params: { id, name: "R1" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "R2" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "R3" } }, ctx);
    // Remove the first; remaining seeds compact to 1,2.
    const rm = await lensRun("tournaments", "removeEntrant", { params: { id, entrantId: e1.result.entrant.id } }, ctx);
    assert.equal(rm.ok, true);
    const ents = rm.result.tournament.entrants;
    assert.equal(ents.length, 2);
    assert.ok(!ents.some((e) => e.name === "R1"));
    assert.deepEqual(ents.map((e) => e.seed).sort(), [1, 2]);
  });

  it("removeEntrant: a missing entrant id is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Miss Cup" } }, ctx);
    const bad = await lensRun("tournaments", "removeEntrant", { params: { id: cr.result.tournament.id, entrantId: "nope_ent" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "entrant_not_found");
  });

  it("seed mode=rating: re-orders entrants by descending rating", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Seed Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "Low", rating: 1000 } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "High", rating: 3000 } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "Mid", rating: 2000 } }, ctx);
    const s = await lensRun("tournaments", "seed", { params: { id, mode: "rating" } }, ctx);
    const ents = s.result.tournament.entrants;
    // Seed 1 is highest rating.
    assert.equal(ents[0].name, "High");
    assert.equal(ents[0].seed, 1);
    assert.equal(ents[1].name, "Mid");
    assert.equal(ents[2].name, "Low");
    assert.equal(ents[2].seed, 3);
  });

  it("seed entrantId+seed: moves one entrant to a specific seed position", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Move Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "A" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "B" } }, ctx);
    const cEnt = await lensRun("tournaments", "addEntrant", { params: { id, name: "C" } }, ctx);
    // Move C (seed 3) to seed 1.
    const s = await lensRun("tournaments", "seed", { params: { id, entrantId: cEnt.result.entrant.id, seed: 1 } }, ctx);
    const ents = s.result.tournament.entrants;
    assert.equal(ents[0].name, "C");
    assert.equal(ents[0].seed, 1);
    assert.equal(ents[1].name, "A");
    assert.equal(ents[2].name, "B");
  });

  it("seed: invalid args are rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Bad Seed Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "X" } }, ctx);
    const bad = await lensRun("tournaments", "seed", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "seed_args_invalid");
  });
});

describe("tournaments — check-in lifecycle + auto-forfeit (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("tournaments-checkin"); });

  async function makeWithEntrants(title, names, extra = {}) {
    const cr = await lensRun("tournaments", "create", { params: { title, maxEntrants: 8, ...extra } }, ctx);
    const id = cr.result.tournament.id;
    const ids = [];
    for (const n of names) {
      const a = await lensRun("tournaments", "addEntrant", { params: { id, name: n } }, ctx);
      ids.push(a.result.entrant.id);
    }
    return { id, entrantIds: ids };
  }

  it("openCheckin: locks registration, sets status, requires ≥2 entrants", async () => {
    const { id } = await makeWithEntrants("Checkin Cup", ["A", "B"]);
    const open = await lensRun("tournaments", "openCheckin", { params: { id } }, ctx);
    assert.equal(open.ok, true);
    assert.equal(open.result.tournament.status, "checkin");
    assert.equal(open.result.tournament.locked, true);
    // After lock, addEntrant is closed.
    const closed = await lensRun("tournaments", "addEntrant", { params: { id, name: "C" } }, ctx);
    assert.equal(closed.result.ok, false);
    assert.equal(closed.result.error, "registration_closed");
  });

  it("openCheckin: a single-entrant tournament cannot open check-in", async () => {
    const { id } = await makeWithEntrants("Solo Checkin", ["Only"]);
    const bad = await lensRun("tournaments", "openCheckin", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "need_2_entrants");
  });

  it("checkIn: only valid during the check-in window", async () => {
    const { id, entrantIds } = await makeWithEntrants("CI Window", ["A", "B"]);
    // Not yet open → rejected.
    const early = await lensRun("tournaments", "checkIn", { params: { id, entrantId: entrantIds[0] } }, ctx);
    assert.equal(early.result.ok, false);
    assert.equal(early.result.error, "checkin_not_open");
    await lensRun("tournaments", "openCheckin", { params: { id } }, ctx);
    const ci = await lensRun("tournaments", "checkIn", { params: { id, entrantId: entrantIds[0] } }, ctx);
    assert.equal(ci.ok, true);
    const e = ci.result.tournament.entrants.find((x) => x.id === entrantIds[0]);
    assert.equal(e.checkedIn, true);
  });

  it("start after check-in auto-forfeits no-shows and reports the count", async () => {
    const { id, entrantIds } = await makeWithEntrants("Forfeit Cup", ["A", "B", "C"]);
    await lensRun("tournaments", "openCheckin", { params: { id } }, ctx);
    // Only 2 of 3 check in.
    await lensRun("tournaments", "checkIn", { params: { id, entrantId: entrantIds[0] } }, ctx);
    await lensRun("tournaments", "checkIn", { params: { id, entrantId: entrantIds[1] } }, ctx);
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    assert.equal(st.ok, true);
    assert.equal(st.result.forfeited, 1);                  // the no-show dropped
    assert.equal(st.result.tournament.entrants.length, 2); // only checked-in remain
    assert.equal(st.result.tournament.status, "in_progress");
  });

  it("start after check-in with <2 checked in is rejected", async () => {
    const { id, entrantIds } = await makeWithEntrants("Empty Start", ["A", "B"]);
    await lensRun("tournaments", "openCheckin", { params: { id } }, ctx);
    await lensRun("tournaments", "checkIn", { params: { id, entrantId: entrantIds[0] } }, ctx);
    const bad = await lensRun("tournaments", "start", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "need_2_checked_in_entrants");
  });
});

describe("tournaments — single-elim bracket play to completion (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("tournaments-se"); });

  it("4-entrant single-elim: report all matches → champion + payouts computed", async () => {
    const cr = await lensRun("tournaments", "create", {
      params: { title: "SE Cup", maxEntrants: 4, prizePoolCc: 1000 },
    }, ctx);
    const id = cr.result.tournament.id;
    for (const n of ["A", "B", "C", "D"]) {
      await lensRun("tournaments", "addEntrant", { params: { id, name: n } }, ctx);
    }
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    assert.equal(st.result.tournament.status, "in_progress");
    // 4 entrants → 2 round-1 matches (no byes).
    let t = st.result.tournament;
    let r1 = t.matches.filter((m) => m.round === 1 && m.status === "pending");
    assert.equal(r1.length, 2);

    // Report both round-1 matches: aId wins each.
    let last;
    for (const m of r1) {
      last = await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 2, scoreB: 1 } }, ctx);
      assert.equal(last.ok, true);
    }
    t = last.result.tournament;
    // A round-2 (final) match should now exist.
    const r2 = t.matches.filter((m) => m.round === 2);
    assert.equal(r2.length, 1);
    // Report the final.
    const fin = await lensRun("tournaments", "reportMatch", { params: { id, matchId: r2[0].id, scoreA: 3, scoreB: 0 } }, ctx);
    t = fin.result.tournament;
    assert.equal(t.status, "completed");
    assert.ok(t.winnerId);
    // Payouts: prizePool 1000, split [60,25,15] → 600 / 250 / 150.
    assert.equal(t.payouts.length, 3);
    assert.equal(t.payouts[0].amountCc, 600);
    assert.equal(t.payouts[1].amountCc, 250);
    assert.equal(t.payouts[2].amountCc, 150);
    // Champion is rank 1.
    assert.equal(t.payouts[0].entrantId, t.winnerId);
  });

  it("reportMatch: a draw score is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Draw Cup", maxEntrants: 2 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "A" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "B" } }, ctx);
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    const m = st.result.tournament.matches.find((x) => x.status === "pending");
    const bad = await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 1, scoreB: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "draws_not_allowed");
  });

  it("reportMatch: an already-reported match is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Dup Cup", maxEntrants: 2 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "A" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "B" } }, ctx);
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    const m = st.result.tournament.matches.find((x) => x.status === "pending");
    // First report completes the 2-player bracket.
    await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 2, scoreB: 0 } }, ctx);
    // Reporting it again — tournament is completed now → not running.
    const again = await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 5, scoreB: 0 } }, ctx);
    assert.equal(again.result.ok, false);
    assert.equal(again.result.error, "tournament_not_running");
  });

  it("3-entrant single-elim seeds a bye for the top seed", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Bye Cup", maxEntrants: 4 } }, ctx);
    const id = cr.result.tournament.id;
    for (const n of ["A", "B", "C"]) {
      await lensRun("tournaments", "addEntrant", { params: { id, name: n } }, ctx);
    }
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    // 3 entrants → bracket size 4 → one real match + one bye in round 1.
    const r1 = st.result.tournament.matches.filter((m) => m.round === 1);
    assert.equal(r1.length, 2);
    assert.ok(r1.some((m) => m.status === "bye"));
    assert.ok(r1.some((m) => m.status === "pending"));
  });
});

describe("tournaments — round-robin standings + payouts (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("tournaments-rr"); });

  it("3-entrant round-robin: 3 matches, full play declares standings winner + payouts", async () => {
    const cr = await lensRun("tournaments", "create", {
      params: { title: "RR Cup", format: "round_robin", maxEntrants: 4, prizePoolCc: 300, payoutSplit: [70, 30] },
    }, ctx);
    const id = cr.result.tournament.id;
    const ids = {};
    for (const n of ["A", "B", "C"]) {
      const a = await lensRun("tournaments", "addEntrant", { params: { id, name: n } }, ctx);
      ids[n] = a.result.entrant.id;
    }
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    let t = st.result.tournament;
    // Round robin of 3 → C(3,2) = 3 matches.
    assert.equal(t.matches.length, 3);

    // Make A beat everyone, B beat C → A=2W, B=1W, C=0W.
    let last;
    for (const m of t.matches) {
      const aIsA = m.aId === ids.A;
      const bIsA = m.bId === ids.A;
      let scoreA, scoreB;
      if (aIsA) { scoreA = 5; scoreB = 0; }       // A always wins as slot A
      else if (bIsA) { scoreA = 0; scoreB = 5; }  // A always wins as slot B
      else { // B vs C → B wins
        const aIsB = m.aId === ids.B;
        scoreA = aIsB ? 5 : 0; scoreB = aIsB ? 0 : 5;
      }
      last = await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA, scoreB } }, ctx);
    }
    t = last.result.tournament;
    assert.equal(t.status, "completed");
    // Standings: A first (2 wins).
    assert.equal(t.standings[0].entrantId, ids.A);
    assert.equal(t.standings[0].wins, 2);
    assert.equal(t.winnerId, ids.A);
    // Payouts: pool 300, split [70,30] → 210 / 90.
    assert.equal(t.payouts.length, 2);
    assert.equal(t.payouts[0].amountCc, 210);
    assert.equal(t.payouts[1].amountCc, 90);
  });
});

describe("tournaments — list/get/payouts/cancel surfaces (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("tournaments-surfaces"); });

  it("list: status + format filters narrow rows; counts reflect every status", async () => {
    const a = await lensRun("tournaments", "create", { params: { title: "L1", format: "single_elimination" } }, ctx);
    await lensRun("tournaments", "create", { params: { title: "L2", format: "round_robin" } }, ctx);
    const cancelMe = await lensRun("tournaments", "create", { params: { title: "L3" } }, ctx);
    await lensRun("tournaments", "cancel", { params: { id: cancelMe.result.tournament.id } }, ctx);

    const all = await lensRun("tournaments", "list", {}, ctx);
    assert.ok(all.result.tournaments.some((t) => t.id === a.result.tournament.id));
    assert.ok(all.result.counts.upcoming >= 2);
    assert.ok(all.result.counts.cancelled >= 1);

    const rrOnly = await lensRun("tournaments", "list", { params: { format: "round_robin" } }, ctx);
    assert.ok(rrOnly.result.tournaments.every((t) => t.format === "round_robin"));
    assert.ok(rrOnly.result.tournaments.length >= 1);

    const cancelled = await lensRun("tournaments", "list", { params: { status: "cancelled" } }, ctx);
    assert.ok(cancelled.result.tournaments.every((t) => t.status === "cancelled"));
  });

  it("get by shareSlug resolves the same tournament as get by id", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Share Cup" } }, ctx);
    const t = cr.result.tournament;
    const bySlug = await lensRun("tournaments", "get", { params: { shareSlug: t.shareSlug } }, ctx);
    assert.equal(bySlug.ok, true);
    assert.equal(bySlug.result.tournament.id, t.id);
  });

  it("get: a missing tournament id is rejected", async () => {
    const bad = await lensRun("tournaments", "get", { params: { id: "tour_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "tournament_not_found");
  });

  it("payouts: recompute with a new split + report unallocated remainder", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Payout Recalc", maxEntrants: 2, prizePoolCc: 1000 } }, ctx);
    const id = cr.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "A" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "B" } }, ctx);
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    const m = st.result.tournament.matches.find((x) => x.status === "pending");
    await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 1, scoreB: 0 } }, ctx);
    // Now completed. Recompute with a winner-take-all-ish split [100] over 2 entrants.
    const pay = await lensRun("tournaments", "payouts", { params: { id, payoutSplit: [100] } }, ctx);
    assert.equal(pay.ok, true);
    assert.equal(pay.result.prizePoolCc, 1000);
    assert.deepEqual(pay.result.payoutSplit, [100]);
    assert.equal(pay.result.payouts.length, 1);
    assert.equal(pay.result.payouts[0].amountCc, 1000); // 1000 × 100/100
    assert.equal(pay.result.unallocated, 0);
  });

  it("payouts: an un-completed tournament is rejected", async () => {
    const cr = await lensRun("tournaments", "create", { params: { title: "Not Done", prizePoolCc: 500 } }, ctx);
    const bad = await lensRun("tournaments", "payouts", { params: { id: cr.result.tournament.id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "tournament_not_completed");
  });

  it("cancel: an upcoming tournament flips to cancelled; a completed one cannot be cancelled", async () => {
    const up = await lensRun("tournaments", "create", { params: { title: "Cancel Me" } }, ctx);
    const c = await lensRun("tournaments", "cancel", { params: { id: up.result.tournament.id } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.tournament.status, "cancelled");

    // Build + complete a tournament, then cancel is rejected.
    const done = await lensRun("tournaments", "create", { params: { title: "Done Cup", maxEntrants: 2 } }, ctx);
    const id = done.result.tournament.id;
    await lensRun("tournaments", "addEntrant", { params: { id, name: "A" } }, ctx);
    await lensRun("tournaments", "addEntrant", { params: { id, name: "B" } }, ctx);
    const st = await lensRun("tournaments", "start", { params: { id } }, ctx);
    const m = st.result.tournament.matches.find((x) => x.status === "pending");
    await lensRun("tournaments", "reportMatch", { params: { id, matchId: m.id, scoreA: 2, scoreB: 0 } }, ctx);
    const bad = await lensRun("tournaments", "cancel", { params: { id } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "already_completed");
  });
});
