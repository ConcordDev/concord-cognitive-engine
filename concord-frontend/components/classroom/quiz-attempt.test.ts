import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { cohortStillListed, parseClassroomCohort, quizAttemptFromSubmit } from "./quiz-attempt";

describe("quiz submit result", () => {
  it("reads the score off the attempt wrapper", () => {
    const attempt = quizAttemptFromSubmit({
      attempt: {
        score: 1,
        totalPoints: 2,
        percent: 50,
        breakdown: [{ questionId: "q1", prompt: "One", correct: true, awarded: 1 }],
      },
    });
    assert.equal(attempt?.score, 1);
    assert.equal(attempt?.totalPoints, 2);
    assert.equal(attempt?.percent, 50);
    assert.equal(attempt?.breakdown.length, 1);
  });

  it("does not treat the wrapper itself as a score", () => {
    assert.equal(quizAttemptFromSubmit({ attempt: { id: "qa" } }), null);
    assert.equal(quizAttemptFromSubmit(null), null);
  });
});

describe("classroom cohort orientation", () => {
  it("keeps a stored id only when that cohort is still listed", () => {
    assert.equal(parseClassroomCohort("12"), 12);
    assert.equal(parseClassroomCohort("nope"), null);
    assert.equal(cohortStillListed(12, [3, 12]), 12);
    assert.equal(cohortStillListed(9, [3, 12]), null);
  });
});
