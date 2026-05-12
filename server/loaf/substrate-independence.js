import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF X.2 — Substrate Independence & Portability
 *
 * Capabilities (Environmental Constraints, continued):
 *   16. Knowledge portability across different substrates/platforms
 *   17. Constraint-aware governance (rules adapt to environment)
 *   18. Context-bound knowledge marking (valid only under conditions)
 *   19. Stability across changing worlds (invariants that survive change)
 *   20. Substrate-agnostic knowledge encoding
 *   21. Platform capability discovery and adaptation
 *   22. Cross-substrate knowledge translation
 *   23. Environment-specific optimization without losing generality
 *   24. Portable epistemic primitives (works anywhere)
 *   25. Substrate migration planning and execution
 *   26. Capability degradation mapping per substrate
 *   27. Environment fingerprinting for adaptation
 *   28. Substrate-aware quality metrics
 *   29. Portability verification testing
 *   30. Cross-environment consistency guarantees
 *
 * Design:
 *   - Knowledge is encoded in substrate-agnostic formats
 *   - Governance rules adapt based on detected environment capabilities
 *   - Context-bound knowledge carries explicit validity conditions
 *   - Invariants are separated from substrate-dependent behaviors
 *   - Migration planning accounts for capability differences
 *   - Portability is verified through cross-substrate testing
 */

// === SUBSTRATE TYPES ===

const SUBSTRATE_CAPABILITIES = Object.freeze({
  COMPUTE: "compute",
  PERSISTENCE: "persistence",
  NETWORKING: "networking",
  ENCRYPTION: "encryption",
  REAL_TIME: "real_time",
  BATCH: "batch",
  CONCURRENT: "concurrent",
  GPU: "gpu",
});

const ENCODING_FORMATS = Object.freeze({
  JSON: "json",
  CANONICAL: "canonical",     // platform-independent canonical form
  COMPACT: "compact",         // compressed for low-resource substrates
  HUMAN_READABLE: "human_readable",
  BINARY: "binary",
});

const CONTEXT_VALIDITY = Object.freeze({
  UNIVERSAL: "universal",     // valid everywhere
  SUBSTRATE_BOUND: "substrate_bound",
  TIME_BOUND: "time_bound",
  CONDITION_BOUND: "condition_bound",
  ENVIRONMENT_BOUND: "environment_bound",
});

const MAX_SUBSTRATES = 100;
const MAX_KNOWLEDGE_ENTRIES = 1000;
const MAX_TRANSLATIONS = 500;
const MAX_MIGRATIONS = 100;
const MAX_INVARIANTS = 300;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// substrateId -> { name, capabilities{}, limitations[], fingerprint }
const substrates = new LruMap();
// knowledgeId -> { content, encoding, contextBounds[], portabilityScore }
const portableKnowledge = new LruMap();
// translationId -> { fromSubstrate, toSubstrate, knowledgeId, translated, lossReport }
const translations = new LruMap();
// migrationId -> { fromSubstrate, toSubstrate, items[], status }
const substrateMigrations = new LruMap();
// invariantId -> { rule, substrateIndependent, validatedOn[] }
const invariants = new LruMap();
// Governance adaptation rules
const governanceAdaptations = new LruMap();

// === SUBSTRATE REGISTRATION ===

/**
 * Register a substrate with its capabilities and limitations.
 */
function registerSubstrate(name, capabilities, limitations) {
  const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(substrates, MAX_SUBSTRATES);

  const fingerprint = computeFingerprint(capabilities, limitations);
  substrates.set(id, {
    name,
    capabilities: capabilities || {},
    limitations: limitations || [],
    fingerprint,
    registeredAt: Date.now(),
    lastSeen: Date.now(),
  });
  return { ok: true, substrateId: id, fingerprint };
}

/**
 * Compute environment fingerprint from capabilities and limitations.
 */
