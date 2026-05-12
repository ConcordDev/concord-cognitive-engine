import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IV.1 — Cognitive Load Balancing & Knowledge Exploration
 *
 * Capabilities:
 *   1.  Cognitive load balancing across users and time
 *   2.  Automatic identification of underexplored knowledge regions
 *   3.  Self-generated research agendas based on epistemic gaps
 *   4.  Cross-user synthesis artifacts (emergent meta-DTUs)
 *   14. Canon divergence tracking and reconciliation
 *   15. Epistemic debt detection and cleanup
 *   19. Discovery of latent invariants from accumulated DTUs
 *   20. Emergent ontology refinement
 *   21. Cross-domain concept unification
 *   30. Civilization-scale knowledge curation primitives
 *
 * Design:
 *   - Per-user cognitive load scoring with temporal decay
 *   - Domain coverage maps identifying underexplored regions
 *   - Research agenda generation from gap analysis
 *   - Cross-user synthesis producing emergent meta-DTUs
 *   - Ontology refinement through concept clustering
 */

// === COGNITIVE LOAD TRACKING ===

const LOAD_TYPES = Object.freeze({
  ABSORPTION: "absorption",       // taking in new knowledge
  INTEGRATION: "integration",     // connecting knowledge
  PRODUCTION: "production",       // generating outputs
  VERIFICATION: "verification",   // checking claims
  GOVERNANCE: "governance",       // participating in governance
});

const LOAD_WEIGHTS = Object.freeze({
  [LOAD_TYPES.ABSORPTION]: 1.0,
  [LOAD_TYPES.INTEGRATION]: 1.5,
  [LOAD_TYPES.PRODUCTION]: 2.0,
  [LOAD_TYPES.VERIFICATION]: 1.2,
  [LOAD_TYPES.GOVERNANCE]: 1.8,
});

const LOAD_DECAY_RATE = 0.05;   // load decays over time
const MAX_LOAD_SCORE = 100;
const OVERLOAD_THRESHOLD = 80;

// userId -> { score, history[], lastDecay, domains{} }
const userLoads = new LruMap();

/**
 * Record cognitive load for a user.
 */
function recordLoad(userId, type, domain, weight = 1.0) {
  if (!userLoads.has(userId)) {
    userLoads.set(userId, {
      score: 0, history: [], lastDecay: Date.now(), domains: {},
    });
  }
  const user = userLoads.get(userId);
  const loadWeight = (LOAD_WEIGHTS[type] || 1.0) * Math.max(0, Math.min(10, Number(weight)));

  user.score = Math.min(MAX_LOAD_SCORE, user.score + loadWeight);
  user.domains[domain] = (user.domains[domain] || 0) + loadWeight;

  user.history.push({
    type, domain, weight: loadWeight, ts: Date.now(),
  });
  if (user.history.length > 500) user.history.splice(0, user.history.length - 500);

  return {
    userId,
    currentLoad: user.score,
    overloaded: user.score >= OVERLOAD_THRESHOLD,
    domain,
  };
}

/**
 * Apply temporal decay to all user loads.
 */
function decayLoads(dtMs = 60000) {
  const safeDt = Math.max(0, Number(dtMs) || 0);
  let decayed = 0;
  for (const [, user] of userLoads) {
    const factor = Math.exp(-LOAD_DECAY_RATE * (safeDt / 60000));
    const prev = user.score;
    user.score = user.score * factor;
    if (Math.abs(prev - user.score) > 0.01) decayed++;
    user.lastDecay = Date.now();
  }
  return { decayed, total: userLoads.size };
}

/**
 * Get load-balanced recommendation for which user should handle a task.
 */
