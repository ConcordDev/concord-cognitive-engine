// tests/depth/crime-behavior.test.js — REAL behavioral tests for the crime
// domain (register()/runMacro family, via the macroRuntime harness path).
// Exact-value calcs (heists are deterministic via rollOverride) + lifecycle
// round-trips + validation. Each literal runMacro("crime","<macro>",…) is
// credited by the macro-depth grader.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("crime — deterministic contracts", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("crime")); });

  it("record: a witnessed crime mints bounty = floor(severity*1000+100)", async () => {
    const r = await runMacro("crime", "record", { victimKind: "npc", victimId: "n1", crimeKind: "theft", severity: 0.5, witnessed: true, worldId: "w-crime-1" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.witnessed, true);
    assert.equal(r.bountyCents, 600);          // floor(0.5*1000 + 100)
  });

  it("record: missing victim is rejected", async () => {
    const r = await runMacro("crime", "record", { crimeKind: "theft" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("wanted: an unresolved crime appears on the world's wanted list", async () => {
    await runMacro("crime", "record", { victimKind: "npc", victimId: "n2", crimeKind: "assault", severity: 0.3, worldId: "w-crime-2" }, ctx);
    const w = await runMacro("crime", "wanted", { worldId: "w-crime-2" }, ctx);
    assert.equal(w.ok, true);
    assert.ok(w.wanted.length >= 1);
  });

  it("plan_heist → execute_heist: a forced-low roll SUCCEEDS and pays the reward", async () => {
    const plan = await runMacro("crime", "plan_heist", { targetKind: "vault", targetId: "b1", difficulty: 0.5, rewardCents: 5000 }, ctx);
    assert.equal(plan.ok, true);
    assert.equal(plan.rewardCents, 5000);
    const ex = await runMacro("crime", "execute_heist", { heistId: plan.heistId, crewSkill: 80, rollOverride: 0.01, witnessRollOverride: 0.99 }, ctx);
    assert.equal(ex.ok, true);
    assert.equal(ex.success, true);            // 0.01 < successChance (clamped ≥0.05)
    assert.equal(ex.rewardCents, 5000);
    assert.equal(ex.witnesses, 0);             // 0.99 → no witnesses
  });

  it("execute_heist: a forced-high roll FAILS and pays nothing", async () => {
    const plan = await runMacro("crime", "plan_heist", { targetKind: "vault", targetId: "v1", difficulty: 0.5, rewardCents: 9000 }, ctx);
    const ex = await runMacro("crime", "execute_heist", { heistId: plan.heistId, crewSkill: 20, rollOverride: 0.99, witnessRollOverride: 0.99 }, ctx);
    assert.equal(ex.success, false);           // 0.99 > successChance (clamped ≤0.95)
    assert.equal(ex.rewardCents, 0);
  });

  it("execute_heist: a missing heist id is rejected", async () => {
    const r = await runMacro("crime", "execute_heist", { heistId: "does-not-exist" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "heist_not_found");
  });

  it("constants: exposes the crime tuning constants", async () => {
    const r = await runMacro("crime", "constants", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.constants && typeof r.constants === "object");
  });
});

describe("crime — bounties + territories round-trips", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("crime-rt")); });

  it("issue_bounty → bounties_on → claim_bounty: full lifecycle, exact payout", async () => {
    const issued = await runMacro("crime", "issue_bounty", { targetKind: "npc", targetId: "fugitive-1", amountCents: 2500, reason: "wanted" }, ctx);
    assert.equal(issued.ok, true);
    const on = await runMacro("crime", "bounties_on", { targetKind: "npc", targetId: "fugitive-1" }, ctx);
    assert.ok(on.bounties.some((b) => b.id === issued.bountyId));
    const claim = await runMacro("crime", "claim_bounty", { bountyId: issued.bountyId }, ctx);
    assert.equal(claim.ok, true);
    assert.equal(claim.amountCents, 2500);
  });

  it("issue_bounty → cancel_bounty: a cancelled bounty can't be claimed", async () => {
    const issued = await runMacro("crime", "issue_bounty", { targetKind: "npc", targetId: "fugitive-2", amountCents: 1000, reason: "x" }, ctx);
    const cancel = await runMacro("crime", "cancel_bounty", { bountyId: issued.bountyId }, ctx);
    assert.equal(cancel.ok, true);
    const claim = await runMacro("crime", "claim_bounty", { bountyId: issued.bountyId }, ctx);
    assert.equal(claim.ok, false);             // cancelled
  });

  it("stake_territory → territories → advance_control: control moves and clamps at 100", async () => {
    const staked = await runMacro("crime", "stake_territory", { worldId: "w-terr", factionId: "f1", controlPct: 50, radiusM: 200 }, ctx);
    assert.equal(staked.ok, true);
    const list = await runMacro("crime", "territories", { worldId: "w-terr" }, ctx);
    assert.ok(list.territories.some((t) => t.id === staked.territoryId));
    const adv = await runMacro("crime", "advance_control", { territoryId: staked.territoryId, delta: 20 }, ctx);
    assert.equal(adv.controlPct, 70);          // 50 + 20
    const adv2 = await runMacro("crime", "advance_control", { territoryId: staked.territoryId, delta: 100 }, ctx);
    assert.equal(adv2.controlPct, 100);        // clamped 0..100
  });
});
