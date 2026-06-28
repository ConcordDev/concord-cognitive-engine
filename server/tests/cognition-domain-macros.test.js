// Behavioral macro tests for server/domains/cognition.js — the cognition
// lens's parity macros (mode recommend/compare + reasoning-trace export ledger
// + drift-alert feed).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a LOCAL register harness (NO server boot, NO network, NO LLM). These
// are NOT shape-only assertions: every test asserts ACTUAL computed values +
// multi-step round-trips (export → list → get → delete), per-user isolation,
// the rule-based mode classifier's surface-feature outputs, the
// compareModes/driftAlerts validation gates, and the fail-CLOSED numeric guards
// the macro-assassin's V2 vector probes.
//
// The HLR engine + drift-monitor are real in-process modules; compareModes /
// driftAlerts are exercised here only through their pre-engine validation gates
// (empty/invalid input) so the test stays hermetic and fast (<10s). The happy
// paths of those two are covered front-to-back by the macro-assassin + the
// inline hlr.*/drift macros, not duplicated here.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCognitionMacros from "../domains/cognition.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "cognition", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`cognition.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerCognitionMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const MODES = [
  "deductive", "inductive", "abductive", "adversarial",
  "analogical", "temporal", "counterfactual",
];

describe("cognition — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "compareModes", "recommendMode", "exportTrace",
      "listExports", "getExport", "deleteExport", "driftAlerts",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing cognition.${m}`);
    }
  });
});

describe("cognition.recommendMode — rule-based mode classifier (real surface features)", () => {
  it("picks counterfactual for a 'what if' question", () => {
    const r = call("recommendMode", ctxA, { question: "What if the premise were false?" });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "counterfactual");
    // the 7-way ranking is always returned and sums every mode exactly once
    assert.equal(r.result.ranking.length, 7);
    assert.deepEqual(new Set(r.result.ranking.map((x) => x.mode)), new Set(MODES));
    assert.ok(r.result.confidence >= 0 && r.result.confidence <= 1);
    // a 'what if' must NOT spuriously fire the bare-'if' deductive signal
    assert.notEqual(r.result.recommended, "deductive");
  });

  it("picks abductive for a 'why' / explanation question", () => {
    const r = call("recommendMode", ctxA, { question: "Why did the market crash?" });
    assert.equal(r.result.recommended, "abductive");
    assert.ok(r.result.rationale.length >= 1, "abductive rationale is surfaced");
  });

  it("picks temporal for a change-over-time question", () => {
    const r = call("recommendMode", ctxA, { question: "How will this trend evolve over time?" });
    assert.equal(r.result.recommended, "temporal");
  });

  it("picks adversarial for a stress-test question", () => {
    const r = call("recommendMode", ctxA, { question: "Is it true that this claim has a flaw?" });
    assert.equal(r.result.recommended, "adversarial");
  });

  it("falls back to deductive with no surface signal", () => {
    const r = call("recommendMode", ctxA, { question: "Concord" });
    assert.equal(r.ok, true);
    assert.equal(r.result.recommended, "deductive");
  });

  it("rejects an empty question", () => {
    assert.equal(call("recommendMode", ctxA, {}).error, "question_required");
  });
});

describe("cognition.compareModes — validation gates (hermetic, pre-engine)", () => {
  it("requires a claim or question", async () => {
    const r = await call("compareModes", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "claim_or_question_required");
  });

  it("rejects identical modes", async () => {
    const r = await call("compareModes", ctxA, { claim: "X is Y", modeA: "deductive", modeB: "deductive" });
    assert.equal(r.error, "modes_must_differ");
  });

  it("rejects an unknown mode", async () => {
    const r = await call("compareModes", ctxA, { claim: "X is Y", modeA: "deductive", modeB: "zzz" });
    assert.equal(r.error, "invalid_mode");
    assert.deepEqual(r.allowed, MODES);
  });

  it("fail-CLOSES on a poisoned depth (assassin V2) BEFORE touching the engine", async () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = await call("compareModes", ctxA, { claim: "X is Y", modeA: "deductive", modeB: "adversarial", depth: bad });
      assert.equal(r.ok, false, `depth=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_depth");
    }
  });
});

