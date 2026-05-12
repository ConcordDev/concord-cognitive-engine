import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF V.2 — Truth Lifecycle & Epistemic Health
 *
 * Capabilities (Civilizational-Scale):
 *   4.  Formalized "truth lifecycle" (birth → challenge → stabilization → decay)
 *   5.  Automated detection of epistemic stagnation
 *   6.  Institutional blind-spot discovery
 *   9.  Epistemic rollback of failed societal decisions
 *   16. Canon fracture detection and repair
 *   17. Competing world-model coexistence without collapse
 *   18. Truth robustness metrics usable outside Concord
 *   19. Knowledge stress-tests under adversarial assumptions
 *   20. Cognitive debt accounting (what society "owes" itself epistemically)
 *   26. Civilization-level error correction
 *   27. Governance evolution driven by observed failure, not ideology
 *   28. Discovery of new invariant classes
 *   29. Emergent scientific unification across domains
 *   30. Epistemic self-repair at societal scale
 *
 * Design:
 *   - Truths progress through a formal lifecycle with explicit state transitions
 *   - Stagnation is detected when knowledge stops evolving
 *   - Blind spots are found by analyzing coverage asymmetries
 *   - Epistemic rollback reverses failed decisions with full audit trail
 *   - Canon fractures are detected when authoritative knowledge diverges
 */

// === TRUTH LIFECYCLE ===

const TRUTH_STATES = Object.freeze({
  BORN: "born",                 // newly introduced claim
  CHALLENGED: "challenged",     // under active challenge
  STABILIZED: "stabilized",     // survived challenges, widely accepted
  DECAYING: "decaying",         // losing support or relevance
  DEAD: "dead",                 // no longer accepted
  ROLLED_BACK: "rolled_back",   // explicitly reverted
});

const truths = new LruMap(); // truthId -> Truth

/**
 * Create a truth in the lifecycle system.
 */
