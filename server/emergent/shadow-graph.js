/**
 * Shadow DTU Graph Upgrade
 *
 * Shadows become first-class graph citizens:
 *   1. Unified store access — allDTUs(), getDTU(), hasDTU() span both maps
 *   2. Shadow edges — pattern→source, linguistic→topIds, wired through the edge store
 *   3. Full core fields — definitions, examples, nextActions synthesized from matches
 *   4. Activation participation — shadows at 0.6× tier weight
 *   5. Conversability — shadows answer questions, with promotion momentum
 *   6. Richness-based TTL — edge count + claim count + conversation count → survival
 *   7. Uniform graph traversal — modules use getDTU(), not STATE.shadowDtus.get()
 *
 * The lattice gets a subconscious. Shadows are pre-conscious knowledge —
 * not yet validated, not yet promoted, but structurally present and
 * influencing everything through the graph.
 */

import { createEdge, queryEdges, getNeighborhood } from "./edges.js";
import {
  activate as rawActivate,
  spreadActivation,
  getWorkingSet as rawGetWorkingSet,
  getActivationSystem,
} from "./activation.js";
import { getEmergentState } from "./store.js";

// ── 1. Unified Store Access ──────────────────────────────────────────────────

/**
 * Get a DTU from either canonical or shadow store.
 * Single entry point — modules never check two maps.
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {Object|null}
 */
export function getDTU(STATE, dtuId) {
  return STATE.dtus?.get(dtuId) || STATE.shadowDtus?.get(dtuId) || null;
}

/**
 * Check if a DTU exists in either store.
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {boolean}
 */
export function hasDTU(STATE, dtuId) {
  return (STATE.dtus?.has(dtuId) || STATE.shadowDtus?.has(dtuId)) === true;
}

/**
 * Iterator over all DTUs (canonical + shadow).
 * Returns an array — callers can filter by tier if they need only canonical.
 *
 * @param {Object} STATE
 * @param {Object} [opts]
 * @param {boolean} [opts.includeShadows=true]
 * @returns {Object[]}
 */
export function allDTUs(STATE, opts = {}) {
  const includeShadows = opts.includeShadows !== false;
  const canonical = STATE.dtus ? Array.from(STATE.dtus.values()) : [];
  if (!includeShadows) return canonical;
  const shadows = STATE.shadowDtus ? Array.from(STATE.shadowDtus.values()) : [];
  return canonical.concat(shadows);
}

/**
 * Determine which store a DTU lives in.
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {"canonical"|"shadow"|null}
 */
export function getDTUSource(STATE, dtuId) {
  if (STATE.dtus?.has(dtuId)) return "canonical";
  if (STATE.shadowDtus?.has(dtuId)) return "shadow";
  return null;
}

/**
 * Check if a DTU is a shadow (by tier or tag).
 *
 * @param {Object} d
 * @returns {boolean}
 */
export function isShadow(d) {
  return (
    (d?.tier || "").toString().toLowerCase() === "shadow" ||
    (Array.isArray(d?.tags) && d.tags.includes("shadow"))
  );
}

// ── 2. Shadow Edge Wiring ────────────────────────────────────────────────────

/**
 * After creating a pattern shadow DTU, wire it into the edge store.
 *
 *   shadow ──derives──→ source DTU (the DTU that triggered promotion)
 *   shadow ──similar──→ each matching DTU (shares the invariant)
 *
 * @param {Object} STATE
 * @param {Object} shadowDtu - The newly created shadow DTU
 * @param {string} sourceId - The DTU that triggered the shadow
 * @param {string[]} matchingIds - DTU IDs that share the promoted invariants
 * @returns {{ edgesCreated: number }}
 */
