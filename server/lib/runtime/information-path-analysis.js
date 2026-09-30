// server/lib/runtime/information-path-analysis.js
//
// Measures the full Concord information path before inference:
// knowledge → DTU selection → DHTP transport → procedural execution → model reasoning → verification → memory
//
// Raw baseline starts at: prompt → model → answer (much later in the stack).

const LAYER_TRANSITIONS = Object.freeze([
  { from: "A", to: "B", layer: "dtu_retrieval", label: "DTU retrieval & ranking" },
  { from: "B", to: "C", layer: "dhtp_compression", label: "DHTP cognitive packet" },
  { from: "C", to: "D", layer: "dtu_dhtp_combined", label: "DTU + DHTP combined routing" },
  { from: "D", to: "E", layer: "full_stack", label: "PCE + cache + recovery + memory" },
]);

const QUALITY_REGRESSION_THRESHOLD_PP = 2.0;

/**
 * Build funnel stages from one mission's efficiency metrics.
 * Units are token-equivalents — the measurable proxy for information volume.
 */
export function buildPathFunnelFromMetrics(metrics = {}) {
  const eff = metrics.efficiency || metrics;
  const intel = metrics.intelligence || {};
  const pipeline = metrics.pipeline || {};

  const knowledge = eff.rawContextTokens || pipeline.world || eff.contextTokensFull || 0;
  const selected = eff.tokensAfterDtu || pipeline.dtu || 0;
  const transported = eff.dhtpTokens || pipeline.dhtp || 0;
  const reasoned = eff.actualModelInputTokens || pipeline.modelInput || 0;
  const cacheAvoided = eff.llmCallsAvoidedCache || pipeline.cache || 0;
  const pceAvoided = eff.llmCallsAvoidedPce || pipeline.pce || 0;
  const llmCalls = eff.llmCallsEstimated || pipeline.llm || 0;
  const skipLlm = eff.skipLlm === 1;

  const effectiveInference = skipLlm || cacheAvoided > 0 ? 0 : reasoned;

  return {
    knowledgeUnits: knowledge,
    selectedUnits: selected || knowledge,
    transportedUnits: transported || selected || knowledge,
    reasonedUnits: reasoned,
    effectiveInferenceUnits: effectiveInference,
    proceduralAvoided: pceAvoided,
    cacheAvoided,
    llmCalls,
    skipLlm: skipLlm || cacheAvoided > 0,
    compressionRatio: knowledge > 0 ? knowledge / Math.max(1, effectiveInference || reasoned || 1) : 1,
    selectionRatio: knowledge > 0 ? selected / knowledge : 1,
    transportRatio: selected > 0 ? transported / selected : 1,
    inferenceRatio: knowledge > 0 ? (effectiveInference || reasoned) / knowledge : 1,
  };
}

/**
 * Aggregate funnel across runs for one path.
 */
export function aggregatePathFunnel(runs = []) {
  if (!runs?.length) {
    return { ok: false, reason: "no_runs" };
  }

  const funnels = runs.map((r) => buildPathFunnelFromMetrics(r.metrics || r));
  const n = funnels.length;

  const avg = (field) => funnels.reduce((s, f) => s + (f[field] || 0), 0) / n;

  return {
    ok: true,
    samples: n,
    knowledgeUnits: avg("knowledgeUnits"),
    selectedUnits: avg("selectedUnits"),
    transportedUnits: avg("transportedUnits"),
    reasonedUnits: avg("reasonedUnits"),
    effectiveInferenceUnits: avg("effectiveInferenceUnits"),
    proceduralAvoided: avg("proceduralAvoided"),
    cacheAvoided: avg("cacheAvoided"),
    compressionRatio: avg("compressionRatio"),
    selectionRatio: avg("selectionRatio"),
    transportRatio: avg("transportRatio"),
    inferenceRatio: avg("inferenceRatio"),
  };
}

/**
 * Compare Raw vs Dila information paths — the core moat equation.
 */
export function compareInformationPaths(rawFunnel, dilaFunnel) {
  if (!rawFunnel?.ok || !dilaFunnel?.ok) {
    return { ok: false, reason: "incomplete_funnels" };
  }

  const rawInference = rawFunnel.reasonedUnits || rawFunnel.knowledgeUnits;
  const dilaInference = dilaFunnel.effectiveInferenceUnits ?? dilaFunnel.reasonedUnits;

  const inferenceReductionPct = rawInference > 0
    ? ((rawInference - dilaInference) / rawInference) * 100
    : null;

  const knowledgeToInferenceRaw = rawFunnel.knowledgeUnits > 0
    ? rawInference / rawFunnel.knowledgeUnits
    : 1;

  const knowledgeToInferenceDila = dilaFunnel.knowledgeUnits > 0
    ? dilaInference / dilaFunnel.knowledgeUnits
    : 1;

  return {
    ok: true,
    raw: {
      path: "prompt → model → answer",
      knowledgeUnits: rawFunnel.knowledgeUnits,
      inferenceUnits: rawInference,
      ratio: knowledgeToInferenceRaw,
      narrative: `${Math.round(rawFunnel.knowledgeUnits)} units context → ${Math.round(rawInference)} units inference`,
    },
    dila: {
      path: "substrate → retrieval → DHTP → PCE → model → verify → memory",
      knowledgeUnits: dilaFunnel.knowledgeUnits,
      selectedUnits: dilaFunnel.selectedUnits,
      transportedUnits: dilaFunnel.transportedUnits,
      inferenceUnits: dilaInference,
      proceduralAvoided: dilaFunnel.proceduralAvoided,
      cacheAvoided: dilaFunnel.cacheAvoided,
      ratio: knowledgeToInferenceDila,
      narrative: `${Math.round(dilaFunnel.knowledgeUnits)} knowledge → ${Math.round(dilaFunnel.selectedUnits)} selected → ${Math.round(dilaFunnel.transportedUnits)} transported → ${Math.round(dilaInference)} reasoned`,
    },
    inferenceReductionPct,
    knowledgeEfficiencyGain: knowledgeToInferenceRaw > 0
      ? knowledgeToInferenceRaw / Math.max(knowledgeToInferenceDila, 0.001)
      : null,
    moat: "Concord controls the information path before inference — not just compression",
  };
}

