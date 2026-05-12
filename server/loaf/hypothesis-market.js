import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IV.2 — Hypothesis Markets & Adversarial Verification
 *
 * Capabilities:
 *   5.  Competitive hypothesis markets
 *   6.  Adversarial verification between independent councils
 *   9.  Consensus-by-evidence rather than voting
 *   10. Truth-weighted influence instead of role-based authority
 *   11. Knowledge stress-testing under simulated adversarial conditions
 *   12. Automated red-teaming of claims and models
 *   22. Automatic detection of circular reasoning and collapse risks
 *   23. Knowledge robustness scoring
 *   27. Incentive-aligned truth seeking under economic pressure
 *
 * Design:
 *   - Hypothesis lifecycle: proposed → challenged → defended → resolved
 *   - Multiple independent councils verify adversarially
 *   - Consensus emerges from evidence weight, not voting
 *   - Truth-weighted influence replaces role-based authority
 *   - Automated red-teaming generates challenges
 *   - Circular reasoning and collapse risk detection
 */

const HYPOTHESIS_STATES = Object.freeze({
  PROPOSED: "proposed",
  CHALLENGED: "challenged",
  DEFENDED: "defended",
  RESOLVED_TRUE: "resolved_true",
  RESOLVED_FALSE: "resolved_false",
  COLLAPSED: "collapsed",        // circular or unsupported
  INDETERMINATE: "indeterminate", // insufficient evidence
});

// Hypothesis store
const hypotheses = new LruMap(); // hypothesisId -> Hypothesis

// Truth-weighted influence ledger: actorId -> { accuracy, totalClaims, correctClaims }
const influenceLedger = new Map();

// Red-team challenge registry
const redTeamChallenges = new Map();

/**
 * Propose a new hypothesis into the market.
 */
function proposeHypothesis(claim, evidence, proposerId, domain) {
  const id = `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const hypothesis = {
    id,
    claim: String(claim).slice(0, 5000),
    domain: String(domain || "general"),
    state: HYPOTHESIS_STATES.PROPOSED,
    proposerId: String(proposerId || "anonymous"),
    evidence: Array.isArray(evidence) ? evidence.map(normalizeEvidence) : [],
    challenges: [],
    defenses: [],
    resolutions: [],
    robustnessScore: 0,
    circularityCheck: null,
    truthWeight: 0,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };

  hypothesis.robustnessScore = computeRobustness(hypothesis);
  hypotheses.set(id, hypothesis);
  capStore(hypotheses, 50000);

  return { ok: true, hypothesis: sanitizeHypothesis(hypothesis) };
}

/**
 * Challenge a hypothesis with counter-evidence.
 */
function challengeHypothesis(hypothesisId, counterEvidence, challengerId, reason) {
  const hyp = hypotheses.get(hypothesisId);
  if (!hyp) return { ok: false, error: "hypothesis_not_found" };
  if (hyp.state === HYPOTHESIS_STATES.RESOLVED_TRUE || hyp.state === HYPOTHESIS_STATES.RESOLVED_FALSE) {
    return { ok: false, error: "hypothesis_already_resolved" };
  }

  const challenge = {
    id: `chal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    challengerId: String(challengerId || "anonymous"),
    reason: String(reason || "").slice(0, 2000),
    counterEvidence: Array.isArray(counterEvidence) ? counterEvidence.map(normalizeEvidence) : [],
    submittedAt: new Date().toISOString(),
    rebutted: false,
  };

  hyp.challenges.push(challenge);
  if (hyp.challenges.length > 100) hyp.challenges.splice(0, hyp.challenges.length - 100);
  hyp.state = HYPOTHESIS_STATES.CHALLENGED;
  hyp.robustnessScore = computeRobustness(hyp);

  return { ok: true, challenge, hypothesis: sanitizeHypothesis(hyp) };
}

/**
 * Defend a hypothesis against a challenge.
 */