export function wireShadowEdges_pattern(STATE, shadowDtu, sourceId, matchingIds = []) {
  let edgesCreated = 0;
  const provenance = { source: "shadow_graph", id: shadowDtu.id };

  // shadow → source: derives
  const r1 = createEdge(STATE, {
    sourceId: shadowDtu.id,
    targetId: sourceId,
    edgeType: "derives",
    weight: 0.8,
    confidence: 0.9,
    createdBySource: provenance.source,
    createdById: provenance.id,
    label: "pattern_shadow_source",
  });
  if (r1.ok) edgesCreated++;

  // shadow → each matching DTU: similar (capped at 10 to avoid fan-out)
  for (const mid of matchingIds.slice(0, 10)) {
    if (mid === sourceId || mid === shadowDtu.id) continue;
    const r2 = createEdge(STATE, {
      sourceId: shadowDtu.id,
      targetId: mid,
      edgeType: "similar",
      weight: 0.5,
      confidence: 0.7,
      createdBySource: provenance.source,
      createdById: provenance.id,
      label: "pattern_shadow_match",
    });
    if (r2.ok) edgesCreated++;
  }

  return { edgesCreated };
}

/**
 * After creating a linguistic shadow DTU, wire topIds as edges.
 *
 *   shadow ──references──→ each topId
 *
 * @param {Object} STATE
 * @param {Object} shadowDtu - The newly created linguistic shadow
 * @param {string[]} topIds - DTU IDs that were top results for this phrase
 * @returns {{ edgesCreated: number }}
 */
export function wireShadowEdges_linguistic(STATE, shadowDtu, topIds = []) {
  let edgesCreated = 0;
  const provenance = { source: "shadow_graph", id: shadowDtu.id };

  for (const tid of topIds.slice(0, 12)) {
    if (tid === shadowDtu.id) continue;
    const r = createEdge(STATE, {
      sourceId: shadowDtu.id,
      targetId: tid,
      edgeType: "references",
      weight: 0.4,
      confidence: 0.6,
      createdBySource: provenance.source,
      createdById: provenance.id,
      label: "linguistic_shadow_top",
    });
    if (r.ok) edgesCreated++;
  }

  return { edgesCreated };
}

// ── 3. Full Core Fields ──────────────────────────────────────────────────────

/**
 * Enrich a shadow DTU's core fields by synthesizing from matching canonical DTUs.
 *
 * Pattern shadows get:
 *   - definitions from source DTU
 *   - examples aggregated from matching DTUs
 *   - nextActions from source DTU
 *
 * Linguistic shadows get:
 *   - definitions from topIds (first match with definitions)
 *   - claims from topIds
 *
 * @param {Object} STATE
 * @param {Object} shadowDtu - Mutable shadow DTU to enrich
 * @param {Object} opts
 * @param {string} [opts.sourceId] - Source DTU id (pattern shadows)
 * @param {string[]} [opts.matchingIds] - Matching DTU ids (pattern shadows)
 * @param {string[]} [opts.topIds] - Top result ids (linguistic shadows)
 * @returns {{ fieldsAdded: number }}
 */