function balanceLoad(candidateUserIds, taskType, taskDomain) {
  const candidates = candidateUserIds
    .map(uid => {
      const user = userLoads.get(uid) || { score: 0, domains: {} };
      return {
        userId: uid,
        currentLoad: user.score,
        domainExperience: user.domains[taskDomain] || 0,
        overloaded: user.score >= OVERLOAD_THRESHOLD,
      };
    })
    .filter(c => !c.overloaded)
    .sort((a, b) => a.currentLoad - b.currentLoad);

  if (candidates.length === 0) {
    return { ok: false, reason: "all_candidates_overloaded" };
  }

  return {
    ok: true,
    recommended: candidates[0].userId,
    candidates,
    taskType,
    taskDomain,
  };
}

// === KNOWLEDGE GAP DETECTION ===

// Domain coverage map: domain -> { coverage, dtuCount, lastUpdate, subdomain{} }
const domainCoverage = new Map();

/**
 * Update domain coverage based on DTU additions.
 */
function updateCoverage(domain, subdomain, dtuCount = 1) {
  if (!domainCoverage.has(domain)) {
    domainCoverage.set(domain, {
      coverage: 0, dtuCount: 0, lastUpdate: Date.now(), subdomains: {},
    });
  }
  const entry = domainCoverage.get(domain);
  entry.dtuCount += Math.max(0, Number(dtuCount));
  entry.lastUpdate = Date.now();

  if (subdomain) {
    entry.subdomains[subdomain] = (entry.subdomains[subdomain] || 0) + dtuCount;
  }

  // Recalculate coverage (logarithmic scaling — diminishing returns)
  entry.coverage = Math.min(1, Math.log(entry.dtuCount + 1) / Math.log(1000));

  if (domainCoverage.size > 10000) {
    const oldest = domainCoverage.keys().next().value;
    domainCoverage.delete(oldest);
  }

  return { domain, coverage: entry.coverage, dtuCount: entry.dtuCount };
}

/**
 * Identify underexplored knowledge regions.
 * Returns domains sorted by coverage gap (least covered first).
 */
function identifyGaps(knownDomains = []) {
  const gaps = [];

  // Check existing domains for low coverage
  for (const [domain, entry] of domainCoverage) {
    if (entry.coverage < 0.3) {
      gaps.push({
        domain,
        coverage: entry.coverage,
        dtuCount: entry.dtuCount,
        severity: entry.coverage < 0.1 ? "critical" : entry.coverage < 0.2 ? "high" : "moderate",
        staleness: Date.now() - entry.lastUpdate,
      });
    }
  }

  // Check for entirely missing domains from the known domain list
  for (const domain of knownDomains) {
    if (!domainCoverage.has(domain)) {
      gaps.push({
        domain,
        coverage: 0,
        dtuCount: 0,
        severity: "critical",
        staleness: Infinity,
        missing: true,
      });
    }
  }

  return gaps.sort((a, b) => a.coverage - b.coverage);
}

/**
 * Generate a research agenda from identified epistemic gaps.
 */
function generateResearchAgenda(gaps, maxItems = 20) {
  const agenda = gaps
    .slice(0, maxItems)
    .map((gap, i) => ({
      priority: i + 1,
      domain: gap.domain,
      coverage: gap.coverage,
      severity: gap.severity,
      action: gap.missing
        ? `Establish foundational knowledge in ${gap.domain}`
        : gap.coverage < 0.1
          ? `Urgently expand knowledge base in ${gap.domain} (${gap.dtuCount} DTUs, ${(gap.coverage * 100).toFixed(1)}% coverage)`
          : `Deepen coverage in ${gap.domain} (${(gap.coverage * 100).toFixed(1)}% coverage)`,
      researchQuestions: [
        `What are the foundational concepts in ${gap.domain}?`,
        `What are the key open problems in ${gap.domain}?`,
        `How does ${gap.domain} connect to adjacent domains?`,
      ],
    }));

  return {
    generatedAt: new Date().toISOString(),
    totalGaps: gaps.length,
    agendaItems: agenda.length,
    agenda,
  };
}

// === CROSS-USER SYNTHESIS & META-DTUs ===

