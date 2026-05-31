// Engine N8 — chemistry/reaction networks (equilibria as fixed points). Pins
// mass-action rate, catalysis, the Euler step, convergence to a reversible
// equilibrium ratio K=kf/kb, and the steam-combination shape.
//
// Run: node --test tests/chemistry-reactions.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { massActionRate, stepConcentrations, simulateToEquilibrium, reversibleEquilibrium } from "../lib/chemistry/reactions.js";

const close = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

describe("mass action", () => {
  it("rate = k · Π[reactant]^stoich", () => {
    const r = { reactants: { A: 1, B: 2 }, products: { C: 1 }, k: 2 };
    assert.equal(massActionRate(r, { A: 3, B: 4 }), 2 * 3 * 16); // 2·3·4² = 96
  });
  it("a catalyst multiplies the rate without being consumed", () => {
    const r = { reactants: { A: 1 }, products: { B: 1 }, k: 1, catalyst: "cat" };
    assert.equal(massActionRate(r, { A: 5, cat: 3 }), 15);
    const next = stepConcentrations({ A: 5, cat: 3 }, [r], 0.01);
    assert.equal(next.cat, 3); // catalyst unchanged
    assert.ok(next.A < 5);     // reactant consumed
  });
});

describe("equilibrium fixed points", () => {
  it("closed-form reversible equilibrium: [B]/[A] = kf/kb", () => {
    const eq = reversibleEquilibrium(3, 1, 8); // K=3 → A=2, B=6
    assert.ok(close(eq.A, 2));
    assert.ok(close(eq.B, 6));
    assert.equal(eq.K, 3);
  });

  it("simulation converges to the same equilibrium ratio (net rate → 0)", () => {
    const rxns = [
      { reactants: { A: 1 }, products: { B: 1 }, k: 3 }, // forward
      { reactants: { B: 1 }, products: { A: 1 }, k: 1 }, // backward
    ];
    const r = simulateToEquilibrium({ A: 8, B: 0 }, rxns, { steps: 20000, dt: 0.01 });
    assert.equal(r.settled, true);
    assert.ok(close(r.state.B / r.state.A, 3, 0.1)); // K = kf/kb = 3
    assert.ok(close(r.state.A + r.state.B, 8, 0.01)); // mass conserved
  });

  it("steam combination: water + fire → steam consumes both, makes steam", () => {
    const steam = { reactants: { water: 1, fire: 1 }, products: { steam: 1 }, k: 5 };
    const out = simulateToEquilibrium({ water: 1, fire: 1, steam: 0 }, [steam], { steps: 20000, dt: 0.01 });
    assert.ok(out.state.steam > 0.9);  // most converted
    assert.ok(out.state.water < 0.1);
  });
});
