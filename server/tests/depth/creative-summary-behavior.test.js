// tests/depth/creative-summary-behavior.test.js — REAL behavioral tests for the
// creative project/revision summary lens-actions (lens-audit Batch B: the creative-lens
// "Project Summary" / "Revision Summary" buttons hit no macro until these landed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("creative.project_summary", () => {
  it("summarizes a project artifact: status + array counts", async () => {
    const r = await lensRun("creative", "project_summary", {
      data: { title: "Film X", status: "production", shots: [1, 2, 3], deliverables: [1] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Film X");
    assert.equal(r.result.status, "production");
    assert.equal(r.result.counts.shots, 3);
    assert.equal(r.result.totalItems, 4);
    assert.match(r.result.summary, /production/);
  });
  it("degrades to a planning summary on an empty artifact", async () => {
    const r = await lensRun("creative", "project_summary", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalItems, 0);
  });
});

describe("creative.revision_summary", () => {
  it("counts revisions and reports the latest status", async () => {
    const r = await lensRun("creative", "revision_summary", {
      data: { versions: [{ version: 1, status: "approved" }, { version: 2, status: "draft" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.revisionCount, 2);
    assert.equal(r.result.latestStatus, "draft");
    assert.equal(r.result.statusCounts.approved, 1);
  });
  it("handles no revisions cleanly", async () => {
    const r = await lensRun("creative", "revision_summary", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.revisionCount, 0);
    assert.equal(r.result.latestStatus, "none");
  });
});