// Emergent meta-DTUs from cross-user synthesis
const metaDTUs = new Map(); // metaDtuId -> { sources[], synthesis, confidence }

/**
 * Synthesize a meta-DTU from multiple user contributions.
 * A meta-DTU emerges when multiple users produce converging knowledge.
 */
function synthesizeMetaDTU(contributions) {
  if (!Array.isArray(contributions) || contributions.length < 2) {
    return { ok: false, error: "need_at_least_two_contributions" };
  }

  // Extract common themes
  const allTags = contributions.flatMap(c => c.tags || []);
  const tagFreq = {};
  for (const t of allTags) tagFreq[t] = (tagFreq[t] || 0) + 1;
  const commonTags = Object.entries(tagFreq)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([tag]) => tag);

  // Compute convergence score
  const userIds = new Set(contributions.map(c => c.userId || c.user || "anonymous"));
  const avgConfidence = contributions.reduce((s, c) => s + (c.confidence || 0.5), 0) / contributions.length;
  const convergence = (commonTags.length / Math.max(1, new Set(allTags).size)) * avgConfidence;

  const id = `meta_dtu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metaDTU = {
    id,
    type: "emergent_meta_dtu",
    sources: contributions.map(c => ({
      id: c.id, userId: c.userId || c.user, domain: c.domain,
    })),
    commonTags,
    convergence,
    confidence: avgConfidence,
    userCount: userIds.size,
    synthesizedAt: new Date().toISOString(),
    content: `Emergent synthesis across ${userIds.size} users on: ${commonTags.slice(0, 5).join(", ")}`,
  };

  metaDTUs.set(id, metaDTU);
  if (metaDTUs.size > 10000) {
    const oldest = metaDTUs.keys().next().value;
    metaDTUs.delete(oldest);
  }

  return { ok: true, metaDTU };
}

// === ONTOLOGY REFINEMENT ===

// Concept map for ontology refinement
const conceptMap = new Map(); // conceptId -> { name, domain, relations[], frequency }

/**
 * Register a concept in the evolving ontology.
 */
function registerConcept(name, domain, relations = []) {
  const id = `concept_${String(name).toLowerCase().replace(/\s+/g, "_")}`;

  if (conceptMap.has(id)) {
    const existing = conceptMap.get(id);
    existing.frequency++;
    existing.domains = [...new Set([...existing.domains, domain])];
    for (const r of relations) {
      if (!existing.relations.some(er => er.target === r.target && er.type === r.type)) {
        existing.relations.push(r);
      }
    }
    return { ok: true, concept: existing, updated: true };
  }

  const concept = {
    id,
    name: String(name),
    domains: [domain],
    relations: relations.map(r => ({
      target: String(r.target),
      type: r.type || "related_to",
      strength: Number(r.strength ?? 0.5),
    })),
    frequency: 1,
    createdAt: new Date().toISOString(),
  };

  conceptMap.set(id, concept);
  if (conceptMap.size > 50000) {
    const oldest = conceptMap.keys().next().value;
    conceptMap.delete(oldest);
  }

  return { ok: true, concept, created: true };
}

/**
 * Find cross-domain concept unifications.
 * Identifies concepts that appear in multiple domains (potential unifications).
 */
function findConceptUnifications(minDomains = 2) {
  const unifications = [];

  for (const [, concept] of conceptMap) {
    if (concept.domains.length >= minDomains) {
      unifications.push({
        concept: concept.name,
        domains: concept.domains,
        domainCount: concept.domains.length,
        frequency: concept.frequency,
        relations: concept.relations.length,
      });
    }
  }

  return unifications.sort((a, b) => b.domainCount - a.domainCount);
}

/**
 * Detect canon divergence: cases where the same concept has diverged across domains.
 */
function detectCanonDivergence() {
  const divergences = [];

  for (const [, concept] of conceptMap) {
    if (concept.domains.length < 2) continue;

    // Check for contradictory relations from different domains
    const relsByTarget = {};
    for (const r of concept.relations) {
      if (!relsByTarget[r.target]) relsByTarget[r.target] = [];
      relsByTarget[r.target].push(r);
    }

    for (const [target, rels] of Object.entries(relsByTarget)) {
      const types = new Set(rels.map(r => r.type));
      if (types.size > 1) {
        divergences.push({
          concept: concept.name,
          target,
          conflictingTypes: [...types],
          domains: concept.domains,
          severity: types.has("contradicts") ? "high" : "moderate",
        });
      }
    }
  }

  return divergences;
}

/**
 * Discover latent invariants from accumulated knowledge.
 * Searches for patterns that hold across many DTUs and domains.
 */
function discoverLatentInvariants(items) {
  if (!Array.isArray(items) || items.length < 3) {
    return { ok: false, invariants: [], reason: "insufficient_data" };
  }

  const tagCooccurrence = {};
  for (const item of items) {
    const tags = item.tags || [];
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join("::");
        tagCooccurrence[key] = (tagCooccurrence[key] || 0) + 1;
      }
    }
  }

  const threshold = Math.max(3, items.length * 0.1);
  const invariants = Object.entries(tagCooccurrence)
    .filter(([, count]) => count >= threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([pair, count]) => {
      const [a, b] = pair.split("::");
      return {
        type: "cooccurrence_invariant",
        concepts: [a, b],
        frequency: count,
        support: count / items.length,
        confidence: Math.min(1, count / (items.length * 0.5)),
      };
    });

  return {
    ok: true,
    invariants,
    totalItems: items.length,
    pairsAnalyzed: Object.keys(tagCooccurrence).length,
  };
}

// === EPISTEMIC DEBT ===

const epistemicDebts = new Map(); // debtId -> { type, domain, description, severity, createdAt }

/**
 * Record an epistemic debt — knowledge that is known to be incomplete, outdated, or unverified.
 */
function recordDebt(domain, description, severity = "moderate") {
  const id = `debt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const debt = {
    id,
    domain: String(domain),
    description: String(description).slice(0, 2000),
    severity, // "critical" | "high" | "moderate" | "low"
    status: "open", // "open" | "in_progress" | "resolved"
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };

  epistemicDebts.set(id, debt);
  if (epistemicDebts.size > 10000) {
    const oldest = epistemicDebts.keys().next().value;
    epistemicDebts.delete(oldest);
  }

  return { ok: true, debt };
}