function birthTruth(claim, domain, evidence, proposer) {
  const id = `truth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const truth = {
    id,
    claim: String(claim).slice(0, 5000),
    domain: String(domain || "general"),
    state: TRUTH_STATES.BORN,
    confidence: Math.max(0, Math.min(1, Number(evidence?.confidence ?? 0.5))),
    evidence: Array.isArray(evidence) ? evidence : evidence ? [evidence] : [],
    challenges: [],
    stateHistory: [{
      from: null, to: TRUTH_STATES.BORN, ts: new Date().toISOString(), reason: "initial_proposal",
    }],
    proposer: String(proposer || "anonymous"),
    robustness: 0,
    stagnationScore: 0,
    lastActivity: Date.now(),
    createdAt: new Date().toISOString(),
  };

  truths.set(id, truth);
  capMap(truths, 50000);

  return { ok: true, truth: sanitizeTruth(truth) };
}

/**
 * Transition a truth to a new lifecycle state.
 */
function transitionTruth(truthId, newState, reason) {
  const truth = truths.get(truthId);
  if (!truth) return { ok: false, error: "truth_not_found" };

  const validTransitions = {
    [TRUTH_STATES.BORN]: [TRUTH_STATES.CHALLENGED, TRUTH_STATES.STABILIZED, TRUTH_STATES.DEAD],
    [TRUTH_STATES.CHALLENGED]: [TRUTH_STATES.STABILIZED, TRUTH_STATES.DECAYING, TRUTH_STATES.DEAD],
    [TRUTH_STATES.STABILIZED]: [TRUTH_STATES.CHALLENGED, TRUTH_STATES.DECAYING],
    [TRUTH_STATES.DECAYING]: [TRUTH_STATES.DEAD, TRUTH_STATES.CHALLENGED, TRUTH_STATES.STABILIZED],
    [TRUTH_STATES.DEAD]: [TRUTH_STATES.BORN], // rebirth possible
    [TRUTH_STATES.ROLLED_BACK]: [TRUTH_STATES.BORN],
  };

  const allowed = validTransitions[truth.state] || [];
  if (!allowed.includes(newState) && newState !== TRUTH_STATES.ROLLED_BACK) {
    return {
      ok: false,
      error: "invalid_transition",
      currentState: truth.state,
      allowedTransitions: allowed,
    };
  }

  truth.stateHistory.push({
    from: truth.state,
    to: newState,
    ts: new Date().toISOString(),
    reason: String(reason || "").slice(0, 1000),
  });
  if (truth.stateHistory.length > 100) truth.stateHistory.splice(0, truth.stateHistory.length - 100);

  truth.state = newState;
  truth.lastActivity = Date.now();

  return { ok: true, truth: sanitizeTruth(truth) };
}

// === STAGNATION DETECTION ===

/**
 * Detect epistemic stagnation: knowledge that has stopped evolving.
 */
function detectStagnation(thresholdMs = 7 * 86400000) {
  const now = Date.now();
  const stagnant = [];

  for (const [, truth] of truths) {
    if (truth.state === TRUTH_STATES.DEAD || truth.state === TRUTH_STATES.ROLLED_BACK) continue;

    const age = now - truth.lastActivity;
    if (age > thresholdMs) {
      const stagnationScore = Math.min(1, age / (thresholdMs * 10));
      truth.stagnationScore = stagnationScore;
      stagnant.push({
        id: truth.id,
        claim: truth.claim.slice(0, 200),
        domain: truth.domain,
        state: truth.state,
        stagnationScore,
        daysSinceActivity: Math.floor(age / 86400000),
      });
    }
  }

  return {
    ok: true,
    stagnant: stagnant.sort((a, b) => b.stagnationScore - a.stagnationScore),
    totalStagnant: stagnant.length,
    totalActive: truths.size - stagnant.length,
  };
}

// === BLIND-SPOT DISCOVERY ===

/**
 * Discover institutional blind spots by analyzing coverage asymmetries.
 */
function discoverBlindSpots(expectedDomains, actualDomains) {
  const expected = new Set(Array.isArray(expectedDomains) ? expectedDomains : []);
  const _actual = new Set(Array.isArray(actualDomains) ? actualDomains : []);

  // Domains with truths in the system
  const coveredDomains = new Set();
  for (const [, truth] of truths) {
    if (truth.state !== TRUTH_STATES.DEAD) {
      coveredDomains.add(truth.domain);
    }
  }

  const blindSpots = [];

  // Expected but not covered
  for (const domain of expected) {
    if (!coveredDomains.has(domain)) {
      blindSpots.push({
        domain,
        type: "completely_missing",
        severity: "critical",
        reason: "Expected domain has zero truths in the system",
      });
    }
  }

  // Covered but with very low truth count
  const domainCounts = {};
  for (const [, truth] of truths) {
    if (truth.state !== TRUTH_STATES.DEAD) {
      domainCounts[truth.domain] = (domainCounts[truth.domain] || 0) + 1;
    }
  }

  const avgCount = Object.values(domainCounts).length > 0
    ? Object.values(domainCounts).reduce((s, v) => s + v, 0) / Object.values(domainCounts).length
    : 0;

  for (const [domain, count] of Object.entries(domainCounts)) {
    if (count < avgCount * 0.2 && count < 5) {
      blindSpots.push({
        domain,
        type: "severely_underrepresented",
        severity: "high",
        truthCount: count,
        averageCount: Math.round(avgCount),
        reason: `Domain has ${count} truths vs average of ${Math.round(avgCount)}`,
      });
    }
  }

  return {
    ok: true,
    blindSpots: blindSpots.sort((a, b) => {
      const sev = { critical: 0, high: 1, moderate: 2, low: 3 };
      return (sev[a.severity] || 4) - (sev[b.severity] || 4);
    }),
    totalBlindSpots: blindSpots.length,
    coveredDomains: coveredDomains.size,
  };
}

// === EPISTEMIC ROLLBACK ===

const rollbackLog = []; // Historical rollback records

/**
 * Perform an epistemic rollback: revert a truth (or set of truths)
 * that led to a failed societal decision.
 */
function epistemicRollback(truthIds, reason, actor) {
  const results = [];

  for (const truthId of (Array.isArray(truthIds) ? truthIds : [truthIds])) {
    const truth = truths.get(String(truthId));
    if (!truth) {
      results.push({ truthId, ok: false, error: "not_found" });
      continue;
    }

    truth.stateHistory.push({
      from: truth.state,
      to: TRUTH_STATES.ROLLED_BACK,
      ts: new Date().toISOString(),
      reason: `Epistemic rollback: ${String(reason).slice(0, 500)}`,
      actor: String(actor || "system"),
    });

    truth.state = TRUTH_STATES.ROLLED_BACK;
    truth.lastActivity = Date.now();
    results.push({ truthId, ok: true, newState: truth.state });
  }

  const entry = {
    id: `rb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    truthIds: Array.isArray(truthIds) ? truthIds : [truthIds],
    reason: String(reason).slice(0, 2000),
    actor: String(actor || "system"),
    results,
    rolledBackAt: new Date().toISOString(),
  };

  rollbackLog.push(entry);
  if (rollbackLog.length > 500) rollbackLog.splice(0, rollbackLog.length - 500);

  return { ok: true, rollback: entry };
}

