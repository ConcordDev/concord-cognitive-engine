/**
 * E0#3 — boss HP/phase HUD support + boss-phase scaling lit up.
 *
 * Bosses spawn with a STATE.bossPhases phase-state machine, but the combat path
 * never ticked it — its damage scaling was dead. computeBossState ticks the
 * phases on the post-damage hp and builds the boss:state HUD payload. This pins
 * the tick + payload determinism + the same phase thresholds spawn.js uses.
 *
 * Run: node --test tests/integration/boss-hud.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createBossPhases } from "../../lib/combat/boss-phases.js";
import { isBossRow, computeBossState } from "../../lib/combat/boss-hud.js";

// The exact pack spawn.js installs for a boss.
function spawnPhases(bossId = "boss_1") {
  return createBossPhases({
    bossId,
    // most-restrictive-first (matches the fixed spawn.js ordering)
    phases: [
      { name: "death-throes", when: (m) => m.hpPct <= 0.25, scaling: { damage: 1.6 } },
      { name: "enraged-2", when: (m) => m.hpPct <= 0.50, scaling: { damage: 1.4 } },
      { name: "enraged-1", when: (m) => m.hpPct <= 0.75, scaling: { damage: 1.2 } },
    ],
  });
}

describe("E0#3 — boss HUD payload + phase tick", () => {
  it("identifies bosses by npc_type or presence of a phase-state", () => {
    assert.equal(isBossRow({ npc_type: "boss" }, null), true);
    assert.equal(isBossRow({ npc_type: "grunt" }, { tick() {} }), true);
    assert.equal(isBossRow({ npc_type: "grunt" }, null), false);
    assert.equal(isBossRow(null, null), false);
  });

  it("computes a clamped hpPct and carries name/hp into the payload", () => {
    const s = computeBossState({ npcId: "b", worldId: "w", name: "The Warden", currentHp: 250, maxHp: 1000 });
    assert.equal(s.hpPct, 0.25);
    assert.equal(s.name, "The Warden");
    assert.equal(s.currentHp, 250);
    assert.equal(s.maxHp, 1000);
    // overkill / negative hp clamps to [0,1]
    assert.equal(computeBossState({ currentHp: -50, maxHp: 1000 }).hpPct, 0);
    assert.equal(computeBossState({ currentHp: 5000, maxHp: 1000 }).hpPct, 1);
  });

  it("ticks the phase machine on hp and advances at the right thresholds", () => {
    const phases = spawnPhases();
    // 80% — above all thresholds, no phase
    let s = computeBossState({ npcId: "b", currentHp: 800, maxHp: 1000, phases });
    assert.equal(s.phase, null);
    // 70% — enters enraged-1
    s = computeBossState({ npcId: "b", currentHp: 700, maxHp: 1000, phases });
    assert.equal(s.phase, "enraged-1");
    assert.equal(s.phaseAdvanced, true);
    // 70% again — same phase, not advanced
    s = computeBossState({ npcId: "b", currentHp: 700, maxHp: 1000, phases });
    assert.equal(s.phase, "enraged-1");
    assert.equal(s.phaseAdvanced, false);
    // 20% — death-throes
    s = computeBossState({ npcId: "b", currentHp: 200, maxHp: 1000, phases });
    assert.equal(s.phase, "death-throes");
    assert.equal(s.phaseAdvanced, true);
  });

  it("flags defeated and falls back to archetype for the name", () => {
    const s = computeBossState({ npcId: "b", archetype: "ruin_warden", currentHp: 0, maxHp: 500, defeated: true });
    assert.equal(s.defeated, true);
    assert.equal(s.name, "ruin_warden");
    assert.equal(s.hpPct, 0);
  });
});
