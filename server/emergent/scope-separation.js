/**
 * Scope Separation — Global / Marketplace / Local
 *
 * Implements hard separation between Concord's three knowledge scopes.
 *
 * Core Invariants:
 *   1. Founder Sovereignty — Global rules are final, all overrides logged.
 *   2. One-Way Influence — Global → Marketplace → Local (never reverse).
 *   3. No Silent Promotion — upward movement requires author intent + council approval.
 *
 * Scope Purposes:
 *   - Global:      Slow, canonical, evidence-driven truth substrate (5-min tick)
 *   - Marketplace: Governed distribution + rights, no cognition (no tick)
 *   - Local:       Fast, free, personal cognition with explicit export only (normal tick)
 */

import { listEmergents, getEmergentState } from "./store.js";
import logger from '../logger.js';

// ── Scope Constants ──────────────────────────────────────────────────────────

export const SCOPES = Object.freeze({
  LOCAL: "local",
  GLOBAL: "global",
  CREATIVE_GLOBAL: "creative_global",
  MARKETPLACE: "marketplace",
  SHADOW: "shadow",
});

export const ALL_SCOPES = Object.freeze([SCOPES.LOCAL, SCOPES.GLOBAL, SCOPES.CREATIVE_GLOBAL, SCOPES.MARKETPLACE, SCOPES.SHADOW]);

export const DTU_CLASSES = Object.freeze({
  EMPIRICAL: "empirical",
  PHILOSOPHICAL: "philosophical",
});

export const ALL_DTU_CLASSES = Object.freeze([DTU_CLASSES.EMPIRICAL, DTU_CLASSES.PHILOSOPHICAL]);

// ── Influence Matrix (Hard Rules) ────────────────────────────────────────────
//
// From → To    | Global | Marketplace | Local
// Global       | ✅ self | ✅ allowed  | ✅ allowed
// Marketplace  | ❌ never | ✅ self     | ✅ allowed
// Local        | ❌ never | ❌ without push + council | ✅ self

const INFLUENCE_MATRIX = Object.freeze({
  [SCOPES.GLOBAL]:          { [SCOPES.GLOBAL]: true,  [SCOPES.CREATIVE_GLOBAL]: true,  [SCOPES.MARKETPLACE]: true,  [SCOPES.LOCAL]: true,  [SCOPES.SHADOW]: false },
  [SCOPES.CREATIVE_GLOBAL]: { [SCOPES.GLOBAL]: false, [SCOPES.CREATIVE_GLOBAL]: true,  [SCOPES.MARKETPLACE]: true,  [SCOPES.LOCAL]: true,  [SCOPES.SHADOW]: false },
  [SCOPES.MARKETPLACE]:     { [SCOPES.GLOBAL]: false, [SCOPES.CREATIVE_GLOBAL]: false, [SCOPES.MARKETPLACE]: true,  [SCOPES.LOCAL]: true,  [SCOPES.SHADOW]: false },
  [SCOPES.LOCAL]:           { [SCOPES.GLOBAL]: false, [SCOPES.CREATIVE_GLOBAL]: false, [SCOPES.MARKETPLACE]: false, [SCOPES.LOCAL]: true,  [SCOPES.SHADOW]: false },
  [SCOPES.SHADOW]:          { [SCOPES.GLOBAL]: false, [SCOPES.CREATIVE_GLOBAL]: false, [SCOPES.MARKETPLACE]: false, [SCOPES.LOCAL]: false, [SCOPES.SHADOW]: true },
});

// ── Heartbeat Configuration per Scope ────────────────────────────────────────