// === CANON FRACTURE DETECTION ===

/**
 * Detect canon fractures: cases where authoritative knowledge has diverged
 * into incompatible versions across communities or domains.
 */
function detectCanonFractures() {
  const fractures = [];

  // Group truths by domain
  const byDomain = {};
  for (const [, truth] of truths) {
    if (truth.state === TRUTH_STATES.DEAD || truth.state === TRUTH_STATES.ROLLED_BACK) continue;
    if (!byDomain[truth.domain]) byDomain[truth.domain] = [];
    byDomain[truth.domain].push(truth);
  }

  // Look for contradictions within domains
  for (const [domain, domainTruths] of Object.entries(byDomain)) {
    for (let i = 0; i < domainTruths.length; i++) {
      for (let j = i + 1; j < domainTruths.length; j++) {
        const a = domainTruths[i];
        const b = domainTruths[j];

        // Simple contradiction check
        const aText = a.claim.toLowerCase();
        const bText = b.claim.toLowerCase();
        const hasNegation =
          (aText.includes("not") && !bText.includes("not")) ||
          (!aText.includes("not") && bText.includes("not"));

        const wordsA = new Set(aText.split(/\s+/).filter(w => w.length > 4));
        const wordsB = new Set(bText.split(/\s+/).filter(w => w.length > 4));
        let overlap = 0;
        for (const w of wordsA) if (wordsB.has(w)) overlap++;
        const overlapRatio = (wordsA.size + wordsB.size) > 0
          ? (2 * overlap) / (wordsA.size + wordsB.size) : 0;

        if (hasNegation && overlapRatio > 0.3) {
          fractures.push({
            domain,
            truthA: { id: a.id, claim: a.claim.slice(0, 200), state: a.state },
            truthB: { id: b.id, claim: b.claim.slice(0, 200), state: b.state },
            overlapRatio,
            severity: a.state === TRUTH_STATES.STABILIZED && b.state === TRUTH_STATES.STABILIZED
              ? "critical" : "moderate",
          });
        }
      }
    }
  }

  return { ok: true, fractures, totalFractures: fractures.length };
}

// === TRUTH ROBUSTNESS METRICS (Exportable) ===

/**
 * Compute truth robustness metrics in a format usable outside Concord.
 */
function computeRobustnessMetrics(truthId) {
  const truth = truths.get(truthId);
  if (!truth) return { ok: false, error: "truth_not_found" };

  const evidenceStrength = truth.evidence.length > 0
    ? truth.evidence.reduce((s, e) => s + (e.confidence || 0.5), 0) / truth.evidence.length
    : 0;

  const survivalScore = truth.stateHistory.filter(h => h.to === TRUTH_STATES.STABILIZED).length > 0 ? 0.3 : 0;
  const challengeSurvival = truth.challenges.length > 0
    ? Math.min(0.3, (truth.stateHistory.filter(h => h.from === TRUTH_STATES.CHALLENGED && h.to === TRUTH_STATES.STABILIZED).length / truth.challenges.length) * 0.3)
    : 0.1;

  const stagnationPenalty = truth.stagnationScore * 0.2;

  const robustness = Math.max(0, Math.min(1,
    evidenceStrength * 0.4 + survivalScore + challengeSurvival - stagnationPenalty
  ));

  truth.robustness = robustness;

  return {
    ok: true,
    truthId,
    robustness,
    breakdown: {
      evidenceStrength,
      survivalScore,
      challengeSurvival,
      stagnationPenalty,
    },
    exportable: true,
    format: "concord-robustness-v1",
  };
}

// === KNOWLEDGE STRESS TESTS ===

/**
 * Stress-test a set of truths under adversarial assumptions.
 */
