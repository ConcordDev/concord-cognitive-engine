import test from "node:test";
import assert from "node:assert/strict";
import { mentorRatingCaption } from "./rating-caption";

test("a mean names how many listed mentors it covers", () => {
  assert.deepEqual(mentorRatingCaption(3.7, 2), {
    value: "3.7",
    caption: "mean of 2 listed mentors with a review",
  });
});

test("one review is still a mean of one", () => {
  assert.deepEqual(mentorRatingCaption(5, 1), {
    value: "5",
    caption: "mean of 1 listed mentor with a review",
  });
});

test("no reviews read as unavailable", () => {
  assert.deepEqual(mentorRatingCaption(0, 0), {
    value: "--",
    caption: "no mentor reviews yet",
  });
  assert.equal(mentorRatingCaption(3.7, 0).value, "--");
});