export const HEARTBEAT_CONFIG = Object.freeze({
  [SCOPES.LOCAL]: {
    enabled: true,
    intervalMs: 15000,       // 15 seconds (existing cadence)
    minMs: 2000,
    maxMs: 120000,
    canGenerateDtus: true,
    canMutateLattice: true,
    canDriveEmergents: true,
  },
  [SCOPES.GLOBAL]: {
    enabled: true,
    intervalMs: 300000,      // 5 minutes — slow, deliberate synthesis
    minMs: 60000,            // min 1 minute
    maxMs: 600000,           // max 10 minutes
    canGenerateDtus: true,   // candidates only, from existing Global DTUs
    canUpdateResonance: true,
    canIngestLocal: false,    // ❌ cannot ingest local or marketplace
    canIngestMarketplace: false,
    canRespondToLocal: false,
  },
  [SCOPES.CREATIVE_GLOBAL]: {
    enabled: true,
    intervalMs: 180000,      // 3 minutes — faster than academic global
    minMs: 30000,
    maxMs: 300000,
    canGenerateDtus: false,  // creative content is user-driven, not auto-generated
    canUpdateResonance: true,
    canIngestLocal: false,
    canIngestMarketplace: false,
    canRecordAnalytics: true,
  },
  [SCOPES.MARKETPLACE]: {
    enabled: false,           // ❌ No heartbeat at all
    intervalMs: 0,
    canGenerateDtus: false,   // ❌ never generates DTUs
    canMutateKnowledge: false,// ❌ never mutates knowledge
    canRecordAnalytics: true, // analytics only
  },
  [SCOPES.SHADOW]: {
    enabled: false,           // ❌ No heartbeat — pre-conscious
    intervalMs: 0,
    canGenerateDtus: false,
    canMutateKnowledge: false,
    canRecordAnalytics: false,
  },
});

// ── Scope Validation ─────────────────────────────────────────────────────────

/**
 * Check if influence is allowed from sourceScope to targetScope.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkInfluence(sourceScope, targetScope) {
  if (!ALL_SCOPES.includes(sourceScope)) {
    return { allowed: false, reason: `invalid_source_scope: ${sourceScope}` };
  }
  if (!ALL_SCOPES.includes(targetScope)) {
    return { allowed: false, reason: `invalid_target_scope: ${targetScope}` };
  }

  const allowed = INFLUENCE_MATRIX[sourceScope][targetScope];
  if (!allowed) {
    return {
      allowed: false,
      reason: `influence_blocked: ${sourceScope} → ${targetScope} is never allowed`,
    };
  }
  return { allowed: true, reason: "influence_permitted" };
}

/**
 * Validate that a scope value is valid.
 */
export function isValidScope(scope) {
  return ALL_SCOPES.includes(scope);
}

/**
 * Get the ordinal rank of a scope (Local=0, Marketplace=1, Global=2).
 */
function scopeRank(scope) {
  return { [SCOPES.SHADOW]: 0, [SCOPES.LOCAL]: 1, [SCOPES.MARKETPLACE]: 2, [SCOPES.CREATIVE_GLOBAL]: 3, [SCOPES.GLOBAL]: 4 }[scope] ?? -1;
}

/**
 * Check if moving from one scope to another is an "upward" promotion.
 */
export function isUpwardPromotion(fromScope, toScope) {
  return scopeRank(toScope) > scopeRank(fromScope);
}

// ── Scope Store (STATE integration) ──────────────────────────────────────────

/**
 * Ensure STATE has scope separation infrastructure.
 */
export function ensureScopeState(STATE) {
  if (!STATE._scopeSeparation) {
    STATE._scopeSeparation = {
      initialized: true,
      initializedAt: new Date().toISOString(),
      promotionLog: [],       // audit trail of all scope promotions
      overrideLog: [],        // founder override audit trail
      analytics: {            // marketplace analytics (sales/usage/attribution)
        sales: [],
        usage: [],
        derivativePropagation: [],
        attributionChains: [],
      },
      globalTick: {
        lastTickAt: null,
        tickCount: 0,
        candidatesGenerated: 0,
        resonanceUpdates: 0,
      },
      metrics: {
        promotionAttempts: 0,
        promotionApprovals: 0,
        promotionRejections: 0,
        influenceBlocks: 0,
        founderOverrides: 0,
        globalTickCount: 0,
        scopeViolations: 0,
      },
    };
  }
  return STATE._scopeSeparation;
}

// ── DTU Scope Assignment ─────────────────────────────────────────────────────

/**
 * Assign scope to a DTU. Defaults to "local".
 */
