// The classroom dialog posts type "artifact" (reconciled) and a status from
// enrolled | active | completed | withdrawn | graduated. Those three extra
// words used to fail validateArtifact, and the client showed only
// "validation failed".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_RULES, validateArtifact, getValidTransitions } from "../lib/domain-logic.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

reconcileArtifactTypes(DOMAIN_RULES);

const CLASSROOM = ["enrolled", "active", "completed", "withdrawn", "graduated"];

describe("education classroom record", () => {
  it("accepts a course, a lesson plan, and a quiz at every classroom status", () => {
    for (const artifactType of ["Course", "LessonPlan", "Quiz", "Student"]) {
      for (const status of CLASSROOM) {
        const v = validateArtifact("education", "artifact", { artifactType }, { status });
        assert.equal(v.ok, true, `${artifactType}/${status}: ${v.errors.join("; ")}`);
      }
    }
  });

  it("names status when the status is not a classroom word", () => {
    const v = validateArtifact("education", "artifact", { artifactType: "Course" }, { status: "nope" });
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /status/i);
    assert.match(v.errors[0], /nope/);
  });

  it("lets a saved enrolled record move to the other classroom words", () => {
    const next = getValidTransitions("education", "enrolled");
    for (const status of ["active", "completed", "withdrawn", "graduated"]) {
      assert.ok(next.includes(status), status);
    }
  });
});
