/**
 * Phase 5 contract tests — the self-repair decision engine.
 *
 * Pins the production-safe policy (research: SLO canary + auto-rollback + human
 * approval for high-stakes): never apply an unverified fix; auto-rollback on a
 * canary SLO violation; code-changing repairs ALWAYS escalate to Sovereign
 * approval even when green; only operational + verified + healthy fixes auto-apply.
 * Every cycle yields an audit trail.
 *
 * Run: node --test server/tests/self-repair-loop.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FIX_CLASS, DECISION, classifyFix, evaluateCanary, decideRepair, runSelfRepair,
} from "../lib/self-repair-loop.js";

describe("classifyFix", () => {
  it("code/source/diff is high-stakes (code_change); state/restart is operational", () => {
    assert.equal(classifyFix({ kind: "code_change" }), FIX_CLASS.CODE_CHANGE);
    assert.equal(classifyFix({ code: "const x = 1;" }), FIX_CLASS.CODE_CHANGE);
    assert.equal(classifyFix({ diff: "@@ -1 +1 @@" }), FIX_CLASS.CODE_CHANGE);
    assert.equal(classifyFix({ kind: "restart" }), FIX_CLASS.OPERATIONAL);
    assert.equal(classifyFix({ kind: "gc" }), FIX_CLASS.OPERATIONAL);
    assert.equal(classifyFix({}), FIX_CLASS.OPERATIONAL);
  });
});

describe("evaluateCanary (SLO — success rate AND latency)", () => {
  it("healthy within thresholds", () => {
    const r = evaluateCanary({ successRate: 0.999, errorRate: 0.001, p95LatencyMs: 120 }, { minSuccessRate: 0.99, maxErrorRate: 0.01, maxP95LatencyMs: 300 });
    assert.equal(r.healthy, true);
    assert.deepEqual(r.violations, []);
  });
  it("catches a latency regression even when success rate is fine (error rate alone would miss it)", () => {
    const r = evaluateCanary({ successRate: 1, errorRate: 0, p95LatencyMs: 800 }, { maxP95LatencyMs: 300 });
    assert.equal(r.healthy, false);
    assert.match(r.violations[0], /p95_latency/);
  });
  it("catches a success-rate / error-rate violation", () => {
    assert.equal(evaluateCanary({ successRate: 0.90 }, { minSuccessRate: 0.99 }).healthy, false);
    assert.equal(evaluateCanary({ errorRate: 0.2 }, { maxErrorRate: 0.01 }).healthy, false);
  });
});

describe("decideRepair (the policy)", () => {
  const okCanary = { healthy: true, violations: [] };
  it("escalates an unverified fix (honesty: never apply unverified)", () => {
    assert.equal(decideRepair({ verify: { passed: false }, canary: okCanary, fixClass: FIX_CLASS.OPERATIONAL }).decision, DECISION.ESCALATE);
  });
  it("rolls back on a canary failure", () => {
    const d = decideRepair({ verify: { passed: true }, canary: { healthy: false, violations: ["p95"] }, fixClass: FIX_CLASS.OPERATIONAL });
    assert.equal(d.decision, DECISION.ROLLBACK);
  });
  it("escalates a code change even when verified + green (Sovereign approval)", () => {
    const d = decideRepair({ verify: { passed: true }, canary: okCanary, fixClass: FIX_CLASS.CODE_CHANGE });
    assert.equal(d.decision, DECISION.ESCALATE);
    assert.match(d.reason, /Sovereign approval/);
  });
  it("auto-applies an operational fix that is verified + healthy", () => {
    assert.equal(decideRepair({ verify: { passed: true }, canary: okCanary, fixClass: FIX_CLASS.OPERATIONAL }).decision, DECISION.APPLY);
  });
});

describe("runSelfRepair orchestration", () => {
  const calls = () => { const c = { apply: 0, rollback: 0, escalate: 0 }; return { c, apply: async () => { c.apply++; return "applied"; }, rollback: async () => { c.rollback++; return "rolled-back"; }, escalate: async () => { c.escalate++; return "queued"; } }; };

  it("operational + verified + healthy → applies (zero-downtime reload)", async () => {
    const e = calls();
    const out = await runSelfRepair({
      fault: { error: "memory leak" },
      generateFix: async () => ({ status: "done", kind: "gc" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 1, errorRate: 0, p95LatencyMs: 100 }),
      ...e,
    });
    assert.equal(out.decision, DECISION.APPLY);
    assert.equal(e.c.apply, 1);
    assert.equal(e.c.escalate, 0);
    assert.ok(out.trail.find((t) => t.step === "apply"));
  });

  it("code change → escalates to Sovereign, never auto-applies", async () => {
    const e = calls();
    const out = await runSelfRepair({
      fault: { error: "logic bug" },
      generateFix: async () => ({ status: "done", code: "function fixed() {}" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 1, errorRate: 0, p95LatencyMs: 100 }),
      ...e,
    });
    assert.equal(out.decision, DECISION.ESCALATE);
    assert.equal(out.fixClass, FIX_CLASS.CODE_CHANGE);
    assert.equal(e.c.apply, 0);
    assert.equal(e.c.escalate, 1);
  });

  it("canary failure → rolls back", async () => {
    const e = calls();
    const out = await runSelfRepair({
      fault: { error: "x" },
      generateFix: async () => ({ status: "done", kind: "restart" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 0.5, errorRate: 0.4, p95LatencyMs: 100 }),
      slo: { minSuccessRate: 0.99, maxErrorRate: 0.01 },
      ...e,
    });
    assert.equal(out.decision, DECISION.ROLLBACK);
    assert.equal(e.c.rollback, 1);
  });

  it("build loop produced no verified fix → escalates (never claims a fix)", async () => {
    const e = calls();
    const out = await runSelfRepair({
      fault: { error: "x" },
      generateFix: async () => ({ status: "unverified" }),
      ...e,
    });
    assert.equal(out.decision, DECISION.ESCALATE);
    assert.equal(e.c.apply, 0);
    assert.equal(e.c.escalate, 1);
  });
});
