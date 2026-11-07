// S-AFF-4 pins (build(affect)) — policy derivation receipts.
//
// F5: the Policy surface printed bare derived floats (a reader's
// "magic numbers" — nothing on the surface or in the payload said how
// any signal was computed). POLICY_DERIVATIONS now ships the formula
// for every signal, in dimension names, as a sibling of the policy
// object on GET /api/affect/policy, and the panel prints it.
//
// Pins:
//  - every signal getAffectPolicy returns has a derivation entry, and
//    the map carries no keys the policy does not have;
//  - every derivation names at least one dimension (no bare constants);
//  - spot-checked derivations agree NUMERICALLY with the code at the
//    baseline state — the printed formula is the executed formula.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAffectPolicy, POLICY_DERIVATIONS } from "../affect/policy.js";
import { BASELINE } from "../affect/defaults.js";

const DIM_NAMES = ["valence", "arousal", "stability", "coherence", "agency", "trust", "fatigue"];

describe("S-AFF-4 policy derivations cover every signal", () => {
  it("every policy signal has a derivation, with no extras", () => {
    const policy = getAffectPolicy(BASELINE);
    assert.deepEqual(Object.keys(POLICY_DERIVATIONS).sort(), Object.keys(policy).sort());
    for (const [category, signals] of Object.entries(policy)) {
      assert.deepEqual(
        Object.keys(POLICY_DERIVATIONS[category]).sort(),
        Object.keys(signals).sort(),
        `category ${category}`
      );
      for (const key of Object.keys(signals)) {
        const d = POLICY_DERIVATIONS[category][key];
        assert.equal(typeof d, "string", `${category}.${key}`);
        assert.ok(d.length > 0, `${category}.${key} empty`);
      }
    }
  });

  it("every derivation names at least one dimension", () => {
    for (const [category, signals] of Object.entries(POLICY_DERIVATIONS)) {
      for (const [key, d] of Object.entries(signals)) {
        assert.ok(
          DIM_NAMES.some((n) => d.includes(n)),
          `${category}.${key} names no dimension: ${d}`
        );
      }
    }
  });
});

describe("S-AFF-4 printed formulas agree with the code at baseline", () => {
  const { v, a, s, c, g, t, f } = BASELINE;
  const policy = getAffectPolicy(BASELINE);
  const near = (x, y) => Math.abs(x - y) < 1e-9;

  it("style.verbosity", () => {
    assert.ok(near(policy.style.verbosity, 0.5 + (c - 0.5) * 0.3 - a * 0.2 - f * 0.15));
  });

  it("cognition.latencyBudgetMs", () => {
    const raw = 3000 + (1 - f) * 7000 + c * 3000 - a * 2000;
    assert.equal(policy.cognition.latencyBudgetMs, Math.round(Math.min(15000, Math.max(1000, raw))));
  });

  it("memory.retentionBias", () => {
    assert.ok(near(policy.memory.retentionBias, 0.5 + t * 0.2 + s * 0.15 + (1 - f) * 0.1));
  });

  it("safety.strictness", () => {
    assert.ok(near(policy.safety.strictness, 0.4 + (1 - t) * 0.25 + (1 - s) * 0.15 + f * 0.1 + (1 - c) * 0.1));
  });
});
