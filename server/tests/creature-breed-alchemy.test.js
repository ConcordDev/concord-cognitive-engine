// Wave 6 / Layer 2 — the breed-alchemy variant resolver.
//
// Pins the headline cascade (water×fire-in-heat → steam; steam×water-in-wet →
// brine), environment-conditioned dominance, conflict→stability, same-affinity
// no-op, totality, and phenotype plasticity.
//
// Run: node --test tests/creature-breed-alchemy.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveVariant, phenotypeForEnv, AFFINITIES } from "../lib/creature-breed-alchemy.js";

describe("Wave 6 — breed-alchemy variant resolution", () => {
  it("water × fire born HOT → steam (fire dominant, water recessive)", () => {
    const r = resolveVariant({ affinityA: "water", affinityB: "fire", env: { temp: 34, humidity: 30 } });
    assert.equal(r.variant, "steam");
    assert.equal(r.reacted, true);
    assert.equal(r.dominant, "steam");      // a reacted hybrid expresses the variant
    assert.ok(["water", "fire"].includes(r.recessive));
  });

  it("steam × water in a WET biome → brine (the second hop)", () => {
    const r = resolveVariant({ affinityA: "steam", affinityB: "water", env: { temp: 20, humidity: 80 } });
    assert.equal(r.variant, "brine");
    assert.equal(r.reacted, true);
  });

  it("environment chooses the dominant when no reaction fires", () => {
    // ice × earth: no variant rule; a cold env should favour ice as dominant.
    const cold = resolveVariant({ affinityA: "ice", affinityB: "earth", env: { temp: 2 } });
    assert.equal(cold.variant, null);
    assert.equal(cold.dominant, "ice");
    assert.equal(cold.recessive, "earth");
  });

  it("conflicting affinities lower stability (BotW-cancel analogue)", () => {
    const conflict = resolveVariant({ affinityA: "water", affinityB: "fire", env: { temp: 10, humidity: 10 } });
    // cold+dry → no steam reaction, so the water/fire conflict stands → stability < 1
    assert.equal(conflict.variant, null);
    assert.ok(conflict.stability < 1, `expected reduced stability, got ${conflict.stability}`);
  });

  it("same affinity is a clean no-op at full stability", () => {
    const r = resolveVariant({ affinityA: "bio", affinityB: "bio", env: {} });
    assert.equal(r.variant, null);
    assert.equal(r.dominant, "bio");
    assert.equal(r.stability, 1);
  });

  it("is total — unknown/empty affinities never throw", () => {
    assert.doesNotThrow(() => resolveVariant({}));
    assert.equal(resolveVariant({ affinityA: "garbage", affinityB: "" }).dominant, "none");
    assert.ok(AFFINITIES.includes("brine"));
  });

  it("phenotype plasticity shifts by environment within genotype", () => {
    const inWater = phenotypeForEnv({ dominant: "water" }, { humidity: 90, temp: 10 });
    const inHeat = phenotypeForEnv({ dominant: "water" }, { humidity: 20, temp: 35 });
    assert.ok(inWater.wetness > inHeat.wetness, "slicker in water");
    assert.ok(inHeat.scaling > inWater.scaling, "scaled-up/dry in heat");
  });
});
