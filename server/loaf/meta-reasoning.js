import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VI.2 — Meta-Reasoning & Model Pluralism
 *
 * Capabilities (Epistemic Limits & Meta-Reasoning):
 *   6.  Reasoning about why reasoning fails
 *   7.  Tracking of assumption lineage (which assumptions enable which results)
 *   8.  Collapse detection in explanatory frameworks
 *   9.  Identification of irreducible disagreements
 *   10. Stable coexistence of incompatible but valid models
 *   11. Meta-transfer learning (learning when transfer should not occur)
 *   15. Formal treatment of paradoxes without resolution pressure
 *   16. Knowledge abstention as a valid outcome
 *   20. Recognition of category errors across sciences
 *   24. Meta-governance of how truth itself is handled
 *   25. Epistemic invariants as objects, not rules
 *
 * Design:
 *   - Reasoning failures are explicitly typed and tracked
 *   - Assumptions form a dependency graph (lineage tracking)
 *   - Framework collapse is detected when explanatory power drops
 *   - Irreducible disagreements are preserved without forced resolution
 *   - Incompatible models coexist in separate namespaces
 *   - Meta-transfer learning detects when knowledge transfer would cause harm
 */

// === REASONING FAILURE TAXONOMY ===

const FAILURE_TYPES = Object.freeze({
  CIRCULAR: "circular",               // reasoning depends on its own conclusion
  REGRESS: "infinite_regress",        // justification chain never terminates
  CATEGORY_ERROR: "category_error",   // applying wrong category
  COMPOSITION: "composition",          // assuming whole has properties of parts
  DIVISION: "division",                // assuming parts have properties of whole
  FALSE_DILEMMA: "false_dilemma",     // artificial binary choice
  SCOPE: "scope_error",               // valid locally but not globally
  REIFICATION: "reification",          // treating abstractions as concrete
  CONFLATION: "conflation",           // merging distinct concepts
  UNDERDETERMINATION: "underdetermination", // evidence insufficient to decide
});

const reasoningFailures = new LruMap(); // failureId -> ReasoningFailure

/**
 * Record a reasoning failure with explicit typing.
 */
