/**
 * A1 / F1.3 — typed attack telegraphs.
 *
 * Pins:
 *   - light attacks are non-perilous (generic windup)
 *   - committed attacks resolve thrust/sweep/grab by weapon/style
 *   - each peril has the right counter (thrust→dodge, sweep→jump, grab→break)
 *   - counterNegates: the right counter (or a parry) negates; the wrong fails
 *
 * Run: node --test tests/integration/telegraph-peril.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { perilFor, counterNegates, PERIL_COUNTER } from "../../lib/combat/telegraph-peril.js";

describe("A1 — perilFor", () => {
  it("light attacks have no peril", () => {
    assert.equal(perilFor({ weapon: "spear", heavy: false }).perilKind, null);
  });
  it("resolves thrust / sweep / grab from the weapon or style", () => {
    assert.equal(perilFor({ weapon: "spear", heavy: true }).perilKind, "thrust");
    assert.equal(perilFor({ weapon: "great_axe", heavy: true }).perilKind, "sweep");
    assert.equal(perilFor({ style: "clinch_grapple", heavy: true }).perilKind, "grab");
  });
  it("a committed attack with no specific weapon reads as a sweep", () => {
    assert.equal(perilFor({ heavy: true }).perilKind, "sweep");
  });
  it("each peril carries its counter", () => {
    assert.equal(perilFor({ weapon: "rapier", heavy: true }).counter, PERIL_COUNTER.thrust);
    assert.equal(perilFor({ weapon: "maul", heavy: true }).counter, "jump");
    assert.equal(perilFor({ weapon: "grab", heavy: true }).counter, "break");
  });
});

describe("A1 — counterNegates", () => {
  it("the right counter negates, the wrong one fails", () => {
    assert.equal(counterNegates("thrust", "dodge"), true);
    assert.equal(counterNegates("thrust", "block"), false);   // block eats a thrust
    assert.equal(counterNegates("grab", "block"), false);     // block does not stop a grab
    assert.equal(counterNegates("grab", "break"), true);
    assert.equal(counterNegates("sweep", "jump"), true);
    assert.equal(counterNegates("sweep", "dodge"), false);
  });
  it("a parry beats any peril; null peril is never negated", () => {
    assert.equal(counterNegates("thrust", "parry"), true);
    assert.equal(counterNegates("grab", "parry"), true);
    assert.equal(counterNegates(null, "dodge"), false);
  });
});