function defendHypothesis(hypothesisId, challengeId, defense, defenderId) {
  const hyp = hypotheses.get(hypothesisId);
  if (!hyp) return { ok: false, error: "hypothesis_not_found" };

  const challenge = hyp.challenges.find(c => c.id === challengeId);
  if (!challenge) return { ok: false, error: "challenge_not_found" };

  const def = {
    id: `def_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    challengeId,
    defenderId: String(defenderId || "anonymous"),
    evidence: Array.isArray(defense.evidence) ? defense.evidence.map(normalizeEvidence) : [],
    argument: String(defense.argument || "").slice(0, 2000),
    submittedAt: new Date().toISOString(),
  };

  hyp.defenses.push(def);
  if (hyp.defenses.length > 100) hyp.defenses.splice(0, hyp.defenses.length - 100);
  hyp.state = HYPOTHESIS_STATES.DEFENDED;
  hyp.robustnessScore = computeRobustness(hyp);

  return { ok: true, defense: def, hypothesis: sanitizeHypothesis(hyp) };
}

/**
 * Resolve a hypothesis based on accumulated evidence weight (not voting).
 * Consensus-by-evidence: the resolution depends on evidence strength, not headcount.
 */
function resolveByEvidence(hypothesisId) {
  const hyp = hypotheses.get(hypothesisId);
  if (!hyp) return { ok: false, error: "hypothesis_not_found" };

  // Compute evidence weight for the hypothesis
  const forWeight = computeEvidenceWeight(hyp.evidence);
  const defenseWeight = hyp.defenses.reduce(
    (s, d) => s + computeEvidenceWeight(d.evidence), 0
  );
  const againstWeight = hyp.challenges.reduce(
    (s, c) => s + computeEvidenceWeight(c.counterEvidence), 0
  );

  const totalFor = forWeight + defenseWeight;
  const totalAgainst = againstWeight;
  const total = totalFor + totalAgainst;

  if (total === 0) {
    hyp.state = HYPOTHESIS_STATES.INDETERMINATE;
    hyp.resolvedAt = new Date().toISOString();
    return { ok: true, state: hyp.state, reason: "no_evidence", forWeight: 0, againstWeight: 0 };
  }

  const ratio = totalFor / total;

  if (ratio >= 0.7) {
    hyp.state = HYPOTHESIS_STATES.RESOLVED_TRUE;
  } else if (ratio <= 0.3) {
    hyp.state = HYPOTHESIS_STATES.RESOLVED_FALSE;
  } else {
    hyp.state = HYPOTHESIS_STATES.INDETERMINATE;
  }

  hyp.resolvedAt = new Date().toISOString();
  hyp.truthWeight = ratio;

  // Update influence ledger for proposer
  updateInfluence(hyp.proposerId, hyp.state === HYPOTHESIS_STATES.RESOLVED_TRUE);
  for (const c of hyp.challenges) {
    updateInfluence(c.challengerId, hyp.state === HYPOTHESIS_STATES.RESOLVED_FALSE);
  }

  return {
    ok: true,
    state: hyp.state,
    forWeight: totalFor,
    againstWeight: totalAgainst,
    ratio,
    hypothesis: sanitizeHypothesis(hyp),
  };
}

/**
 * Get truth-weighted influence for an actor.
 * Actors who are frequently correct gain more influence.
 */
function getInfluence(actorId) {
  const entry = influenceLedger.get(actorId);
  if (!entry) return { actorId, accuracy: 0, totalClaims: 0, weight: 0 };
  return {
    actorId,
    accuracy: entry.totalClaims > 0 ? entry.correctClaims / entry.totalClaims : 0,
    totalClaims: entry.totalClaims,
    correctClaims: entry.correctClaims,
    weight: entry.totalClaims > 0
      ? (entry.correctClaims / entry.totalClaims) * Math.log(entry.totalClaims + 1)
      : 0,
  };
}

function updateInfluence(actorId, wasCorrect) {
  if (!influenceLedger.has(actorId)) {
    influenceLedger.set(actorId, { accuracy: 0, totalClaims: 0, correctClaims: 0 });
  }
  const entry = influenceLedger.get(actorId);
  entry.totalClaims++;
  if (wasCorrect) entry.correctClaims++;
  entry.accuracy = entry.correctClaims / entry.totalClaims;

  if (influenceLedger.size > 50000) {
    const oldest = influenceLedger.keys().next().value;
    influenceLedger.delete(oldest);
  }
}

// === AUTOMATED RED-TEAMING ===

/**
 * Generate automated red-team challenges for a hypothesis.
 * Tests claim robustness under adversarial conditions.
 */
function redTeam(hypothesisId) {
  const hyp = hypotheses.get(hypothesisId);
  if (!hyp) return { ok: false, error: "hypothesis_not_found" };

  const challenges = [];

  // 1. Negation challenge: what if the opposite is true?
  challenges.push({
    type: "negation",
    challenge: `What if the opposite of "${hyp.claim.slice(0, 100)}..." were true?`,
    severity: "standard",
  });

  // 2. Scope challenge: does this generalize beyond its evidence base?
  if (hyp.evidence.length < 3) {
    challenges.push({
      type: "insufficient_evidence",
      challenge: "Only " + hyp.evidence.length + " evidence items support this claim. Is this sufficient?",
      severity: "high",
    });
  }

  // 3. Source diversity: are all sources from similar provenance?
  const sources = hyp.evidence.map(e => e.source).filter(Boolean);
  const uniqueSources = new Set(sources);
  if (sources.length > 0 && uniqueSources.size === 1) {
    challenges.push({
      type: "source_monoculture",
      challenge: "All evidence comes from a single source type. Independent corroboration needed.",
      severity: "high",
    });
  }

  // 4. Circular reasoning check
  const circularityResult = detectCircularReasoning(hypothesisId);
  if (circularityResult.isCircular) {
    challenges.push({
      type: "circular_reasoning",
      challenge: `Circular reasoning detected: ${circularityResult.cycle.join(" → ")}`,
      severity: "critical",
    });
  }

  // 5. Confidence calibration: is confidence consistent with evidence quantity?
  const avgConf = hyp.evidence.length > 0
    ? hyp.evidence.reduce((s, e) => s + e.confidence, 0) / hyp.evidence.length
    : 0;
  if (avgConf > 0.8 && hyp.evidence.length < 5) {
    challenges.push({
      type: "overconfidence",
      challenge: `High confidence (${(avgConf * 100).toFixed(0)}%) with limited evidence (${hyp.evidence.length} items)`,
      severity: "moderate",
    });
  }

  const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const result = {
    id,
    hypothesisId,
    challenges,
    totalChallenges: challenges.length,
    criticalCount: challenges.filter(c => c.severity === "critical").length,
    generatedAt: new Date().toISOString(),
  };

  redTeamChallenges.set(id, result);
  if (redTeamChallenges.size > 10000) {
    const oldest = redTeamChallenges.keys().next().value;
    redTeamChallenges.delete(oldest);
  }

  return { ok: true, ...result };
}

// === CIRCULAR REASONING DETECTION ===

/**
 * Detect circular reasoning in evidence chains.
 * Follows evidence references to see if they loop back.
 */
function detectCircularReasoning(hypothesisId) {
  const hyp = hypotheses.get(hypothesisId);
  if (!hyp) return { isCircular: false, error: "hypothesis_not_found" };

  // Build a reference graph from evidence
  const visited = new Set();
  const path = [];

  function dfs(evidenceItems, depth) {
    if (depth > 20) return false;
    for (const e of evidenceItems) {
      const ref = e.reference || e.source;
      if (!ref) continue;

      if (ref === hypothesisId || path.includes(ref)) {
        path.push(ref);
        return true;
      }

      if (visited.has(ref)) continue;
      visited.add(ref);
      path.push(ref);

      // Check if the reference points to another hypothesis
      const refHyp = hypotheses.get(ref);
      if (refHyp) {
        if (dfs(refHyp.evidence, depth + 1)) return true;
      }

      path.pop();
    }
    return false;
  }

  path.push(hypothesisId);
  const isCircular = dfs(hyp.evidence, 0);

  return {
    isCircular,
    cycle: isCircular ? [...path] : [],
    depth: path.length,
  };
}

/**
 * Compute knowledge robustness score for a hypothesis.
 * Higher = more robust (well-evidenced, defended, not circular).
 */
function computeRobustness(hyp) {
  let score = 0;

  // Evidence quantity and quality
  const evidenceScore = Math.min(1, hyp.evidence.length / 5) * 0.3;
  const avgConfidence = hyp.evidence.length > 0
    ? hyp.evidence.reduce((s, e) => s + e.confidence, 0) / hyp.evidence.length
    : 0;
  score += evidenceScore * avgConfidence;

  // Defense score (survived challenges)
  const challengeCount = hyp.challenges.length;
  const defenseCount = hyp.defenses.length;
  if (challengeCount > 0) {
    score += Math.min(0.3, (defenseCount / challengeCount) * 0.3);
  } else {
    score += 0.1; // untested gets moderate credit
  }

  // Source diversity bonus
  const sources = new Set(hyp.evidence.map(e => e.source).filter(Boolean));
  score += Math.min(0.2, sources.size * 0.05);

  // Penalty for unaddressed challenges
  const unrebutted = hyp.challenges.filter(c => !c.rebutted).length;
  score -= unrebutted * 0.05;

  return Math.max(0, Math.min(1, score));
}

// === HELPERS ===

function normalizeEvidence(e) {
  return {
    text: String(e.text || e).slice(0, 2000),
    source: e.source || null,
    reference: e.reference || null,
    confidence: Math.max(0, Math.min(1, Number(e.confidence ?? 0.5))),
    addedAt: new Date().toISOString(),
  };
}

function computeEvidenceWeight(evidenceArray) {
  if (!Array.isArray(evidenceArray) || evidenceArray.length === 0) return 0;
  return evidenceArray.reduce((s, e) => s + (e.confidence || 0.5), 0);
}

function sanitizeHypothesis(hyp) {
  return {
    id: hyp.id,
    claim: hyp.claim.slice(0, 200),
    domain: hyp.domain,
    state: hyp.state,
    proposerId: hyp.proposerId,
    evidenceCount: hyp.evidence.length,
    challengeCount: hyp.challenges.length,
    defenseCount: hyp.defenses.length,
    robustnessScore: hyp.robustnessScore,
    truthWeight: hyp.truthWeight,
    createdAt: hyp.createdAt,
    resolvedAt: hyp.resolvedAt,
  };
}

function capStore(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.hypothesisMarket = {
    stats: {
      proposed: 0, challenged: 0, defended: 0, resolved: 0,
      redTeamRuns: 0, circularDetections: 0,
    },
  };

  register("loaf.hypothesis", "status", (ctx) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    const all = Array.from(hypotheses.values());
    return {
      ok: true,
      totalHypotheses: hypotheses.size,
      byState: {
        proposed: all.filter(h => h.state === HYPOTHESIS_STATES.PROPOSED).length,
        challenged: all.filter(h => h.state === HYPOTHESIS_STATES.CHALLENGED).length,
        defended: all.filter(h => h.state === HYPOTHESIS_STATES.DEFENDED).length,
        resolved_true: all.filter(h => h.state === HYPOTHESIS_STATES.RESOLVED_TRUE).length,
        resolved_false: all.filter(h => h.state === HYPOTHESIS_STATES.RESOLVED_FALSE).length,
        indeterminate: all.filter(h => h.state === HYPOTHESIS_STATES.INDETERMINATE).length,
      },
      influenceTracked: influenceLedger.size,
      redTeamChallenges: redTeamChallenges.size,
      stats: hm.stats,
    };
  }, { public: true });

  register("loaf.hypothesis", "propose", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    const result = proposeHypothesis(
      input.claim, input.evidence, ctx.actor?.id || input.proposerId, input.domain
    );
    if (result.ok) hm.stats.proposed++;
    return result;
  }, { public: false });

  register("loaf.hypothesis", "challenge", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    const result = challengeHypothesis(
      String(input.hypothesisId || ""), input.counterEvidence,
      ctx.actor?.id || input.challengerId, input.reason
    );
    if (result.ok) hm.stats.challenged++;
    return result;
  }, { public: false });

  register("loaf.hypothesis", "defend", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    const result = defendHypothesis(
      String(input.hypothesisId || ""), String(input.challengeId || ""),
      input.defense || {}, ctx.actor?.id || input.defenderId
    );
    if (result.ok) hm.stats.defended++;
    return result;
  }, { public: false });

  register("loaf.hypothesis", "resolve", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    const result = resolveByEvidence(String(input.hypothesisId || ""));
    if (result.ok) hm.stats.resolved++;
    return result;
  }, { public: false });

  register("loaf.hypothesis", "get_influence", (ctx, input = {}) => {
    return { ok: true, ...getInfluence(String(input.actorId || ctx.actor?.id || "")) };
  }, { public: true });

  register("loaf.hypothesis", "red_team", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    hm.stats.redTeamRuns++;
    return redTeam(String(input.hypothesisId || ""));
  }, { public: true });

  register("loaf.hypothesis", "check_circular", (ctx, input = {}) => {
    const hm = ctx.state.__loaf.hypothesisMarket;
    hm.stats.circularDetections++;
    return { ok: true, ...detectCircularReasoning(String(input.hypothesisId || "")) };
  }, { public: true });

  register("loaf.hypothesis", "list", (_ctx, input = {}) => {
    let list = Array.from(hypotheses.values());
    if (input.state) list = list.filter(h => h.state === input.state);
    if (input.domain) list = list.filter(h => h.domain === input.domain);
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, hypotheses: list.slice(-limit).map(sanitizeHypothesis) };
  }, { public: true });

  register("loaf.hypothesis", "influence_leaderboard", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 20), 100);
    const entries = Array.from(influenceLedger.entries())
      .map(([id]) => getInfluence(id))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);
    return { ok: true, leaderboard: entries };
  }, { public: true });
}

export {
  HYPOTHESIS_STATES,
  proposeHypothesis,
  challengeHypothesis,
  defendHypothesis,
  resolveByEvidence,
  getInfluence,
  redTeam,
  detectCircularReasoning,
  computeRobustness,
  init,
};
