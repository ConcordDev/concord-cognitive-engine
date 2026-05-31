// Wave 3 — climate energy budget (#25) + tipping-point hysteresis (#27). Pins
// the Stefan-Boltzmann equilibrium against the Earth fixtures and the bistable
// path-dependence (same forcing, different temperature depending on history).
//
// Run: node --test tests/viability/climate-energy.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { equilibriumTemp, steppedClimate, tippingPoints } from "../../lib/viability/climate-energy-budget.js";

describe("equilibriumTemp (Stefan-Boltzmann)", () => {
  it("Earth with no greenhouse ≈ −18 °C", () => {
    const { celsius } = equilibriumTemp({ albedo: 0.3, greenhouse: 0 });
    assert.ok(Math.abs(celsius - (-18.7)) < 2, `got ${celsius}`);
  });

  it("Earth with greenhouse ≈ +15 °C", () => {
    const { celsius } = equilibriumTemp({ albedo: 0.3, greenhouse: 0.78 });
    assert.ok(Math.abs(celsius - 15) < 3, `got ${celsius}`);
  });

  it("more greenhouse → warmer; more albedo → colder", () => {
    const base = equilibriumTemp({ albedo: 0.3, greenhouse: 0.4 }).celsius;
    assert.ok(equilibriumTemp({ albedo: 0.3, greenhouse: 0.7 }).celsius > base);
    assert.ok(equilibriumTemp({ albedo: 0.6, greenhouse: 0.4 }).celsius < base);
  });
});

describe("steppedClimate bistability + hysteresis (#27)", () => {
  const params = { iceThreshold: 0.9, warmThreshold: 1.1, iceAlbedo: 0.6, warmAlbedo: 0.3, greenhouse: 0.4 };

  it("a warm planet snowballs only when forcing drops below iceThreshold", () => {
    const stay = steppedClimate({ branch: "warm" }, 0.95, params); // between thresholds
    assert.equal(stay.branch, "warm");
    assert.equal(stay.tipped, false);
    const flip = steppedClimate({ branch: "warm" }, 0.85, params); // below iceThreshold
    assert.equal(flip.branch, "ice");
    assert.equal(flip.tipped, true);
  });

  it("a frozen planet thaws only when forcing rises above warmThreshold", () => {
    const stay = steppedClimate({ branch: "ice" }, 1.05, params); // between thresholds
    assert.equal(stay.branch, "ice");
    const flip = steppedClimate({ branch: "ice" }, 1.15, params); // above warmThreshold
    assert.equal(flip.branch, "warm");
    assert.equal(flip.tipped, true);
  });

  it("PATH DEPENDENCE: same forcing, different temperature by history", () => {
    const warm = steppedClimate({ branch: "warm" }, 1.0, params);
    const ice = steppedClimate({ branch: "ice" }, 1.0, params);
    // identical forcing, but the ice branch (higher albedo) is colder → hysteresis
    assert.equal(warm.branch, "warm");
    assert.equal(ice.branch, "ice");
    assert.ok(ice.temperature < warm.temperature);
  });

  it("tippingPoints exposes the bounds", () => {
    const tp = tippingPoints(params);
    assert.ok(tp.iceThreshold < tp.warmThreshold);
  });
});
