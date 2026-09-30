// server/lib/runtime/counterfactual-context.js
//
// Counterfactual context testing — FULL vs COMPRESSED before rule promotion.
// Reject compression that saves tokens but drops quality beyond threshold.

import { buildCognitiveIR } from "../dhtp-cognitive-ir.js";
import { buildCompressionPolicy } from "./dhtp-policy.js";
import {
  compileCognitivePacket,
  REPRESENTATION_TIERS,
  scoreContextROI,
} from "./dhtp-cognitive-compiler.js";

const DEFAULT_QUALITY_TOLERANCE = Number(process.env.DHTP_CF_QUALITY_TOLERANCE ?? 0.005);
const DEFAULT_MIN_TOKEN_SAVINGS = Number(process.env.DHTP_CF_MIN_TOKEN_SAVINGS ?? 0.10);

/**
 * Score IR completeness as quality proxy (0–1).
 */
export function scoreIrCompleteness(packet, ir) {
  if (!packet || !ir) return 0;
  let present = 0;
  let total = 0;
  for (const field of Object.keys(ir)) {
    if (ir[field] == null || ir[field] === "") continue;
    total += 1;
    if (packet.includes(`@${field}`)) present += 1;
  }
  return total > 0 ? present / total : 0;
}

/**
 * Score safety — forbidden content must not appear in compressed packet.
 */
export function scoreForbiddenSuppression(fullPacket, compressedPacket) {
  const forbiddenInCompressed = /api[_-]?key|password|bearer\s+sk-/i.test(compressedPacket || "");
  const forbiddenInFull = /api[_-]?key|password|bearer\s+sk-/i.test(fullPacket || "");
  if (forbiddenInCompressed) return 0;
  if (forbiddenInFull && !forbiddenInCompressed) return 1;
  return 1;
}

/**
 * Run counterfactual test: FULL context vs COMPRESSED context for same IR.
 */
export function runCounterfactualContextTest({
  ir,
  policy,
  qualityTolerance = DEFAULT_QUALITY_TOLERANCE,
  minTokenSavings = DEFAULT_MIN_TOKEN_SAVINGS,
} = {}) {
  if (!ir) return { ok: false, reason: "no_ir" };

  const policyFn = (field, value) => {
    const p = policy?.[field];
    if (p) return p;
    return { compressionLevel: "compact", decisionImpact: 0.5, importance: 0.5, freshness: 0.5 };
  };

  const full = compileCognitivePacket(ir, {
    policyFn,
    forceTier: REPRESENTATION_TIERS.FULL,
  });

  const compressed = compileCognitivePacket(ir, { policyFn });

  const qualityFull = (
    scoreIrCompleteness(full.packet, ir) * 0.6
    + scoreForbiddenSuppression(full.packet, full.packet) * 0.4
  );
  const qualityCompressed = (
    scoreIrCompleteness(compressed.packet, ir) * 0.6
    + scoreForbiddenSuppression(full.packet, compressed.packet) * 0.4
  );

  const qualityDelta = qualityCompressed - qualityFull;
  const tokenSavingsPct = full.packetTokens > 0
    ? ((full.packetTokens - compressed.packetTokens) / full.packetTokens) * 100
    : 0;

  const promoted = qualityDelta >= -qualityTolerance && tokenSavingsPct >= minTokenSavings * 100;
  const rejected = !promoted;

  let reason;
  if (qualityDelta < -qualityTolerance) {
    reason = `quality_regression_${(Math.abs(qualityDelta) * 100).toFixed(1)}pp`;
  } else if (tokenSavingsPct < minTokenSavings * 100) {
    reason = `insufficient_token_savings_${tokenSavingsPct.toFixed(1)}pct`;
  } else {
    reason = "promoted";
  }

  return {
    ok: true,
    full: {
      tokens: full.packetTokens,
      quality: qualityFull,
      tierCounts: full.tierCounts,
    },
    compressed: {
      tokens: compressed.packetTokens,
      quality: qualityCompressed,
      tierCounts: compressed.tierCounts,
      forbiddenSuppressed: compressed.forbiddenCount,
    },
    qualityDelta,
    tokenSavingsPct,
    promoted,
    rejected,
    reason,
    qualityTolerance,
    minTokenSavingsPct: minTokenSavings * 100,
  };
}

/**
 * Test all IR fields' compression policies counterfactually.
 */
export function runCounterfactualPolicyBattery({
  mission,
  step,
  stepIndex,
  route,
  ledger,
  lessons,
  recallPack,
  context,
  db,
} = {}) {
  const ir = buildCognitiveIR({
    mission,
    step,
    stepIndex,
    route,
    ledger,
    lessons,
    recallPack,
    observation: context?.observation,
    priorSteps: context?.priorSteps,
  });

  const policy = buildCompressionPolicy(ir, {
    stepIndex,
    missionAge: mission?.tick_count || 0,
    db,
    taskClass: route?.taskClass,
  });

  const overall = runCounterfactualContextTest({ ir, policy });
  const perField = [];

  for (const [field, fieldPolicy] of Object.entries(policy)) {
    const singleIr = { ...ir, [field]: ir[field] };
    for (const k of Object.keys(singleIr)) {
      if (k !== field) singleIr[k] = k === "MISSION" || k === "OBJECTIVE" ? ir[k] : "";
    }
    const fieldPolicyMap = { [field]: fieldPolicy };
    const test = runCounterfactualContextTest({ ir: singleIr, policy: fieldPolicyMap });
    perField.push({
      field,
      compressionLevel: fieldPolicy.compressionLevel,
      promoted: test.promoted,
      reason: test.reason,
      tokenSavingsPct: test.tokenSavingsPct,
      qualityDelta: test.qualityDelta,
    });
  }

  const promoted = perField.filter((f) => f.promoted).length;
  const rejected = perField.filter((f) => !f.promoted).length;

  return {
    ok: overall.promoted,
    overall,
    perField,
    summary: {
      fields: perField.length,
      promoted,
      rejected,
      promotionRate: perField.length ? promoted / perField.length : 0,
    },
  };
}

/**
 * Persist counterfactual test result.
 */
export function persistCounterfactualTest(db, {
  ruleId,
  field,
  taskClass,
  result,
} = {}) {
  if (!db || !result?.ok) return { ok: false };

  try {
    db.prepare(`
      INSERT INTO dhtp_counterfactual_tests (
        rule_id, field, task_class,
        full_tokens, compressed_tokens,
        quality_full, quality_compressed, quality_delta,
        token_savings_pct, promoted, rejected, reason, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId || `cf_${field || "overall"}`,
      field || null,
      taskClass || null,
      result.full?.tokens ?? null,
      result.compressed?.tokens ?? null,
      result.full?.quality ?? null,
      result.compressed?.quality ?? null,
      result.qualityDelta ?? null,
      result.tokenSavingsPct ?? null,
      result.promoted ? 1 : 0,
      result.rejected ? 1 : 0,
      result.reason,
      JSON.stringify({ tierCounts: result.compressed?.tierCounts }),
    );
    return { ok: true, promoted: result.promoted };
  } catch {
    return { ok: false, reason: "persist_failed" };
  }
}
