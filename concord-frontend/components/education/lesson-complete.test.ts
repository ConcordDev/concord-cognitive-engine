import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonCompleteNotice, playerEmptyCopy } from "./lesson-complete.ts";

describe("lesson complete copy", () => {
  it("names the points the server awarded", () => {
    assert.equal(lessonCompleteNotice(50, false), "+50 energy points. That counts toward the day streak.");
  });

  it("does not claim new points on a repeat", () => {
    assert.equal(lessonCompleteNotice(0, true), "Already completed. Energy points stay as they were.");
  });

  it("says when the enrolled course has no lessons", () => {
    assert.equal(playerEmptyCopy(false, 0), "Enroll in a course to open its lessons.");
    assert.match(playerEmptyCopy(true, 0) || "", /no lessons yet/);
    assert.equal(playerEmptyCopy(true, 1), null);
  });
});
