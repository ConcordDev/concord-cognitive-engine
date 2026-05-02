/**
 * World clock + NPC schedules tests.
 * Run: node --test tests/world-clock-and-schedules.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  getWorldPhase,
  getDayPhase,
  setWorldEpoch,
  WORLD_CLOCK_CONSTANTS,
} from "../lib/world-clock.js";
import {
  getCurrentBehavior,
  hasSegmentChanged,
  setNPCSchedule,
  batchCurrentBehaviors,
  NPC_SCHEDULE_ARCHETYPES,
} from "../lib/npc-schedules.js";

describe("world-clock", () => {
  it("phase is in [0,1)", () => {
    const t = getWorldPhase();
    assert.ok(t >= 0 && t < 1);
  });

  it("getDayPhase returns one of the named segments", () => {
    const segments = WORLD_CLOCK_CONSTANTS.segments.map(s => s.name);
    for (const t of [0.0, 0.05, 0.25, 0.5, 0.75, 0.95]) {
      const seg = getDayPhase(t);
      assert.ok(segments.includes(seg), `unknown segment ${seg} for t=${t}`);
    }
  });

  it("setWorldEpoch shifts the phase deterministically", () => {
    setWorldEpoch(Date.now()); // phase ~0
    const t1 = getWorldPhase();
    setWorldEpoch(Date.now() - 6 * 60 * 1000); // 6 minutes ago = ~25% of 24-min day
    const t2 = getWorldPhase();
    assert.ok(t2 > t1);
  });
});

describe("npc-schedules", () => {
  it("baker works dawn/morning, rests night", () => {
    const baker = { id: "b1", archetype: "baker" };
    setWorldEpoch(Date.now());                                          // dawn
    assert.ok(["work", "trade"].includes(getCurrentBehavior(baker)));
    setWorldEpoch(Date.now() - 22 * 60 * 1000);                         // night-ish
    const nightBehavior = getCurrentBehavior(baker);
    assert.ok(["rest", "socialize"].includes(nightBehavior));
  });

  it("guard guards at night", () => {
    const guard = { id: "g1", archetype: "guard" };
    setWorldEpoch(Date.now() - 21 * 60 * 1000); // ~night
    assert.ok(["guard", "patrol"].includes(getCurrentBehavior(guard)));
  });

  it("custom schedule overrides archetype default", () => {
    const npc = { id: "x", archetype: "baker" };
    setNPCSchedule("x", { dawn: "patrol", morning: "patrol", midday: "patrol", afternoon: "patrol", dusk: "patrol", night: "patrol" });
    assert.strictEqual(getCurrentBehavior(npc), "patrol");
    setNPCSchedule("x", null); // clear
  });

  it("hasSegmentChanged reports correctly across boundaries", () => {
    assert.strictEqual(hasSegmentChanged(0.05, 0.20), true);  // dawn → morning
    assert.strictEqual(hasSegmentChanged(0.15, 0.20), false); // both morning
  });

  it("NPC_SCHEDULE_ARCHETYPES exposes the registered set", () => {
    assert.ok(NPC_SCHEDULE_ARCHETYPES.includes("guard"));
    assert.ok(NPC_SCHEDULE_ARCHETYPES.includes("default"));
  });

  it("batchCurrentBehaviors returns one entry per NPC", () => {
    const npcs = [
      { id: "n1", archetype: "guard" },
      { id: "n2", archetype: "baker" },
    ];
    const out = batchCurrentBehaviors(npcs);
    assert.ok(out.n1);
    assert.ok(out.n2);
  });
});
