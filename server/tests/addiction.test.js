// Slice-of-Life SL4 (core) — addiction as viability-decay. Pins: dependence
// builds with use + sheds with abstinence, the debuff magnitude is derived
// through the viability spine (0 clean → 1 at the withdrawal boundary), and
// crossing the boundary is withdrawal. Vice = the same R≥D viability math.
//
// Run: node --test tests/addiction.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBSTANCES, recordUse, tickAbstinence, addictionMagnitude, inWithdrawal } from "../lib/social/addiction.js";

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("addiction as viability-decay", () => {
  it("clean → magnitude 0; repeated use raises it toward 1", () => {
    assert.equal(addictionMagnitude(0, "alcohol"), 0);
    let d = 0;
    for (let i = 0; i < 5; i++) d = recordUse(d, "alcohol"); // 5 × 0.10 = 0.5
    assert.ok(close(d, 0.5));
    const m = addictionMagnitude(d, "alcohol");
    assert.ok(m > 0.4 && m < 0.6); // ~0.5 of the way to the boundary
  });

  it("magnitude is monotonic in dependence (closer to withdrawal = worse)", () => {
    assert.ok(addictionMagnitude(0.8, "alcohol") > addictionMagnitude(0.3, "alcohol"));
  });

  it("abstinence decays dependence back toward 0", () => {
    let d = 0.5;
    for (let i = 0; i < 10; i++) d = tickAbstinence(d, "alcohol"); // 10 × 0.02 = 0.2
    assert.ok(close(d, 0.3));
    assert.ok(addictionMagnitude(d, "alcohol") < addictionMagnitude(0.5, "alcohol"));
  });

  it("crossing the threshold is withdrawal; magnitude pins to 1 there", () => {
    let d = 0;
    for (let i = 0; i < 12; i++) d = recordUse(d, "alcohol"); // capped at 1.0
    assert.equal(d, 1.0);
    assert.equal(inWithdrawal(d, "alcohol"), true);
    assert.equal(addictionMagnitude(d, "alcohol"), 1);
  });

  it("opiates hook faster + are judged harder than alcohol", () => {
    assert.ok(SUBSTANCES.opiate.perUse > SUBSTANCES.alcohol.perUse);
    assert.ok(SUBSTANCES.opiate.decayPerTick < SUBSTANCES.alcohol.decayPerTick); // harder to shake
    assert.ok(SUBSTANCES.opiate.opinionJudgment < SUBSTANCES.alcohol.opinionJudgment);
  });
});
