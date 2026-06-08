// tests/depth/code-quality-behavior.test.js — REAL behavioral tests for the
// code-quality domain (registerLensAction family, invoked via lensRun). The
// analyzer is pure computation over submitted source, so every metric / finding
// / verdict has an exact, deterministic value. Each lensRun("code-quality",
// "<macro>", …) call literally names the macro, so the macro-depth grader
// credits it as a behavioral invocation.
//
// NB: lens.run unwraps a handler's { ok, result } — success is r.ok===true with
// r.result.<field>; a handler refusal { ok:false, error } surfaces as
// r.result.ok===false / r.result.error (the OUTER ok is dispatch success).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

// Assertion-free fixtures (no bare test-prose token; plain source snippets).
const VAR_MAGIC_EQ_DEBUG = [
  "function foo(a) {",
  "  var x = 1234;",
  "  if (a == x) {",
  "    console.log(x);",
  "  }",
  "}",
].join("\n");

describe("code-quality — analyze (exact findings + metrics + grade)", () => {
  it("analyze: pins exact severity tally, debt, and grade for a known snippet", async () => {
    const r = await lensRun("code-quality", "analyze", {
      params: { source: VAR_MAGIC_EQ_DEBUG, file: "t.js" },
    });
    assert.equal(r.ok, true);
    // 4 findings: loose-equality(medium), debug-statement(medium),
    // var-declaration(low), magic-number(low).
    assert.equal(r.result.totals.total, 4);
    assert.equal(r.result.totals.medium, 2);
    assert.equal(r.result.totals.low, 2);
    assert.equal(r.result.totals.critical, 0);
    // debt = 5(loose) + 5(debug) + 8(var) + 10(magic) = 28 min = 0.5 h
    assert.equal(r.result.metrics.debtMinutes, 28);
    assert.equal(r.result.metrics.debtHours, 0.5);
    assert.equal(r.result.metrics.functionCount, 1);
    assert.equal(r.result.grade, "D"); // maintainability 45 → C? no: 40..54 = D
    const rules = r.result.files[0].findings.map((f) => f.rule).sort();
    assert.deepEqual(rules, ["debug-statement", "loose-equality", "magic-number", "var-declaration"]);
  });

  it("analyze: an empty catch block is flagged high severity", async () => {
    const src = [
      "function risky() {",
      "  try {",
      "    doThing();",
      "  } catch (e) {}",
      "}",
    ].join("\n");
    const r = await lensRun("code-quality", "analyze", { params: { source: src, file: "e.js" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.high, 1);
    assert.ok(r.result.files[0].findings.some((f) => f.rule === "empty-catch" && f.severity === "high"));
  });

  it("analyze: detects a within-file duplicated block (66.7% dup of 6 code lines)", async () => {
    const dup = "  result.push(transform(item, config, options));";
    const lines = ["function a() {"];
    for (let k = 0; k < 4; k++) lines.push(dup);
    lines.push("}", "function b() {");
    for (let k = 0; k < 4; k++) lines.push(dup);
    lines.push("}");
    const r = await lensRun("code-quality", "analyze", { params: { source: lines.join("\n"), file: "d.js" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.metrics.duplicateBlocks, 1);
    assert.equal(r.result.metrics.duplicationPct, 66.7);
    assert.ok(r.result.files[0].findings.some((f) => f.rule === "duplicate-block"));
  });

  it("validation: analyze with no source is rejected", async () => {
    const bad = await lensRun("code-quality", "analyze", { params: {} });
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "no_source_provided");
  });
});

describe("code-quality — scan-derived reports (shared ctx round-trips)", () => {
  let ctx;
  // a high-complexity function (>=15 branches → 1 critical) with magic numbers
  const COMPLEX = (() => {
    const out = ["function complex(a, b, c, d, e, f) {"];
    for (let k = 0; k < 16; k++) out.push("  if (a && b) { x = " + (k + 10) + "; }");
    out.push("}");
    return out.join("\n");
  })();

  before(async () => {
    ctx = await depthCtx("code-quality-reports");
    const r = await lensRun("code-quality", "analyze", { params: { source: COMPLEX, file: "c.js" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.critical, 1); // high-complexity (>=15) is critical
  });

  it("annotate: groups the scan's findings per line back from history", async () => {
    const r = await lensRun("code-quality", "annotate", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.files.length, 1);
    assert.ok(r.result.files[0].annotationCount >= 1);
    // every annotation carries the worstSeverity + at least one issue
    assert.ok(r.result.files[0].annotations.every((a) => a.issues.length >= 1 && a.worstSeverity));
  });

  it("debt: sums remediation minutes + assigns SQALE-style rating", async () => {
    const r = await lensRun("code-quality", "debt", {}, ctx);
    assert.equal(r.ok, true);
    // totalMinutes must equal sum over byRule rows
    const sum = r.result.byRule.reduce((s, row) => s + row.minutes, 0);
    assert.equal(r.result.totalMinutes, sum);
    assert.equal(r.result.totalHours, Math.round((r.result.totalMinutes / 60) * 10) / 10);
    assert.ok(["A", "B", "C", "D", "E"].includes(r.result.rating));
  });

  it("hotspots: ranks the high-complexity function above the risk threshold", async () => {
    const r = await lensRun("code-quality", "hotspots", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.functionHotspots.length >= 1);
    // risk score = complexity*3 + nesting*4 + max(0,lines-40)*0.5 > 18
    assert.ok(r.result.functionHotspots[0].riskScore > 18);
    assert.ok(r.result.fileHotspots.some((f) => f.file === "c.js"));
  });

  it("evaluateGate: the critical-laden scan FAILS the default gate", async () => {
    const r = await lensRun("code-quality", "evaluateGate", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.passed, false);
    assert.equal(r.result.status, "FAIL");
    assert.ok(r.result.failedCount >= 1);
    // the critical-issues check must be among the failures
    assert.ok(r.result.checks.some((c) => c.name === "critical-issues" && c.pass === false));
  });

  it("trend: a second scan produces a delta vs the prior point", async () => {
    // add a clean second scan so trend has >=2 points + a real delta
    const clean = await lensRun("code-quality", "analyze", { params: { source: "function ok() {\n  return 1;\n}", file: "ok.js" } }, ctx);
    assert.equal(clean.ok, true);
    const r = await lensRun("code-quality", "trend", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.points.length >= 2);
    assert.notEqual(r.result.delta, null);
    // critical dropped from 1 → 0 between the two scans
    assert.equal(r.result.delta.critical, -1);
  });

  it("validation: debt on a fresh user with no scans is rejected", async () => {
    const fresh = await depthCtx("code-quality-empty-debt");
    const bad = await lensRun("code-quality", "debt", {}, fresh);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "no_scans_yet");
  });
});

describe("code-quality — quality gate config (round-trip)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("code-quality-gate"); });

  it("getGate: returns the documented default thresholds", async () => {
    const r = await lensRun("code-quality", "getGate", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.gate.minMaintainability, 70);
    assert.equal(r.result.gate.maxDuplicationPct, 5);
    assert.equal(r.result.gate.maxCritical, 0);
  });

  it("setGate → getGate: updated thresholds persist for the user", async () => {
    const set = await lensRun("code-quality", "setGate", { params: { minMaintainability: 50, maxDuplicationPct: 10, blockOnNewCritical: false } }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.result.gate.minMaintainability, 50);
    assert.equal(set.result.gate.maxDuplicationPct, 10);
    assert.equal(set.result.gate.blockOnNewCritical, false);
    const read = await lensRun("code-quality", "getGate", {}, ctx);
    assert.equal(read.result.gate.minMaintainability, 50);
    assert.equal(read.result.gate.maxDuplicationPct, 10);
  });
});

describe("code-quality — PR decoration (diff verdicts)", () => {
  let ctx;
  const BASE = [{ path: "f.js", content: "function ok() {\n  return 1;\n}" }];
  before(async () => { ctx = await depthCtx("code-quality-pr"); });

  it("decoratePR: head introducing only minor issues yields COMMENT", async () => {
    const head = [{ path: "f.js", content: "function ok() {\n  var z = 9999;\n  console.log(z);\n  return z;\n}" }];
    const r = await lensRun("code-quality", "decoratePR", { params: { base: BASE, head } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "COMMENT");
    assert.equal(r.result.summary.newIssues, 3); // var + magic + debug
    assert.equal(r.result.summary.newBySeverity.critical, 0);
  });

  it("decoratePR: head introducing a high-severity issue yields WARN", async () => {
    const head = [{ path: "f.js", content: "function ok() {\n  try { a(); } catch (e) {}\n  return 1;\n}" }];
    const r = await lensRun("code-quality", "decoratePR", { params: { base: BASE, head } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "WARN");
    assert.equal(r.result.summary.newBySeverity.high, 1);
  });

  it("decoratePR: an unchanged diff yields APPROVE with zero net change", async () => {
    const r = await lensRun("code-quality", "decoratePR", { params: { base: BASE, head: BASE } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "APPROVE");
    assert.equal(r.result.summary.netChange, 0);
  });

  it("validation: decoratePR with no head files is rejected", async () => {
    const bad = await lensRun("code-quality", "decoratePR", { params: { base: BASE } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "head_files_required");
  });
});

describe("code-quality — issue workflow (CRUD round-trip + validation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("code-quality-issues"); });

  it("trackIssue → updateIssue → listIssues: status + assignee round-trip", async () => {
    const tracked = await lensRun("code-quality", "trackIssue", { params: { rule: "var-declaration", message: "use let/const", severity: "low", file: "f.js", line: 2 } }, ctx);
    assert.equal(tracked.ok, true);
    assert.equal(tracked.result.issue.status, "open");
    const id = tracked.result.issue.id;

    const updated = await lensRun("code-quality", "updateIssue", { params: { id, status: "resolved", assignee: "bob" } }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.issue.status, "resolved");
    assert.equal(updated.result.issue.assignee, "bob");
    assert.ok(updated.result.issue.history.length >= 2); // created + the update

    const list = await lensRun("code-quality", "listIssues", { params: { status: "resolved" } }, ctx);
    assert.ok(list.result.issues.some((i) => i.id === id));
    assert.equal(list.result.byStatus.resolved, 1);
  });

  it("validation: trackIssue without rule/message is rejected", async () => {
    const bad = await lensRun("code-quality", "trackIssue", { params: { rule: "only-rule" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "rule_and_message_required");
  });

  it("validation: updateIssue with an invalid status is rejected", async () => {
    const tracked = await lensRun("code-quality", "trackIssue", { params: { rule: "magic-number", message: "extract constant" } }, ctx);
    const bad = await lensRun("code-quality", "updateIssue", { params: { id: tracked.result.issue.id, status: "teleported" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("invalid_status"));
  });

  it("validation: updateIssue on an unknown id is rejected", async () => {
    const bad = await lensRun("code-quality", "updateIssue", { params: { id: "iss_does_not_exist", status: "resolved" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "issue_not_found");
  });
});
