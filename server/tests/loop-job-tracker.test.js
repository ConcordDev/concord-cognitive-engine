// server/tests/loop-job-tracker.test.js
//
// INC-150: loop-job-tracker must tolerate nesting, async out-of-order ends,
// and withJob on throw.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  beginJob,
  endJob,
  withJob,
  activeJobs,
  lastJob,
  jobsInWindow,
  _resetJobsForTest,
} from "../lib/loop-job-tracker.js";

beforeEach(() => { _resetJobsForTest(); });

describe("loop-job-tracker", () => {
  it("reports a single active job", () => {
    const token = beginJob("alpha");
    const jobs = activeJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].name, "alpha");
    assert.ok(Number.isFinite(jobs[0].startedAt));
    endJob(token);
    assert.equal(activeJobs().length, 0);
  });

  it("tolerates nested jobs", () => {
    const t1 = beginJob("outer");
    const t2 = beginJob("inner");
    assert.deepEqual(activeJobs().map((j) => j.name), ["outer", "inner"]);
    endJob(t2);
    assert.deepEqual(activeJobs().map((j) => j.name), ["outer"]);
    endJob(t1);
    assert.equal(activeJobs().length, 0);
  });

  it("tolerates async out-of-order completion", async () => {
    const t1 = beginJob("a");
    const t2 = beginJob("b");
    // End the outer job first, as can happen with async fire-and-forget wrappers.
    endJob(t1);
    assert.deepEqual(activeJobs().map((j) => j.name), ["b"]);
    endJob(t2);
    assert.equal(activeJobs().length, 0);
  });

  it("withJob ends the job even when fn throws", async () => {
    let threw = false;
    try {
      await withJob("throws", async () => { throw new Error("boom"); });
    } catch (e) {
      threw = true;
      assert.equal(e.message, "boom");
    }
    assert.ok(threw);
    assert.equal(activeJobs().length, 0);
    assert.equal(lastJob().name, "throws");
  });

  it("withJob returns the fn result", async () => {
    const r = await withJob("compute", async () => 42);
    assert.equal(r, 42);
  });

  it("endJob with unknown token is a silent no-op", () => {
    assert.equal(endJob("no-such-token"), false);
  });

  it("jobsInWindow includes active and recently-ended jobs", async () => {
    const t1 = beginJob("active-now");
    await withJob("ended", async () => { /* short */ });
    const windowed = jobsInWindow(5000, Date.now(), 10);
    const names = windowed.map((j) => j.name);
    assert.ok(names.includes("active-now"));
    assert.ok(names.includes("ended"));
    endJob(t1);
  });

  it("lastJob prefers the most recently-ended job", async () => {
    await withJob("first", async () => { /* short */ });
    await new Promise((r) => setTimeout(r, 10));
    await withJob("second", async () => { /* short */ });
    assert.equal(lastJob().name, "second");
  });
});
