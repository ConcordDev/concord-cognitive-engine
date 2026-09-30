// server/tests/depth/cognitive-compiler-v2.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMission } from "../../migrations/423_mission_runtime.js";
import { up as upPhases } from "../../migrations/424_runtime_phases.js";
import { up as upTier } from "../../migrations/425_runtime_tier.js";
import { up as upDila } from "../../migrations/426_dila_runtime_v1.js";
import { up as upV2 } from "../../migrations/427_dila_runtime_v2.js";
import { up as upExec } from "../../migrations/428_dila_executive_closure.js";
import { up as upCausal } from "../../migrations/429_dila_tier2_brain.js";
import { up as upDhtp } from "../../migrations/435_dhtp_metrics.js";
import { up as upCognitive } from "../../migrations/436_dhtp_cognitive.js";
import { up as upSavings } from "../../migrations/437_cognitive_savings_ledger.js";
import { up as upBilling } from "../../migrations/438_provider_billing_telemetry.js";
import { up as upCompilerV2 } from "../../migrations/439_cognitive_compiler_v2.js";
import { buildCognitiveIR } from "../../lib/dhtp-cognitive-ir.js";
import { buildCompressionPolicy } from "../../lib/runtime/dhtp-policy.js";
import {
  buildRecoveryContract,
  attachRecoveryContracts,
  recompileField,
} from "../../lib/runtime/cognitive-recovery.js";
import { anticipateContext, filterRecallByAnticipation } from "../../lib/runtime/predictive-context.js";
import { applyCompressionGovernor } from "../../lib/runtime/compression-governor.js";
import {
  resolveBaseReasoningLevel,
  climbReasoningLadder,
  reasoningLevelToRouteHints,
  REASONING_LEVELS,
} from "../../lib/runtime/reasoning-ladder.js";
import {
  deriveProblemFamily,
  evaluateCapabilityPromotion,
  promoteCapabilityFamily,
} from "../../lib/runtime/capability-memory.js";
import {
  getOperationalSelfModel,
  updateSelfModelFromOutcome,
  selfModelConfidence,
} from "../../lib/runtime/dila-self-model.js";
import {
  compileMinimumSufficientCognition,
  recordCompilerLearning,
} from "../../lib/runtime/cognitive-compiler-v2.js";
import { compileExecutiveCognition } from "../../lib/runtime/dhtp-compiler.js";

function setupDb() {
  const db = new Database(":memory:");
  for (const up of [
    upMission, upPhases, upTier, upDila, upV2, upExec, upCausal,
    upDhtp, upCognitive, upSavings, upBilling, upCompilerV2,
  ]) {
    up(db);
  }
  return db;
}

const SAMPLE_IR = {
  MISSION: "probe",
  OBJECTIVE: "analyze cognitive substrate health",
  REQUEST: "execute",
  CONSTRAINTS: "no unauthorized mutations",
  RELEVANT_MEMORY: [{ id: "dtu_abc123", title: "prior probe" }],
  HYPOTHESES: "cache may reduce tokens",
  UNCERTAINTY: "low",
};

describe("Wave A — recovery contracts", () => {
  it("builds recovery contract with pointer for compressed tiers", () => {
    const contract = buildRecoveryContract("RELEVANT_MEMORY", SAMPLE_IR.RELEVANT_MEMORY, "hash", { importance: 0.4 });
    assert.ok(contract.recovery_pointer);
    assert.ok(contract.hash);
    assert.equal(contract.recoverable, true);
    assert.ok(contract.loss_budget > 0);
  });

  it("recompileField expands one field to FULL progressively", () => {
    const policy = buildCompressionPolicy(SAMPLE_IR, { taskClass: "cognitive_probe" });
    const policyFn = (f, v) => policy[f] || { importance: 0.5 };
    const v2 = compileMinimumSufficientCognition({
      ir: SAMPLE_IR,
      mission: { template: "cognitive_probe", goal: SAMPLE_IR.OBJECTIVE },
      step: { tool: "cognitive_delta_execute" },
      route: { taskClass: "cognitive_probe" },
    });
    const pointer = v2.recoveryContracts.RELEVANT_MEMORY?.recovery_pointer;
    assert.ok(pointer);
    const expanded = recompileField(v2.compiled, pointer, { ir: SAMPLE_IR, policyFn });
    assert.ok(expanded.ok);
    assert.ok(expanded.packet.includes(SAMPLE_IR.RELEVANT_MEMORY[0].id));
    assert.ok(expanded.tokensAdded >= 0);
  });
});

describe("Wave B — predictive context", () => {
  it("anticipates decisions tools and evidence for coding tasks", () => {
    const ant = anticipateContext({
      goal: "fix off-by-one in sum helper and run tests",
      taskClass: "coding",
      step: { tool: "coding_loop_verify" },
    });
    assert.ok(ant.anticipatedTools.includes("coding_loop_verify"));
    assert.ok(ant.evidenceNeeds.includes("test_output"));
    assert.ok(ant.dtuRetrievalHints.maxRecent <= 12);
  });

  it("filters recall pack by anticipation hints", () => {
    const recall = {
      ok: true,
      recent: [
        { id: "1", title: "ledger event", kind: "ledger" },
        { id: "2", title: "unrelated", kind: "other" },
        { id: "3", title: "ledger trace", kind: "ledger" },
      ],
      pinned: [],
    };
    const ant = anticipateContext({ goal: "analyze ledger", taskClass: "cognitive_probe" });
    const filtered = filterRecallByAnticipation(recall, ant);
    assert.ok(filtered.anticipationFiltered);
  });
});