/**
 * Diagnose which layer causes quality regression across A→E path ladder.
 * If benchmark misses 80%, this tells us where to invest.
 */
export function diagnoseLayerAttribution(pathQualityTable = []) {
  const byId = Object.fromEntries(pathQualityTable.map((r) => [r.pathId, r]));
  const transitions = [];
  const regressions = [];

  for (const t of LAYER_TRANSITIONS) {
    const from = byId[t.from];
    const to = byId[t.to];
    if (!from || !to) continue;

    const qualityDeltaPp = (to.avgComposite - from.avgComposite) * 100;
    const tokenDeltaPct = from.avgTokens > 0
      ? ((from.avgTokens - to.avgTokens) / from.avgTokens) * 100
      : null;

    const entry = {
      from: t.from,
      to: t.to,
      layer: t.layer,
      label: t.label,
      qualityDeltaPp,
      tokenDeltaPct,
      fromQuality: from.avgComposite,
      toQuality: to.avgComposite,
      fromTokens: from.avgTokens,
      toTokens: to.avgTokens,
      qualityRegression: qualityDeltaPp < -QUALITY_REGRESSION_THRESHOLD_PP,
      efficiencyGain: tokenDeltaPct != null && tokenDeltaPct > 0,
    };

    transitions.push(entry);

    if (entry.qualityRegression) {
      regressions.push({
        layer: t.layer,
        label: t.label,
        qualityLossPp: Math.abs(qualityDeltaPp),
        recommendation: layerRecommendation(t.layer),
      });
    }
  }

  const overallAtoE = byId.A && byId.E
    ? {
        qualityDeltaPp: (byId.E.avgComposite - byId.A.avgComposite) * 100,
        tokenReductionPct: byId.A.avgTokens > 0
          ? ((byId.A.avgTokens - byId.E.avgTokens) / byId.A.avgTokens) * 100
          : null,
        qualityParityOrBetter: byId.E.avgComposite >= byId.A.avgComposite - 0.01,
        target80PctInferenceReduction: byId.A.avgTokens > 0
          ? ((byId.A.avgTokens - byId.E.avgTokens) / byId.A.avgTokens) * 100 >= 80
          : false,
      }
    : null;

  let verdict;
  if (overallAtoE?.target80PctInferenceReduction && overallAtoE?.qualityParityOrBetter) {
    verdict = "moat_validated_quality_parity_with_80pct_inference_reduction";
  } else if (overallAtoE?.qualityParityOrBetter && !overallAtoE?.target80PctInferenceReduction) {
    verdict = "quality_ok_inference_reduction_below_80pct";
  } else if (regressions.length > 0) {
    verdict = `quality_regression_in_${regressions[0].layer}`;
  } else {
    verdict = "mixed_needs_more_workloads_or_billing";
  }

  return {
    transitions,
    regressions,
    overallAtoE,
    verdict,
    investPriority: regressions.length > 0
      ? regressions.sort((a, b) => b.qualityLossPp - a.qualityLossPp)
      : [],
  };
}

function layerRecommendation(layer) {
  const recs = {
    dtu_retrieval: "Improve DTU indexing, ranking, and recall precision — wrong retrieval poisons downstream reasoning",
    dhtp_compression: "Refine DHTP field selection and compression policy — representation loss before model sees context",
    dtu_dhtp_combined: "Tune combined routing — DTU filter + DHTP packet interaction may be dropping load-bearing facts",
    full_stack: "Audit PCE eligibility, cache fingerprinting, and recovery paths — reuse must not serve stale/wrong patterns",
  };
  return recs[layer] || "Investigate layer-specific quality regression";
}

/**
 * Build the strategic moat summary for benchmark output.
 */
export function buildMoatSummary({ pathSuites, pathQualityTable }) {
  const rawSuite = pathSuites?.find((s) => s.pathId === "A");
  const dilaSuite = pathSuites?.find((s) => s.pathId === "E");

  const rawFunnel = aggregatePathFunnel(rawSuite?.runs);
  const dilaFunnel = aggregatePathFunnel(dilaSuite?.runs);
  const pathComparison = compareInformationPaths(rawFunnel, dilaFunnel);
  const layerAttribution = diagnoseLayerAttribution(pathQualityTable);

  return {
    positioning: {
      notThis: "Our protocol compresses text",
      this: "Concord has a native machine-readable cognitive substrate that decides what information deserves inference",
      commercial: "Model-agnostic intelligence efficiency layer — small model + substrate can match larger model alone",
    },
    rawFunnel,
    dilaFunnel,
    pathComparison,
    layerAttribution,
    compoundingAdvantages: [
      "More knowledge does not mean more inference — DTUs indexed, ranked, selectively retrieved",
      "DHTP makes selected knowledge inexpensive to transmit — model gets cognitive IR, not the universe",
      "PCE removes entire classes of inference — deterministic math, transforms, repo ops",
      "Verified reasoning becomes reusable — DTUs + causal memory + cognitive cache",
      "Model capability becomes multiplicative — cheap model + substrate ≈ expensive model alone",
    ],
  };
}

export { LAYER_TRANSITIONS };
