/**
 * Tier-2 contract tests for the per-NPC daily-schedule layer
 * (server/lib/npc-schedules.js). The world-clock-and-schedules suite covers
 * the clock half; this file pins the per-archetype routine table and the
 * custom-override path.
 *
 * Run: node --test tests/npc-schedules.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  setNPCSchedule,
  getCurrentBehavior,
  hasSegmentChanged,
  batchCurrentBehaviors,
  NPC_SCHEDULE_ARCHETYPES,
} from "../lib/npc-schedules.js";
import { setWorldEpoch } from "../lib/world-clock.js";

const ONE_MIN = 60 * 1000;
const WORLD_DAY_MS = 24 * ONE_MIN;

// Drive the world clock to a deterministic phase so day-segment lookups
// don't depend on real wall time.
function setWorldPhase(targetPhase) {
  // phase = ((Date.now() - epoch) % WORLD_DAY_MS) / WORLD_DAY_MS
  // → epoch = Date.now() - (targetPhase * WORLD_DAY_MS)
  setWorldEpoch(Date.now() - targetPhase * WORLD_DAY_MS);
}

describe("NPC_SCHEDULE_ARCHETYPES — registry", () => {
  it("exposes every archetype baked into the table", () => {
    for (const required of [
      "baker", "smith", "guard", "scholar", "merchant",
      "farmer", "thief", "bard", "enforcer", "hacker",
      "netrunner", "default",
    ]) {
      assert.ok(NPC_SCHEDULE_ARCHETYPES.includes(required), `missing ${required}`);
    }
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(NPC_SCHEDULE_ARCHETYPES));
  });
});

describe("getCurrentBehavior — archetype defaults per day-segment", () => {
  it("baker bakes at dawn, trades through midday, sleeps at night", () => {
    setWorldPhase(0.05);  // dawn
    assert.equal(getCurrentBehavior({ id: "n_baker_1", archetype: "baker" }), "work");
    setWorldPhase(0.45);  // midday
    assert.equal(getCurrentBehavior({ id: "n_baker_1", archetype: "baker" }), "trade");
    setWorldPhase(0.90);  // night
    assert.equal(getCurrentBehavior({ id: "n_baker_1", archetype: "baker" }), "rest");
  });

  it("guard patrols at dawn, rests morning/midday, guards at night", () => {
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_guard_1", archetype: "guard" }), "patrol");
    setWorldPhase(0.20);
    assert.equal(getCurrentBehavior({ id: "n_guard_1", archetype: "guard" }), "rest");
    setWorldPhase(0.90);
    assert.equal(getCurrentBehavior({ id: "n_guard_1", archetype: "guard" }), "guard");
  });

  it("scholar works through morning + dusk + night", () => {
    setWorldPhase(0.20);
    assert.equal(getCurrentBehavior({ id: "n_scholar_1", archetype: "scholar" }), "work");
    setWorldPhase(0.75);
    assert.equal(getCurrentBehavior({ id: "n_scholar_1", archetype: "scholar" }), "work");
    setWorldPhase(0.90);
    assert.equal(getCurrentBehavior({ id: "n_scholar_1", archetype: "scholar" }), "work");
  });

  it("falls back to default schedule for unknown archetype", () => {
    setWorldPhase(0.20);
    assert.equal(getCurrentBehavior({ id: "n_unknown", archetype: "wizard_unknown" }), "work");
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_unknown", archetype: "wizard_unknown" }), "rest");
  });

  it("falls back to default for missing archetype", () => {
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_no_arch" }), "rest");
  });
});

describe("setNPCSchedule — per-NPC override beats archetype", () => {
  afterEach(() => {
    setNPCSchedule("n_override_1", null); // clear
  });

  it("custom schedule overrides default", () => {
    setNPCSchedule("n_override_1", {
      dawn: "work", morning: "work", midday: "work",
      afternoon: "work", dusk: "work", night: "work",
    });
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_override_1", archetype: "guard" }), "work");
    setWorldPhase(0.90);
    assert.equal(getCurrentBehavior({ id: "n_override_1", archetype: "guard" }), "work");
  });

  it("clearing the override (null) reverts to archetype default", () => {
    setNPCSchedule("n_override_1", { dawn: "work" });
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_override_1", archetype: "guard" }), "work");
    setNPCSchedule("n_override_1", null);
    setWorldPhase(0.05);
    assert.equal(getCurrentBehavior({ id: "n_override_1", archetype: "guard" }), "patrol");
  });
});

describe("hasSegmentChanged — boundary detection", () => {
  it("reports false when both phases land in the same named segment", () => {
    // both within "morning" (0.10-0.40)
    assert.equal(hasSegmentChanged(0.15, 0.30), false);
  });

  it("reports true when crossing a segment boundary", () => {
    // 0.05 (dawn) → 0.20 (morning)
    assert.equal(hasSegmentChanged(0.05, 0.20), true);
  });

  it("crosses dawn → night wrap correctly", () => {
    assert.equal(hasSegmentChanged(0.05, 0.90), true);
  });
});

describe("batchCurrentBehaviors — bulk lookup", () => {
  it("returns one behavior per NPC keyed by id", () => {
    setWorldPhase(0.05); // dawn
    const result = batchCurrentBehaviors([
      { id: "a", archetype: "baker" },
      { id: "b", archetype: "guard" },
      { id: "c", archetype: "scholar" },
    ]);
    assert.equal(result.a, "work");
    assert.equal(result.b, "patrol");
    assert.equal(result.c, "rest");
  });

  it("handles empty list", () => {
    assert.deepStrictEqual(batchCurrentBehaviors([]), {});
  });
});