function recordReasoningFailure(type, context, affectedClaims, diagnosis) {
  const id = `rf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const failure = {
    id,
    type: Object.values(FAILURE_TYPES).includes(type) ? type : "unknown",
    context: String(context).slice(0, 2000),
    affectedClaims: Array.isArray(affectedClaims)
      ? affectedClaims.map(c => String(c).slice(0, 500))
      : [],
    diagnosis: String(diagnosis || "").slice(0, 2000),
    status: "open",  // open | mitigated | accepted
    mitigationStrategy: null,
    createdAt: new Date().toISOString(),
  };

  reasoningFailures.set(id, failure);
  capMap(reasoningFailures, 10000);

  return { ok: true, failure };
}

/**
 * Analyze why reasoning failed in a specific context.
 */
function analyzeReasoningFailure(claims, evidence) {
  const diagnosis = [];

  // Check for circularity
  const claimTexts = (Array.isArray(claims) ? claims : []).map(c => String(c.text || c).toLowerCase());
  const evidenceTexts = (Array.isArray(evidence) ? evidence : []).map(e => String(e.text || e).toLowerCase());

  for (const claim of claimTexts) {
    for (const ev of evidenceTexts) {
      const claimWords = new Set(claim.split(/\s+/).filter(w => w.length > 4));
      const evWords = new Set(ev.split(/\s+/).filter(w => w.length > 4));
      let overlap = 0;
      for (const w of claimWords) if (evWords.has(w)) overlap++;
      const ratio = (claimWords.size + evWords.size) > 0
        ? (2 * overlap) / (claimWords.size + evWords.size) : 0;

      if (ratio > 0.7) {
        diagnosis.push({
          type: FAILURE_TYPES.CIRCULAR,
          detail: "Evidence appears to restate the claim rather than support it",
          claim: claim.slice(0, 200),
          evidence: ev.slice(0, 200),
        });
      }
    }
  }

  // Check for scope errors (universal claims from limited evidence)
  for (const claim of claimTexts) {
    if (/\b(all|every|always|never|none)\b/.test(claim) && evidenceTexts.length < 5) {
      diagnosis.push({
        type: FAILURE_TYPES.SCOPE,
        detail: "Universal claim from limited evidence sample",
        claim: claim.slice(0, 200),
      });
    }
  }

  // Check for false dilemmas
  for (const claim of claimTexts) {
    if (/\b(either|or|only two|binary|dichotomy)\b/.test(claim)) {
      diagnosis.push({
        type: FAILURE_TYPES.FALSE_DILEMMA,
        detail: "Possible false dilemma — consider additional options",
        claim: claim.slice(0, 200),
      });
    }
  }

  return {
    ok: true,
    diagnosis,
    totalIssues: diagnosis.length,
    claimsAnalyzed: claimTexts.length,
    evidenceAnalyzed: evidenceTexts.length,
  };
}

// === ASSUMPTION LINEAGE TRACKING ===

// Assumption dependency graph
const assumptions = new LruMap(); // assumptionId -> { text, enables[], enabledBy[], status }

/**
 * Register an assumption with its lineage.
 */
function registerAssumption(text, enabledBy, enables) {
  const id = `asm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const assumption = {
    id,
    text: String(text).slice(0, 2000),
    enabledBy: Array.isArray(enabledBy) ? enabledBy.map(String) : [],  // assumptions this depends on
    enables: Array.isArray(enables) ? enables.map(String) : [],        // results this enables
    status: "active",  // active | invalidated | conditional
    invalidatedAt: null,
    cascadeImpact: 0,  // number of downstream results affected
    createdAt: new Date().toISOString(),
  };

  assumptions.set(id, assumption);
  capMap(assumptions, 50000);

  return { ok: true, assumption };
}

/**
 * Invalidate an assumption and trace the cascade impact.
 */
function invalidateAssumption(assumptionId) {
  const asm = assumptions.get(assumptionId);
  if (!asm) return { ok: false, error: "assumption_not_found" };
  if (asm.status === "invalidated") return { ok: true, alreadyInvalidated: true };

  asm.status = "invalidated";
  asm.invalidatedAt = new Date().toISOString();

  // Trace cascade: what results depend on this assumption?
  const affected = new Set();
  const queue = [assumptionId];

  while (queue.length > 0) {
    const current = queue.shift();
    const currentAsm = assumptions.get(current);
    if (!currentAsm) continue;

    for (const enabled of currentAsm.enables) {
      if (!affected.has(enabled)) {
        affected.add(enabled);
        queue.push(enabled);
      }
    }
  }

  asm.cascadeImpact = affected.size;

  return {
    ok: true,
    assumption: asm,
    cascadeImpact: affected.size,
    affectedResults: [...affected],
  };
}

/**
 * Trace the full lineage of an assumption (all ancestors and descendants).
 */
function traceLineage(assumptionId, maxDepth = 20) {
  const ancestors = [];
  const descendants = [];

  function traceUp(id, depth) {
    if (depth >= maxDepth) return;
    const asm = assumptions.get(id);
    if (!asm) return;
    for (const parent of asm.enabledBy) {
      if (!ancestors.some(a => a.id === parent)) {
        const parentAsm = assumptions.get(parent);
        if (parentAsm) {
          ancestors.push({ id: parent, text: parentAsm.text.slice(0, 200), depth });
          traceUp(parent, depth + 1);
        }
      }
    }
  }

  function traceDown(id, depth) {
    if (depth >= maxDepth) return;
    const asm = assumptions.get(id);
    if (!asm) return;
    for (const child of asm.enables) {
      if (!descendants.some(d => d.id === child)) {
        const childAsm = assumptions.get(child);
        if (childAsm) {
          descendants.push({ id: child, text: childAsm.text.slice(0, 200), depth });
          traceDown(child, depth + 1);
        }
      }
    }
  }

  traceUp(assumptionId, 0);
  traceDown(assumptionId, 0);

  return {
    ok: true,
    assumptionId,
    ancestors,
    descendants,
    totalLineage: ancestors.length + descendants.length,
  };
}

