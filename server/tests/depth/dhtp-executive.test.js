// server/tests/depth/dhtp-executive.test.js
//
// DHTP-2 executive cognitive transport — IR, compiler, bidirectional deltas.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upDhtp } from "../../migrations/435_dhtp_metrics.js";
import { up as upCognitive } from "../../migrations/436_dhtp_cognitive.js";
import { up as upSavings } from "../../migrations/437_cognitive_savings_ledger.js";
import {
  buildCognitiveIR,
  serializeCognitivePacket,
  parseCognitiveDelta,
  validateCognitiveDelta,
  COGNITIVE_IR_FIELDS,
} from "../../lib/dhtp-cognitive-ir.js";
import { compileExecutiveCognition, processCognitiveResponse } from "../../lib/runtime/dhtp-compiler.js";
import { assembleExecutiveContext } from "../../lib/runtime/context-assembler.js";
import { dhtpMetricsSummary } from "../../lib/runtime/dhtp-metrics.js";
import { minimumRepresentationForTask, buildCompressionPolicy } from "../../lib/runtime/dhtp-policy.js";
import {
  recordFieldOutcomes, learnDhtpPolicies, getLearnedPolicies, runDhtpPolicyLearningCycle,
} from "../../lib/runtime/dhtp-policy-learner.js";
import {
  fingerprintCognition, lookupCognitiveCache, storeCognitiveSolution, cognitiveCacheStats, tryCognitiveCache,
} from "../../lib/runtime/cognitive-cache.js";
import { executeCognitiveDelta } from "../../lib/runtime/cognitive-delta-runtime.js";

function setupDb() {
  const db = new Database(":memory:");
  upMission(db);
  upPhases(db);
  upTier(db);
  upDila(db);
  upV2(db);
  upExec(db);
  upDhtp(db);
  upCognitive(db);
  upSavings(db);
  return db;
}

describe("DHTP-2 cognitive IR", () => {
  it("defines canonical executive fields", () => {
    assert.ok(COGNITIVE_IR_FIELDS.includes("MISSION"));
    assert.ok(COGNITIVE_IR_FIELDS.includes("REQUEST"));
    assert.ok(COGNITIVE_IR_FIELDS.includes("FAILURE_HISTORY"));
  });

  it("buildCognitiveIR maps mission state to typed fields", () => {
    const ir = buildCognitiveIR({
      mission: { id: "mis_1", goal: "fix auth", status: "running", template: "coding_loop" },
      step: { tool: "pce_execute" },
      stepIndex: 1,
      route: { taskClass: "coding", workerId: "wr-groq" },
      constraints: ["f0_required"],
    });
    assert.equal(ir.MISSION, "mis_1");
    assert.equal(ir.OBJECTIVE, "fix auth");
    assert.ok(ir.STATE.includes("pce_execute"));
    assert.ok(ir.CONSTRAINTS.includes("f0_required"));
  });

  it("serializeCognitivePacket compresses vs full context", () => {
    const ir = buildCognitiveIR({
      mission: { id: "m", goal: "a".repeat(200), status: "running" },
      step: { tool: "sentinel_sweep" },
      stepIndex: 0,
      route: { taskClass: "reasoning" },
    });
    const s = serializeCognitivePacket(ir);
    assert.ok(s.packet.includes("@DHTP2 executive"));
    assert.ok(s.packet.includes("@OBJECTIVE"));
    assert.ok(s.compressionRatio >= 0);
  });
});

