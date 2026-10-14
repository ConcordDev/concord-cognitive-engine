// INC-SWEEP legacy F2 — cleared / omitted testCoverage must use server default
// 50 (not score as measured 0%). Explicit 0 remains measured 0.
// Re-read: invoke → inspect metrics; second invoke with omit still defaults.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./depth/_harness.js";

describe("legacy F2 technicalDebt coverage honesty", () => {
  it("omitted testCoverage defaults to 50 and flags testCoverageDefaulted", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{
          name: "mod-omit-cov",
          linesOfCode: 1000,
          cyclomaticComplexity: 0,
          // testCoverage omitted
          dependencyCount: 0,
          dependencyAgeYears: 0,
          duplicateRatio: 0,
          lastModifiedDaysAgo: 0,
        }],
      },
    });
    assert.equal(r.ok, true);
    const m = r.result.modules[0];
    assert.equal(m.metrics.testCoverage, 50);
    assert.equal(m.metrics.testCoverageDefaulted, true);
    // (100-50)*0.25 = 12.5 coverage debt — not the 25 from measured 0%
    assert.equal(m.debtBreakdown.coverage, 12.5);
    assert.notEqual(m.debtScore, 25);
  });

  it("null / empty-string testCoverage also default (re-read after omit path)", async () => {
    const r1 = await lensRun("legacy", "technicalDebt", {
      data: { modules: [{ name: "a", linesOfCode: 1000, testCoverage: null }] },
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.modules[0].metrics.testCoverage, 50);
    assert.equal(r1.result.modules[0].metrics.testCoverageDefaulted, true);

    const r2 = await lensRun("legacy", "technicalDebt", {
      data: { modules: [{ name: "b", linesOfCode: 1000, testCoverage: "" }] },
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.modules[0].metrics.testCoverage, 50);
    assert.equal(r2.result.modules[0].metrics.testCoverageDefaulted, true);
  });

  it("explicit testCoverage 0 stays measured 0 with coverage debt 25", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{
          name: "mod-zero-cov",
          linesOfCode: 1000,
          cyclomaticComplexity: 0,
          testCoverage: 0,
          dependencyCount: 0,
          dependencyAgeYears: 0,
          duplicateRatio: 0,
          lastModifiedDaysAgo: 0,
        }],
      },
    });
    assert.equal(r.ok, true);
    const m = r.result.modules[0];
    assert.equal(m.metrics.testCoverage, 0);
    assert.equal(m.metrics.testCoverageDefaulted, false);
    assert.equal(m.debtBreakdown.coverage, 25);
    assert.equal(m.debtScore, 25);
    assert.equal(m.remediationHours, 50);
  });
});

describe("legacy F3 technicalDebt complexity honesty", () => {
  it("explicit cyclomaticComplexity 0 stays 0 in metrics (not rewritten to 1)", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{
          name: "mod-zero-cc",
          linesOfCode: 1000,
          cyclomaticComplexity: 0,
          testCoverage: 0,
          dependencyCount: 0,
          dependencyAgeYears: 0,
          duplicateRatio: 0,
          lastModifiedDaysAgo: 0,
        }],
      },
    });
    assert.equal(r.ok, true);
    const m = r.result.modules[0];
    assert.equal(m.metrics.cyclomaticComplexity, 0);
    // complexity debt term is 0 for any cc ≤ 10; MI uses the real 0 in -0.23*cc
    assert.equal(m.debtBreakdown.complexity, 0);
    // volume = loc * log2(max(2, cc)) still uses max(2,0)=2; MI differs from coerced-1
    // Re-read: second call with same payload must echo 0 again.
    const r2 = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{
          name: "mod-zero-cc",
          linesOfCode: 1000,
          cyclomaticComplexity: 0,
          testCoverage: 0,
        }],
      },
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.modules[0].metrics.cyclomaticComplexity, 0);
    assert.equal(r2.result.modules[0].maintainabilityIndex, m.maintainabilityIndex);
  });

  it("omitted cyclomaticComplexity still defaults to 1", async () => {
    const r = await lensRun("legacy", "technicalDebt", {
      data: {
        modules: [{ name: "mod-omit-cc", linesOfCode: 100, testCoverage: 80 }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.modules[0].metrics.cyclomaticComplexity, 1);
  });
});