// === FRAMEWORK COLLAPSE DETECTION ===

/**
 * Detect collapse in an explanatory framework:
 * when a framework's explanatory power drops below viability.
 */
function detectFrameworkCollapse(framework) {
  if (!framework) return { ok: false, error: "framework_required" };

  const indicators = [];

  // Check prediction accuracy trend
  const predictions = framework.predictions || [];
  if (predictions.length >= 5) {
    const recent = predictions.slice(-5);
    const accuracy = recent.filter(p => p.correct).length / recent.length;
    if (accuracy < 0.3) {
      indicators.push({
        type: "prediction_failure",
        detail: `Recent prediction accuracy: ${(accuracy * 100).toFixed(0)}%`,
        severity: "critical",
      });
    }
  }

  // Check for expanding exception count
  const exceptions = framework.exceptions || 0;
  const rules = framework.rules || 1;
  if (exceptions > rules * 0.5) {
    indicators.push({
      type: "exception_proliferation",
      detail: `${exceptions} exceptions to ${rules} rules`,
      severity: "high",
    });
  }

  // Check for internal contradictions
  const contradictions = framework.contradictions || 0;
  if (contradictions > 0) {
    indicators.push({
      type: "internal_contradiction",
      detail: `${contradictions} internal contradictions`,
      severity: contradictions > 3 ? "critical" : "high",
    });
  }

  const isCollapsing = indicators.some(i => i.severity === "critical");

  return {
    ok: true,
    isCollapsing,
    collapseRisk: Math.min(1, indicators.length / 3),
    indicators,
  };
}

// === IRREDUCIBLE DISAGREEMENTS ===

const disagreements = new LruMap(); // disagreementId -> IrreducibleDisagreement

/**
 * Register an irreducible disagreement — a disagreement that cannot be resolved
 * with current methods and must be preserved without forced resolution.
 */
