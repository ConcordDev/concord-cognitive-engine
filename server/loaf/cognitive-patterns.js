import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IV.4 — Cognitive Pattern Libraries & Skill Crystallization
 *
 * Capabilities:
 *   16. Skill crystallization into reusable cognitive modules
 *   17. Auto-compilation of best practices from successful transfers
 *   18. Cognitive pattern libraries (strategies as assets)
 *
 * Design:
 *   - Strategies and successful approaches are crystallized into reusable modules
 *   - Best practices are automatically compiled from high-success-rate patterns
 *   - Cognitive patterns form a searchable library of strategies-as-assets
 *   - Patterns have provenance, success rates, and applicability metadata
 */

const PATTERN_TYPES = Object.freeze({
  STRATEGY: "strategy",
  HEURISTIC: "heuristic",
  WORKFLOW: "workflow",
  DIAGNOSTIC: "diagnostic",
  SYNTHESIS: "synthesis",
});

const CRYSTALLIZATION_STATES = Object.freeze({
  RAW: "raw",                     // observed but not yet crystallized
  CANDIDATE: "candidate",        // meets threshold for crystallization
  CRYSTALLIZED: "crystallized",  // confirmed reusable module
  DEPRECATED: "deprecated",      // no longer recommended
});

// Pattern library
const patterns = new LruMap(); // patternId -> Pattern

// Skill crystals: reusable cognitive modules
const crystals = new LruMap(); // crystalId -> Crystal

// Best practices compiled from successful transfers
const bestPractices = new LruMap(); // practiceId -> BestPractice

// Transfer success tracking for auto-compilation
const transferOutcomes = []; // { patternId, domain, success, ts }

/**
 * Register a cognitive pattern in the library.
 */
function registerPattern(name, type, description, steps, metadata) {
  const id = `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pattern = {
    id,
    name: String(name).slice(0, 200),
    type: Object.values(PATTERN_TYPES).includes(type) ? type : PATTERN_TYPES.STRATEGY,
    description: String(description).slice(0, 2000),
    steps: Array.isArray(steps) ? steps.map(s => String(s).slice(0, 500)) : [],
    metadata: {
      domains: Array.isArray(metadata?.domains) ? metadata.domains : [],
      applicability: Math.max(0, Math.min(1, Number(metadata?.applicability ?? 0.5))),
      successRate: 0,
      useCount: 0,
      ...metadata,
    },
    provenance: {
      source: metadata?.source || "observed",
      confidence: Math.max(0, Math.min(1, Number(metadata?.confidence ?? 0.5))),
      createdAt: new Date().toISOString(),
    },
    state: CRYSTALLIZATION_STATES.RAW,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  patterns.set(id, pattern);
  capMap(patterns, 50000);

  return { ok: true, pattern: sanitizePattern(pattern) };
}

/**
 * Record a pattern usage outcome (success or failure).
 */
function recordOutcome(patternId, domain, success, context) {
  const pattern = patterns.get(patternId);
  if (!pattern) return { ok: false, error: "pattern_not_found" };

  pattern.metadata.useCount++;
  const outcome = {
    patternId,
    domain: String(domain || "general"),
    success: Boolean(success),
    context: String(context || "").slice(0, 500),
    ts: Date.now(),
  };
  transferOutcomes.push(outcome);
  if (transferOutcomes.length > 10000) transferOutcomes.splice(0, transferOutcomes.length - 10000);

  // Recalculate success rate
  const patternOutcomes = transferOutcomes.filter(o => o.patternId === patternId);
  const successes = patternOutcomes.filter(o => o.success).length;
  pattern.metadata.successRate = patternOutcomes.length > 0
    ? successes / patternOutcomes.length
    : 0;

  // Check for crystallization candidacy
  if (pattern.metadata.useCount >= 5 && pattern.metadata.successRate >= 0.7) {
    pattern.state = CRYSTALLIZATION_STATES.CANDIDATE;
  }

  pattern.updatedAt = new Date().toISOString();
  return { ok: true, successRate: pattern.metadata.successRate, state: pattern.state };
}

/**
 * Crystallize a pattern into a reusable cognitive module.
 * Requires the pattern to be a candidate (sufficient usage and success rate).
 */
function crystallize(patternId) {
  const pattern = patterns.get(patternId);
  if (!pattern) return { ok: false, error: "pattern_not_found" };
  if (pattern.state !== CRYSTALLIZATION_STATES.CANDIDATE) {
    return {
      ok: false,
      error: "not_a_candidate",
      currentState: pattern.state,
      successRate: pattern.metadata.successRate,
      useCount: pattern.metadata.useCount,
    };
  }

  const crystalId = `crystal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const crystal = {
    id: crystalId,
    sourcePatternId: patternId,
    name: pattern.name,
    type: pattern.type,
    description: pattern.description,
    steps: [...pattern.steps],
    domains: [...pattern.metadata.domains],
    successRate: pattern.metadata.successRate,
    useCount: pattern.metadata.useCount,
    reliability: Math.min(1, pattern.metadata.successRate * (1 - 1 / (pattern.metadata.useCount + 1))),
    crystallizedAt: new Date().toISOString(),
    deprecated: false,
  };

  crystals.set(crystalId, crystal);
  capMap(crystals, 10000);

  pattern.state = CRYSTALLIZATION_STATES.CRYSTALLIZED;
  pattern.updatedAt = new Date().toISOString();

  return { ok: true, crystal };
}

/**
 * Search the pattern library by domain, type, or minimum success rate.
 */