export function enrichShadowCoreFields(STATE, shadowDtu, opts = {}) {
  if (!shadowDtu?.core) {
    shadowDtu.core = { definitions: [], invariants: [], claims: [], examples: [], nextActions: [] };
  }

  let fieldsAdded = 0;
  const kind = shadowDtu.machine?.kind;

  if (kind === "pattern_shadow") {
    const source = STATE.dtus?.get(opts.sourceId);
    const matchingDTUs = (opts.matchingIds || [])
      .map(id => STATE.dtus?.get(id))
      .filter(Boolean);

    // Definitions from source
    if (source?.core?.definitions?.length && !shadowDtu.core.definitions.length) {
      shadowDtu.core.definitions = source.core.definitions.slice(0, 4)
        .map(d => `[from ${source.id}] ${d}`);
      fieldsAdded++;
    }

    // Examples aggregated from matching DTUs (one per DTU, max 6)
    if (!shadowDtu.core.examples.length) {
      const examples = [];
      for (const m of matchingDTUs) {
        if (!m.core?.examples?.length) continue;
        examples.push(`[${m.id}] ${m.core.examples[0]}`);
        if (examples.length >= 6) break;
      }
      if (examples.length) {
        shadowDtu.core.examples = examples;
        fieldsAdded++;
      }
    }

    // nextActions from source
    if (source?.core?.nextActions?.length && !shadowDtu.core.nextActions.length) {
      shadowDtu.core.nextActions = source.core.nextActions.slice(0, 3);
      fieldsAdded++;
    }

    // Claims aggregated from matches (deduped, max 6)
    if (!shadowDtu.core.claims.length) {
      const claimSet = new Set();
      for (const m of [source, ...matchingDTUs].filter(Boolean)) {
        for (const c of (m.core?.claims || []).slice(0, 3)) {
          const norm = String(c).toLowerCase().trim();
          if (!claimSet.has(norm)) {
            claimSet.add(norm);
            shadowDtu.core.claims.push(c);
          }
          if (shadowDtu.core.claims.length >= 6) break;
        }
        if (shadowDtu.core.claims.length >= 6) break;
      }
      if (shadowDtu.core.claims.length) fieldsAdded++;
    }
  } else if (kind === "linguistic_map") {
    const topDTUs = (opts.topIds || shadowDtu.machine?.topIds || [])
      .map(id => STATE.dtus?.get(id))
      .filter(Boolean);

    // Definitions from first topId that has them
    if (!shadowDtu.core.definitions.length) {
      for (const t of topDTUs) {
        if (t.core?.definitions?.length) {
          shadowDtu.core.definitions = t.core.definitions.slice(0, 3)
            .map(d => `[from ${t.id}] ${d}`);
          fieldsAdded++;
          break;
        }
      }
    }

    // Claims from topIds (aggregated, max 4)
    if (!shadowDtu.core.claims.length) {
      const claims = [];
      for (const t of topDTUs) {
        for (const c of (t.core?.claims || []).slice(0, 2)) {
          claims.push(c);
          if (claims.length >= 4) break;
        }
        if (claims.length >= 4) break;
      }
      if (claims.length) {
        shadowDtu.core.claims = claims;
        fieldsAdded++;
      }
    }
  }

  if (fieldsAdded > 0) {
    shadowDtu.updatedAt = new Date().toISOString();
  }

  return { fieldsAdded };
}

// ── 4. Activation Participation ──────────────────────────────────────────────

/**
 * Shadow tier multiplier applied during activation.
 * Shadows activate at 0.6× canonical strength.
 */
export const SHADOW_TIER_WEIGHT = 0.6;

/**
 * Activate a DTU with tier-aware weighting.
 * Shadows get 0.6× the activation score.
 * Everything else passes through unchanged.
 *
 * @param {Object} STATE
 * @param {string} sessionId
 * @param {string} dtuId
 * @param {number} [score=1.0]
 * @param {string} [reason]
 * @returns {{ ok, activation }}
 */
export function activateWithTier(STATE, sessionId, dtuId, score = 1.0, reason = "direct") {
  const dtu = getDTU(STATE, dtuId);
  const effectiveScore = dtu && isShadow(dtu) ? score * SHADOW_TIER_WEIGHT : score;
  return rawActivate(STATE, sessionId, dtuId, effectiveScore, reason);
}

/**
 * Get working set including shadow DTUs.
 * Shadow entries are annotated with `isShadow: true` so callers can
 * differentiate without needing to check the store.
 *
 * @param {Object} STATE
 * @param {string} sessionId
 * @param {number} [k]
 * @returns {{ ok, workingSet, count }}
 */
export function getWorkingSetWithShadows(STATE, sessionId, k) {
  const result = rawGetWorkingSet(STATE, sessionId, k);
  if (!result.ok) return result;

  // Annotate each entry with shadow status
  for (const entry of result.workingSet) {
    const dtu = getDTU(STATE, entry.dtuId);
    entry.isShadow = dtu ? isShadow(dtu) : false;
    entry.tier = dtu?.tier || "unknown";
  }

  return result;
}

// ── 5. Conversability + Promotion Momentum ───────────────────────────────────

/**
 * Get or initialize the shadow conversation tracker.
 */
function getShadowConversations(STATE) {
  const es = getEmergentState(STATE);
  if (!es._shadowConversations) {
    es._shadowConversations = new Map(); // dtuId → ConversationRecord
  }
  return es._shadowConversations;
}