function registerDisagreement(positions, domain, reason) {
  const id = `dis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const disagreement = {
    id,
    positions: Array.isArray(positions)
      ? positions.map(p => ({
          claim: String(p.claim || p).slice(0, 2000),
          evidence: Array.isArray(p.evidence) ? p.evidence.length : 0,
          supporters: p.supporters || 0,
        }))
      : [],
    domain: String(domain || "general"),
    reason: String(reason || "insufficient methods to resolve").slice(0, 2000),
    status: "active", // active | resolved | deprecated
    resolutionAttempts: 0,
    createdAt: new Date().toISOString(),
  };

  disagreements.set(id, disagreement);
  capMap(disagreements, 10000);

  return { ok: true, disagreement };
}

// === MODEL COEXISTENCE ===

const coexistingModels = new LruMap(); // namespaceId -> { models[], policy }

/**
 * Register incompatible but valid models for stable coexistence.
 * Each model exists in its own namespace without forced unification.
 */
function registerCoexistingModels(namespace, models, coexistencePolicy) {
  const id = String(namespace);

  const entry = {
    namespace: id,
    models: Array.isArray(models) ? models.map(m => ({
      id: m.id || `model_${Math.random().toString(36).slice(2, 8)}`,
      name: String(m.name || "unnamed").slice(0, 200),
      description: String(m.description || "").slice(0, 1000),
      domain: m.domain || "general",
      incompatibleWith: Array.isArray(m.incompatibleWith) ? m.incompatibleWith : [],
    })) : [],
    coexistencePolicy: String(coexistencePolicy || "parallel_validity").slice(0, 500),
    createdAt: new Date().toISOString(),
  };

  coexistingModels.set(id, entry);
  capMap(coexistingModels, 5000);

  return { ok: true, namespace: entry };
}

// === META-TRANSFER LEARNING ===

/**
 * Evaluate whether a knowledge transfer should occur.
 * Returns negative if transfer would cause harm (negative transfer).
 */
function evaluateTransfer(source, target, transferCandidate) {
  const risks = [];

  // Domain mismatch
  const sourceDomain = String(source.domain || "");
  const targetDomain = String(target.domain || "");
  if (sourceDomain !== targetDomain) {
    risks.push({
      type: "domain_mismatch",
      severity: "moderate",
      detail: `Transferring from ${sourceDomain} to ${targetDomain}`,
    });
  }

  // Check for known negative transfer indicators
  const transferText = String(transferCandidate.text || transferCandidate.content || "").toLowerCase();
  if (/\b(exception|special case|only when|not applicable)\b/.test(transferText)) {
    risks.push({
      type: "context_dependent",
      severity: "high",
      detail: "Knowledge appears to be context-dependent — may not generalize",
    });
  }

  // Check confidence gap
  const sourceConf = Number(source.confidence ?? 0.5);
  const _targetConf = Number(target.confidence ?? 0.5);
  if (sourceConf < 0.3) {
    risks.push({
      type: "low_source_confidence",
      severity: "high",
      detail: `Source confidence is only ${(sourceConf * 100).toFixed(0)}%`,
    });
  }

  const shouldTransfer = risks.filter(r => r.severity === "high").length === 0;

  return {
    ok: true,
    shouldTransfer,
    risks,
    riskCount: risks.length,
    recommendation: shouldTransfer ? "proceed_with_caution" : "block_transfer",
  };
}

// === PARADOX TREATMENT ===

const paradoxes = new LruMap(); // paradoxId -> Paradox

/**
 * Register a paradox for formal treatment without resolution pressure.
 * Paradoxes are preserved as valuable epistemic objects.
 */
function registerParadox(description, domain, relatedClaims) {
  const id = `paradox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const paradox = {
    id,
    description: String(description).slice(0, 2000),
    domain: String(domain || "general"),
    relatedClaims: Array.isArray(relatedClaims) ? relatedClaims.map(c => String(c).slice(0, 500)) : [],
    status: "open",  // open | partially_understood | dissolved | preserved
    resolutionPressure: false, // ALWAYS false — no forced resolution
    analyses: [],
    createdAt: new Date().toISOString(),
  };

  paradoxes.set(id, paradox);
  capMap(paradoxes, 5000);

  return { ok: true, paradox };
}

// === EPISTEMIC INVARIANTS AS OBJECTS ===

const epistemicInvariants = new LruMap(); // invariantId -> EpistemicInvariant

/**
 * Register an epistemic invariant as a first-class object (not just a rule).
 */