/**
 * Resolve an epistemic debt.
 */
function resolveDebt(debtId, resolution) {
  const debt = epistemicDebts.get(debtId);
  if (!debt) return { ok: false, error: "debt_not_found" };

  debt.status = "resolved";
  debt.resolvedAt = new Date().toISOString();
  debt.resolution = String(resolution).slice(0, 2000);
  return { ok: true, debt };
}

/**
 * Get epistemic debt summary by domain.
 */
function debtSummary() {
  const byDomain = {};
  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0 };
  let open = 0;

  for (const [, debt] of epistemicDebts) {
    if (debt.status === "open") {
      open++;
      bySeverity[debt.severity] = (bySeverity[debt.severity] || 0) + 1;
      byDomain[debt.domain] = (byDomain[debt.domain] || 0) + 1;
    }
  }

  return { total: epistemicDebts.size, open, bySeverity, byDomain };
}

function init({ register, STATE }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.cognitiveLoad = {
    stats: {
      loadsRecorded: 0, decayRuns: 0, gapsIdentified: 0, agendasGenerated: 0,
      metaDTUsSynthesized: 0, conceptsRegistered: 0, unificationsFound: 0,
      invariantsDiscovered: 0, debtsRecorded: 0, debtsResolved: 0,
    },
  };

  register("loaf.cognitive_load", "status", (ctx) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    return {
      ok: true,
      trackedUsers: userLoads.size,
      domainsCovered: domainCoverage.size,
      metaDTUs: metaDTUs.size,
      concepts: conceptMap.size,
      epistemicDebts: debtSummary(),
      stats: cl.stats,
    };
  }, { public: true });

  register("loaf.cognitive_load", "record_load", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    cl.stats.loadsRecorded++;
    return {
      ok: true,
      ...recordLoad(
        String(input.userId || ctx.actor?.id || "anon"),
        input.type || LOAD_TYPES.ABSORPTION,
        String(input.domain || "general"),
        input.weight,
      ),
    };
  }, { public: false });

  register("loaf.cognitive_load", "decay", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    cl.stats.decayRuns++;
    return { ok: true, ...decayLoads(input.dtMs) };
  }, { public: false });

  register("loaf.cognitive_load", "balance", (_ctx, input = {}) => {
    return balanceLoad(input.userIds || [], input.taskType, String(input.domain || "general"));
  }, { public: true });

  register("loaf.cognitive_load", "update_coverage", (_ctx, input = {}) => {
    return { ok: true, ...updateCoverage(String(input.domain || ""), input.subdomain, input.dtuCount) };
  }, { public: false });

  register("loaf.cognitive_load", "identify_gaps", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const gaps = identifyGaps(input.knownDomains || []);
    cl.stats.gapsIdentified += gaps.length;
    return { ok: true, gaps };
  }, { public: true });

  register("loaf.cognitive_load", "research_agenda", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const gaps = identifyGaps(input.knownDomains || []);
    cl.stats.agendasGenerated++;
    return { ok: true, ...generateResearchAgenda(gaps, input.maxItems) };
  }, { public: true });

  register("loaf.cognitive_load", "synthesize_meta_dtu", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const result = synthesizeMetaDTU(input.contributions || []);
    if (result.ok) cl.stats.metaDTUsSynthesized++;
    return result;
  }, { public: false });

  register("loaf.cognitive_load", "register_concept", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    cl.stats.conceptsRegistered++;
    return registerConcept(input.name, String(input.domain || "general"), input.relations || []);
  }, { public: false });

  register("loaf.cognitive_load", "find_unifications", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const unifications = findConceptUnifications(input.minDomains || 2);
    cl.stats.unificationsFound += unifications.length;
    return { ok: true, unifications };
  }, { public: true });

  register("loaf.cognitive_load", "detect_canon_divergence", (_ctx) => {
    return { ok: true, divergences: detectCanonDivergence() };
  }, { public: true });

  register("loaf.cognitive_load", "discover_invariants", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const result = discoverLatentInvariants(input.items || []);
    if (result.ok) cl.stats.invariantsDiscovered += result.invariants.length;
    return result;
  }, { public: true });

  register("loaf.cognitive_load", "record_debt", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    cl.stats.debtsRecorded++;
    return recordDebt(String(input.domain || "general"), String(input.description || ""), input.severity);
  }, { public: false });

  register("loaf.cognitive_load", "resolve_debt", (ctx, input = {}) => {
    const cl = ctx.state.__loaf.cognitiveLoad;
    const result = resolveDebt(String(input.debtId || ""), input.resolution);
    if (result.ok) cl.stats.debtsResolved++;
    return result;
  }, { public: false });

  register("loaf.cognitive_load", "debt_summary", (_ctx) => {
    return { ok: true, ...debtSummary() };
  }, { public: true });

  register("loaf.cognitive_load", "list_meta_dtus", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 50), 200);
    const items = Array.from(metaDTUs.values()).slice(-limit);
    return { ok: true, metaDTUs: items };
  }, { public: true });
}

export {
  LOAD_TYPES,
  LOAD_WEIGHTS,
  recordLoad,
  decayLoads,
  balanceLoad,
  updateCoverage,
  identifyGaps,
  generateResearchAgenda,
  synthesizeMetaDTU,
  registerConcept,
  findConceptUnifications,
  detectCanonDivergence,
  discoverLatentInvariants,
  recordDebt,
  resolveDebt,
  debtSummary,
  init,
};
