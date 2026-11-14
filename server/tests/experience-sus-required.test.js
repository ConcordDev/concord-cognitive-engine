// GB-1538 / FIX-experience-003 — usabilityScore requires its fields.
// A cleared field used to coerce to 0 (parseFloat(x) || 0) and compute a
// fresh-looking score, so the form showed no validation and the panel
// kept the stale result. Missing/empty/non-numeric inputs are now
// refused by name; an explicit 0 remains a legitimate value (the
// FIX-experience-002 zero-session case in experience-sus-scale).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerExperienceActions from "../domains/experience.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function score(data) {
  const fn = ACTIONS.get("experience.usabilityScore");
  return fn({ actor: { userId: "u1" } }, { id: null, data, meta: {} }, {});
}

before(() => { registerExperienceActions(register); });

describe("experience usabilityScore required fields (FIX-experience-003)", () => {
  it("a cleared taskSuccessRate is refused by name, not scored as 0", () => {
    const r = score({ taskSuccessRate: "", avgTimeSeconds: 45, errorCount: 1, satisfactionScore: 75 });
    assert.equal(r.ok, false);
    assert.match(r.error, /taskSuccessRate/);
  });

  it("an absent field is refused by name", () => {
    const r = score({ avgTimeSeconds: 45, errorCount: 1, satisfactionScore: 75 });
    assert.equal(r.ok, false);
    assert.match(r.error, /taskSuccessRate/);
  });

  it("every missing field is named in one refusal", () => {
    const r = score({});
    assert.equal(r.ok, false);
    for (const k of ["taskSuccessRate", "avgTimeSeconds", "errorCount", "satisfactionScore"]) {
      assert.match(r.error, new RegExp(k));
    }
  });

  it("explicit zeros remain legitimate and score 0", () => {
    const r = score({ taskSuccessRate: 0, avgTimeSeconds: 10000, errorCount: 50, satisfactionScore: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.susScore, 0);
  });

  it("the form-default session still scores 81 (FIX-experience-002 shape intact)", () => {
    const r = score({ taskSuccessRate: 80, avgTimeSeconds: 45, errorCount: 1, satisfactionScore: 75 });
    assert.equal(r.ok, true);
    assert.equal(r.result.susScore, 81);
  });
});
