// server/lib/pce/intent-compiler.js
//
// Intent → transform plan (Mode A deterministic / B compositional / C novel).

import { findPatternsForIntent, patternToTransformPlan } from "./pattern-ir.js";
import { provenanceGate, stripSourceFromGenerationContext } from "./provenance.js";

export const GENERATION_MODES = Object.freeze({
  DETERMINISTIC: "deterministic",
  COMPOSITIONAL: "compositional",
  NOVEL: "novel",
});

export function compileIntent(intent, { db, codeSpace, targetPolicy = "permissive" } = {}) {
  const goal = String(intent || "").trim();
  if (!goal) return { ok: false, reason: "missing_intent" };

  const patterns = findPatternsForIntent(db, goal, { limit: 3 });
  if (patterns.length === 0) {
    return {
      ok: true,
      mode: GENERATION_MODES.NOVEL,
      intent: goal,
      steps: [],
      requiresLlm: true,
      reason: "no_matching_pattern",
    };
  }

  const best = patterns[0];
  const gate = provenanceGate(db, { pattern: best, targetPolicy });
  if (!gate.ok) {
    const fallback = patterns.find((p) => provenanceGate(db, { pattern: p, targetPolicy }).ok);
    if (!fallback) {
      return {
        ok: true,
        mode: GENERATION_MODES.NOVEL,
        intent: goal,
        steps: [],
        requiresLlm: true,
        reason: "provenance_requires_llm",
      };
    }
    return compileFromPattern(fallback, goal, { mode: GENERATION_MODES.DETERMINISTIC });
  }

  if (patterns.length >= 2 && patterns[1].matchScore > 0.5) {
    const plans = patterns.slice(0, 2).map((p) => compileFromPattern(
      stripSourceFromGenerationContext(p),
      goal,
      { mode: GENERATION_MODES.COMPOSITIONAL },
    ));
    return {
      ok: true,
      mode: GENERATION_MODES.COMPOSITIONAL,
      intent: goal,
      subPlans: plans.filter((p) => p.ok),
      patternId: best.patternId,
      requiresLlm: false,
    };
  }

  return compileFromPattern(stripSourceFromGenerationContext(best), goal, {
    mode: GENERATION_MODES.DETERMINISTIC,
  });
}

function compileFromPattern(pattern, intent, { mode }) {
  const plan = patternToTransformPlan(pattern);
  return {
    ok: plan.ok,
    mode,
    intent,
    patternId: pattern.patternId || pattern.pattern_id,
    steps: plan.steps,
    verification: plan.verification,
    requiresLlm: false,
  };
}

export function extractTestPattern(intent, plan) {
  return plan?.verification?.testPattern
    || String(intent).match(/[a-z][a-z0-9_-]{2,}/gi)?.[0]
    || "mission";
}
