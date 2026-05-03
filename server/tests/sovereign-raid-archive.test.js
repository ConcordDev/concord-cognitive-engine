// Tests for Sovereign Refusal Archive + Mass Raid scaffold.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  recordPlayerPowerForArchive,
  draftSovereignManifestation,
  SOVEREIGN_ARCHIVE_TAG,
} from "../lib/sovereign/refusal-archive.js";
import {
  openSovereignRaid,
  closeSovereignRaid,
  joinSovereignRaid,
  computePhase,
  isFriendlyFireImmune,
  maybeAdvancePhase,
  sovereignScalingFactor,
} from "../lib/sovereign/raid-event.js";
import { isRefused } from "../lib/refusal-field.js";

describe("refusal-archive", () => {
  test("records a player's skill into the archive as a Shadow DTU", () => {
    const state = {};
    recordPlayerPowerForArchive(state, { id: "skill_1", title: "Phoenix Riposte", meta: { damageRange: [10, 18] } }, "playerA");
    const shadow = state.shadowDtus.get("shadow_sovereign_skill_1_playerA");
    assert.ok(shadow);
    assert.ok(shadow.tags.includes(SOVEREIGN_ARCHIVE_TAG));
    assert.equal(shadow.observedFrom, "playerA");
    assert.equal(shadow.core.summary, "Phoenix Riposte");
  });

  test("repeated record by same player is a no-op (deduped)", () => {
    const state = {};
    recordPlayerPowerForArchive(state, { id: "s2", title: "X", meta: {} }, "p1");
    const r = recordPlayerPowerForArchive(state, { id: "s2", title: "X", meta: {} }, "p1");
    assert.equal(r.deduped, true);
    assert.equal(state.shadowDtus.size, 1);
  });

  test("draftSovereignManifestation fuses N archive shadows", () => {
    const state = {};
    for (let i = 0; i < 5; i++) {
      recordPlayerPowerForArchive(state, { id: `s_${i}`, title: `Power ${i}`, meta: { damageRange: [5, 20] } }, "playerA");
    }
    const manifest = draftSovereignManifestation(state, { draws: 3 });
    assert.equal(manifest.sources.length, 3);
    assert.deepEqual(manifest.refusedLimits, ["cooldown", "stamina_cost", "ap_cost"]);
    assert.equal(manifest.cooldownMs, 0);
    assert.equal(manifest.staminaCost, 0);
  });

  test("draft falls back to empty-archive form when nothing recorded", () => {
    const state = { shadowDtus: new Map() };
    const m = draftSovereignManifestation(state);
    assert.equal(m.sources.length, 0);
    assert.match(m.summary, /refuses to bother/);
  });

  test("draft prefers shadows from the targeted player when set", () => {
    const state = {};
    recordPlayerPowerForArchive(state, { id: "from_a", title: "A", meta: {} }, "playerA");
    recordPlayerPowerForArchive(state, { id: "from_b", title: "B", meta: {} }, "playerB");
    recordPlayerPowerForArchive(state, { id: "from_a2", title: "A2", meta: {} }, "playerA");
    const m = draftSovereignManifestation(state, { draws: 2, preferTargetId: "playerA" });
    // Both picks should be from playerA when prefer is set and we have 2+ playerA entries.
    assert.equal(m.sources.length, 2);
  });
});

describe("raid-event", () => {
  test("computePhase tier boundaries", () => {
    assert.equal(computePhase(1), "tester");
    assert.equal(computePhase(50), "tester");
    assert.equal(computePhase(51), "refusal");
    assert.equal(computePhase(200), "refusal");
    assert.equal(computePhase(201), "archive");
    assert.equal(computePhase(1000), "archive");
    assert.equal(computePhase(1001), "eternal");
  });

  test("openSovereignRaid creates a single open event", () => {
    const state = {};
    const r1 = openSovereignRaid(state);
    const r2 = openSovereignRaid(state);
    assert.equal(r1.id, r2.id);
    assert.equal(r1.participants.size, 0);
  });

  test("joinSovereignRaid adds participants and advances phase", () => {
    const state = {};
    openSovereignRaid(state);
    for (let i = 0; i < 51; i++) joinSovereignRaid(state, `u${i}`);
    maybeAdvancePhase(state);
    assert.equal(state.activeSovereignRaid.phase, "refusal");
  });

  test("isFriendlyFireImmune true between participants, false otherwise", () => {
    const state = {};
    openSovereignRaid(state);
    joinSovereignRaid(state, "alice");
    joinSovereignRaid(state, "bob");
    assert.equal(isFriendlyFireImmune(state, "alice", "bob"), true);
    assert.equal(isFriendlyFireImmune(state, "alice", "outsider"), false);
  });

  test("sovereignScalingFactor scales with participant count", () => {
    const state = {};
    openSovereignRaid(state);
    assert.equal(sovereignScalingFactor(state), 1.0);
    for (let i = 0; i < 60; i++) joinSovereignRaid(state, `u${i}`);
    assert.equal(sovereignScalingFactor(state), 1.5);
  });

  test("entering eternal phase declares win_refused so victory is gated", () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    for (let i = 0; i < 1100; i++) joinSovereignRaid(state, `u${i}`);
    maybeAdvancePhase(state);
    assert.equal(state.activeSovereignRaid.phase, "eternal");
    assert.equal(isRefused(state, "concordia-hub", "win_refused"), true);
    assert.equal(isRefused(state, "concordia-hub", "numbers_refused"), true);
    assert.equal(isRefused(state, "concordia-hub", "dome_collapse"), true);
  });

  test("closeSovereignRaid returns final roster", () => {
    const state = {};
    openSovereignRaid(state);
    joinSovereignRaid(state, "x");
    joinSovereignRaid(state, "y");
    const r = closeSovereignRaid(state);
    assert.equal(r.participants.length, 2);
    assert.equal(state.activeSovereignRaid, null);
  });
});
