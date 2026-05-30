import { test } from "node:test";
import assert from "node:assert/strict";
import {
  movedFraction, npcsMoved, eventFired, stateChanged, valueWhere, threadSurfaced, runJourney,
} from "../../scripts/playtest/liveness.mjs";
import { worldIsAlive, hydrologyFlows } from "../../scripts/playtest/journeys.mjs";

// Instrument 2 — prove the liveness harness has TEETH: it must pass on a live
// world and FAIL on a frozen/silent one (the frozen-priest + hydrology bugs).

test("liveness predicates", () => {
  const before = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 0, z: 0 }, { id: "c", x: 0, z: 0 }];
  const movedAll = [{ id: "a", x: 5, z: 0 }, { id: "b", x: 0, z: 5 }, { id: "c", x: 3, z: 3 }];
  const frozen = before.map((e) => ({ ...e }));
  assert.equal(movedFraction(before, movedAll), 1);
  assert.equal(movedFraction(before, frozen), 0);
  assert.equal(npcsMoved(before, movedAll, 0.3), true);
  assert.equal(npcsMoved(before, frozen, 0.3), false);
  assert.equal(eventFired(["weather:update"], "weather:"), true);
  assert.equal(eventFired([], "weather:"), false);
  assert.equal(stateChanged({ p: { h: 0 } }, { p: { h: 2 } }, "p.h"), true);
  assert.equal(valueWhere({ pit: { water_height: 2 } }, "pit.water_height", (v) => v > 0), true);
  assert.equal(threadSurfaced({ hook: { actionable: true } }), true);
  assert.equal(threadSurfaced({}), false);
});

// A mock driver simulating a LIVE world: NPCs wander, events fire, water flows.
function liveDriver() {
  let t = 0;
  const npcs = [{ id: "priest", x: 0, z: 0 }, { id: "smith", x: 1, z: 1 }, { id: "guard", x: 2, z: 2 }];
  let pitWater = 0;
  return {
    async call(d, n, input) { if (d === "terrain" && n === "seed_water") pitWater = 0; return { ok: true }; },
    async http() { return { ok: true }; },
    async tick(k) { t += k; for (const e of npcs) { e.x += k; e.z += k * 0.5; } pitWater += k * 0.5; },
    async snapshot() { return { npcs: npcs.map((e) => ({ ...e })), pit: { water_height: pitWater } }; },
    events() { return t > 0 ? ["weather:update", "npc:activity-batch"] : []; },
    drainFallbacks() { return []; },
  };
}
// A BROKEN world: NPCs frozen, no events, water never flows.
function deadDriver() {
  const npcs = [{ id: "priest", x: 0, z: 0 }, { id: "smith", x: 1, z: 1 }];
  return {
    async call() { return { ok: true }; }, async http() { return { ok: true }; },
    async tick() {}, async snapshot() { return { npcs: npcs.map((e) => ({ ...e })), pit: { water_height: 0 } }; },
    events() { return []; }, drainFallbacks() { return ["spell→generic cast"]; },
  };
}

test("worldIsAlive journey PASSES on a live world, FAILS on a frozen one", async () => {
  const ok = await runJourney(worldIsAlive, liveDriver());
  assert.equal(ok.alive, true, ok.summary);
  const bad = await runJourney(worldIsAlive, deadDriver());
  assert.equal(bad.alive, false, "frozen world must fail liveness");
});

test("hydrology journey PASSES when water flows, FAILS when it doesn't", async () => {
  const ok = await runJourney(hydrologyFlows, liveDriver());
  assert.equal(ok.alive, true, ok.summary);
  const bad = await runJourney(hydrologyFlows, deadDriver());
  assert.equal(bad.alive, false, "dry pit must fail liveness");
});

test("the no-silent-fallback log is collected during a run", async () => {
  const bad = await runJourney(worldIsAlive, deadDriver());
  assert.ok(bad.silentFallbacks.includes("spell→generic cast"));
});
