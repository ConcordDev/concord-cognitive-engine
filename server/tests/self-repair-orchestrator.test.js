/**
 * Item 4 contract tests — the self-repair orchestrator wires the Phase-5 decision
 * engine to the REAL Sovereign queue (postAutoProposal). A code-change fault
 * escalates → a council/auto proposal row is written; an operational verified+green
 * fault "applies" (honest no-op); a canary failure rolls back; an unproduced fix
 * escalates. Uses a real in-memory DB so the escalation persistence is genuine.
 *
 * Run: node --test server/tests/self-repair-orchestrator.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { orchestrateRepair, DECISION } from "../lib/self-repair-orchestrator.js";

let db;
beforeEach(() => { db = new Database(":memory:"); delete process.env.CONCORD_AUTO_GOVERNANCE; });
afterEach(() => { db.close(); });

function proposalCount() {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auto_proposals'").get();
  return t ? db.prepare("SELECT COUNT(*) c FROM auto_proposals").get().c : 0;
}

describe("orchestrateRepair → Sovereign queue", () => {
  it("escalates a code-change fix to a real council/auto proposal (never auto-applies)", async () => {
    const applied = [];
    const out = await orchestrateRepair({
      db,
      fault: { message: "TypeError: cannot read 'x' of undefined" },
      generateFix: async () => ({ status: "done", code: "function fixed(){ return 1; }" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 1, errorRate: 0, p95LatencyMs: 100 }),
      apply: async () => { applied.push(1); return { ok: true }; },
    });
    assert.equal(out.decision, DECISION.ESCALATE);
    assert.equal(applied.length, 0, "a code change is NEVER auto-applied");
    assert.equal(proposalCount(), 1, "a Sovereign proposal was persisted");
  });

  it("applies an operational verified + canary-green heal (honest no-op apply)", async () => {
    const out = await orchestrateRepair({
      db,
      fault: { message: "memory pressure" },
      generateFix: async () => ({ status: "done", kind: "gc" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 1, errorRate: 0, p95LatencyMs: 80 }),
    });
    assert.equal(out.decision, DECISION.APPLY);
    assert.equal(proposalCount(), 0, "operational heal does not escalate");
    const applyStep = out.trail.find((t) => t.step === "apply");
    assert.equal(applyStep.result.applied, false, "apply is an honest no-op until reload infra exists");
  });

  it("rolls back when the canary fails the SLO", async () => {
    const out = await orchestrateRepair({
      db,
      fault: { message: "x" },
      generateFix: async () => ({ status: "done", kind: "restart" }),
      verifyFix: async () => ({ passed: true }),
      canaryEval: async () => ({ successRate: 0.4, errorRate: 0.5, p95LatencyMs: 100 }),
      slo: { minSuccessRate: 0.99, maxErrorRate: 0.01 },
    });
    assert.equal(out.decision, DECISION.ROLLBACK);
    assert.equal(proposalCount(), 0);
  });

  it("escalates when the build loop produces no verified fix", async () => {
    const out = await orchestrateRepair({
      db,
      fault: { message: "x" },
      generateFix: async () => ({ status: "unverified" }),
    });
    assert.equal(out.decision, DECISION.ESCALATE);
    assert.equal(proposalCount(), 1);
  });
});