/**
 * Record a conversation interaction with a shadow DTU.
 * Builds promotion momentum: each interaction accumulates evidence.
 *
 * When momentum reaches the promotion threshold (5 meaningful interactions),
 * the shadow is flagged as a promotion candidate.
 *
 * @param {Object} STATE
 * @param {string} shadowDtuId
 * @param {Object} interaction
 * @param {string} interaction.type - "question"|"elaboration"|"correction"|"citation"
 * @param {string} [interaction.userId]
 * @param {string} [interaction.claim] - Any new claim surfaced during conversation
 * @returns {{ ok, momentum, promotionCandidate }}
 */
export function recordShadowInteraction(STATE, shadowDtuId, interaction = {}) {
  const dtu = getDTU(STATE, shadowDtuId);
  if (!dtu || !isShadow(dtu)) {
    return { ok: false, error: "not_a_shadow" };
  }

  const convos = getShadowConversations(STATE);
  let record = convos.get(shadowDtuId);
  if (!record) {
    record = {
      dtuId: shadowDtuId,
      interactions: [],
      uniqueUsers: new Set(),
      claimsAdded: [],
      momentum: 0,
      promotionCandidate: false,
      firstInteraction: new Date().toISOString(),
      lastInteraction: null,
    };
    convos.set(shadowDtuId, record);
  }

  // Record the interaction
  const entry = {
    type: interaction.type || "question",
    userId: interaction.userId || "anonymous",
    timestamp: new Date().toISOString(),
  };
  record.interactions.push(entry);
  if (record.interactions.length > 50) {
    record.interactions = record.interactions.slice(-50);
  }
  record.lastInteraction = entry.timestamp;

  // Track unique users
  if (interaction.userId) {
    record.uniqueUsers.add(interaction.userId);
  }

  // Track claims surfaced during conversation
  if (interaction.claim) {
    record.claimsAdded.push(interaction.claim);
    if (record.claimsAdded.length > 20) {
      record.claimsAdded = record.claimsAdded.slice(-20);
    }

    // Add claim to the shadow DTU's core
    if (dtu.core?.claims && !dtu.core.claims.includes(interaction.claim)) {
      dtu.core.claims.push(interaction.claim);
      if (dtu.core.claims.length > 12) {
        dtu.core.claims = dtu.core.claims.slice(-12);
      }
    }
  }

  // Compute momentum
  const interactionWeight = {
    question: 1,
    elaboration: 2,
    correction: 2,
    citation: 3,
  };
  record.momentum += interactionWeight[interaction.type] || 1;

  // Promotion threshold: 5+ weighted interactions from 2+ users
  const PROMOTION_THRESHOLD = 5;
  const MIN_USERS = 2;
  record.promotionCandidate =
    record.momentum >= PROMOTION_THRESHOLD &&
    record.uniqueUsers.size >= MIN_USERS;

  return {
    ok: true,
    momentum: record.momentum,
    promotionCandidate: record.promotionCandidate,
    interactionCount: record.interactions.length,
    uniqueUsers: record.uniqueUsers.size,
  };
}

/**
 * Get conversation record for a shadow DTU.
 */
export function getShadowConversationRecord(STATE, shadowDtuId) {
  const convos = getShadowConversations(STATE);
  const record = convos.get(shadowDtuId);
  if (!record) return { ok: false, error: "no_conversations" };
  return {
    ok: true,
    record: {
      ...record,
      uniqueUsers: record.uniqueUsers.size,
    },
  };
}

/**
 * List promotion candidates — shadows with enough momentum.
 *
 * @param {Object} STATE
 * @returns {{ ok, candidates }}
 */
export function listPromotionCandidates(STATE) {
  const convos = getShadowConversations(STATE);
  const candidates = [];

  for (const [dtuId, record] of convos) {
    if (!record.promotionCandidate) continue;
    const dtu = getDTU(STATE, dtuId);
    if (!dtu || !isShadow(dtu)) continue;

    candidates.push({
      dtuId,
      title: dtu.title,
      momentum: record.momentum,
      interactionCount: record.interactions.length,
      uniqueUsers: record.uniqueUsers.size,
      claimsAdded: record.claimsAdded.length,
      richness: computeRichness(STATE, dtuId),
    });
  }

  candidates.sort((a, b) => b.momentum - a.momentum);
  return { ok: true, candidates, count: candidates.length };
}

