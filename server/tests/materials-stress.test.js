// Engine N7 — materials (physical viability under stress). Pins the
// elastic→yielding→fracture response, the robust/brittle distinction, Basquin
// fatigue life + Miner's-rule accumulation, and relative toughness.
//
// Run: node --test tests/materials-stress.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MATERIALS, stressResponse, isBrittle, fatigueLife, accumulateFatigue, toughness } from "../lib/materials/stress.js";

describe("stress response", () => {
  it("steel: elastic → yielding → fracture across the load range", () => {
    assert.equal(stressResponse("steel", 50).state, "elastic");   // < yield 120
    assert.equal(stressResponse("steel", 150).state, "yielding"); // yield..ultimate
    const f = stressResponse("steel", 250);
    assert.equal(f.state, "fracture");
    assert.equal(f.failed, true);
  });

  it("ratio is stress/ultimate", () => {
    assert.equal(stressResponse("steel", 100).ratio, 0.5); // 100/200
  });

  it("brittle materials (glass/stone) have little plastic warning; ductile steel a lot", () => {
    assert.ok(stressResponse("glass", 49.5).plasticReserve < 0.1);
    assert.ok(stressResponse("steel", 100).plasticReserve > 0.3);
    assert.equal(isBrittle("glass"), true);
    assert.equal(isBrittle("stone"), true);
    assert.equal(isBrittle("steel"), false);
  });
});

describe("fatigue (Basquin S-N + Miner's rule)", () => {
  it("higher stress amplitude → dramatically shorter life", () => {
    const low = fatigueLife("steel", 50);
    const high = fatigueLife("steel", 150);
    assert.ok(high < low);
    assert.equal(fatigueLife("steel", 250), 1); // overload fails on cycle 1
    assert.equal(fatigueLife("steel", 0), Infinity);
  });

  it("repeated sub-ultimate stress accumulates to failure (damage ≥ 1)", () => {
    const Nf = fatigueLife("wood", 40);
    let d = 0;
    let r = accumulateFatigue(d, "wood", 40, Math.ceil(Nf / 2));
    assert.equal(r.failed, false); // half-life, not yet
    r = accumulateFatigue(r.damage, "wood", 40, Math.ceil(Nf));
    assert.equal(r.failed, true);  // past full life → fractures
  });
});

describe("toughness (robust vs brittle)", () => {
  it("ductile steel is tougher than brittle glass despite glass strength", () => {
    assert.ok(toughness("steel") > toughness("glass"));
  });
  it("catalog has the building materials", () => {
    for (const k of ["thatch", "wood", "stone", "steel"]) assert.ok(MATERIALS[k]);
  });
});
