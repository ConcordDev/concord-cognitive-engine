// server/lib/runtime/capability-memory.js
//
// Capability memory — evolve cache from exact fingerprints to problem families.

import crypto from "node:crypto";

const MIN_GENERALIZATION_SCORE = Number(process.env.CAPABILITY_MIN_GENERALIZATION ?? 0.75);
const MIN_TRANSFER_PROOFS = Number(process.env.CAPABILITY_MIN_TRANSFER_PROOFS ?? 2);

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='capability_families'`).get();
  } catch {
    return false;
  }
}

/**
 * Derive problem family from mission shape (abstracted fingerprint).
 */
export function deriveProblemFamily({ mission, step, goal } = {}) {
  const template = mission?.template || "generic";
  const tool = step?.tool || "unknown";
  const goalNorm = String(goal || mission?.goal || "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9\s#]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)
    .join("_");
  const familyId = `fam_${crypto.createHash("sha256")
    .update(`${template}|${tool}|${goalNorm}`)
    .digest("hex")
    .slice(0, 16)}`;
  return {
    familyId,
    template,
    tool,
    goalSignature: goalNorm,
    abstractPattern: `${template}:${tool}`,
  };
}

/**
 * Evaluate whether a cache entry can promote to a reusable capability.
 */
export function evaluateCapabilityPromotion({
  fingerprint,
  mission,
  step,
  transferProof = {},
} = {}) {
  const family = deriveProblemFamily({ mission, step, goal: mission?.goal });
  const proofs = transferProof.proofs || [];
  const generalizationScore = transferProof.generalizationScore
    ?? (proofs.length >= MIN_TRANSFER_PROOFS ? 0.8 : 0.4);

  const promoted = generalizationScore >= MIN_GENERALIZATION_SCORE
    && (transferProof.semanticTransfer || proofs.some((p) => p.semantic))
    && (transferProof.adversarialPassed !== false);

  return {
    ok: true,
    fingerprint,
    family,
    generalizationScore,
    promoted,
    reason: promoted ? "transfer_proof_sufficient" : "insufficient_generalization",
    preconditions: transferProof.preconditions || [],
    verificationProof: transferProof.verificationProof || null,
    knownFailureModes: transferProof.failureModes || [],
  };
}

/**
 * Persist capability family promotion.
 */
export function promoteCapabilityFamily(db, {
  evaluation,
  solution,
  delta,
  benchmarkResult,
} = {}) {
  if (!db || !tablesReady(db) || !evaluation?.promoted) {
    return { ok: false, reason: evaluation?.promoted === false ? "not_promoted" : "missing_inputs" };
  }

  const now = Math.floor(Date.now() / 1000);
  const fam = evaluation.family;
  try {
    db.prepare(`
      INSERT INTO capability_families
        (family_id, abstract_pattern, template, step_tool, goal_signature,
         fingerprint_hash, solution_json, delta_json, generalization_score,
         verification_json, failure_modes_json, promoted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET
        fingerprint_hash = excluded.fingerprint_hash,
        solution_json = excluded.solution_json,
        delta_json = excluded.delta_json,
        generalization_score = MAX(capability_families.generalization_score, excluded.generalization_score),
        verification_json = excluded.verification_json,
        failure_modes_json = excluded.failure_modes_json,
        promoted_at = excluded.promoted_at
    `).run(
      fam.familyId,
      fam.abstractPattern,
      fam.template,
      fam.tool,
      fam.goalSignature,
      evaluation.fingerprint,
      solution ? JSON.stringify(solution) : null,
      delta ? JSON.stringify(delta) : null,
      evaluation.generalizationScore,
      evaluation.verificationProof ? JSON.stringify(evaluation.verificationProof) : null,
      JSON.stringify(evaluation.knownFailureModes || []),
      now,
    );
    return { ok: true, familyId: fam.familyId, promoted: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Lookup capability by problem family (broader than exact fingerprint).
 */
export function lookupCapabilityFamily(db, { mission, step, goal } = {}) {
  if (!db || !tablesReady(db)) return { ok: false, hit: false };

  const family = deriveProblemFamily({ mission, step, goal });
  const row = db.prepare(`
    SELECT * FROM capability_families
    WHERE family_id = ? OR (template = ? AND step_tool = ?)
    ORDER BY generalization_score DESC LIMIT 1
  `).get(family.familyId, family.template, family.tool);

  if (!row || row.generalization_score < MIN_GENERALIZATION_SCORE) {
    return { ok: true, hit: false, family };
  }

  return {
    ok: true,
    hit: true,
    family,
    capability: {
      familyId: row.family_id,
      generalizationScore: row.generalization_score,
      solution: row.solution_json ? JSON.parse(row.solution_json) : null,
      delta: row.delta_json ? JSON.parse(row.delta_json) : null,
      failureModes: row.failure_modes_json ? JSON.parse(row.failure_modes_json) : [],
    },
    reasoningCost: "zero_family",
  };
}

/**
 * Build transfer proof from DGB-style benchmark results.
 */
export function transferProofFromDgb(dgbResult) {
  if (!dgbResult) return { proofs: [], generalizationScore: 0 };
  const proofs = [];
  if (dgbResult.variantCold?.ok) proofs.push({ type: "semantic", ok: true });
  if (dgbResult.variantWarm?.ok) proofs.push({ type: "compositional", ok: true });
  if (dgbResult.adversarial?.ok !== false) proofs.push({ type: "adversarial", ok: true });
  return {
    proofs,
    semanticTransfer: dgbResult.variantCold?.ok,
    compositionalTransfer: dgbResult.variantWarm?.ok,
    adversarialPassed: dgbResult.adversarial?.ok !== false,
    generalizationScore: proofs.filter((p) => p.ok).length / Math.max(1, proofs.length),
    preconditions: dgbResult.preconditions || [],
    verificationProof: dgbResult.verification || null,
    failureModes: dgbResult.failureModes || [],
  };
}
