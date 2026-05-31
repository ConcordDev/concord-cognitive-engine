// Wave 2 — corpus #6 (constraint-cone) + #9 (habitability), instantiated on the
// viability spine. Pins: a creature thrives inside its climate envelope + can't
// survive outside it, the limiting axis is named, unknown affinity is permissive,
// and the spawn-density modifier maps V onto the legacy range.
//
// Run: node --test tests/viability/creature-envelope.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { survivalCone, creatureViability, habitable, envelopeReport, spawnDensityModifier } from "../../lib/viability/adapters/creature-envelope.js";

describe("creature survival envelope (#6 / #9)", () => {
  it("an arctic creature thrives in the cold, dies in the heat", () => {
    assert.ok(creatureViability("arctic", { temperature: -20 }) > 0.5);
    assert.equal(habitable("arctic", { temperature: -20 }).feasible, true);
    const hot = habitable("arctic", { temperature: 40 });
    assert.equal(hot.feasible, false);              // outside [-45,12]
    assert.ok(hot.violations.some((v) => v.id === "temperature"));
    assert.equal(creatureViability("arctic", { temperature: 40 }), 0);
  });

  it("a desert creature needs heat + dryness; a tropical one heat + wet", () => {
    assert.equal(habitable("desert", { temperature: 35, humidity: 20 }).feasible, true);
    assert.equal(habitable("desert", { temperature: 35, humidity: 90 }).feasible, false); // too humid
    assert.equal(habitable("tropical", { temperature: 30, humidity: 80 }).feasible, true);
    assert.equal(habitable("tropical", { temperature: 5, humidity: 80 }).feasible, false); // too cold
  });

  it("the report names the limiting (nearest-binding) axis", () => {
    const r = envelopeReport("temperate", { temperature: 15, humidity: 22 }); // temp mid-band, humidity near lo=20
    assert.ok(r.nearest); // humidity (slack ~2) is far tighter than temperature (slack ~17)
    assert.equal(r.nearest.id, "humidity");
  });

  it("unknown affinity is permissive (degrade-graceful — never penalises)", () => {
    assert.equal(habitable("alien_xenofauna", { temperature: 999 }).feasible, true);
    assert.equal(creatureViability("alien_xenofauna", {}), 1);
  });

  it("spawn-density modifier maps V onto the legacy ~0.5–1.4 range", () => {
    assert.ok(Math.abs(spawnDensityModifier("arctic", { temperature: 40 }) - 0.5) < 1e-9); // V=0 → 0.5×
    assert.ok(spawnDensityModifier("arctic", { temperature: -20 }) > 1.0);                  // thriving → boosted
  });

  it("an unmeasured environment doesn't kill anything (signals absent → viable)", () => {
    assert.equal(habitable("arctic", {}).feasible, true); // no temperature reading → not penalised
  });
});