export function assignScope(dtu, scope) {
  dtu.scope = isValidScope(scope) ? scope : SCOPES.LOCAL;
  return dtu;
}

/**
 * Get the scope of a DTU (defaults to "local" if unset).
 */
export function getDtuScope(dtu) {
  return dtu?.scope && ALL_SCOPES.includes(dtu.scope) ? dtu.scope : SCOPES.LOCAL;
}

// ── Global DTU Validation ────────────────────────────────────────────────────

/**
 * Validate a DTU meets Global scope requirements.
 *
 * Global Empirical DTUs require:
 *   - Citations (source-addressable)
 *   - Evidence payloads
 *   - Confidence labeling
 *   - Explicit uncertainty bounds
 *
 * Global Philosophical DTUs require:
 *   - Clearly labeled as non-empirical
 *   - Logical rigor / internal consistency
 *   - Council gated
 *   - No factual authority claims
 */
export function validateGlobalDtu(dtu) {
  const errors = [];
  const dtuClass = dtu.meta?.dtuClass || DTU_CLASSES.EMPIRICAL;
  const core = dtu.core || {};

  // All Global DTUs require provenance
  if (!dtu.source || dtu.source === "unknown") {
    errors.push("global_requires_provenance: source must be specified");
  }

  // Council score must be adequate (stricter for Global)
  const score =
    (core.definitions?.length || 0) +
    (core.invariants?.length || 0) +
    (core.examples?.length || 0) +
    (core.claims?.length || 0) +
    (core.nextActions?.length || 0);
  if (score < 3) {
    errors.push(`global_requires_minimum_structure: score=${score}, need>=3`);
  }

  if (dtuClass === DTU_CLASSES.EMPIRICAL) {
    // Must have evidence / citations
    if (!dtu.meta?.citations?.length && !dtu.meta?.evidence?.length) {
      errors.push("empirical_requires_citations: provide meta.citations or meta.evidence");
    }
    // Must have confidence labeling
    if (!dtu.meta?.confidence && !dtu.meta?.confidenceLabel) {
      errors.push("empirical_requires_confidence: provide meta.confidence or meta.confidenceLabel");
    }
    // Must have uncertainty bounds
    if (dtu.meta?.uncertaintyBounds === undefined && dtu.meta?.confidence === undefined) {
      errors.push("empirical_requires_uncertainty: provide meta.uncertaintyBounds or numeric meta.confidence");
    }
  } else if (dtuClass === DTU_CLASSES.PHILOSOPHICAL) {
    // Must be labeled as non-empirical
    if (!dtu.tags?.includes("non-empirical") && !dtu.tags?.includes("philosophical")) {
      errors.push("philosophical_must_be_labeled: add 'non-empirical' or 'philosophical' tag");
    }
    // Must not make factual authority claims
    if (dtu.tags?.includes("fact") || dtu.meta?.confidenceLabel === "fact") {
      errors.push("philosophical_no_factual_claims: cannot claim factual authority");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    dtuClass,
    score,
  };
}

// ── Marketplace Validation ───────────────────────────────────────────────────

/**
 * Validate a DTU/artifact for marketplace listing.
 * Less strict than Global, but must prevent spam, block malicious content,
 * and ensure attribution clarity.
 */
export function validateMarketplaceListing(dtu, listing) {
  const errors = [];

  // Must have title
  if (!dtu.title || dtu.title === "Untitled DTU") {
    errors.push("marketplace_requires_title");
  }

  // Must have attribution/owner
  if (!listing?.orgId) {
    errors.push("marketplace_requires_attribution: listing must have orgId");
  }

  // License must be specified
  if (!listing?.license) {
    errors.push("marketplace_requires_license");
  }

  // No injection-flagged DTUs
  if (dtu.tags?.includes("quarantine:injection-review")) {
    errors.push("marketplace_blocks_quarantined: DTU is flagged for injection review");
  }

  return { ok: errors.length === 0, errors };
}

// ── Promotion Pipeline ───────────────────────────────────────────────────────

/**
 * Attempt to promote a DTU from one scope to another.
 *
 * All upward promotions require:
 *   1. Author explicitly pushes it
 *   2. Scope destination chosen
 *   3. Council passes it under destination rules
 *   4. Provenance preserved
 *
 * @param {object} STATE - Global state
 * @param {string} dtuId - DTU to promote
 * @param {string} targetScope - Destination scope
 * @param {object} opts - { actorId, override, verified, reason }
 * @returns {{ ok: boolean, error?: string, promotion?: object }}
 */
export function promoteDtu(STATE, dtuId, targetScope, opts = {}) {
  const ss = ensureScopeState(STATE);
  ss.metrics.promotionAttempts++;

  const dtu = STATE.dtus.get(dtuId);
  if (!dtu) {
    return { ok: false, error: "dtu_not_found" };
  }

  const currentScope = getDtuScope(dtu);

  // Validate target scope
  if (!isValidScope(targetScope)) {
    return { ok: false, error: `invalid_target_scope: ${targetScope}` };
  }

  // Same scope? No-op.
  if (currentScope === targetScope) {
    return { ok: false, error: "already_in_target_scope" };
  }

  // Check if this is upward (requires explicit push)
  if (isUpwardPromotion(currentScope, targetScope)) {
    // Rule 1: Author must explicitly push (opts.actorId must be present)
    if (!opts.actorId) {
      ss.metrics.promotionRejections++;
      return { ok: false, error: "upward_promotion_requires_author_intent: provide actorId" };
    }

    // Rule 3: Destination-scope council gate
    if (targetScope === SCOPES.GLOBAL) {
      const globalValidation = validateGlobalDtu(dtu);
      if (!globalValidation.ok) {
        ss.metrics.promotionRejections++;
        return {
          ok: false,
          error: "global_council_rejected",
          validationErrors: globalValidation.errors,
        };
      }
    }

    if (targetScope === SCOPES.CREATIVE_GLOBAL) {
      // Creative Global requires metadata completeness and domain
      if (!dtu.meta?.createdBy && !dtu.ownerId) {
        ss.metrics.promotionRejections++;
        return { ok: false, error: "creative_global_requires_creator" };
      }
      if (!dtu.human?.summary && !dtu.title) {
        ss.metrics.promotionRejections++;
        return { ok: false, error: "creative_global_requires_summary" };
      }
    }

    if (targetScope === SCOPES.MARKETPLACE) {
      // Marketplace has lighter council gate
      if (!dtu.title || dtu.title === "Untitled DTU") {
        ss.metrics.promotionRejections++;
        return { ok: false, error: "marketplace_requires_titled_dtu" };
      }
    }
  } else {
    // Downward influence (Global → Marketplace, Global → Local, etc.) always allowed
    // per influence matrix — no checks needed
    void 0;
  }

  // Founder override: always available, always logged
  if (opts.override && opts.verified) {
    ss.overrideLog.push({
      id: `override_${Date.now().toString(36)}`,
      dtuId,
      fromScope: currentScope,
      toScope: targetScope,
      actorId: opts.actorId,
      reason: opts.reason || "founder_override",
      timestamp: new Date().toISOString(),
    });
    ss.metrics.founderOverrides++;
  }

  // Apply the scope change
  const previousScope = currentScope;
  dtu.scope = targetScope;
  dtu.meta = dtu.meta || {};
  dtu.meta.scopeHistory = dtu.meta.scopeHistory || [];
  dtu.meta.scopeHistory.push({
    from: previousScope,
    to: targetScope,
    at: new Date().toISOString(),
    by: opts.actorId || "system",
    reason: opts.reason || "promotion",
  });
  dtu.updatedAt = new Date().toISOString();

  // Rule 4: Provenance preserved
  const promotionRecord = {
    id: `promo_${Date.now().toString(36)}`,
    dtuId,
    fromScope: previousScope,
    toScope: targetScope,
    actorId: opts.actorId,
    reason: opts.reason,
    override: !!(opts.override && opts.verified),
    timestamp: new Date().toISOString(),
  };
  ss.promotionLog.push(promotionRecord);
  ss.metrics.promotionApprovals++;

  return { ok: true, promotion: promotionRecord };
}

// ── Scope Enforcement Gates ──────────────────────────────────────────────────

/**
 * Gate: Enforce that a DTU creation respects scope rules.
 * - Local: free creation
 * - Marketplace: no auto-generation of DTUs
 * - Global: must come from existing Global DTUs or pass global council
 */
export function gateCreateDtu(scope, opts = {}) {
  if (scope === SCOPES.LOCAL) {
    return { ok: true, reason: "local_free_creation" };
  }

  if (scope === SCOPES.SHADOW) {
    return { ok: true, reason: "shadow_pre_conscious_creation" };
  }

  if (scope === SCOPES.MARKETPLACE) {
    return { ok: false, reason: "marketplace_cannot_create_dtus" };
  }

  if (scope === SCOPES.CREATIVE_GLOBAL) {
    // Creative Global DTUs must go through promotion pipeline (local → creative_global)
    if (opts.isAutoGenerated) {
      return { ok: false, reason: "creative_global_no_autogen" };
    }
    return { ok: true, reason: "creative_global_requires_citation_review" };
  }

  if (scope === SCOPES.GLOBAL) {
    // Global auto-generated DTUs must derive from existing Global DTUs only
    if (opts.isAutoGenerated) {
      if (!opts.parentDtuIds?.length) {
        return { ok: false, reason: "global_autogen_requires_global_parents" };
      }
      // Verify all parents are Global
      if (opts.parentScopes?.some(s => s !== SCOPES.GLOBAL)) {
        return { ok: false, reason: "global_autogen_parents_must_be_global" };
      }
      return { ok: true, reason: "global_autogen_from_global_parents" };
    }

    // Manual creation requires explicit council approval (handled by promotion pipeline)
    return { ok: true, reason: "global_manual_requires_council" };
  }

  return { ok: false, reason: `unknown_scope: ${scope}` };
}

/**
 * Gate: Enforce heartbeat scope rules.
 * Determines what operations a heartbeat tick is allowed to perform.
 */
export function gateHeartbeatOp(scope, operation) {
  const config = HEARTBEAT_CONFIG[scope];
  if (!config) return { ok: false, reason: `no_heartbeat_config: ${scope}` };

  if (!config.enabled) {
    return { ok: false, reason: `heartbeat_disabled_for_scope: ${scope}` };
  }

  switch (operation) {
    case "generate_dtu":
      return config.canGenerateDtus
        ? { ok: true, reason: `${scope}_can_generate` }
        : { ok: false, reason: `${scope}_cannot_generate_dtus` };
    case "mutate_lattice":
      if (scope === SCOPES.MARKETPLACE) {
        return { ok: false, reason: "marketplace_cannot_mutate_knowledge" };
      }
      return { ok: true, reason: `${scope}_can_mutate` };
    case "ingest_local":
      if (scope === SCOPES.GLOBAL) {
        return { ok: false, reason: "global_cannot_ingest_local" };
      }
      return { ok: true, reason: "ingest_allowed" };
    case "ingest_marketplace":
      if (scope === SCOPES.GLOBAL) {
        return { ok: false, reason: "global_cannot_ingest_marketplace" };
      }
      return { ok: true, reason: "ingest_allowed" };
    case "record_analytics":
      return config.canRecordAnalytics !== false
        ? { ok: true, reason: "analytics_allowed" }
        : { ok: false, reason: "analytics_not_allowed" };
    case "update_resonance":
      if (scope === SCOPES.GLOBAL) {
        return { ok: true, reason: "global_can_update_resonance" };
      }
      return { ok: false, reason: `${scope}_cannot_update_resonance` };
    default:
      return { ok: false, reason: `unknown_operation: ${operation}` };
  }
}

/**
 * Gate: Enforce that marketplace operations stay analytics-only.
 * Marketplace may track: sales, usage, derivative propagation, attribution chains.
 * Analytics NEVER influence: Global synthesis, Local cognition, DTU promotion logic.
 */
export function gateMarketplaceAnalytics(operation) {
  const allowedOps = ["record_sale", "record_usage", "record_derivation", "record_attribution",
                      "query_sales", "query_usage", "query_derivations", "query_attributions"];
  const blocked = ["create_dtu", "mutate_dtu", "promote_dtu", "influence_global",
                   "influence_local", "generate_dtu", "run_heartbeat"];

  if (blocked.includes(operation)) {
    return { ok: false, reason: `marketplace_operation_blocked: ${operation}` };
  }
  if (allowedOps.includes(operation)) {
    return { ok: true, reason: "marketplace_analytics_allowed" };
  }
  // Unknown operations are blocked by default (fail-closed)
  return { ok: false, reason: `marketplace_unknown_operation_blocked: ${operation}` };
}

// ── Marketplace Analytics ────────────────────────────────────────────────────

/**
 * Record a marketplace analytics event (sales, usage, etc.).
 */
export function recordMarketplaceAnalytics(STATE, eventType, payload) {
  const ss = ensureScopeState(STATE);
  const event = {
    id: `mkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
  };

  const allowed = gateMarketplaceAnalytics(`record_${eventType}`);
  if (!allowed.ok) {
    return { ok: false, error: allowed.reason };
  }

  switch (eventType) {
    case "sale":
      ss.analytics.sales.push(event);
      break;
    case "usage":
      ss.analytics.usage.push(event);
      break;
    case "derivation":
      ss.analytics.derivativePropagation.push(event);
      break;
    case "attribution":
      ss.analytics.attributionChains.push(event);
      break;
    default:
      return { ok: false, error: `unknown_analytics_type: ${eventType}` };
  }

  return { ok: true, event };
}

// ── Global Tick ──────────────────────────────────────────────────────────────

/**
 * Run the Global scope tick (every 5 minutes).
 *
 * Global tick CAN:
 *   - Generate DTU candidates from existing Global DTUs
 *   - Update resonance / credibility scores
 *
 * Global tick CANNOT:
 *   - Ingest local or marketplace DTUs
 *   - Respond to local activity
 */
export function runGlobalTick(STATE) {
  const ss = ensureScopeState(STATE);

  // Get all Global-scope DTUs
  const globalDtus = [];
  for (const dtu of STATE.dtus.values()) {
    if (getDtuScope(dtu) === SCOPES.GLOBAL) {
      globalDtus.push(dtu);
    }
  }

  // Get global emergents only
  let globalEmergents = [];
  try {
    const es = getEmergentState(STATE);
    globalEmergents = listEmergents(es, { active: true, instanceScope: "global" });
  } catch (_e) { logger.debug('emergent:scope-separation', 'store not initialized yet — ok, just empty', { error: _e?.message }); }

  ss.globalTick.lastTickAt = new Date().toISOString();
  ss.globalTick.tickCount++;
  ss.metrics.globalTickCount++;

  const readyForSynthesis = globalEmergents.length >= 3 && globalDtus.length >= 10;

  return {
    ok: true,
    tickNumber: ss.globalTick.tickCount,
    globalDtuCount: globalDtus.length,
    globalEmergentCount: globalEmergents.length,
    timestamp: ss.globalTick.lastTickAt,
    globalDtuIds: globalDtus.map(d => d.id),
    globalEmergentIds: globalEmergents.map(e => e.id),
    readyForSynthesis,
  };
}

/**
 * Select global DTUs that are candidates for synthesis.
 * Looks for: gaps (domains with few DTUs), recent additions, low-edge DTUs.
 */
export function selectGlobalSynthesisCandidates(STATE, globalDtuIds, limit = 5) {
  const candidates = [];

  for (const id of globalDtuIds) {
    const dtu = STATE.dtus.get(id);
    if (!dtu) continue;

    // Score: prefer DTUs with fewer edges (under-connected knowledge)
    const edgeCount = (dtu.meta?.edgeCount || 0);
    const age = Date.now() - new Date(dtu.createdAt || 0).getTime();
    const ageBonus = age < 86_400_000 ? 0.3 : 0; // recent DTUs get a boost

    candidates.push({
      id: dtu.id,
      title: dtu.title,
      tags: dtu.tags || [],
      tier: dtu.tier,
      score: (1 / (1 + edgeCount)) + ageBonus,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

// ── Query Helpers ────────────────────────────────────────────────────────────

/**
 * List DTUs filtered by scope.
 */
export function listDtusByScope(STATE, scope, opts = {}) {
  if (!isValidScope(scope)) {
    return { ok: false, error: `invalid_scope: ${scope}` };
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const offset = Math.max(0, Math.trunc(Number(opts.offset) || 0));
  const userId = opts.userId || opts.actorId || null;
  const dtus = [];
  for (const dtu of STATE.dtus.values()) {
    if (getDtuScope(dtu) !== scope) continue;
    // For local scope, only show DTUs owned by this user (or unowned legacy DTUs)
    if (scope === SCOPES.LOCAL && userId && dtu.ownerId && dtu.ownerId !== userId) continue;
    dtus.push(dtu);
  }
  const sorted = dtus.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return { ok: true, scope, dtus: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset };
}

/**
 * Get promotion history for a DTU.
 */
export function getPromotionHistory(STATE, dtuId) {
  const ss = ensureScopeState(STATE);
  const records = ss.promotionLog.filter(r => r.dtuId === dtuId);
  return { ok: true, dtuId, promotions: records };
}

/**
 * Get founder override log.
 */
export function getOverrideLog(STATE, opts = {}) {
  const ss = ensureScopeState(STATE);
  const limit = Math.min(Math.max(opts.limit || 50, 1), 500);
  return {
    ok: true,
    overrides: ss.overrideLog.slice(-limit).reverse(),
    total: ss.overrideLog.length,
  };
}

/**
 * Get marketplace analytics.
 */
export function getMarketplaceAnalytics(STATE, opts = {}) {
  const ss = ensureScopeState(STATE);
  const limit = Math.min(Math.max(opts.limit || 50, 1), 500);
  return {
    ok: true,
    sales: ss.analytics.sales.slice(-limit),
    usage: ss.analytics.usage.slice(-limit),
    derivativePropagation: ss.analytics.derivativePropagation.slice(-limit),
    attributionChains: ss.analytics.attributionChains.slice(-limit),
  };
}

/**
 * Get scope separation metrics.
 */
export function getScopeMetrics(STATE, opts = {}) {
  const ss = ensureScopeState(STATE);
  const userId = opts.userId || null;

  // Count DTUs by scope (total system counts)
  const scopeCounts = { [SCOPES.LOCAL]: 0, [SCOPES.GLOBAL]: 0, [SCOPES.CREATIVE_GLOBAL]: 0, [SCOPES.MARKETPLACE]: 0, [SCOPES.SHADOW]: 0 };
  // User-specific local count (only DTUs owned by this user)
  let userLocalCount = 0;
  let userSyncedCount = 0;

  for (const dtu of STATE.dtus.values()) {
    const s = getDtuScope(dtu);
    scopeCounts[s] = (scopeCounts[s] || 0) + 1;
    if (userId && s === SCOPES.LOCAL) {
      if (!dtu.ownerId || dtu.ownerId === userId) {
        userLocalCount++;
        if (dtu.meta?.syncedFromGlobal) userSyncedCount++;
      }
    }
  }

  return {
    ok: true,
    scopeCounts,
    // User-specific counts for the dashboard
    globalCount: scopeCounts[SCOPES.GLOBAL],
    creativeGlobalCount: scopeCounts[SCOPES.CREATIVE_GLOBAL],
    localCount: userId ? userLocalCount : scopeCounts[SCOPES.LOCAL],
    marketplaceCount: scopeCounts[SCOPES.MARKETPLACE],
    shadowCount: scopeCounts[SCOPES.SHADOW],
    userSyncedCount,
    globalTick: { ...ss.globalTick },
    metrics: { ...ss.metrics },
    influenceMatrix: INFLUENCE_MATRIX,
    heartbeatConfig: HEARTBEAT_CONFIG,
  };
}
