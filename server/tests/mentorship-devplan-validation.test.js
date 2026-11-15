// GB-1538 / FIX-mentorship-007 — developmentPlan validates its inputs.
// The panel declares current skills + target role + skill gaps required,
// but the action defaulted past empty/junk input and emitted a full
// 26-week plan from nothing ('{bad' in every field). The server now
// enforces the panel's own contract.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMentorshipActions from "../domains/mentorship.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function plan(data) {
  const fn = ACTIONS.get("mentorship.developmentPlan");
  return fn({ actor: { userId: "u1" } }, { id: null, data, meta: {} }, {});
}

before(() => { registerMentorshipActions(register); });

describe("mentorship developmentPlan validation (FIX-mentorship-007)", () => {
  it("empty input is refused as not-enough-info, with no plan emitted", () => {
    const r = plan({});
    assert.equal(r.ok, false);
    assert.match(r.error, /not enough info/i);
    assert.equal(r.result, undefined);
  });

  it("the walker's junk repro — '{bad' in every field — is refused", () => {
    const r = plan({ currentSkills: ["{bad"], targetRole: "{bad", skillGaps: ["{bad"] });
    assert.equal(r.ok, false);
    assert.match(r.error, /not enough info/i);
  });

  it("a missing leg is refused even when the others are usable", () => {
    assert.equal(plan({ currentSkills: ["python"], targetRole: "staff engineer" }).ok, false);
    assert.equal(plan({ currentSkills: ["python"], skillGaps: ["system design"] }).ok, false);
    assert.equal(plan({ targetRole: "staff engineer", skillGaps: ["system design"] }).ok, false);
  });

  it("usable input still generates the full 26-week plan", () => {
    const r = plan({ currentSkills: ["python", "sql"], targetRole: "staff engineer", skillGaps: ["system design"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.timelineWeeks, 26);
    assert.equal(r.result.milestones.length, 4);
    assert.equal(r.result.targetRole, "staff engineer");
    assert.deepEqual(r.result.gaps, ["system design"]);
  });
});