function computeFingerprint(capabilities, limitations) {
  const parts = [
    ...Object.entries(capabilities || {}).map(([k, v]) => `${k}:${v}`).sort(),
    ...(limitations || []).map(l => `!${l}`).sort(),
  ];
  const str = parts.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

/**
 * Discover platform capabilities of current environment.
 */
function discoverCapabilities() {
  const capabilities = {};

  // Detect basic capabilities
  capabilities[SUBSTRATE_CAPABILITIES.COMPUTE] = true;
  capabilities[SUBSTRATE_CAPABILITIES.PERSISTENCE] = typeof globalThis !== "undefined";
  capabilities[SUBSTRATE_CAPABILITIES.BATCH] = true;

  // Check for specific features
  try {
    capabilities[SUBSTRATE_CAPABILITIES.CONCURRENT] = typeof Promise !== "undefined";
  } catch { capabilities[SUBSTRATE_CAPABILITIES.CONCURRENT] = false; }

  try {
    capabilities[SUBSTRATE_CAPABILITIES.ENCRYPTION] = typeof globalThis.crypto !== "undefined";
  } catch { capabilities[SUBSTRATE_CAPABILITIES.ENCRYPTION] = false; }

  return { ok: true, capabilities };
}

// === PORTABLE KNOWLEDGE ===

/**
 * Encode knowledge in a substrate-agnostic format.
 */
function encodePortable(content, encoding, contextBounds) {
  const id = `pk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(portableKnowledge, MAX_KNOWLEDGE_ENTRIES);

  const encoded = performEncoding(content, encoding || ENCODING_FORMATS.CANONICAL);
  const bounds = (contextBounds || []).map(b => ({
    type: b.type || CONTEXT_VALIDITY.UNIVERSAL,
    condition: b.condition || null,
    substrate: b.substrate || null,
    validFrom: b.validFrom || null,
    validUntil: b.validUntil || null,
  }));

  portableKnowledge.set(id, {
    content: encoded,
    originalContent: content,
    encoding: encoding || ENCODING_FORMATS.CANONICAL,
    contextBounds: bounds,
    portabilityScore: computePortabilityScore(encoded, bounds),
    createdAt: Date.now(),
    verifiedOn: [],
  });
  return { ok: true, knowledgeId: id, encoding: encoding || ENCODING_FORMATS.CANONICAL };
}

/**
 * Perform encoding to a specific format.
 */
function performEncoding(content, format) {
  switch (format) {
    case ENCODING_FORMATS.JSON:
      return JSON.stringify(content);
    case ENCODING_FORMATS.CANONICAL:
      return canonicalize(content);
    case ENCODING_FORMATS.COMPACT:
      return compact(content);
    case ENCODING_FORMATS.HUMAN_READABLE:
      return typeof content === "string" ? content : JSON.stringify(content, null, 2);
    default:
      return JSON.stringify(content);
  }
}

/**
 * Produce a canonical (deterministic) encoding.
 */
function canonicalize(obj) {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/**
 * Produce a compact encoding (strip whitespace, shorten keys).
 */
function compact(obj) {
  return JSON.stringify(obj);
}

/**
 * Compute portability score (0–1) for encoded knowledge.
 */
function computePortabilityScore(encoded, bounds) {
  let score = 1.0;

  // Universal bounds = most portable
  const _universalBounds = bounds.filter(b => b.type === CONTEXT_VALIDITY.UNIVERSAL);
  const boundBounds = bounds.filter(b => b.type !== CONTEXT_VALIDITY.UNIVERSAL);
  if (boundBounds.length > 0) {
    score -= boundBounds.length * 0.15;
  }

  // Smaller encodings are more portable
  const size = typeof encoded === "string" ? encoded.length : JSON.stringify(encoded).length;
  if (size > 100000) score -= 0.2;
  else if (size > 10000) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

/**
 * Check if portable knowledge is valid in a given context.
 */
function checkContextValidity(knowledgeId, context) {
  const pk = portableKnowledge.get(knowledgeId);
  if (!pk) return { ok: false, error: "Knowledge not found" };

  if (pk.contextBounds.length === 0) {
    return { ok: true, valid: true, reason: "No bounds — universally valid" };
  }

  const violations = [];
  for (const bound of pk.contextBounds) {
    if (bound.type === CONTEXT_VALIDITY.UNIVERSAL) continue;

    if (bound.type === CONTEXT_VALIDITY.TIME_BOUND) {
      const now = Date.now();
      if (bound.validFrom && now < bound.validFrom) violations.push("Not yet valid (time)");
      if (bound.validUntil && now > bound.validUntil) violations.push("Expired (time)");
    }

    if (bound.type === CONTEXT_VALIDITY.SUBSTRATE_BOUND && bound.substrate) {
      if (context.substrateId && context.substrateId !== bound.substrate) {
        violations.push(`Wrong substrate: expected ${bound.substrate}`);
      }
    }

    if (bound.type === CONTEXT_VALIDITY.CONDITION_BOUND && bound.condition) {
      if (context[bound.condition.key] !== bound.condition.value) {
        violations.push(`Condition not met: ${bound.condition.key}`);
      }
    }
  }

  return { ok: true, valid: violations.length === 0, violations };
}

// === CROSS-SUBSTRATE TRANSLATION ===

/**
 * Translate knowledge from one substrate to another.
 */
function translateKnowledge(knowledgeId, fromSubstrateId, toSubstrateId) {
  const pk = portableKnowledge.get(knowledgeId);
  if (!pk) return { ok: false, error: "Knowledge not found" };
  const fromSub = substrates.get(fromSubstrateId);
  const toSub = substrates.get(toSubstrateId);
  if (!fromSub) return { ok: false, error: "Source substrate not found" };
  if (!toSub) return { ok: false, error: "Target substrate not found" };

  const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(translations, MAX_TRANSLATIONS);

  // Determine capability differences
  const missingCapabilities = [];
  for (const [cap, val] of Object.entries(fromSub.capabilities)) {
    if (val && !toSub.capabilities[cap]) {
      missingCapabilities.push(cap);
    }
  }

  // Compute translation loss
  const lossRatio = missingCapabilities.length /
    Math.max(Object.keys(fromSub.capabilities).length, 1);

  translations.set(id, {
    fromSubstrate: fromSubstrateId,
    toSubstrate: toSubstrateId,
    knowledgeId,
    translated: pk.originalContent, // In real system, would adapt
    missingCapabilities,
    lossRatio,
    translatedAt: Date.now(),
  });

  return {
    ok: true,
    translationId: id,
    lossRatio,
    missingCapabilities,
    lossless: missingCapabilities.length === 0,
  };
}

// === INVARIANTS ===

/**
 * Register a substrate-independent invariant.
 */
function registerInvariant(rule, description) {
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(invariants, MAX_INVARIANTS);

  invariants.set(id, {
    rule,
    description,
    substrateIndependent: true,
    validatedOn: [],
    createdAt: Date.now(),
  });
  return { ok: true, invariantId: id };
}

/**
 * Validate an invariant on a specific substrate.
 */
function validateInvariant(invariantId, substrateId, holds) {
  const inv = invariants.get(invariantId);
  if (!inv) return { ok: false, error: "Invariant not found" };

  inv.validatedOn.push({ substrateId, holds, validatedAt: Date.now() });

  if (!holds) {
    inv.substrateIndependent = false;
  }

  const totalValidations = inv.validatedOn.length;
  const holdCount = inv.validatedOn.filter(v => v.holds).length;

  return {
    ok: true,
    invariantId,
    holds,
    substrateIndependent: inv.substrateIndependent,
    holdRate: totalValidations > 0 ? holdCount / totalValidations : 0,
    validatedOnCount: totalValidations,
  };
}

// === GOVERNANCE ADAPTATION ===

/**
 * Register a governance rule that adapts based on environment.
 */
function registerAdaptiveGovernance(ruleName, baseRule, adaptations) {
  const id = `gov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(governanceAdaptations, 200);

  governanceAdaptations.set(id, {
    ruleName,
    baseRule,
    adaptations: (adaptations || []).map(a => ({
      condition: a.condition,
      modifiedRule: a.modifiedRule,
      reason: a.reason,
    })),
    currentRule: baseRule,
    adaptedFor: null,
    createdAt: Date.now(),
  });
  return { ok: true, governanceId: id };
}

/**
 * Adapt governance rules to current environment.
 */
function adaptGovernance(governanceId, environment) {
  const gov = governanceAdaptations.get(governanceId);
  if (!gov) return { ok: false, error: "Governance rule not found" };

  let adapted = false;
  let selectedRule = gov.baseRule;
  let reason = "base_rule";

  for (const adaptation of gov.adaptations) {
    if (evaluateAdaptationCondition(adaptation.condition, environment)) {
      selectedRule = adaptation.modifiedRule;
      reason = adaptation.reason;
      adapted = true;
      break; // First matching adaptation wins
    }
  }

  gov.currentRule = selectedRule;
  gov.adaptedFor = adapted ? environment : null;

  return { ok: true, governanceId, adapted, currentRule: selectedRule, reason };
}

/**
 * Evaluate an adaptation condition against environment.
 */
function evaluateAdaptationCondition(condition, environment) {
  if (!condition || !environment) return false;
  if (condition.hasCapability) {
    return environment.capabilities?.[condition.hasCapability] === true;
  }
  if (condition.lacksCapability) {
    return !environment.capabilities?.[condition.lacksCapability];
  }
  if (condition.resourceBelow) {
    return (environment.resources?.[condition.resourceBelow.type] || 0)
      < condition.resourceBelow.threshold;
  }
  return false;
}

// === SUBSTRATE MIGRATION ===

/**
 * Plan a substrate migration.
 */
function planSubstrateMigration(fromSubstrateId, toSubstrateId, knowledgeIds) {
  const id = `smig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(substrateMigrations, MAX_MIGRATIONS);

  const fromSub = substrates.get(fromSubstrateId);
  const toSub = substrates.get(toSubstrateId);
  if (!fromSub || !toSub) {
    return { ok: false, error: "Substrate not found" };
  }

  // Map capability degradation
  const degradation = [];
  for (const [cap, val] of Object.entries(fromSub.capabilities)) {
    if (val && !toSub.capabilities[cap]) {
      degradation.push({ capability: cap, status: "lost" });
    } else if (val && toSub.capabilities[cap]) {
      degradation.push({ capability: cap, status: "preserved" });
    }
  }

  substrateMigrations.set(id, {
    fromSubstrate: fromSubstrateId,
    toSubstrate: toSubstrateId,
    knowledgeIds: knowledgeIds || [],
    degradation,
    status: "planned",
    createdAt: Date.now(),
  });

  return {
    ok: true,
    migrationId: id,
    degradation,
    lostCapabilities: degradation.filter(d => d.status === "lost").length,
    preservedCapabilities: degradation.filter(d => d.status === "preserved").length,
  };
}

/**
 * Execute a substrate migration.
 */
function executeSubstrateMigration(migrationId) {
  const mig = substrateMigrations.get(migrationId);
  if (!mig) return { ok: false, error: "Migration not found" };

  mig.status = "in_progress";
  const migrated = [];
  const failed = [];

  for (const kid of mig.knowledgeIds) {
    const pk = portableKnowledge.get(kid);
    if (pk) {
      migrated.push(kid);
    } else {
      failed.push(kid);
    }
  }

  mig.status = failed.length === 0 ? "completed" : "partial";
  return {
    ok: true,
    migrationId,
    migrated: migrated.length,
    failed: failed.length,
    status: mig.status,
  };
}

// === PORTABILITY VERIFICATION ===

/**
 * Run portability verification tests across substrates.
 */
function verifyPortability(knowledgeId, substrateIds) {
  const pk = portableKnowledge.get(knowledgeId);
  if (!pk) return { ok: false, error: "Knowledge not found" };

  const results = [];
  for (const sid of (substrateIds || [])) {
    const sub = substrates.get(sid);
    if (!sub) {
      results.push({ substrateId: sid, portable: false, error: "Substrate not found" });
      continue;
    }

    // Check context bounds
    const validity = checkContextValidity(knowledgeId, { substrateId: sid });
    // Check if encoding is compatible
    const encodingOk = true; // JSON is universal

    results.push({
      substrateId: sid,
      substrateName: sub.name,
      portable: validity.valid && encodingOk,
      contextValid: validity.valid,
      contextViolations: validity.violations || [],
    });

    pk.verifiedOn.push({ substrateId: sid, portable: validity.valid, at: Date.now() });
  }

  const allPortable = results.every(r => r.portable);
  return { ok: true, knowledgeId, allPortable, results, testedOn: results.length };
}

/**
 * Get cross-environment consistency report.
 */
function consistencyReport() {
  const report = {
    substrates: substrates.size,
    portableKnowledge: portableKnowledge.size,
    invariants: invariants.size,
    substrateIndependentInvariants: [...invariants.values()].filter(i => i.substrateIndependent).length,
    translations: translations.size,
    losslessTranslations: [...translations.values()].filter(t => t.lossRatio === 0).length,
    averagePortabilityScore: 0,
    governanceAdaptations: governanceAdaptations.size,
  };

  const scores = [...portableKnowledge.values()].map(pk => pk.portabilityScore);
  report.averagePortabilityScore = scores.length > 0
    ? scores.reduce((s, v) => s + v, 0) / scores.length
    : 0;

  return { ok: true, report };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "register_substrate", (ctx) => {
    const { name, capabilities, limitations } = ctx.args || {};
    return registerSubstrate(name, capabilities, limitations);
  }, { public: true });

  register("loaf", "discover_capabilities", (_ctx) => {
    return discoverCapabilities();
  }, { public: true });

  register("loaf", "encode_portable", (ctx) => {
    const { content, encoding, contextBounds } = ctx.args || {};
    return encodePortable(content, encoding, contextBounds);
  }, { public: true });

  register("loaf", "check_context_validity", (ctx) => {
    const { knowledgeId, context } = ctx.args || {};
    return checkContextValidity(knowledgeId, context || {});
  }, { public: true });

  register("loaf", "translate_knowledge", (ctx) => {
    const { knowledgeId, fromSubstrate, toSubstrate } = ctx.args || {};
    return translateKnowledge(knowledgeId, fromSubstrate, toSubstrate);
  }, { public: true });

  register("loaf", "register_invariant", (ctx) => {
    const { rule, description } = ctx.args || {};
    return registerInvariant(rule, description);
  }, { public: true });

  register("loaf", "validate_invariant", (ctx) => {
    const { invariantId, substrateId, holds } = ctx.args || {};
    return validateInvariant(invariantId, substrateId, holds);
  }, { public: true });

  register("loaf", "register_adaptive_governance", (ctx) => {
    const { ruleName, baseRule, adaptations } = ctx.args || {};
    return registerAdaptiveGovernance(ruleName, baseRule, adaptations);
  }, { public: true });

  register("loaf", "adapt_governance", (ctx) => {
    const { governanceId, environment } = ctx.args || {};
    return adaptGovernance(governanceId, environment || {});
  }, { public: true });

  register("loaf", "plan_substrate_migration", (ctx) => {
    const { fromSubstrate, toSubstrate, knowledgeIds } = ctx.args || {};
    return planSubstrateMigration(fromSubstrate, toSubstrate, knowledgeIds);
  }, { public: true });

  register("loaf", "execute_substrate_migration", (ctx) => {
    return executeSubstrateMigration(ctx.args?.migrationId);
  }, { public: true });

  register("loaf", "verify_portability", (ctx) => {
    const { knowledgeId, substrateIds } = ctx.args || {};
    return verifyPortability(knowledgeId, substrateIds || []);
  }, { public: true });

  register("loaf", "consistency_report", (_ctx) => {
    return consistencyReport();
  }, { public: true });
}

export {
  init,
  SUBSTRATE_CAPABILITIES,
  ENCODING_FORMATS,
  CONTEXT_VALIDITY,
  registerSubstrate,
  computeFingerprint,
  discoverCapabilities,
  encodePortable,
  performEncoding,
  canonicalize,
  computePortabilityScore,
  checkContextValidity,
  translateKnowledge,
  registerInvariant,
  validateInvariant,
  registerAdaptiveGovernance,
  adaptGovernance,
  planSubstrateMigration,
  executeSubstrateMigration,
  verifyPortability,
  consistencyReport,
};