function searchPatterns(query) {
  let results = Array.from(patterns.values());

  if (query.domain) {
    results = results.filter(p => p.metadata.domains.includes(query.domain));
  }
  if (query.type) {
    results = results.filter(p => p.type === query.type);
  }
  if (query.minSuccessRate !== undefined) {
    results = results.filter(p => p.metadata.successRate >= query.minSuccessRate);
  }
  if (query.state) {
    results = results.filter(p => p.state === query.state);
  }
  if (query.keyword) {
    const kw = String(query.keyword).toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw)
    );
  }

  return results
    .sort((a, b) => b.metadata.successRate - a.metadata.successRate)
    .slice(0, Number(query.limit || 50))
    .map(sanitizePattern);
}

/**
 * Auto-compile best practices from patterns with high success rates.
 * Identifies recurring successful patterns and synthesizes them into best practices.
 */
function compileBestPractices(minSuccessRate = 0.8, minUseCount = 3) {
  const candidates = Array.from(patterns.values())
    .filter(p => p.metadata.successRate >= minSuccessRate && p.metadata.useCount >= minUseCount);

  // Group by domain
  const byDomain = {};
  for (const p of candidates) {
    for (const d of p.metadata.domains) {
      if (!byDomain[d]) byDomain[d] = [];
      byDomain[d].push(p);
    }
  }

  const practices = [];
  for (const [domain, domPatterns] of Object.entries(byDomain)) {
    if (domPatterns.length < 1) continue;

    const practiceId = `bp_${domain}_${Date.now()}`;
    const practice = {
      id: practiceId,
      domain,
      patterns: domPatterns.map(p => ({
        id: p.id, name: p.name, successRate: p.metadata.successRate,
      })),
      avgSuccessRate: domPatterns.reduce((s, p) => s + p.metadata.successRate, 0) / domPatterns.length,
      totalUseCount: domPatterns.reduce((s, p) => s + p.metadata.useCount, 0),
      compiledSteps: domPatterns
        .sort((a, b) => b.metadata.successRate - a.metadata.successRate)
        .flatMap(p => p.steps)
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 20),
      compiledAt: new Date().toISOString(),
    };

    bestPractices.set(practiceId, practice);
    practices.push(practice);
  }

  capMap(bestPractices, 5000);

  return {
    ok: true,
    practicesCompiled: practices.length,
    practices,
    candidatesAnalyzed: candidates.length,
  };
}

// === HELPERS ===

function sanitizePattern(p) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    description: p.description.slice(0, 200),
    domains: p.metadata.domains,
    successRate: p.metadata.successRate,
    useCount: p.metadata.useCount,
    state: p.state,
    stepCount: p.steps.length,
    createdAt: p.createdAt,
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
  STATE.__loaf.cognitivePatterns = {
    stats: {
      patternsRegistered: 0, outcomesRecorded: 0, crystallized: 0,
      searches: 0, bestPracticesCompiled: 0,
    },
  };

  register("loaf.patterns", "status", (ctx) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    return {
      ok: true,
      patterns: patterns.size,
      crystals: crystals.size,
      bestPractices: bestPractices.size,
      transferOutcomes: transferOutcomes.length,
      byState: {
        raw: Array.from(patterns.values()).filter(p => p.state === CRYSTALLIZATION_STATES.RAW).length,
        candidate: Array.from(patterns.values()).filter(p => p.state === CRYSTALLIZATION_STATES.CANDIDATE).length,
        crystallized: Array.from(patterns.values()).filter(p => p.state === CRYSTALLIZATION_STATES.CRYSTALLIZED).length,
      },
      stats: cp.stats,
    };
  }, { public: true });

  register("loaf.patterns", "register", (ctx, input = {}) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    cp.stats.patternsRegistered++;
    return registerPattern(input.name, input.type, input.description, input.steps, input.metadata);
  }, { public: false });

  register("loaf.patterns", "record_outcome", (ctx, input = {}) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    cp.stats.outcomesRecorded++;
    return recordOutcome(String(input.patternId || ""), input.domain, input.success, input.context);
  }, { public: false });

  register("loaf.patterns", "crystallize", (ctx, input = {}) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    const result = crystallize(String(input.patternId || ""));
    if (result.ok) cp.stats.crystallized++;
    return result;
  }, { public: false });

  register("loaf.patterns", "search", (ctx, input = {}) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    cp.stats.searches++;
    return { ok: true, patterns: searchPatterns(input) };
  }, { public: true });

  register("loaf.patterns", "compile_best_practices", (ctx, input = {}) => {
    const cp = ctx.state.__loaf.cognitivePatterns;
    cp.stats.bestPracticesCompiled++;
    return compileBestPractices(input.minSuccessRate, input.minUseCount);
  }, { public: true });

  register("loaf.patterns", "list_crystals", (_ctx, input = {}) => {
    const limit = Math.min(Number(input.limit || 50), 200);
    const list = Array.from(crystals.values())
      .filter(c => !c.deprecated)
      .sort((a, b) => b.reliability - a.reliability)
      .slice(0, limit);
    return { ok: true, crystals: list };
  }, { public: true });

  register("loaf.patterns", "list_best_practices", (_ctx, input = {}) => {
    let list = Array.from(bestPractices.values());
    if (input.domain) list = list.filter(p => p.domain === input.domain);
    return { ok: true, bestPractices: list.slice(0, 50) };
  }, { public: true });
}

export {
  PATTERN_TYPES,
  CRYSTALLIZATION_STATES,
  registerPattern,
  recordOutcome,
  crystallize,
  searchPatterns,
  compileBestPractices,
  init,
};