// ── 6. Richness-Based TTL ────────────────────────────────────────────────────

/**
 * Compute the "richness" score for a shadow DTU.
 * Richness determines how long a shadow survives.
 *
 *   richness = edgeCount × 2 + claimCount + conversationCount × 3
 *
 * Higher richness → longer TTL (up to 90 days).
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {number} Richness score (0+)
 */
export function computeRichness(STATE, dtuId) {
  const dtu = getDTU(STATE, dtuId);
  if (!dtu) return 0;

  // Edge count (from the edge store)
  const neighborhood = getNeighborhood(STATE, dtuId);
  const edgeCount = neighborhood.ok ? neighborhood.totalEdges : 0;

  // Claim count
  const claimCount = dtu.core?.claims?.length || 0;

  // Conversation count
  const convos = getShadowConversations(STATE);
  const record = convos.get(dtuId);
  const conversationCount = record?.interactions?.length || 0;

  return edgeCount * 2 + claimCount + conversationCount * 3;
}

/**
 * Compute TTL in days for a shadow DTU based on richness.
 *
 *   Base TTL:     14 days (empty shadow, no edges, no claims)
 *   Per richness: +2 days per richness point
 *   Maximum:      90 days
 *
 * A shadow with 3 edges (6) + 2 claims (2) + 1 conversation (3) = richness 11
 *   → 14 + 11×2 = 36 days
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {number} TTL in days
 */
export function computeShadowTTL(STATE, dtuId) {
  const BASE_TTL = 14;
  const PER_RICHNESS = 2;
  const MAX_TTL = 90;
  const richness = computeRichness(STATE, dtuId);
  return Math.min(MAX_TTL, BASE_TTL + richness * PER_RICHNESS);
}

/**
 * Richness-aware shadow cleanup.
 * Replaces the flat 14-day TTL with per-shadow richness-based expiry.
 *
 * @param {Object} STATE
 * @param {Object} [opts]
 * @param {number} [opts.maxShadows] - Capacity cap (defaults to env CONCORD_MAX_SHADOWS or 50000)
 * @returns {{ ok, expired, remaining, richestKept }}
 */
export function cleanupShadowsByRichness(STATE, opts = {}) {
  // Default raised from 2000 to 50000 for 32GB-heap deployments. Override via
  // env CONCORD_MAX_SHADOWS or per-call opts.maxShadows. The watchdog in
  // memory-pressure.js still sheds shadows under real heap pressure regardless.
  const maxShadows = opts.maxShadows || Number(process.env.CONCORD_MAX_SHADOWS) || 50000;
  const now = Date.now();
  let expired = 0;
  let richestKept = 0;

  const shadows = Array.from(STATE.shadowDtus?.entries() || []);

  // Linguistic shadow richness floor: linguistic_map shadows get a minimum
  // richness of 3, protecting them from aggressive TTL-based cleanup.
  // These shadows are the sole source of vocabulary patterns for offline mode.
  const LINGUISTIC_RICHNESS_FLOOR = 3;

  // Pass 1: Remove expired shadows (per-shadow TTL)
  for (const [id, dtu] of shadows) {
    // Protect linguistic shadows with richness floor
    const isLinguistic = dtu?.machine?.kind === "linguistic_map";
    if (isLinguistic) {
      const richness = computeRichness(STATE, id);
      if (richness + LINGUISTIC_RICHNESS_FLOOR >= 3) continue; // protected
    }

    const createdAt = new Date(dtu.createdAt || 0).getTime();
    const ttlDays = computeShadowTTL(STATE, id);
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    if (now - createdAt > ttlMs) {
      STATE.shadowDtus.delete(id);
      expired++;
    }
  }

  // Pass 2: If still over capacity, evict poorest (lowest richness first)
  // Linguistic shadows get a richness boost to survive longer
  if (STATE.shadowDtus.size > maxShadows) {
    const scored = Array.from(STATE.shadowDtus.entries())
      .map(([id, dtu]) => {
        const base = computeRichness(STATE, id);
        const isLinguistic = dtu?.machine?.kind === "linguistic_map";
        return { id, dtu, richness: base + (isLinguistic ? LINGUISTIC_RICHNESS_FLOOR : 0) };
      })
      .sort((a, b) => a.richness - b.richness); // ascending → poorest first

    const toRemove = scored.slice(0, STATE.shadowDtus.size - maxShadows);
    for (const { id } of toRemove) {
      STATE.shadowDtus.delete(id);
      expired++;
    }

    // Track the richest shadow we kept
    if (scored.length > toRemove.length) {
      richestKept = scored[scored.length - 1].richness;
    }
  }

  return {
    ok: true,
    expired,
    remaining: STATE.shadowDtus.size,
    richestKept,
  };
}

