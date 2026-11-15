// server/tests/experience-sus-scale.test.js
//
// FIX-experience-002: usabilityScore multiplied the task-success
// PERCENT by 25 as if it were a 0-1 fraction — the form's own defaults
// (80% success, 45 s, 1 error, 75% satisfaction) contributed 2000
// points from the first term alone and the clamp pinned the result at
// a perfect 100/A. All four terms are percents now (≤25 points each),
// and the result carries the components + formula for hand-checking.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerExperienceActions from "../domains/experience.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function score(data) {
  const fn = ACTIONS.get("experience.usabilityScore");
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data, meta: {} }, {});
}

before(() => { registerExperienceActions(register); });

describe("experience usabilityScore scale (FIX-experience-002)", () => {
  it("the audit session (form defaults) scores 81, not a perfect 100", () => {
    const r = score({ taskSuccessRate: 80, avgTimeSeconds: 45, errorCount: 1, satisfactionScore: 75 });
    assert.equal(r.ok, true);
    // 0.25×80 + 0.25×(100−22.5) + 0.25×(100−10) + 0.25×75
    // = 20 + 19.375 + 22.5 + 18.75 = 80.625 → 81
    assert.equal(r.result.susScore, 81);
    assert.deepEqual(r.result.components, { taskSuccess: 20, time: 19.4, errors: 22.5, satisfaction: 18.8 });
    assert.match(r.result.formula, /0\.25 ×/);
  });

  it("a perfect session still scores 100 and a zero session 0", () => {
    assert.equal(score({ taskSuccessRate: 100, avgTimeSeconds: 0, errorCount: 0, satisfactionScore: 100 }).result.susScore, 100);
    assert.equal(score({ taskSuccessRate: 0, avgTimeSeconds: 10000, errorCount: 50, satisfactionScore: 0 }).result.susScore, 0);
  });

  it("out-of-range percents are refused by name", () => {
    const r = score({ taskSuccessRate: 180, avgTimeSeconds: 10, errorCount: 0, satisfactionScore: 50 });
    assert.equal(r.ok, false);
    assert.match(r.error, /taskSuccessRate must be a percent/);
  });
});