function registerEpistemicInvariant(name, description, domain, properties) {
  const id = `einv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const invariant = {
    id,
    name: String(name).slice(0, 200),
    description: String(description).slice(0, 2000),
    domain: String(domain || "universal"),
    properties: {
      scope: properties?.scope || "universal",
      strength: Math.max(0, Math.min(1, Number(properties?.strength ?? 0.9))),
      violations: 0,
      lastVerified: null,
      ...properties,
    },
    status: "active", // active | suspended | violated
    createdAt: new Date().toISOString(),
  };

  epistemicInvariants.set(id, invariant);
  capMap(epistemicInvariants, 10000);

  return { ok: true, invariant };
}

// === HELPERS ===

function capMap(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.metaReasoning = {
    stats: {
      failuresRecorded: 0, failureAnalyses: 0, assumptionsRegistered: 0,
      invalidations: 0, lineageTraces: 0, collapseChecks: 0,
      disagreementsRegistered: 0, modelNamespaces: 0, transferEvals: 0,
      paradoxesRegistered: 0, invariantsRegistered: 0,
    },
  };

  register("loaf.meta_reasoning", "status", (ctx) => {
    const mr = ctx.state.__loaf.metaReasoning;
    return {
      ok: true,
      reasoningFailures: reasoningFailures.size,
      assumptions: assumptions.size,
      disagreements: disagreements.size,
      coexistingModels: coexistingModels.size,
      paradoxes: paradoxes.size,
      epistemicInvariants: epistemicInvariants.size,
      stats: mr.stats,
    };
  }, { public: true });

  register("loaf.meta_reasoning", "record_failure", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.failuresRecorded++;
    return recordReasoningFailure(input.type, input.context, input.affectedClaims, input.diagnosis);
  }, { public: false });

  register("loaf.meta_reasoning", "analyze_failure", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.failureAnalyses++;
    return analyzeReasoningFailure(input.claims, input.evidence);
  }, { public: true });

  register("loaf.meta_reasoning", "register_assumption", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.assumptionsRegistered++;
    return registerAssumption(input.text, input.enabledBy, input.enables);
  }, { public: false });

  register("loaf.meta_reasoning", "invalidate_assumption", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.invalidations++;
    return invalidateAssumption(String(input.assumptionId || ""));
  }, { public: false });

  register("loaf.meta_reasoning", "trace_lineage", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.lineageTraces++;
    return traceLineage(String(input.assumptionId || ""), input.maxDepth);
  }, { public: true });

  register("loaf.meta_reasoning", "detect_collapse", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.collapseChecks++;
    return detectFrameworkCollapse(input.framework || input);
  }, { public: true });

  register("loaf.meta_reasoning", "register_disagreement", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.disagreementsRegistered++;
    return registerDisagreement(input.positions, input.domain, input.reason);
  }, { public: false });

  register("loaf.meta_reasoning", "register_coexisting_models", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.modelNamespaces++;
    return registerCoexistingModels(input.namespace, input.models, input.policy);
  }, { public: false });

  register("loaf.meta_reasoning", "evaluate_transfer", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.transferEvals++;
    return evaluateTransfer(input.source || {}, input.target || {}, input.candidate || {});
  }, { public: true });

  register("loaf.meta_reasoning", "register_paradox", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.paradoxesRegistered++;
    return registerParadox(input.description, input.domain, input.relatedClaims);
  }, { public: false });

  register("loaf.meta_reasoning", "register_invariant", (ctx, input = {}) => {
    const mr = ctx.state.__loaf.metaReasoning;
    mr.stats.invariantsRegistered++;
    return registerEpistemicInvariant(input.name, input.description, input.domain, input.properties);
  }, { public: false });

  register("loaf.meta_reasoning", "list_failures", (_ctx, input = {}) => {
    let list = Array.from(reasoningFailures.values());
    if (input.type) list = list.filter(f => f.type === input.type);
    return { ok: true, failures: list.slice(-(Number(input.limit || 50))) };
  }, { public: true });

  register("loaf.meta_reasoning", "list_disagreements", (_ctx, input = {}) => {
    let list = Array.from(disagreements.values());
    if (input.domain) list = list.filter(d => d.domain === input.domain);
    return { ok: true, disagreements: list.slice(0, 50) };
  }, { public: true });

  register("loaf.meta_reasoning", "list_paradoxes", (_ctx) => {
    return { ok: true, paradoxes: Array.from(paradoxes.values()).slice(0, 50) };
  }, { public: true });

  register("loaf.meta_reasoning", "list_invariants", (_ctx, input = {}) => {
    let list = Array.from(epistemicInvariants.values());
    if (input.domain) list = list.filter(i => i.domain === input.domain);
    return { ok: true, invariants: list.slice(0, 50) };
  }, { public: true });
}

export {
  FAILURE_TYPES,
  recordReasoningFailure,
  analyzeReasoningFailure,
  registerAssumption,
  invalidateAssumption,
  traceLineage,
  detectFrameworkCollapse,
  registerDisagreement,
  registerCoexistingModels,
  evaluateTransfer,
  registerParadox,
  registerEpistemicInvariant,
  init,
};
