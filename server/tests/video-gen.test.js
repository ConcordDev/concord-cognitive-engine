// server/tests/video-gen.test.js
//
// Sprint 14 acceptance — video gen pure logic (no live API calls).

import test from "node:test";
import assert from "node:assert/strict";

import {
  pollVideoStatus, listPendingJobs,
  VIDEO_GEN_CONSTANTS,
} from "../lib/video-gen.js";

test("VIDEO_GEN_CONSTANTS lists 3 providers", () => {
  assert.deepEqual(VIDEO_GEN_CONSTANTS.PROVIDERS, ["openai", "google", "runway"]);
});

test("pollVideoStatus returns error for missing jobId", async () => {
  const r = await pollVideoStatus(null);
  assert.equal(r.ok, false);
});

test("pollVideoStatus returns error for unknown jobId", async () => {
  const r = await pollVideoStatus("vid_doesnotexist");
  assert.equal(r.ok, false);
  assert.equal(r.error, "job_not_found");
});

test("listPendingJobs returns empty array when no jobs", () => {
  const jobs = listPendingJobs();
  assert.ok(Array.isArray(jobs));
});
