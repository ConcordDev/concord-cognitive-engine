// Behavioral macro tests for server/domains/code-quality.js — the user-facing
// static-analysis lens (parity vs SonarQube / CodeClimate).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call
// through the CANONICAL 3-arg register shim the domain installs — against the
// REAL in-memory globalThis._concordSTATE.codeQuality store. These are NOT
// shape-only assertions: every test asserts ACTUAL computed analyzer output
// (findings, complexity, maintainability grade, technical-debt minutes,
// duplication, PR-diff deltas) + multi-step round-trips (analyze → annotate →
// debt → hotspots → gate; track issue → update → list), per-user isolation,
// and the fail-CLOSED numeric guards the macro-assassin's V2 vector probes.
//
// Hermetic: no server boot, no network, no LLM, no DB — the domain is pure
// in-process computation + STATE Maps, so the local register harness suffices.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCodeQualityActions from "../domains/code-quality.js";

// Local register harness mirroring runMacro's canonical (ctx, input) call.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "code-quality", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`code-quality.${name} not registered`);
  return fn(ctx, input);
}

// code-quality.js keeps the legacy registerLensAction(ctx, artifact, params)
// signature; it is bridged into MACROS by domains/detectors.js's
// `codeQualityAdapter`. Mirror that exact adapter here so the test exercises the
// REAL registration path (NOT a plain canonical register, which would call the
// 3-arg handlers with the wrong shape).
const codeQualityAdapter = (domain, action, handler) =>
  register(domain, action, (ctx, input = {}) => handler(ctx, { data: input }, input));

