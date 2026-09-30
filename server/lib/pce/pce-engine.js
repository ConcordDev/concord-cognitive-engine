// server/lib/pce/pce-engine.js
//
// PCE-1.0 — Program Construction Engine orchestrator.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCodeSpace, codeSpaceSummary } from "./code-space.js";
import { compileIntent, extractTestPattern, GENERATION_MODES } from "./intent-compiler.js";
import { applyTransformPlan, rollbackTransform } from "./transform-primitives.js";
import { runVerificationPipeline } from "./verification-pipeline.js";
import { qualityFromVerification } from "./quality-score.js";
import { recordPatternOutcome } from "./pattern-ir.js";
import { seedConcordCorpus } from "./concord-corpus.js";
import { ipSimilarityGate } from "./ip-similarity.js";

function recordFailure(db, { patternId, context, error, repair }) {
  if (!db) return;
  try {
    const sig = JSON.stringify({ patternId, error: String(error).slice(0, 200) });
    const hash = crypto.createHash("sha256").update(sig).digest("hex").slice(0, 16);
    db.prepare(`
      INSERT INTO pce_failure_signatures (signature_hash, pattern_id, context_json, error_json, repair_json, occurrences, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(signature_hash) DO UPDATE SET
        occurrences = occurrences + 1,
        last_seen_at = excluded.last_seen_at
    `).run(hash, patternId, JSON.stringify(context), JSON.stringify({ error }), JSON.stringify(repair || {}), Math.floor(Date.now() / 1000));
  } catch { /* optional */ }
}

/**
 * Execute a PCE task: intent → compile → transform → verify → memory update.
 */
export async function executePceTask({
  db,
  intent,
  repoRoot,
  missionId = null,
  params = {},
  manualSteps = null,
  targetPolicy = "permissive",
  referenceCorpus = [],
} = {}) {
  const started = Date.now();
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();

  seedConcordCorpus(db);

  const codeSpace = await buildCodeSpace(db, root);
  const plan = manualSteps
    ? { ok: true, mode: GENERATION_MODES.DETERMINISTIC, steps: manualSteps, intent }
    : compileIntent(intent, { db, codeSpace, targetPolicy });

  if (!plan.ok) {
    return { ok: false, reason: plan.reason, plan, codeSpace: codeSpaceSummary(codeSpace) };
  }

  if (plan.requiresLlm || plan.mode === GENERATION_MODES.NOVEL) {
    return {
      ok: false,
      reason: "requires_llm",
      mode: plan.mode,
      intent,
      codeSpace: codeSpaceSummary(codeSpace),
      message: "No deterministic pattern matched — route to LLM fallback",
    };
  }

  const steps = plan.subPlans
    ? plan.subPlans.flatMap((sp) => sp.steps || [])
    : (plan.steps || []);

  if (!steps.length) {
    return { ok: false, reason: "empty_plan", mode: plan.mode, intent };
  }

  const hydratedSteps = steps.map((s) => ({
    ...s,
    args: {
      ...s.args,
      ...params,
      ...(s.args?.filePath == null && params.filePath ? { filePath: params.filePath } : {}),
      ...(s.args?.search == null && params.search ? { search: params.search } : {}),
      ...(s.args?.replace == null && params.replace ? { replace: params.replace } : {}),
      ...(s.args?.content == null && params.content ? { content: params.content } : {}),
    },
  }));

  const transform = applyTransformPlan(
    { steps: hydratedSteps },
    { db, repoRoot: root, missionId, patternId: plan.patternId },
  );

  if (!transform.ok) {
    recordFailure(db, { patternId: plan.patternId, context: { intent }, error: transform.reason });
    if (plan.patternId) {
      recordPatternOutcome(db, plan.patternId, { success: false, durationMs: Date.now() - started });
    }
    return { ok: false, reason: "transform_failed", transform, plan };
  }

  const changedFiles = transform.results
    .map((r) => r.filePath)
    .filter(Boolean);

  const productionFiles = changedFiles.filter((f) => !/test|spec/i.test(f));
  const testFiles = changedFiles.filter((f) => /test|spec/i.test(f));
  const testPattern = extractTestPattern(intent, plan);

  const verification = await runVerificationPipeline({
    changedFiles,
    repoRoot: root,
    intent,
    testPattern,
    productionFiles,
    testFiles,
  });

  if (!verification.ok) {
    for (const rb of (transform.rollbacks || []).reverse()) {
      rollbackTransform({ db, repoRoot: root, rollback: rb, missionId });
    }
    recordFailure(db, {
      patternId: plan.patternId,
      context: { intent, gates: verification.hardFailures },
      error: "verification_failed",
      repair: { rollback: true },
    });
    if (plan.patternId) {
      recordPatternOutcome(db, plan.patternId, {
        success: false,
        durationMs: Date.now() - started,
        regression: true,
      });
    }
    return {
      ok: false,
      reason: "verification_failed",
      transform,
      verification,
      rolledBack: true,
    };
  }

  for (const fp of changedFiles) {
    try {
      const content = readFileSync(join(root, fp), "utf8");
      const ip = ipSimilarityGate(content, referenceCorpus);
      if (!ip.ok) {
        for (const rb of (transform.rollbacks || []).reverse()) {
          rollbackTransform({ db, repoRoot: root, rollback: rb, missionId });
        }
        return { ok: false, reason: "ip_violation", ip, rolledBack: true };
      }
    } catch { /* optional */ }
  }

  const qualityScore = qualityFromVerification(verification);
  if (plan.patternId) {
    recordPatternOutcome(db, plan.patternId, {
      success: true,
      durationMs: Date.now() - started,
    });
  }

  return {
    ok: true,
    mode: plan.mode,
    patternId: plan.patternId,
    intent,
    changedFiles,
    transform,
    verification,
    qualityScore,
    deterministic: plan.mode !== GENERATION_MODES.NOVEL,
    durationMs: Date.now() - started,
    summary: {
      filesAnalyzed: codeSpace.fileCount,
      filesChanged: changedFiles.length,
      testsPassed: verification.testsPassed,
      qualityScore,
    },
  };
}

export function pceOverview(db) {
  seedConcordCorpus(db);
  let patterns = 0;
  let transforms = 0;
  let deterministicRate = null;
  try {
    patterns = db.prepare(`SELECT COUNT(*) AS c FROM pce_patterns`).get()?.c || 0;
    transforms = db.prepare(`SELECT COUNT(*) AS c FROM pce_transform_log`).get()?.c || 0;
    const stats = db.prepare(`
      SELECT SUM(applications) AS apps, SUM(successes) AS succ FROM pce_pattern_stats
    `).get();
    if (stats?.apps > 0) deterministicRate = (stats.succ / stats.apps);
  } catch { /* migration optional */ }
  return {
    ok: true,
    version: "PCE-1.0",
    patterns,
    transforms,
    deterministicSuccessRate: deterministicRate,
    modes: Object.values(GENERATION_MODES),
  };
}