// ── 7. Conversation Context Builder ──────────────────────────────────────────

/**
 * Build conversation context for a shadow DTU.
 * Same structure as canonical DTU conversation context, plus promotion momentum.
 *
 * @param {Object} STATE
 * @param {string} dtuId
 * @returns {{ ok, context }}
 */
export function buildShadowConversationContext(STATE, dtuId) {
  const dtu = getDTU(STATE, dtuId);
  if (!dtu) return { ok: false, error: "not_found" };
  if (!isShadow(dtu)) return { ok: false, error: "not_a_shadow" };

  // Neighborhood (edges wired in step 2)
  const neighborhood = getNeighborhood(STATE, dtuId);
  const neighbors = [];

  for (const edge of [...(neighborhood.outgoing || []), ...(neighborhood.incoming || [])]) {
    const neighborId = edge.sourceId === dtuId ? edge.targetId : edge.sourceId;
    const neighborDtu = getDTU(STATE, neighborId);
    if (!neighborDtu) continue;
    neighbors.push({
      id: neighborId,
      title: neighborDtu.title,
      edgeType: edge.edgeType,
      weight: edge.weight,
      isShadow: isShadow(neighborDtu),
    });
  }

  // Conversation record
  const convoResult = getShadowConversationRecord(STATE, dtuId);

  const context = {
    dtuId,
    title: dtu.title,
    tier: dtu.tier,
    kind: dtu.machine?.kind,
    summary: dtu.human?.summary || "",
    core: dtu.core || {},
    tags: dtu.tags || [],
    neighbors: neighbors.slice(0, 20),
    neighborCount: neighbors.length,
    conversation: convoResult.ok ? {
      momentum: convoResult.record.momentum,
      promotionCandidate: convoResult.record.promotionCandidate,
      interactionCount: convoResult.record.interactionCount,
      uniqueUsers: convoResult.record.uniqueUsers,
    } : null,
    richness: computeRichness(STATE, dtuId),
    ttlDays: computeShadowTTL(STATE, dtuId),
    createdAt: dtu.createdAt,
  };

  return { ok: true, context };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/**
 * Get shadow graph metrics.
 */
export function getShadowGraphMetrics(STATE) {
  const totalShadows = STATE.shadowDtus?.size || 0;
  const convos = getShadowConversations(STATE);

  let patternShadows = 0;
  let linguisticShadows = 0;
  let totalRichness = 0;
  let promotionCandidates = 0;

  for (const dtu of STATE.shadowDtus?.values() || []) {
    const kind = dtu?.machine?.kind;
    if (kind === "pattern_shadow") patternShadows++;
    else if (kind === "linguistic_map") linguisticShadows++;
  }

  for (const [dtuId, record] of convos) {
    if (!STATE.shadowDtus?.has(dtuId)) continue;
    totalRichness += computeRichness(STATE, dtuId);
    if (record.promotionCandidate) promotionCandidates++;
  }

  return {
    ok: true,
    totalShadows,
    patternShadows,
    linguisticShadows,
    otherShadows: totalShadows - patternShadows - linguisticShadows,
    conversationsTracked: convos.size,
    promotionCandidates,
    averageRichness: totalShadows > 0 ? totalRichness / totalShadows : 0,
  };
}

/**
 * Compute shadow coverage per domain — what percentage of that domain's
 * vocabulary/patterns are captured in shadow DTUs.
 *
 * Coverage = (shadow DTUs tagged with domain) / (canonical DTUs in domain)
 * Capped at 1.0 (100% coverage).
 *
 * @param {Object} STATE
 * @returns {{ ok, domains: Object<string, { canonical, shadows, coverage }>, overallCoverage }}
 */
export function computeShadowCoverage(STATE) {
  const domainStats = {};

  // Count canonical DTUs per domain (by tags)
  for (const dtu of STATE.dtus?.values() || []) {
    for (const tag of (dtu.tags || [])) {
      if (!domainStats[tag]) domainStats[tag] = { canonical: 0, shadows: 0 };
      domainStats[tag].canonical++;
    }
  }

  // Count shadow DTUs per domain (by tags)
  for (const dtu of STATE.shadowDtus?.values() || []) {
    for (const tag of (dtu.tags || [])) {
      if (!domainStats[tag]) domainStats[tag] = { canonical: 0, shadows: 0 };
      domainStats[tag].shadows++;
    }
  }

  // Compute coverage per domain
  let totalCanonical = 0;
  let totalCoveredDomains = 0;
  const domains = {};
  for (const [tag, stats] of Object.entries(domainStats)) {
    if (stats.canonical < 2) continue; // Skip trivial domains
    const coverage = Math.min(stats.shadows / Math.max(stats.canonical, 1), 1.0);
    domains[tag] = { canonical: stats.canonical, shadows: stats.shadows, coverage: Math.round(coverage * 100) / 100 };
    totalCanonical++;
    if (coverage >= 0.1) totalCoveredDomains++;
  }

  return {
    ok: true,
    domains,
    overallCoverage: totalCanonical > 0 ? Math.round((totalCoveredDomains / totalCanonical) * 100) / 100 : 0,
    domainCount: totalCanonical,
    coveredDomains: totalCoveredDomains,
  };
}

/**
 * Offline mode quality indicator.
 * Returns whether there is enough shadow coverage to meaningfully
 * structure output when all LLM brains are offline.
 *
 * Thresholds:
 *   - "good":     >= 20% overall coverage AND >= 50 linguistic shadows
 *   - "degraded":  >= 5% overall coverage OR  >= 10 linguistic shadows
 *   - "minimal":   any shadows exist
 *   - "none":      no shadows at all
 *
 * @param {Object} STATE
 * @returns {{ ok, quality, linguisticShadows, overallCoverage, warning }}
 */
export function offlineQualityIndicator(STATE) {
  const totalShadows = STATE.shadowDtus?.size || 0;
  let linguisticShadows = 0;
  for (const dtu of STATE.shadowDtus?.values() || []) {
    if (dtu?.machine?.kind === "linguistic_map") linguisticShadows++;
  }

  const coverage = computeShadowCoverage(STATE);
  const overallCoverage = coverage.overallCoverage;

  let quality;
  let warning = null;

  if (overallCoverage >= 0.20 && linguisticShadows >= 50) {
    quality = "good";
  } else if (overallCoverage >= 0.05 || linguisticShadows >= 10) {
    quality = "degraded";
    warning = "Offline mode may produce incomplete or generic output. Continue using online mode to build shadow coverage.";
  } else if (totalShadows > 0) {
    quality = "minimal";
    warning = "Very limited shadow coverage. Offline responses will be basic and may lack domain-specific vocabulary.";
  } else {
    quality = "none";
    warning = "No shadow DTUs exist. Offline mode cannot structure meaningful output. Use online mode first to accumulate patterns.";
  }

  return {
    ok: true,
    quality,
    linguisticShadows,
    totalShadows,
    overallCoverage,
    coveredDomains: coverage.coveredDomains,
    warning,
  };
}