describe("DHTP bidirectional deltas", () => {
  it("parseCognitiveDelta extracts structured proposal", () => {
    const text = `@ACTION patch_file
@RATIONALE_REF ledger:verified
@CONFIDENCE 0.85
@EXPECTED_RESULT tests_pass`;
    const p = parseCognitiveDelta(text);
    assert.equal(p.ok, true);
    assert.equal(p.delta.ACTION, "patch_file");
    assert.equal(p.delta.CONFIDENCE, 0.85);
  });

  it("validateCognitiveDelta blocks mutations without F0", () => {
    const v = validateCognitiveDelta({
      ACTION: "deploy_production",
      RATIONALE_REF: "ledger:attempted",
      CONFIDENCE: 0.9,
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "f0_authority_required");
  });

  it("processCognitiveResponse validates end-to-end", () => {
    const r = processCognitiveResponse(`@ACTION analyze\n@RATIONALE_REF trace:1\n@CONFIDENCE 0.7`);
    assert.equal(r.ok, true);
    assert.equal(r.validation.ok, true);
  });
});

describe("DHTP executive compiler", () => {
  it("compileExecutiveCognition produces compact packet", async () => {
    const db = setupDb();
    const compiled = await compileExecutiveCognition({
      db,
      mission: { id: "mis_x", goal: "verify fleet health", status: "running", template: "fleet_health" },
      step: { tool: "sentinel_sweep" },
      stepIndex: 0,
      route: { taskClass: "classification", workerId: "wr-groq" },
      bumpRecall: false,
    });
    assert.equal(compiled.ok, true);
    assert.ok(compiled.cognitivePacket.includes("@DHTP2"));
    assert.ok(compiled.systemPrompt.length > 0);
    assert.ok(compiled.routeHints.minimumRepresentation);
  });

  it("assembleExecutiveContext attaches cognition layer", async () => {
    const db = setupDb();
    const ctx = await assembleExecutiveContext({
      db,
      mission: { id: "mis_y", goal: "run excellence cycle", status: "running", total_steps: 3 },
      step: { tool: "pce_excellence_run" },
      stepIndex: 0,
      route: { taskClass: "coding" },
      ledger: {},
    });
    assert.equal(ctx.ok, true);
    assert.ok(ctx.cognition?.cognitivePacket);
    assert.ok(ctx.compiledPrompt);
  });

  it("records dhtp metrics when migration present", async () => {
    const db = setupDb();
    await compileExecutiveCognition({
      db,
      mission: { id: "mis_z", goal: "metrics test" },
      step: { tool: "test" },
      stepIndex: 0,
      route: { taskClass: "reasoning" },
      bumpRecall: false,
    });
    const summary = dhtpMetricsSummary(db);
    assert.equal(summary.ok, true);
    assert.ok(summary.total >= 1);
  });
});

describe("DHTP-aware model routing", () => {
  it("minimumRepresentationForTask prefers zero LLM for PCE", () => {
    const r = minimumRepresentationForTask({ taskClass: "coding", deterministicEligible: true });
    assert.equal(r.path, "pce_deterministic");
    assert.equal(r.llmTokens, 0);
  });

  it("minimumRepresentationForTask scales with task class", () => {
    const cheap = minimumRepresentationForTask({ taskClass: "cheap" });
    const reason = minimumRepresentationForTask({ taskClass: "reasoning" });
    assert.equal(cheap.level, "hash");
    assert.equal(reason.level, "verbatim");
  });
});

describe("DHTP policy learning", () => {
  it("learns safer compression from field outcomes", () => {
    const db = setupDb();
    const policy = {
      EVIDENCE: { compressionLevel: "hash", importance: 0.4 },
      STATE: { compressionLevel: "compact", importance: 0.6 },
    };
    for (let i = 0; i < 6; i += 1) {
      recordFieldOutcomes(db, {
        missionId: "mis_learn",
        stepIndex: 0,
        taskClass: "coding",
        policy,
        taskSuccess: i < 5,
        recoveryRequired: i >= 5,
      });
    }
    const learned = learnDhtpPolicies(db, { sinceDays: 1 });
    assert.equal(learned.ok, true);
    assert.ok(learned.analyzed >= 1);
    const policies = getLearnedPolicies(db, "coding");
    assert.ok(policies.EVIDENCE || policies.STATE);
  });

  it("buildCompressionPolicy applies learned overrides", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO dhtp_learned_policies (field, task_class, compression_level, success_rate, sample_count, confidence)
      VALUES ('EVIDENCE', 'coding', 'verbatim', 0.95, 20, 0.9)
    `).run();
    const ir = buildCognitiveIR({
      mission: { id: "m", goal: "patch auth", status: "running" },
      step: { tool: "pce_execute" },
      stepIndex: 0,
      route: { taskClass: "coding" },
    });
    const policy = buildCompressionPolicy(ir, { db, taskClass: "coding" });
    assert.equal(policy.EVIDENCE.compressionLevel, "verbatim");
    assert.ok(policy.EVIDENCE.learned);
  });

  it("runDhtpPolicyLearningCycle returns active policies", () => {
    const db = setupDb();
    const cycle = runDhtpPolicyLearningCycle(db);
    assert.equal(cycle.cycle, "dhtp_policy_learning");
    assert.ok(Array.isArray(cycle.activePolicies));
  });
});

describe("Cognitive solution cache", () => {
  it("fingerprints missions deterministically", () => {
    const fp1 = fingerprintCognition({
      mission: { template: "coding_loop", goal: "fix auth" },
      step: { tool: "pce_execute" },
    });
    const fp2 = fingerprintCognition({
      mission: { template: "coding_loop", goal: "fix auth" },
      step: { tool: "pce_execute" },
    });
    assert.equal(fp1, fp2);
    assert.equal(fp1.length, 24);
  });

  it("reuses verified solutions with zero reasoning cost", () => {
    const db = setupDb();
    const mission = { template: "fleet_health", goal: "verify health", id: "mis_cache" };
    const step = { tool: "sentinel_sweep" };
    const ir = buildCognitiveIR({ mission, step, stepIndex: 0, route: { taskClass: "classification" } });
    const fingerprint = fingerprintCognition({ mission, step, ir });
    const delta = { ACTION: "analyze", RATIONALE_REF: "ledger:verified", CONFIDENCE: 0.9 };

    storeCognitiveSolution(db, {
      fingerprint, mission, step, solution: { mode: "observe" }, delta, verified: true,
    });
    db.prepare(`UPDATE cognitive_solution_cache SET use_count = 3, success_count = 3 WHERE fingerprint_hash = ?`)
      .run(fingerprint);

    const hit = lookupCognitiveCache(db, fingerprint, { minSuccessRate: 0.85 });
    assert.equal(hit.hit, true);
    assert.equal(hit.reasoningCost, "zero");

    const cacheTry = tryCognitiveCache(db, { mission, step, ir });
    assert.equal(cacheTry.cacheHit, true);
    assert.equal(cacheTry.reasoningCost, "zero");

    const stats = cognitiveCacheStats(db);
    assert.equal(stats.ok, true);
    assert.ok(stats.total >= 1);
  });

  it("compileExecutiveCognition skips LLM on cache hit", async () => {
    const db = setupDb();
    const mission = { id: "mis_skip", template: "watch_detect", goal: "sweep alerts", status: "running" };
    const step = { tool: "sentinel_sweep" };
    const ir = buildCognitiveIR({ mission, step, stepIndex: 0, route: { taskClass: "classification" } });
    const fingerprint = fingerprintCognition({ mission, step, ir });
    storeCognitiveSolution(db, {
      fingerprint, mission, step,
      solution: { dispatch: { kind: "observe" } },
      delta: { ACTION: "analyze", CONFIDENCE: 0.9 },
      verified: true,
    });
    db.prepare(`UPDATE cognitive_solution_cache SET use_count = 5, success_count = 5 WHERE fingerprint_hash = ?`)
      .run(fingerprint);

    const compiled = await compileExecutiveCognition({
      db, mission, step, stepIndex: 0,
      route: { taskClass: "classification" },
      bumpRecall: false,
    });
    assert.equal(compiled.skipLlm, true);
    assert.equal(compiled.reasoningCost, "zero");
    assert.ok(compiled.reuseDelta);
  });
});

describe("Cognitive delta execution path", () => {
  it("executes validate → critic → commit for read-only delta", async () => {
    const db = setupDb();
    const result = await executeCognitiveDelta({
      db,
      text: "@ACTION analyze\n@RATIONALE_REF trace:1\n@CONFIDENCE 0.8",
      mission: { id: "mis_delta", goal: "observe fleet", source: "operator" },
      step: { tool: "cognitive_delta_execute" },
      stepIndex: 0,
      route: { taskClass: "classification" },
      gateCtx: { actor: { role: "admin" } },
    });
    assert.equal(result.ok, true);
    assert.equal(result.stage, "committed");
    assert.equal(result.delta.ACTION, "analyze");
    assert.equal(result.principle, "model_proposes_concord_commits");
  });

  it("rejects mutations without F0 authority", async () => {
    const db = setupDb();
    const result = await executeCognitiveDelta({
      db,
      text: "@ACTION deploy_production\n@RATIONALE_REF guess\n@CONFIDENCE 0.99",
      mission: { id: "mis_bad", goal: "deploy" },
      step: { tool: "cognitive_delta_execute" },
      gateCtx: { actor: { role: "member" } },
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "validate");
  });
});
