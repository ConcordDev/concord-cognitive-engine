// server/lib/runtime/predictive-context.js
//
// Predictive context engine — anticipate decisions/tools/evidence before inference.
// predict → retrieve → compile → reason

const TASK_ANTICIPATION = Object.freeze({
  coding: {
    decisions: ["locate_file", "apply_patch", "run_tests"],
    tools: ["coding_loop_search", "coding_loop_verify", "pce_execute", "patch_file"],
    failureModes: ["syntax_error", "test_failure", "scope_creep"],
    evidenceNeeds: ["repo_graph", "test_output", "prior_patches"],
  },
  cognitive_probe: {
    decisions: ["analyze", "summarize", "recommend"],
    tools: ["cognitive_delta_execute", "trace_recent"],
    failureModes: ["insufficient_context", "hallucinated_claim"],
    evidenceNeeds: ["ledger", "dtu_recall", "observation"],
  },
  reasoning: {
    decisions: ["hypothesize", "verify", "synthesize"],
    tools: ["cognitive_delta_execute", "reasoning_trace"],
    failureModes: ["premature_conclusion", "missing_evidence"],
    evidenceNeeds: ["causal_memory", "contradictions", "confidence_scores"],
  },
  research: {
    decisions: ["search", "cite", "compare"],
    tools: ["trace_recent", "dtu_search"],
    failureModes: ["stale_source", "unverified_claim"],
    evidenceNeeds: ["citations", "source_freshness", "provenance"],
  },
});

function normalizeTaskClass(taskClass, template, tool) {
  if (taskClass && TASK_ANTICIPATION[taskClass]) return taskClass;
  const t = `${template || ""} ${tool || ""}`.toLowerCase();
  if (/code|patch|swe|repo/.test(t)) return "coding";
  if (/probe|cognitive/.test(t)) return "cognitive_probe";
  if (/research|cite/.test(t)) return "research";
  return "reasoning";
}

/**
 * Anticipate context needs before LLM call.
 */
export function anticipateContext({
  goal,
  taskClass,
  template,
  step,
  mission,
  priorSteps = [],
} = {}) {
  const cls = normalizeTaskClass(taskClass, template || mission?.template, step?.tool);
  const base = TASK_ANTICIPATION[cls] || TASK_ANTICIPATION.reasoning;
  const goalLower = String(goal || mission?.goal || "").toLowerCase();

  const anticipatedDecisions = [...base.decisions];
  const anticipatedTools = [...base.tools];
  const failureModes = [...base.failureModes];
  const evidenceNeeds = [...base.evidenceNeeds];

  if (/deploy|production|mutate/.test(goalLower)) {
    failureModes.push("unauthorized_mutation");
    evidenceNeeds.push("f0_authority");
  }
  if (/test|verify|bench/.test(goalLower)) {
    anticipatedDecisions.push("verify");
    evidenceNeeds.push("verification_gates");
  }
  if (priorSteps?.some((s) => s.status === "failed")) {
    failureModes.push("recovery_required");
    evidenceNeeds.push("failure_signature");
  }

  const dtuTags = [];
  for (const tag of ["ledger", "causal", "repo", "test", "security"]) {
    if (goalLower.includes(tag) || evidenceNeeds.some((e) => e.includes(tag))) {
      dtuTags.push(tag);
    }
  }

  return {
    ok: true,
    taskClass: cls,
    goal: goal || mission?.goal,
    anticipatedDecisions,
    anticipatedTools,
    failureModes,
    evidenceNeeds,
    dtuRetrievalHints: {
      tags: dtuTags,
      maxRecent: cls === "coding" ? 8 : 12,
      requireProvenance: cls === "research",
      excludeStale: true,
    },
    predictiveGraph: {
      goal,
      decisions: anticipatedDecisions,
      tools: anticipatedTools,
      failures: failureModes,
      evidence: evidenceNeeds,
    },
  };
}

/**
 * Filter recall pack using anticipation hints.
 */
export function filterRecallByAnticipation(recallPack, anticipation) {
  if (!recallPack?.ok || !anticipation?.dtuRetrievalHints) return recallPack;

  const hints = anticipation.dtuRetrievalHints;
  const max = hints.maxRecent || 12;
  let recent = (recallPack.recent || []).slice(0, max);

  if (hints.tags?.length) {
    const tagged = recent.filter((r) => {
      const text = `${r.title || ""} ${r.kind || ""} ${r.memory_kind || ""}`.toLowerCase();
      return hints.tags.some((t) => text.includes(t));
    });
    if (tagged.length >= 2) recent = tagged.slice(0, max);
  }

  return {
    ...recallPack,
    recent,
    anticipationFiltered: true,
    originalCount: recallPack.recent?.length || 0,
    filteredCount: recent.length,
  };
}
