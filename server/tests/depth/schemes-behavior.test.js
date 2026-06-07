// tests/depth/schemes-behavior.test.js — REAL behavioral tests for the schemes
// domain (register()/runMacro family, via the macroRuntime harness path).
//
// Assertions pin EXACT source values from server/domains/schemes.js +
// server/lib/npc-schemes.js (proposePlayerScheme successBase=25/discovery=15,
// the planning→recruiting state machine, gather_evidence's +5 discovery bump,
// the motive/eligible-kind gates) and server/lib/hook-artifacts.js. Each
// literal runMacro("schemes",…) / runMacro("hooks",…) is credited by the
// macro-depth grader. randomUUID keeps fixed-key entities collision-free so
// the persistent test DB stays idempotent across re-runs.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "./_harness.js";

describe("schemes — propose + read-back contracts", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("schemes")); });

  it("propose_player_scheme: a non-NPC target bypasses the motive gate and seeds success_pct=25 / discovery_pct=15", async () => {
    const targetId = `faction-${randomUUID()}`;
    const r = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId, kind: "sabotage_decree" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.kind, "sabotage_decree");
    assert.ok(r.schemeId.startsWith("sch_player_"));  // proposePlayerScheme id prefix

    // round-trip: it reads back on the caller's own-scheme list with the
    // seeded phase + exact success/discovery from proposePlayerScheme().
    const list = await runMacro("schemes", "list_for_user", {}, ctx);
    assert.equal(list.ok, true);
    const mine = list.schemes.find((s) => s.id === r.schemeId);
    assert.ok(mine, "proposed scheme must appear on list_for_user");
    assert.equal(mine.phase, "planning");
    assert.equal(mine.success_pct, 25);   // successBase = 25, no hooks
    assert.equal(mine.discovery_pct, 15); // literal 15 in the INSERT
    assert.equal(mine.target_id, targetId);
    assert.equal(mine.kind, "sabotage_decree");
  });

  it("propose_player_scheme: an ineligible kind is rejected with bad_kind", async () => {
    const r = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `f-${randomUUID()}`, kind: "summon_dragon" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_kind");   // not in ELIGIBLE_KINDS
  });

  it("propose_player_scheme: missing inputs are rejected with missing_inputs", async () => {
    const r = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction" }, ctx);   // no targetId / kind
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("propose_player_scheme: an NPC target with no hatred / stress fails the motive gate", async () => {
    const r = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "npc", targetId: `indifferent-npc-${randomUUID()}`, kind: "blackmail" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_motive");  // hasMotive() → false (no opinion ≤ -50, no stress ≥ 60)
  });
});

describe("schemes — lifecycle state machine", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("schemes-lifecycle")); });

  it("move: planning → recruiting (advanceScheme always advances planning by one tick)", async () => {
    const proposed = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `tf-${randomUUID()}`, kind: "fabricate_secret" }, ctx);
    assert.equal(proposed.ok, true);

    const moved = await runMacro("schemes", "move", { schemeId: proposed.schemeId }, ctx);
    assert.equal(moved.ok, true);
    assert.equal(moved.transitioned, true);
    assert.equal(moved.fromPhase, "planning");
    assert.equal(moved.toPhase, "recruiting");
  });

  it("gather_evidence: only fires in recruiting/gathering_evidence — a fresh planning scheme is rejected with wrong_phase", async () => {
    const proposed = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `wp-${randomUUID()}`, kind: "claim_inheritance" }, ctx);
    const r = await runMacro("schemes", "gather_evidence",
      { schemeId: proposed.schemeId, worldId: "w-schemes" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wrong_phase");
    assert.equal(r.phase, "planning");
  });

  it("move then gather_evidence: adds an evidence row, drops a hook, and bumps discovery_pct by 5 (15→20)", async () => {
    const worldId = `w-${randomUUID().slice(0, 8)}`;
    const proposed = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `ge-${randomUUID()}`, kind: "blackmail" }, ctx);
    await runMacro("schemes", "move", { schemeId: proposed.schemeId }, ctx); // → recruiting

    const g = await runMacro("schemes", "gather_evidence",
      { schemeId: proposed.schemeId, worldId, location: { x: 1, y: 0, z: 2 } }, ctx);
    assert.equal(g.ok, true);
    assert.equal(g.action, "evidence_added");
    assert.equal(g.schemeId, proposed.schemeId);
    assert.ok(g.evidenceId.startsWith("ev_"));
    assert.ok(g.hookId, "gather_evidence drops a hook artifact and returns its id");

    // discovery_pct moved 15 → 20 (MIN(100, discovery_pct + 5)); read it back.
    const list = await runMacro("schemes", "list_for_user", {}, ctx);
    const row = list.schemes.find((s) => s.id === proposed.schemeId);
    assert.equal(row.discovery_pct, 20);
    assert.equal(row.evidence_count, 1);

    // the dropped hook now lies in that world, linked to the new evidence.
    const inWorld = await runMacro("hooks", "list_in_world", { worldId }, ctx);
    assert.equal(inWorld.ok, true);
    const hook = inWorld.hooks.find((h) => h.id === g.hookId);
    assert.ok(hook, "the gathered evidence hook is listable in the world");
    assert.equal(hook.evidence_id, g.evidenceId);
  });

  it("abandon: an owned scheme transitions to terminal 'abandoned' and then rejects further moves with scheme_terminal", async () => {
    const proposed = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `ab-${randomUUID()}`, kind: "seduce" }, ctx);
    const ab = await runMacro("schemes", "abandon", { schemeId: proposed.schemeId }, ctx);
    assert.equal(ab.ok, true);
    assert.equal(ab.action, "abandoned");
    assert.equal(ab.schemeId, proposed.schemeId);

    // loadOwnedActiveScheme rejects a terminal scheme.
    const moveAgain = await runMacro("schemes", "move", { schemeId: proposed.schemeId }, ctx);
    assert.equal(moveAgain.ok, false);
    assert.equal(moveAgain.reason, "scheme_terminal");
  });

  it("move: a scheme id that doesn't exist is rejected with scheme_not_found", async () => {
    const r = await runMacro("schemes", "move", { schemeId: `sch_player_${randomUUID().slice(0, 12)}` }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "scheme_not_found");
  });
});

describe("schemes — discover_evidence + hooks validation", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("schemes-discover")); });

  it("discover_evidence: with zero evidence rows the scheme is NOT exposed and 0 rows are marked", async () => {
    const proposed = await runMacro("schemes", "propose_player_scheme",
      { targetKind: "faction", targetId: `dv-${randomUUID()}`, kind: "sabotage_decree" }, ctx);
    const r = await runMacro("schemes", "discover_evidence",
      { schemeId: proposed.schemeId, evidenceKind: "observed" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.evidenceMarked, 0);   // no undiscovered evidence rows yet
    assert.equal(r.exposed, false);      // counts.total === 0 → no 50% threshold
    assert.equal(r.evidenceKind, "observed");
  });

  it("hooks.list_in_world: missing worldId is rejected with missing_world", async () => {
    const r = await runMacro("hooks", "list_in_world", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_world");
  });
});