function stressTest(truthIds, adversarialAssumptions) {
  const results = [];

  for (const truthId of (Array.isArray(truthIds) ? truthIds : [truthIds])) {
    const truth = truths.get(String(truthId));
    if (!truth) {
      results.push({ truthId, survived: false, reason: "not_found" });
      continue;
    }

    const failures = [];

    for (const assumption of (Array.isArray(adversarialAssumptions) ? adversarialAssumptions : [])) {
      const assumptionText = String(assumption.text || assumption).toLowerCase();
      const claimText = truth.claim.toLowerCase();

      // Check if assumption directly undermines the claim
      const claimWords = new Set(claimText.split(/\s+/).filter(w => w.length > 3));
      const assumptionWords = new Set(assumptionText.split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const w of claimWords) if (assumptionWords.has(w)) overlap++;

      if (overlap >= 2 && assumptionText.includes("not")) {
        failures.push({
          assumption: String(assumption.text || assumption).slice(0, 200),
          impact: "undermines_claim",
          severity: "high",
        });
      }

      if (overlap >= 3) {
        failures.push({
          assumption: String(assumption.text || assumption).slice(0, 200),
          impact: "significant_overlap",
          severity: "moderate",
        });
      }
    }

    results.push({
      truthId,
      claim: truth.claim.slice(0, 200),
      survived: failures.length === 0,
      failures,
      robustness: truth.robustness,
    });
  }

  return {
    ok: true,
    results,
    totalTested: results.length,
    totalSurvived: results.filter(r => r.survived).length,
    totalFailed: results.filter(r => !r.survived).length,
  };
}

// === HELPERS ===

function sanitizeTruth(t) {
  return {
    id: t.id, claim: t.claim.slice(0, 200), domain: t.domain,
    state: t.state, confidence: t.confidence, robustness: t.robustness,
    stagnationScore: t.stagnationScore, evidenceCount: t.evidence.length,
    challengeCount: t.challenges.length, transitions: t.stateHistory.length,
    createdAt: t.createdAt,
  };
}

function capMap(map, max) {
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.truthLifecycle = {
    stats: {
      born: 0, transitioned: 0, stagnationScans: 0, blindSpotScans: 0,
      rollbacks: 0, fractureScans: 0, robustnessChecks: 0, stressTests: 0,
    },
  };

  register("loaf.truth", "status", (ctx) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    const all = Array.from(truths.values());
    return {
      ok: true,
      totalTruths: truths.size,
      byState: Object.fromEntries(
        Object.values(TRUTH_STATES).map(s => [s, all.filter(t => t.state === s).length])
      ),
      rollbackCount: rollbackLog.length,
      stats: tl.stats,
    };
  }, { public: true });

  register("loaf.truth", "birth", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.born++;
    return birthTruth(input.claim, input.domain, input.evidence, ctx.actor?.id || input.proposer);
  }, { public: false });

  register("loaf.truth", "transition", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.transitioned++;
    return transitionTruth(String(input.truthId || ""), input.newState, input.reason);
  }, { public: false });

  register("loaf.truth", "detect_stagnation", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.stagnationScans++;
    return detectStagnation(input.thresholdMs);
  }, { public: true });

  register("loaf.truth", "discover_blind_spots", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.blindSpotScans++;
    return discoverBlindSpots(input.expectedDomains, input.actualDomains);
  }, { public: true });

  register("loaf.truth", "rollback", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.rollbacks++;
    return epistemicRollback(input.truthIds, input.reason, ctx.actor?.id);
  }, { public: false });

  register("loaf.truth", "detect_fractures", (ctx) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.fractureScans++;
    return detectCanonFractures();
  }, { public: true });

  register("loaf.truth", "robustness", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.robustnessChecks++;
    return computeRobustnessMetrics(String(input.truthId || ""));
  }, { public: true });

  register("loaf.truth", "stress_test", (ctx, input = {}) => {
    const tl = ctx.state.__loaf.truthLifecycle;
    tl.stats.stressTests++;
    return stressTest(input.truthIds, input.assumptions);
  }, { public: true });

  register("loaf.truth", "list", (_ctx, input = {}) => {
    let list = Array.from(truths.values());
    if (input.state) list = list.filter(t => t.state === input.state);
    if (input.domain) list = list.filter(t => t.domain === input.domain);
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, truths: list.slice(-limit).map(sanitizeTruth) };
  }, { public: true });

  register("loaf.truth", "rollback_log", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 50), 200);
    return { ok: true, rollbacks: rollbackLog.slice(-limit) };
  }, { public: true });
}

export {
  TRUTH_STATES,
  birthTruth,
  transitionTruth,
  detectStagnation,
  discoverBlindSpots,
  epistemicRollback,
  detectCanonFractures,
  computeRobustnessMetrics,
  stressTest,
  init,
};