before(() => { registerCodeQualityActions(codeQualityAdapter); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// A deliberately smelly source file with KNOWN, countable defects:
//  - var declaration              (1)
//  - 5-deep nesting               (deep-nesting high)
//  - 6 params                     (many-params)
//  - console.log debug statement  (1)
//  - empty catch                  (1 high)
//  - loose equality (==)          (1)
const SMELLY = `function processOrder(order, user, db, cfg, logger, retries) {
  var total = 0;
  if (order == null) {
    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].price > 0) {
        if (order.items[i].qty > 0) {
          if (order.items[i].taxable) {
            total += order.items[i].price * order.items[i].qty * 1.0825;
          }
        }
      }
    }
  }
  console.log('order total', total);
  try {
    db.save(order);
  } catch (e) {}
  return total;
}`;

const CLEAN = `const add = (a, b) => a + b;\nconst sub = (a, b) => a - b;\n`;

describe("code-quality — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "analyze", "annotate", "trend", "debt", "hotspots",
      "getGate", "setGate", "evaluateGate", "decoratePR",
      "trackIssue", "updateIssue", "listIssues",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing code-quality.${m}`);
    }
  });
});

describe("code-quality — analyze computes real findings + metrics", () => {
  it("flags the known smells and grades the file", () => {
    const r = call("analyze", ctxA, { files: [{ path: "order.js", content: SMELLY }] });
    assert.equal(r.ok, true);
    const scan = r.result;
    assert.equal(scan.fileCount, 1);
    assert.ok(scan.scanId.startsWith("scan_"));

    const rules = new Set(scan.files[0].findings.map((f) => f.rule));
    // each of these is a genuine static finding over the masked source
    for (const expected of [
      "var-declaration", "many-params", "deep-nesting",
      "debug-statement", "empty-catch", "loose-equality",
    ]) {
      assert.ok(rules.has(expected), `expected a ${expected} finding`);
    }

    // empty-catch is high severity → totals.high >= 1
    assert.ok(scan.totals.high >= 1, "empty catch is high severity");
    assert.ok(scan.totals.total >= 6, "at least 6 distinct smells");

    // metrics are computed, not stubbed
    assert.equal(scan.files[0].functions[0].paramCount, 6);
    assert.ok(scan.metrics.maxComplexity >= 4, "branchy function has complexity");
    assert.ok(scan.metrics.debtMinutes > 0, "tech-debt minutes accrued");
    assert.ok(["A", "B", "C", "D", "F"].includes(scan.grade));
  });

  it("grades a clean file higher than a smelly one", () => {
    const clean = call("analyze", ctxA, { files: [{ path: "ok.js", content: CLEAN }] }).result;
    globalThis._concordSTATE = {};
    const smelly = call("analyze", ctxA, { files: [{ path: "bad.js", content: SMELLY }] }).result;
    assert.ok(
      clean.metrics.maintainability > smelly.metrics.maintainability,
      "clean file has a higher maintainability index",
    );
  });

  it("accepts the legacy { source } shape and rejects empty input", () => {
    const r = call("analyze", ctxA, { source: CLEAN, file: "snippet.js" });
    assert.equal(r.ok, true);
    assert.equal(r.result.files[0].file, "snippet.js");
    assert.equal(call("analyze", ctxA, {}).error, "no_source_provided");
    assert.equal(call("analyze", ctxA, { files: [{ path: "x", content: "" }] }).error, "all_files_empty");
  });
});

describe("code-quality — annotate / debt / hotspots round-trip off the latest scan", () => {
  it("annotates per-line, sums debt by rule, ranks hotspots", () => {
    const scan = call("analyze", ctxA, { files: [{ path: "order.js", content: SMELLY }] }).result;

    // annotate (defaults to most-recent scan)
    const ann = call("annotate", ctxA, {});
    assert.equal(ann.ok, true);
    const annFile = ann.result.files[0];
    assert.equal(annFile.file, "order.js");
    assert.ok(annFile.annotationCount > 0);
    // every annotation carries a worstSeverity and at least one issue
    for (const a of annFile.annotations) {
      assert.ok(a.issues.length >= 1);
      assert.ok(["critical", "high", "medium", "low", "info"].includes(a.worstSeverity));
    }

    // debt: byRule minutes must sum to totalMinutes
    const debt = call("debt", ctxA, {}).result;
    const ruleSum = debt.byRule.reduce((s, x) => s + x.minutes, 0);
    assert.equal(ruleSum, debt.totalMinutes);
    assert.equal(debt.totalHours, Math.round((debt.totalMinutes / 60) * 10) / 10);
    assert.ok(["A", "B", "C", "D", "E"].includes(debt.rating));

    // hotspots: the 5-deep nested branchy function is a function hotspot
    const hot = call("hotspots", ctxA, {}).result;
    assert.equal(hot.scanId, scan.scanId);
    assert.ok(hot.functionHotspots.length >= 1, "the branchy function ranks as a hotspot");
    assert.equal(hot.fileHotspots[0].file, "order.js");
  });

  it("errors cleanly when there are no scans yet", () => {
    assert.equal(call("annotate", ctxA, {}).error, "no_scans_yet");
    assert.equal(call("debt", ctxA, {}).error, "no_scans_yet");
    assert.equal(call("hotspots", ctxA, {}).error, "no_scans_yet");
  });
});

describe("code-quality — trend tracks scan history with a delta", () => {
  it("returns ordered points and the last-pair delta", () => {
    call("analyze", ctxA, { files: [{ path: "a.js", content: SMELLY }] });
    call("analyze", ctxA, { files: [{ path: "b.js", content: CLEAN }] });
    const tr = call("trend", ctxA, {}).result;
    assert.equal(tr.points.length, 2);
    assert.equal(tr.scanCount, 2);
    assert.ok(tr.delta, "a 2-point history yields a delta");
    // CLEAN after SMELLY → total findings should drop
    assert.ok(tr.delta.total <= 0, "second (clean) scan has fewer findings");
  });
});

describe("code-quality — quality gate config + evaluation", () => {
  it("reads defaults, updates thresholds, and evaluates a scan", () => {
    const g0 = call("getGate", ctxA, {}).result;
    assert.equal(g0.gate.maxCritical, 0);
    assert.equal(g0.defaults.minMaintainability, 70);

    // tighten the duplication limit, loosen high-issue tolerance
    const set = call("setGate", ctxA, { maxHigh: 3, maxDuplicationPct: 10, blockOnNewCritical: false });
    assert.equal(set.ok, true);
    assert.equal(set.result.gate.maxHigh, 3);
    assert.equal(set.result.gate.maxDuplicationPct, 10);
    assert.equal(set.result.gate.blockOnNewCritical, false);

    call("analyze", ctxA, { files: [{ path: "order.js", content: SMELLY }] });
    const verdict = call("evaluateGate", ctxA, {}).result;
    assert.ok(["PASS", "FAIL"].includes(verdict.status));
    assert.equal(verdict.passed, verdict.failedCount === 0);
    // checks include the named gate criteria
    const names = new Set(verdict.checks.map((c) => c.name));
    assert.ok(names.has("critical-issues"));
    assert.ok(names.has("maintainability"));
  });

  it("evaluateGate errors with no scans", () => {
    assert.equal(call("evaluateGate", ctxA, {}).error, "no_scans_yet");
  });
});

describe("code-quality — PR decoration diffs base vs head", () => {
  it("counts new issues introduced by a change and renders a verdict", () => {
    const r = call("decoratePR", ctxA, {
      base: [{ path: "m.js", content: CLEAN }],
      head: [{ path: "m.js", content: SMELLY }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.summary.newIssues > 0, "adding smells introduces new issues");
    assert.ok(["BLOCK", "WARN", "COMMENT", "APPROVE"].includes(r.result.verdict));
    // maintainability got worse going clean → smelly
    assert.ok(r.result.files[0].maintainabilityDelta < 0);
  });

  it("APPROVEs an unchanged diff and requires head files", () => {
    const same = call("decoratePR", ctxA, {
      base: [{ path: "m.js", content: CLEAN }],
      head: [{ path: "m.js", content: CLEAN }],
    });
    assert.equal(same.result.summary.newIssues, 0);
    assert.equal(same.result.verdict, "APPROVE");
    assert.equal(call("decoratePR", ctxA, { base: [] }).error, "head_files_required");
  });
});

describe("code-quality — issue workflow round-trip", () => {
  it("tracks, updates, filters, and isolates per user", () => {
    const t = call("trackIssue", ctxA, {
      rule: "empty-catch", severity: "high", message: "swallows errors",
      file: "order.js", line: 17,
    });
    assert.equal(t.ok, true);
    const id = t.result.issue.id;
    assert.equal(t.result.issue.status, "open");
    assert.equal(t.result.issue.line, 17);

    // update: assign + resolve
    const u = call("updateIssue", ctxA, { id, status: "resolved", assignee: "dev1" });
    assert.equal(u.ok, true);
    assert.equal(u.result.issue.status, "resolved");
    assert.equal(u.result.issue.assignee, "dev1");
    assert.ok(u.result.issue.history.length >= 2);

    // invalid status fails closed
    assert.match(call("updateIssue", ctxA, { id, status: "bogus" }).error, /invalid_status/);
    assert.equal(call("updateIssue", ctxA, { id: "nope" }).error, "issue_not_found");

    // list with status filter
    const l = call("listIssues", ctxA, { status: "resolved" });
    assert.equal(l.result.shown, 1);
    assert.equal(l.result.total, 1);
    assert.equal(l.result.byStatus.resolved, 1);

    // per-user isolation
    assert.equal(call("listIssues", ctxB, {}).result.total, 0);

    // missing required fields
    assert.equal(call("trackIssue", ctxA, {}).error, "rule_and_message_required");
  });
});

describe("code-quality — fail-CLOSED numeric guards (assassin V2)", () => {
  it("rejects poisoned trend.limit instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = call("trend", ctxA, { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_limit");
    }
  });

  it("rejects poisoned setGate thresholds instead of silently ignoring them", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = call("setGate", ctxA, { maxCritical: bad });
      assert.equal(r.ok, false, `maxCritical=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_maxCritical");
    }
    // a valid value still applies
    const ok = call("setGate", ctxA, { minMaintainability: 80 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.gate.minMaintainability, 80);
  });

  it("rejects a poisoned trackIssue.line", () => {
    const r = call("trackIssue", ctxA, { rule: "x", message: "y", line: Infinity });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_line");
  });
});
