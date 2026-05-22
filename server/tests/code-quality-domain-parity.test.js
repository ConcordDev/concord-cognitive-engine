// Contract tests for server/domains/code-quality.js — the user-facing
// static-analysis surface (analyze, annotate, trend, debt, hotspots,
// gate config + evaluation, PR decoration, issue workflow).
//
// All analysis is real computation over submitted source — no seeded
// data. Each test exercises a macro and asserts the { ok } envelope.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCodeQualityActions from "../domains/code-quality.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code-quality.${name}`);
  if (!fn) throw new Error(`code-quality.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => {
  registerCodeQualityActions(register);
});

// Fresh per-user state for each test so scan history is deterministic.
let uidCounter = 0;
let ctx;
beforeEach(() => {
  uidCounter += 1;
  ctx = { actor: { userId: `cq_user_${uidCounter}` }, userId: `cq_user_${uidCounter}` };
});

// A deliberately messy file that trips many rules.
const MESSY = `function huge(a, b, c, d, e, f) {
  var total = 0;
  if (a != null) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 0) {
        if (a[i] < 999) {
          if (a[i] % 2 === 0) {
            total += a[i] * 12345;
          }
        }
      }
    }
  }
  console.log('debug', total);
  try { risky(); } catch (e) {}
  return total;
}`;

const DUP = `const x = 1;
doThing(x);
doThing(x + 1);
doThing(x + 2);
const x = 1;
doThing(x);
doThing(x + 1);
doThing(x + 2);`;

describe("code-quality.analyze", () => {
  it("rejects empty input", () => {
    const r = call("analyze", ctx, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_source_provided");
  });

  it("analyzes a single submitted snippet — issues, metrics, grade", () => {
    const r = call("analyze", ctx, { source: MESSY, file: "messy.js" });
    assert.equal(r.ok, true);
    assert.ok(r.result.scanId);
    assert.equal(r.result.fileCount, 1);
    assert.ok(r.result.totals.total > 0, "should find issues");
    assert.ok(["A", "B", "C", "D", "F"].includes(r.result.grade));
    assert.ok(r.result.metrics.functionCount >= 1);
    assert.ok(r.result.metrics.maxComplexity > 0);
  });

  it("flags the obvious smells: var, debug, empty catch, many-params", () => {
    const r = call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const rules = new Set(r.result.files[0].findings.map((f) => f.rule));
    assert.ok(rules.has("var-declaration"));
    assert.ok(rules.has("debug-statement"));
    assert.ok(rules.has("empty-catch"));
    assert.ok(rules.has("many-params"));
  });

  it("accepts a multi-file files[] payload", () => {
    const r = call("analyze", ctx, {
      files: [
        { path: "a.js", content: "const a = 1;" },
        { path: "b.py", content: "def f():\n    return 1\n" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.fileCount, 2);
  });

  it("detects within-file duplication", () => {
    const r = call("analyze", ctx, { source: DUP, file: "dup.js" });
    assert.equal(r.ok, true);
    assert.ok(r.result.metrics.duplicateBlocks >= 1);
  });
});

describe("code-quality.annotate", () => {
  it("returns no_scans_yet before any analyze", () => {
    const r = call("annotate", ctx, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_scans_yet");
  });

  it("returns per-line annotations with source context for the latest scan", () => {
    call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const r = call("annotate", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.files.length, 1);
    const file = r.result.files[0];
    assert.ok(file.annotationCount > 0);
    const first = file.annotations[0];
    assert.ok(Number.isFinite(first.line));
    assert.ok(Array.isArray(first.issues));
    assert.ok(typeof first.context === "string");
  });
});

describe("code-quality.trend", () => {
  it("returns an empty trend with no scans", () => {
    const r = call("trend", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.scanCount, 0);
    assert.equal(r.result.delta, null);
  });

  it("emits a delta once there are two scans", () => {
    call("analyze", ctx, { source: "const a = 1;", file: "a.js" });
    call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const r = call("trend", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.points.length, 2);
    assert.ok(r.result.delta);
    assert.ok(typeof r.result.delta.total === "number");
  });
});

describe("code-quality.debt", () => {
  it("returns no_scans_yet before any analyze", () => {
    assert.equal(call("debt", ctx, {}).ok, false);
  });

  it("estimates remediation effort with per-rule + per-severity breakdown", () => {
    call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const r = call("debt", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.totalHours >= 0);
    assert.ok(Array.isArray(r.result.byRule));
    assert.ok(Array.isArray(r.result.bySeverity));
    assert.ok(["A", "B", "C", "D", "E"].includes(r.result.rating));
  });
});

describe("code-quality.hotspots", () => {
  it("returns no_scans_yet before any analyze", () => {
    assert.equal(call("hotspots", ctx, {}).ok, false);
  });

  it("ranks function + file hotspots", () => {
    call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const r = call("hotspots", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.functionHotspots));
    assert.ok(Array.isArray(r.result.fileHotspots));
    assert.ok(Array.isArray(r.result.duplicateBlocks));
  });
});

describe("code-quality gate config + evaluation", () => {
  it("getGate returns config + defaults", () => {
    const r = call("getGate", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.gate);
    assert.ok(r.result.defaults);
  });

  it("setGate updates thresholds", () => {
    const r = call("setGate", ctx, { maxCritical: 3, maxDuplicationPct: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.gate.maxCritical, 3);
    assert.equal(r.result.gate.maxDuplicationPct, 12);
  });

  it("evaluateGate returns no_scans_yet before any analyze", () => {
    assert.equal(call("evaluateGate", ctx, {}).ok, false);
  });

  it("evaluateGate produces a PASS/FAIL verdict against the gate", () => {
    call("analyze", ctx, { source: MESSY, file: "messy.js" });
    const r = call("evaluateGate", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(["PASS", "FAIL"].includes(r.result.status));
    assert.ok(Array.isArray(r.result.checks));
    assert.equal(typeof r.result.passed, "boolean");
  });
});

describe("code-quality.decoratePR", () => {
  it("requires head files", () => {
    const r = call("decoratePR", ctx, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "head_files_required");
  });

  it("reports new issues introduced by a diff", () => {
    const r = call("decoratePR", ctx, {
      base: [{ path: "f.js", content: "const a = 1;\n" }],
      head: [{ path: "f.js", content: "const a = 1;\nvar b = 2;\n" }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.summary.newIssues >= 1, "var introduces a new issue");
    assert.ok(["BLOCK", "WARN", "COMMENT", "APPROVE"].includes(r.result.verdict));
  });

  it("APPROVEs a clean diff with no new issues", () => {
    const r = call("decoratePR", ctx, {
      base: [{ path: "f.js", content: "const a = 1;\n" }],
      head: [{ path: "f.js", content: "const a = 1;\nconst b = 2;\n" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.verdict, "APPROVE");
  });
});

describe("code-quality issue workflow", () => {
  it("trackIssue requires rule + message", () => {
    assert.equal(call("trackIssue", ctx, {}).ok, false);
  });

  it("trackIssue promotes a finding to a tracked issue", () => {
    const r = call("trackIssue", ctx, {
      rule: "var-declaration",
      message: "var should be const",
      severity: "low",
      file: "f.js",
      line: 4,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.issue.id);
    assert.equal(r.result.issue.status, "open");
  });

  it("updateIssue changes status + assignee with history", () => {
    const created = call("trackIssue", ctx, {
      rule: "loose-equality",
      message: "use ===",
    });
    const id = created.result.issue.id;
    const r = call("updateIssue", ctx, { id, status: "in-progress", assignee: "dev1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.issue.status, "in-progress");
    assert.equal(r.result.issue.assignee, "dev1");
    assert.ok(r.result.issue.history.length >= 2);
  });

  it("updateIssue rejects unknown ids + invalid status", () => {
    assert.equal(call("updateIssue", ctx, { id: "nope" }).ok, false);
    const created = call("trackIssue", ctx, { rule: "r", message: "m" });
    const bad = call("updateIssue", ctx, {
      id: created.result.issue.id,
      status: "bogus",
    });
    assert.equal(bad.ok, false);
  });

  it("listIssues filters by status", () => {
    const a = call("trackIssue", ctx, { rule: "r1", message: "m1" });
    call("trackIssue", ctx, { rule: "r2", message: "m2" });
    call("updateIssue", ctx, { id: a.result.issue.id, status: "resolved" });
    const all = call("listIssues", ctx, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.total, 2);
    const resolved = call("listIssues", ctx, { status: "resolved" });
    assert.equal(resolved.result.shown, 1);
  });
});
