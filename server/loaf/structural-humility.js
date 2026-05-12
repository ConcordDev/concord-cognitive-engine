import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VI.3 — Structural Humility & Belief Ecosystem Stability
 *
 * Capabilities (Epistemic Limits & Meta-Reasoning):
 *   17. Proof-of-non-progress (detecting when more work won't help)
 *   18. Structural humility enforcement (no forced closure)
 *   19. Long-term preservation of unresolved questions
 *   23. Explicit tracking of conceptual debt
 *   28. Stability analysis of belief ecosystems
 *   29. Reasoning about future reasoning capacity
 *   30. Recognition of terminal questions (questions that cannot be resolved
 *       within current reality)
 *
 * Design:
 *   - Structural humility: the system can say "I don't know" and preserve
 *     the question indefinitely without forced closure
 *   - Non-progress is formally detected and recorded
 *   - Terminal questions are preserved as valuable boundary markers
 *   - Conceptual debt is tracked like technical debt in software
 *   - Belief ecosystems are modeled for stability analysis
 *   - Future reasoning capacity is explicitly modeled
 */

// === KNOWLEDGE ABSTENTION ===

const ABSTENTION_REASONS = Object.freeze({
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  CONTRADICTORY_EVIDENCE: "contradictory_evidence",
  BEYOND_CURRENT_METHODS: "beyond_current_methods",
  REQUIRES_NEW_PRIMITIVES: "requires_new_primitives",
  TERMINAL_QUESTION: "terminal_question",
  ETHICAL_LIMIT: "ethical_limit",
  NON_PROGRESS: "non_progress",
});

const abstentions = new LruMap(); // abstentionId -> Abstention

/**
 * Record a knowledge abstention — an explicit decision NOT to answer.
 * This is a valid and valuable epistemic outcome.
 */
function recordAbstention(question, reason, domain, notes) {
  const id = `abst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const abstention = {
    id,
    question: String(question).slice(0, 2000),
    reason: Object.values(ABSTENTION_REASONS).includes(reason)
      ? reason
      : ABSTENTION_REASONS.INSUFFICIENT_EVIDENCE,
    domain: String(domain || "general"),
    notes: String(notes || "").slice(0, 2000),
    status: "active",  // active | revisited | resolved
    revisitSchedule: null,
    createdAt: new Date().toISOString(),
    revisitedAt: null,
  };

  abstentions.set(id, abstention);
  capMap(abstentions, 50000);

  return { ok: true, abstention };
}

/**
 * Schedule a revisit of an abstention (periodic check if new methods allow answering).
 */
function scheduleRevisit(abstentionId, revisitAfterMs) {
  const abst = abstentions.get(abstentionId);
  if (!abst) return { ok: false, error: "abstention_not_found" };

  abst.revisitSchedule = {
    scheduledAt: new Date(Date.now() + Number(revisitAfterMs || 30 * 86400000)).toISOString(),
    scheduledMs: Number(revisitAfterMs || 30 * 86400000),
  };

  return { ok: true, abstention: abst };
}

// === PROOF-OF-NON-PROGRESS ===

const nonProgressRecords = new LruMap(); // recordId -> NonProgressRecord

/**
 * Record proof-of-non-progress: evidence that more work on a question
 * will not yield results with current methods.
 */
function recordNonProgress(question, attemptHistory, diagnosis) {
  const id = `np_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const record = {
    id,
    question: String(question).slice(0, 2000),
    attempts: Array.isArray(attemptHistory)
      ? attemptHistory.map(a => ({
          method: String(a.method || a).slice(0, 500),
          result: String(a.result || "no_result").slice(0, 500),
          when: a.when || new Date().toISOString(),
        }))
      : [],
    diagnosis: String(diagnosis || "").slice(0, 2000),
    verdict: "non_progress_confirmed",
    recommendation: null,
    createdAt: new Date().toISOString(),
  };

  // Generate recommendation based on attempt patterns
  if (record.attempts.length >= 5) {
    const methods = new Set(record.attempts.map(a => a.method));
    if (methods.size < 3) {
      record.recommendation = "Try fundamentally different methods before concluding non-progress";
    } else {
      record.recommendation = "Multiple methods exhausted — consider this a terminal question or await new paradigms";
    }
  } else {
    record.recommendation = "Insufficient attempts to confirm non-progress — more exploration needed";
    record.verdict = "non_progress_suspected";
  }

  nonProgressRecords.set(id, record);
  capMap(nonProgressRecords, 10000);

  return { ok: true, record };
}

// === TERMINAL QUESTIONS ===

const terminalQuestions = new LruMap(); // questionId -> TerminalQuestion

/**
 * Register a terminal question: a question that cannot be resolved
 * within current reality or methodology.
 * These are preserved as valuable boundary markers.
 */
function registerTerminalQuestion(question, domain, reason, relatedQuestions) {
  const id = `tq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const tq = {
    id,
    question: String(question).slice(0, 2000),
    domain: String(domain || "general"),
    reason: String(reason || "").slice(0, 2000),
    relatedQuestions: Array.isArray(relatedQuestions)
      ? relatedQuestions.map(q => String(q).slice(0, 500))
      : [],
    status: "terminal", // terminal | reopened
    whatWouldResolveIt: null,
    preservedAt: new Date().toISOString(),
    reopenedAt: null,
  };

  terminalQuestions.set(id, tq);
  capMap(terminalQuestions, 10000);

  return { ok: true, terminalQuestion: tq };
}

/**
 * Annotate what would be needed to resolve a terminal question.
 */
function annotateResolutionPath(questionId, requirements) {
  const tq = terminalQuestions.get(questionId);
  if (!tq) return { ok: false, error: "terminal_question_not_found" };

  tq.whatWouldResolveIt = {
    requirements: Array.isArray(requirements)
      ? requirements.map(r => String(r).slice(0, 500))
      : [String(requirements).slice(0, 500)],
    annotatedAt: new Date().toISOString(),
  };

  return { ok: true, terminalQuestion: tq };
}

// === UNRESOLVED QUESTION PRESERVATION ===

const unresolvedQuestions = new LruMap(); // questionId -> UnresolvedQuestion

/**
 * Preserve an unresolved question for long-term tracking.
 * Unlike terminal questions, these may eventually be answerable.
 */
function preserveUnresolvedQuestion(question, domain, context) {
  const id = `uq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const uq = {
    id,
    question: String(question).slice(0, 2000),
    domain: String(domain || "general"),
    context: String(context || "").slice(0, 2000),
    status: "preserved", // preserved | partially_answered | resolved
    partialAnswers: [],
    preservedAt: new Date().toISOString(),
    lastCheckedAt: null,
  };

  unresolvedQuestions.set(id, uq);
  capMap(unresolvedQuestions, 50000);

  return { ok: true, question: uq };
}

// === CONCEPTUAL DEBT TRACKING ===

const DEBT_CATEGORIES = Object.freeze({
  UNDEFINED_TERMS: "undefined_terms",         // terms used without definition
  UNTESTED_ASSUMPTIONS: "untested_assumptions", // assumptions never validated
  BORROWED_CONCEPTS: "borrowed_concepts",       // concepts used without adaptation
  MISSING_CONNECTIONS: "missing_connections",   // known gaps between domains
  OUTDATED_MODELS: "outdated_models",          // models known to be incomplete
});

const conceptualDebts = new LruMap(); // debtId -> ConceptualDebt

/**
 * Track conceptual debt — epistemic obligations that haven't been fulfilled.
 */
function trackConceptualDebt(category, description, domain, priority) {
  const id = `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const debt = {
    id,
    category: Object.values(DEBT_CATEGORIES).includes(category)
      ? category
      : DEBT_CATEGORIES.UNTESTED_ASSUMPTIONS,
    description: String(description).slice(0, 2000),
    domain: String(domain || "general"),
    priority: ["critical", "high", "moderate", "low"].includes(priority) ? priority : "moderate",
    status: "open",  // open | in_progress | resolved | accepted
    estimatedEffort: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  };

  conceptualDebts.set(id, debt);
  capMap(conceptualDebts, 50000);

  return { ok: true, debt };
}

/**
 * Get conceptual debt summary — what society "owes" itself epistemically.
 */
function conceptualDebtSummary() {
  const byCategory = {};
  const byPriority = { critical: 0, high: 0, moderate: 0, low: 0 };
  const byDomain = {};
  let open = 0;

  for (const [, debt] of conceptualDebts) {
    if (debt.status === "open" || debt.status === "in_progress") {
      open++;
      byCategory[debt.category] = (byCategory[debt.category] || 0) + 1;
      byPriority[debt.priority] = (byPriority[debt.priority] || 0) + 1;
      byDomain[debt.domain] = (byDomain[debt.domain] || 0) + 1;
    }
  }

  return {
    total: conceptualDebts.size,
    open,
    byCategory,
    byPriority,
    byDomain,
    highestDebtDomains: Object.entries(byDomain)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count })),
  };
}

// === BELIEF ECOSYSTEM STABILITY ===

/**
 * Analyze the stability of a belief ecosystem.
 * Models beliefs as an ecosystem where beliefs can support, compete,
 * or undermine each other.
 */
function analyzeBeliefStability(beliefs) {
  if (!Array.isArray(beliefs) || beliefs.length === 0) {
    return { ok: true, stability: 1, analysis: { totalBeliefs: 0 } };
  }

  // Compute support network density
  let totalSupports = 0;
  let totalConflicts = 0;

  for (const belief of beliefs) {
    totalSupports += (belief.supports || []).length;
    totalConflicts += (belief.conflicts || []).length;
  }

  const avgSupports = totalSupports / beliefs.length;
  const avgConflicts = totalConflicts / beliefs.length;

  // Support ratio: how well-connected is the belief network?
  const supportRatio = (totalSupports + totalConflicts) > 0
    ? totalSupports / (totalSupports + totalConflicts)
    : 1;

  // Confidence distribution
  const confidences = beliefs.map(b => Number(b.confidence || 0.5));
  const avgConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  const confVariance = confidences.reduce((s, c) => s + (c - avgConfidence) ** 2, 0) / confidences.length;

  // Ecosystem health metrics
  const diversityScore = new Set(beliefs.map(b => b.domain || "unknown")).size / Math.max(1, beliefs.length);

  // Fragility: high average confidence + low conflict = potentially brittle
  const fragility = avgConfidence > 0.8 && avgConflicts < 0.5 ? 0.7 : 0.2;

  // Overall stability
  const stability = Math.max(0, Math.min(1,
    supportRatio * 0.3 +
    (1 - fragility) * 0.3 +
    Math.min(1, diversityScore * 5) * 0.2 +
    Math.min(1, confVariance * 5) * 0.2  // some variance is healthy
  ));

  return {
    ok: true,
    stability,
    analysis: {
      totalBeliefs: beliefs.length,
      avgSupports,
      avgConflicts,
      supportRatio,
      avgConfidence,
      confVariance,
      diversityScore,
      fragility,
    },
    risks: [
      ...(fragility > 0.5 ? [{ type: "brittleness", detail: "High confidence, low conflict — may shatter under challenge" }] : []),
      ...(supportRatio < 0.3 ? [{ type: "high_conflict", detail: "More conflicts than supports in belief network" }] : []),
      ...(diversityScore < 0.1 ? [{ type: "monoculture", detail: "Most beliefs from same domain" }] : []),
    ],
  };
}

// === FUTURE REASONING CAPACITY ===

/**
 * Model future reasoning capacity: what will the system be able to reason about
 * with projected improvements?
 */
function modelFutureCapacity(currentCapabilities, projectedImprovements) {
  const capabilities = Array.isArray(currentCapabilities) ? currentCapabilities : [];
  const improvements = Array.isArray(projectedImprovements) ? projectedImprovements : [];

  const current = capabilities.map(c => ({
    name: String(c.name || c).slice(0, 200),
    level: Math.max(0, Math.min(1, Number(c.level ?? 0.5))),
    domain: c.domain || "general",
  }));

  const projected = improvements.map(imp => ({
    capability: String(imp.capability || imp.name || "").slice(0, 200),
    expectedImprovement: Math.max(0, Math.min(1, Number(imp.improvement ?? 0.1))),
    timeframe: String(imp.timeframe || "unknown"),
    confidence: Math.max(0, Math.min(1, Number(imp.confidence ?? 0.3))),
  }));

  // Compute projected capabilities
  const futureCapabilities = current.map(c => {
    const relevantImprovements = projected.filter(
      p => p.capability.toLowerCase().includes(c.name.toLowerCase()) ||
           c.name.toLowerCase().includes(p.capability.toLowerCase())
    );

    const totalImprovement = relevantImprovements.reduce(
      (s, p) => s + p.expectedImprovement * p.confidence, 0
    );

    return {
      name: c.name,
      currentLevel: c.level,
      projectedLevel: Math.min(1, c.level + totalImprovement),
      improvement: totalImprovement,
      basedOn: relevantImprovements.length,
    };
  });

  // Identify questions that could be unlocked
  const currentAvg = current.length > 0
    ? current.reduce((s, c) => s + c.level, 0) / current.length : 0;
  const projectedAvg = futureCapabilities.length > 0
    ? futureCapabilities.reduce((s, c) => s + c.projectedLevel, 0) / futureCapabilities.length : 0;

  return {
    ok: true,
    current: {
      capabilities: current.length,
      averageLevel: currentAvg,
    },
    projected: {
      capabilities: futureCapabilities,
      averageLevel: projectedAvg,
      overallImprovement: projectedAvg - currentAvg,
    },
    improvements: projected,
  };
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
  STATE.__loaf.structuralHumility = {
    stats: {
      abstentions: 0, nonProgressRecords: 0, terminalQuestions: 0,
      unresolvedPreserved: 0, conceptualDebtsTracked: 0,
      stabilityAnalyses: 0, futureCapacityModels: 0,
    },
  };

  register("loaf.humility", "status", (ctx) => {
    const sh = ctx.state.__loaf.structuralHumility;
    return {
      ok: true,
      abstentions: abstentions.size,
      nonProgressRecords: nonProgressRecords.size,
      terminalQuestions: terminalQuestions.size,
      unresolvedQuestions: unresolvedQuestions.size,
      conceptualDebts: conceptualDebtSummary(),
      stats: sh.stats,
    };
  }, { public: true });

  register("loaf.humility", "abstain", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.abstentions++;
    return recordAbstention(input.question, input.reason, input.domain, input.notes);
  }, { public: false });

  register("loaf.humility", "schedule_revisit", (_ctx, input = {}) => {
    return scheduleRevisit(String(input.abstentionId || ""), input.revisitAfterMs);
  }, { public: false });

  register("loaf.humility", "record_non_progress", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.nonProgressRecords++;
    return recordNonProgress(input.question, input.attemptHistory, input.diagnosis);
  }, { public: false });

  register("loaf.humility", "register_terminal_question", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.terminalQuestions++;
    return registerTerminalQuestion(input.question, input.domain, input.reason, input.relatedQuestions);
  }, { public: false });

  register("loaf.humility", "annotate_resolution_path", (_ctx, input = {}) => {
    return annotateResolutionPath(String(input.questionId || ""), input.requirements);
  }, { public: false });

  register("loaf.humility", "preserve_unresolved", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.unresolvedPreserved++;
    return preserveUnresolvedQuestion(input.question, input.domain, input.context);
  }, { public: false });

  register("loaf.humility", "track_conceptual_debt", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.conceptualDebtsTracked++;
    return trackConceptualDebt(input.category, input.description, input.domain, input.priority);
  }, { public: false });

  register("loaf.humility", "conceptual_debt_summary", (_ctx) => {
    return { ok: true, ...conceptualDebtSummary() };
  }, { public: true });

  register("loaf.humility", "analyze_belief_stability", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.stabilityAnalyses++;
    return analyzeBeliefStability(input.beliefs || []);
  }, { public: true });

  register("loaf.humility", "model_future_capacity", (ctx, input = {}) => {
    const sh = ctx.state.__loaf.structuralHumility;
    sh.stats.futureCapacityModels++;
    return modelFutureCapacity(input.currentCapabilities, input.projectedImprovements);
  }, { public: true });

  register("loaf.humility", "list_abstentions", (_ctx, input = {}) => {
    let list = Array.from(abstentions.values());
    if (input.reason) list = list.filter(a => a.reason === input.reason);
    if (input.domain) list = list.filter(a => a.domain === input.domain);
    return { ok: true, abstentions: list.slice(0, Number(input.limit || 50)) };
  }, { public: true });

  register("loaf.humility", "list_terminal_questions", (_ctx, input = {}) => {
    let list = Array.from(terminalQuestions.values());
    if (input.domain) list = list.filter(q => q.domain === input.domain);
    return { ok: true, terminalQuestions: list.slice(0, 50) };
  }, { public: true });

  register("loaf.humility", "list_unresolved", (_ctx, input = {}) => {
    let list = Array.from(unresolvedQuestions.values());
    if (input.domain) list = list.filter(q => q.domain === input.domain);
    return { ok: true, unresolvedQuestions: list.slice(0, 50) };
  }, { public: true });
}

export {
  ABSTENTION_REASONS,
  DEBT_CATEGORIES,
  recordAbstention,
  scheduleRevisit,
  recordNonProgress,
  registerTerminalQuestion,
  annotateResolutionPath,
  preserveUnresolvedQuestion,
  trackConceptualDebt,
  conceptualDebtSummary,
  analyzeBeliefStability,
  modelFutureCapacity,
  init,
};
