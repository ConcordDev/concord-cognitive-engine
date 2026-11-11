import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { waveEnergyDensity } from "../lib/ocean-wave-energy.js";

describe("wave energy density", () => {
  it("uses 1/8 rho g H^2 for significant wave height", () => {
    assert.equal(Math.round(waveEnergyDensity(1)), 1257);
    assert.equal(Math.round(waveEnergyDensity(2)), 5028);
  });
});