describe("cognition trace-export ledger — export → list → get → delete round-trip", () => {
  it("persists a trace, lists metadata, fetches the full trace, then deletes it", () => {
    const trace = { traceId: "t_123", mode: "deductive", input: { question: "Q?" }, chains: [{ step: 1 }] };

    // export
    const exp = call("exportTrace", ctxA, { trace, title: "My deduction", note: "keep" });
    assert.equal(exp.ok, true);
    assert.equal(exp.result.total, 1);
    const exportId = exp.result.exportId;
    assert.ok(exportId, "an exportId is returned");
    // the heavy trace body is stripped from the export metadata
    assert.equal(exp.result.export.trace, undefined);
    assert.equal(exp.result.export.title, "My deduction");
    assert.equal(exp.result.export.mode, "deductive");
    assert.equal(exp.result.export.traceId, "t_123");

    // list — metadata only, no trace body
    const listed = call("listExports", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.exports.length, 1);
    assert.equal(listed.result.exports[0].id, exportId);
    assert.equal(listed.result.exports[0].trace, undefined);

    // get — full trace round-trips
    const got = call("getExport", ctxA, { exportId });
    assert.equal(got.ok, true);
    assert.equal(got.result.export.id, exportId);
    assert.deepEqual(got.result.export.trace.chains, [{ step: 1 }]);

    // delete — count drops to 0, id echoed
    const del = call("deleteExport", ctxA, { exportId });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, exportId);
    assert.equal(del.result.count, 0);

    // deleting again is not_found; list is empty
    assert.equal(call("deleteExport", ctxA, { exportId }).error, "export_not_found");
    assert.equal(call("listExports", ctxA, {}).result.count, 0);
  });

  it("derives a title from the trace when none is given", () => {
    const exp = call("exportTrace", ctxA, { trace: { input: { topic: "Lattice drift" } } });
    assert.equal(exp.result.export.title, "Lattice drift");
  });

  it("rejects an export with no trace", () => {
    assert.equal(call("exportTrace", ctxA, {}).error, "trace_required");
    assert.equal(call("getExport", ctxA, {}).error, "export_not_found");
    assert.equal(call("deleteExport", ctxA, {}).error, "export_not_found");
  });
});

describe("cognition — per-user isolation", () => {
  it("never leaks one user's exports to another", () => {
    call("exportTrace", ctxA, { trace: { traceId: "a1" }, title: "A only" });
    assert.equal(call("listExports", ctxA, {}).result.count, 1);
    assert.equal(call("listExports", ctxB, {}).result.count, 0);
    // user B cannot fetch user A's export by id
    const aId = call("listExports", ctxA, {}).result.exports[0].id;
    assert.equal(call("getExport", ctxB, { exportId: aId }).error, "export_not_found");
  });
});

describe("cognition.driftAlerts — numeric guard + STATE gate (hermetic)", () => {
  it("fail-CLOSES on a poisoned limit (assassin V2)", async () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = await call("driftAlerts", ctxA, { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.error, "invalid_limit");
    }
  });

  it("returns a real {ok:false} when no STATE/engine is present (never fabricated success)", async () => {
    globalThis._concordSTATE = undefined;
    const r = await call("driftAlerts", ctxA, {});
    assert.equal(r.ok, false);
    assert.ok(["STATE unavailable", "drift_monitor_unavailable", "drift_scan_failed"].includes(r.error), `unexpected error: ${r.error}`);
  });

  it("with a live STATE drift store, returns an ordered severity-tallied feed", async () => {
    // Build a minimal STATE the real drift-monitor recognises: a drift store
    // with two alerts. The macro reads it through getDriftAlerts (pure,
    // in-process). This exercises the ordering + per-severity tally + shape.
    // Seed the live drift store the real drift-monitor reads through
    // getDriftStore(STATE) → getEmergentState(STATE)._driftMonitor.
    globalThis._concordSTATE = {
      __emergent: {
        _driftMonitor: {
          snapshots: [],
          alerts: [
            { id: "d1", type: "goodhart", severity: "warning", timestamp: "2026-06-01T00:00:00.000Z" },
            { id: "d2", type: "echo_chamber", severity: "critical", timestamp: "2026-06-02T00:00:00.000Z" },
          ],
          thresholds: {},
        },
      },
    };
    const r = await call("driftAlerts", ctxA, { limit: 50 });
    assert.equal(r.ok, true);
    assert.equal(Array.isArray(r.result.alerts), true);
    assert.equal(r.result.total, 2);
    // most-recent-first ordering
    assert.equal(r.result.alerts[0].id, "d2");
    assert.equal(r.result.alerts[1].id, "d1");
    // per-severity tally is real
    assert.equal(r.result.bySeverity.warning, 1);
    assert.equal(r.result.bySeverity.critical, 1);
    assert.deepEqual(r.result.severities, ["info", "warning", "alert", "critical"]);
  });

  it("applies the severity filter", async () => {
    // Seed the live drift store the real drift-monitor reads through
    // getDriftStore(STATE) → getEmergentState(STATE)._driftMonitor.
    globalThis._concordSTATE = {
      __emergent: {
        _driftMonitor: {
          snapshots: [],
          alerts: [
            { id: "d1", type: "goodhart", severity: "warning", timestamp: "2026-06-01T00:00:00.000Z" },
            { id: "d2", type: "echo_chamber", severity: "critical", timestamp: "2026-06-02T00:00:00.000Z" },
          ],
          thresholds: {},
        },
      },
    };
    const r = await call("driftAlerts", ctxA, { severity: "critical" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.alerts[0].id, "d2");
    assert.equal(r.result.appliedSeverity, "critical");
  });
});
