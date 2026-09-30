import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verbsFromPain, limbContextModifiers } from "../lib/combat/limb-verbs.js";

describe("limb verbs", () => {
  it("healthy body is identity", () => {
    const v = verbsFromPain({});
    assert.equal(v.damageMul, 1);
    assert.equal(v.dodgeDisabled, false);
  });

  it("broken arms weaken strikes", () => {
    const v = verbsFromPain({ arms: 0.85 });
    assert.ok(v.damageMul < 0.7);
    assert.equal(v.brokenArm, true);
    assert.ok(limbContextModifiers({ arms: 0.85 }).staminaCostMul > 1);
  });

  it("broken legs disable dodge", () => {
    const v = verbsFromPain({ legs: 0.9 });
    assert.equal(v.dodgeDisabled, true);
    assert.equal(v.brokenLeg, true);
    assert.ok(v.speedMul < 0.75);
  });

  it("head trauma increases stagger taken", () => {
    const v = verbsFromPain({ head: 0.8 });
    assert.ok(v.staggerTakenMul > 1.2);
    assert.equal(v.headTrauma, true);
  });
});