describe("Wave C — compression governor", () => {
  it("runs counterfactual governor and may adjust policy", () => {
    const policy = buildCompressionPolicy(SAMPLE_IR, { taskClass: "cognitive_probe" });
    const gov = applyCompressionGovernor({ ir: SAMPLE_IR, policy, taskClass: "cognitive_probe" });
    assert.ok(gov.ok);
    assert.ok(gov.counterfactual);
    assert.ok(typeof gov.promoted === "boolean");
  });
});

describe("Wave D — reasoning ladder", () => {
  it("starts PCE at level 2 without LLM", () => {
    const ladder = resolveBaseReasoningLevel({
      taskClass: "coding",
      step: { tool: "pce_execute" },
      pceEligible: true,
    });
    assert.equal(ladder.level, 2);
    assert.equal(ladder.llmRequired, false);
  });

  it("escalates on verification failure", () => {
    const next = climbReasoningLadder({
      currentLevel: 4,
      taskSuccess: true,
      verificationPassed: false,
      recoveryAttempts: 1,
    });
    assert.ok(next.escalated);
    assert.ok(next.level > 4);
  });

  it("maps reasoning level to route hints", () => {
    const hints = reasoningLevelToRouteHints({ level: 5, ...REASONING_LEVELS[5] });
    assert.equal(hints.reasoningLevel, 5);
    assert.equal(hints.llmRequired, true);
  });
});

describe("Capability memory", () => {
  it("derives stable problem family from mission shape", () => {
    const fam = deriveProblemFamily({
      mission: { template: "cognitive_probe", goal: "analyze substrate" },
      step: { tool: "cognitive_delta_execute" },
    });
    assert.ok(fam.familyId.startsWith("fam_"));
    assert.equal(fam.template, "cognitive_probe");
  });

  it("promotes capability family with sufficient transfer proof", () => {
    const db = setupDb();
    const evalResult = evaluateCapabilityPromotion({
      fingerprint: "fp_test123",
      mission: { template: "cognitive_probe", goal: "analyze" },
      step: { tool: "cognitive_delta_execute" },
      transferProof: {
        proofs: [{ semantic: true }, { adversarial: true }],
        semanticTransfer: true,
        adversarialPassed: true,
        generalizationScore: 0.85,
      },
    });
    assert.ok(evalResult.promoted);
    const promoted = promoteCapabilityFamily(db, {
      evaluation: evalResult,
      solution: { ok: true },
      delta: { ACTION: "analyze" },
    });
    assert.ok(promoted.ok);
    const row = db.prepare("SELECT * FROM capability_families WHERE family_id = ?")
      .get(evalResult.family.familyId);
    assert.ok(row);
  });
});

describe("Dila operational self-model", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("updates strengths and weaknesses from outcomes", () => {
    updateSelfModelFromOutcome(db, {
      taskClass: "coding",
      taskSuccess: true,
      verificationPassed: true,
    });
    updateSelfModelFromOutcome(db, {
      taskClass: "coding",
      taskSuccess: false,
      verificationPassed: false,
    });
    const model = getOperationalSelfModel(db, "coding");
    assert.ok(model.sampleCount >= 2);
    const conf = selfModelConfidence(db, "coding");
    assert.ok(conf.confidence >= 0 && conf.confidence <= 1);
  });
});

describe("Cognitive Compiler v2 integration", () => {
  it("compileMinimumSufficientCognition returns full v2 envelope", () => {
    const result = compileMinimumSufficientCognition({
      ir: SAMPLE_IR,
      mission: { template: "cognitive_probe", goal: SAMPLE_IR.OBJECTIVE, tick_count: 1 },
      step: { tool: "cognitive_delta_execute" },
      stepIndex: 0,
      route: { taskClass: "cognitive_probe" },
    });
    assert.equal(result.version, "cognitive_compiler_v2");
    assert.ok(result.packet);
    assert.ok(result.anticipation);
    assert.ok(result.reasoningLadder);
    assert.ok(result.optimization);
    assert.ok(result.recoveryContracts);
  });

  it("compileExecutiveCognition uses v2 cognitive compiler metadata", async () => {
    const db = setupDb();
    const compiled = await compileExecutiveCognition({
      db,
      mission: { id: "m1", template: "cognitive_probe", goal: "analyze substrate" },
      step: { tool: "cognitive_delta_execute" },
      stepIndex: 0,
      route: { taskClass: "cognitive_probe" },
      ledger: {},
      lessons: [],
      context: {},
    });
    assert.ok(compiled.ok);
    assert.equal(compiled.cognitiveCompiler?.version, "cognitive_compiler_v2");
    assert.ok(compiled.routeHints?.reasoningLevel != null || compiled.routeHints?.minimumRepresentation);
  });

  it("recordCompilerLearning updates self-model", () => {
    const db = setupDb();
    const result = recordCompilerLearning(db, {
      missionId: "m1",
      stepIndex: 0,
      taskClass: "cognitive_probe",
      policy: buildCompressionPolicy(SAMPLE_IR),
      taskSuccess: true,
      verificationPassed: true,
    });
    assert.ok(result.ok);
    assert.ok(result.selfModel?.ok !== false);
  });
});
