// tests/depth/politics-behavior.test.js — REAL behavioral tests for the politics
// domain (register()/runMacro family, via macroRuntime). Drives the election
// loop open_cycle → declare_candidacy → advance_phase → vote → tally → certify,
// plus phase-gate validation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("politics — election cycle loop", () => {
  let runMacro, ctx, cycleId, candidateId;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("politics")); });

  it("open_cycle: a new cycle starts in the filing phase", async () => {
    const r = await runMacro("politics", "open_cycle", { worldId: "w-pol", officeKind: "mayor", seatLabel: "Mayor of Tunya" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.phase, "filing");
    cycleId = r.cycleId;
  });

  it("open_cycle: missing inputs are rejected (engine throws → invalid_input)", async () => {
    const r = await runMacro("politics", "open_cycle", { worldId: "w-pol" }, ctx); // no officeKind/seatLabel
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_input");
  });

  it("get_cycle: reads the cycle back; unknown id is rejected", async () => {
    const ok = await runMacro("politics", "get_cycle", { cycleId }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.cycle.id, cycleId);
    const bad = await runMacro("politics", "get_cycle", { cycleId: "nope" }, ctx);
    assert.equal(bad.reason, "cycle_not_found");
  });

  it("declare_candidacy → candidates: the candidate files and is listed", async () => {
    const c = await runMacro("politics", "declare_candidacy", { cycleId, platform: "lower taxes" }, ctx);
    assert.equal(c.ok, true);
    candidateId = c.candidateId;
    const list = await runMacro("politics", "candidates", { cycleId }, ctx);
    assert.ok(list.candidates.some((x) => x.id === candidateId));
  });

  it("vote before the general phase is rejected (voting_closed)", async () => {
    const r = await runMacro("politics", "vote", { cycleId, candidateId }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "voting_closed");
  });

  it("advance_phase → vote → tally → certify: the election resolves with a winner", async () => {
    const adv = await runMacro("politics", "advance_phase", { cycleId, phase: "general" }, ctx);
    assert.equal(adv.ok, true);
    assert.equal(adv.phase, "general");

    const vote = await runMacro("politics", "vote", { cycleId, candidateId }, ctx);
    assert.equal(vote.ok, true);
    const dupe = await runMacro("politics", "vote", { cycleId, candidateId }, ctx);
    assert.equal(dupe.reason, "already_voted");

    const tally = await runMacro("politics", "tally", { cycleId }, ctx);
    assert.equal(tally.ok, true);
    assert.equal(tally.total, 1);
    assert.equal(tally.winner.candidateId, candidateId);

    const cert = await runMacro("politics", "certify", { cycleId }, ctx);
    assert.equal(cert.ok, true);
    assert.equal(cert.winner.candidateId, candidateId);
  });

  it("advance_phase: an unknown phase is rejected", async () => {
    const r = await runMacro("politics", "advance_phase", { cycleId, phase: "coronation" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_phase");
  });

  it("list_cycles: the world's cycle is listed; constants exposed", async () => {
    const cycles = await runMacro("politics", "list_cycles", { worldId: "w-pol" }, ctx);
    assert.ok(cycles.cycles.some((c) => c.id === cycleId));
    const k = await runMacro("politics", "constants", {}, ctx);
    assert.equal(k.ok, true);
    assert.ok(k.constants && typeof k.constants === "object");
  });
});
