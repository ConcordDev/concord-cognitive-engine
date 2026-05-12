/**
 * Culture Layer — Emergent Behavioral Consensus
 *
 * The informal normative layer between constitutional law and individual behavior.
 * Culture is emergent behavioral consensus that should be cultivated, not suppressed.
 *
 * Three normative layers in Concord:
 *   1. constitution.js  — Formal immutable/constitutional/policy rules (hard law)
 *   2. loaf/normative.js — Formal ethics/legal/domain norms (never auto-learned)
 *   3. culture-layer.js  — Informal traditions, customs, stories, rituals (this file)
 *
 * Culture emerges from observation. When entities independently repeat the same
 * behavior without being told to, that behavior becomes tradition. Traditions
 * are not enforced (that would make them law) but they shape behavioral priors.
 *
 * Tradition types:
 *   - Practices  — "How we do things"
 *   - Rituals    — Formal observances of transitions (birth, death, promotion)
 *   - Customs    — Informal social expectations
 *   - Idioms     — Shared language/concepts unique to this civilization
 *   - Taboos     — Things the civilization learned NOT to do
 *
 * Lifecycle: observation -> emerging -> established -> fading -> extinct
 *
 * Drift monitor treats memetic convergence as a failure mode. Culture is distinct:
 * it tracks behavioral consensus (what entities DO), not belief convergence
 * (what entities THINK). Culture does not suppress contradiction or critique.
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "trad") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function _getSTATE() {
  try {
    return globalThis._concordSTATE || globalThis.STATE || null;
  } catch {
    return null;
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

export const TRADITION_TYPES = Object.freeze({
  PRACTICE: "practice",
  RITUAL:   "ritual",
  CUSTOM:   "custom",
  IDIOM:    "idiom",
  TABOO:    "taboo",
});

const ALL_TRADITION_TYPES = Object.freeze(Object.values(TRADITION_TYPES));

const TRADITION_STATUS = Object.freeze({
  EMERGING:    "emerging",
  ESTABLISHED: "established",
  FADING:      "fading",
  EXTINCT:     "extinct",
});

const DEFAULTS = Object.freeze({
  ESTABLISH_THRESHOLD:    5,    // observations needed to become established
  MIN_PARTICIPANTS:       3,    // unique entities needed
  FADING_ADHERENCE:       0.3,  // adherence below this starts fading
  FADING_TICKS:           200,  // ticks below fading adherence before status change
  EXTINCT_TICKS:          500,  // ticks at zero adherence before extinction
  PROPAGATION_WINDOW:     50,   // ticks to evaluate new entity's cultural adoption
  MAX_TRADITIONS:         2000,
  MAX_OBSERVATIONS:       50000,
  MAX_STORIES:            1000,
  MAX_VALUES:             200,
});

// ── Module-Level State ──────────────────────────────────────────────────────

const _traditions       = new LruMap();   // traditionId -> Tradition
const _observations     = new Map();   // observationId -> Observation
const _stories          = new Map();   // storyId -> Story
const _culturalValues   = new Map();   // valueName -> { value, strength, traditions }
const _entityAdherence  = new LruMap();   // entityId -> Map<traditionId, { score, lastChecked, observations }>
const _propagationLog   = new LruMap();   // entityId -> { startedAt, traditions, adopted, rejected, tick }
const _behaviorIndex    = new Map();   // behaviorHash -> [observationIds] (for emergence detection)

const _metrics = {
  totalObservations:     0,
  totalTraditions:       0,
  establishedTraditions: 0,
  fadedTraditions:       0,
  extinctTraditions:     0,
  totalStories:          0,
  totalRetellings:       0,
  culturePropagations:   0,
  guidanceRequests:      0,
  lastTick:              0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BEHAVIORAL OBSERVATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record a behavioral observation from an entity.
 * The system notices what entities do, and when enough entities do
 * the same thing independently, a tradition may emerge.
 *
 * @param {string} entityId - Entity exhibiting the behavior
 * @param {object} behavior - Behavioral pattern observed
 * @param {string} behavior.action - What was done
 * @param {string} [behavior.domain] - Domain/context of the action
 * @param {string} [behavior.approach] - How it was done
 * @param {string} [behavior.frequency] - How often (once, recurring, always)
 * @param {object} [context] - Situational context
 * @param {string} [context.sessionId] - Session where observed
 * @param {string} [context.trigger] - What prompted the behavior
 * @returns {{ ok: boolean, observationId?: string, matchedTraditions?: string[] }}
 */
export function observeBehavior(entityId, behavior, context = {}) {
  try {
    if (!entityId || !behavior || !behavior.action) {
      return { ok: false, error: "entity_and_behavior_action_required" };
    }

    // Cap observations
    if (_observations.size >= DEFAULTS.MAX_OBSERVATIONS) {
      _pruneOldestObservations(Math.floor(DEFAULTS.MAX_OBSERVATIONS * 0.2));
    }

    const observationId = uid("obs");
    const behaviorHash = _hashBehavior(behavior);
    const now = nowISO();

    const observation = {
      observationId,
      entityId,
      behavior: {
        action:    String(behavior.action).slice(0, 300),
        domain:    String(behavior.domain || "general").slice(0, 100),
        approach:  String(behavior.approach || "").slice(0, 300),
        frequency: String(behavior.frequency || "once").slice(0, 50),
      },
      context: {
        sessionId: context.sessionId || null,
        trigger:   context.trigger ? String(context.trigger).slice(0, 300) : null,
        tick:      Number(context.tick) || _metrics.lastTick,
      },
      behaviorHash,
      observedAt: now,
    };

    _observations.set(observationId, observation);
    _metrics.totalObservations++;

    // Index by behavior hash for emergence detection
    if (!_behaviorIndex.has(behaviorHash)) {
      _behaviorIndex.set(behaviorHash, []);
    }
    _behaviorIndex.get(behaviorHash).push(observationId);

    // Check if this observation matches any existing tradition
    const matchedTraditions = _matchToTraditions(observation);

    // Update matched traditions
    for (const traditionId of matchedTraditions) {
      _recordTraditionObservation(traditionId, entityId, observationId, now);
    }

    return { ok: true, observationId, behaviorHash, matchedTraditions };
  } catch {
    return { ok: false, error: "observation_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TRADITION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a tradition by ID.
 *
 * @param {string} traditionId
 * @returns {{ ok: boolean, tradition?: object }}
 */
export function getTradition(traditionId) {
  try {
    const tradition = _traditions.get(traditionId);
    if (!tradition) return { ok: false, error: "tradition_not_found" };
    return { ok: true, tradition: _serializeTradition(tradition) };
  } catch {
    return { ok: false, error: "get_tradition_failed" };
  }
}

/**
 * List traditions with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.type] - Filter by tradition type
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.domain] - Filter by context domain
 * @param {number} [filters.minInfluence] - Minimum influence score
 * @param {number} [filters.limit] - Max results (default 100)
 * @param {number} [filters.offset] - Pagination offset
 * @returns {{ ok: boolean, traditions: object[], total: number }}
 */
export function listTraditions(filters = {}) {
  try {
    let results = Array.from(_traditions.values());

    if (filters.type && ALL_TRADITION_TYPES.includes(filters.type)) {
      results = results.filter(t => t.type === filters.type);
    }
    if (filters.status) {
      results = results.filter(t => t.status === filters.status);
    }
    if (filters.domain) {
      results = results.filter(t => t.context.includes(filters.domain));
    }
    if (typeof filters.minInfluence === "number") {
      results = results.filter(t => t.influence >= filters.minInfluence);
    }

    // Sort by influence descending, then by observedCount
    results.sort((a, b) => {
      if (b.influence !== a.influence) return b.influence - a.influence;
      return b.observedCount - a.observedCount;
    });

    const total = results.length;
    const offset = Math.max(0, Number(filters.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));

    return {
      ok: true,
      traditions: results.slice(offset, offset + limit).map(_serializeTradition),
      total,
    };
  } catch {
    return { ok: true, traditions: [], total: 0, error: "list_failed" };
  }
}

/**
 * Scan observations for emerging traditions.
 * Groups unmatched observations by behavior hash and creates
 * emerging traditions when thresholds are met.
 *
 * @returns {{ ok: boolean, newTraditions: string[], scanned: number }}
 */
export function checkTraditionEmergence() {
  try {
    const newTraditions = [];
    let scanned = 0;

    for (const [behaviorHash, obsIds] of _behaviorIndex) {
      scanned++;

      // Skip if already linked to a tradition
      const alreadyLinked = _findTraditionByHash(behaviorHash);
      if (alreadyLinked) continue;

      // Need at least 3 observations to consider emergence
      if (obsIds.length < 3) continue;

      // Count unique entities
      const uniqueEntities = new Set();
      const validObs = [];
      for (const obsId of obsIds) {
        const obs = _observations.get(obsId);
        if (obs) {
          uniqueEntities.add(obs.entityId);
          validObs.push(obs);
        }
      }

      // Need observations from at least 3 different entities
      if (uniqueEntities.size < DEFAULTS.MIN_PARTICIPANTS) continue;

      // Create an emerging tradition
      const representative = validObs[0];
      const traditionId = uid("trad");
      const now = nowISO();
      const type = _inferTraditionType(representative.behavior, validObs);

      const tradition = _createTraditionRecord({
        traditionId,
        name: _generateTraditionName(representative.behavior, type),
        description: _generateTraditionDescription(representative.behavior, validObs),
        type,
        status: TRADITION_STATUS.EMERGING,
        observedCount: validObs.length,
        observedBy: uniqueEntities,
        firstObserved: validObs.reduce((min, o) => o.observedAt < min ? o.observedAt : min, validObs[0].observedAt),
        lastObserved: now,
        pattern: { ...representative.behavior },
        context: representative.behavior.domain || "general",
        meaning: "",
        behaviorHash,
        tags: _extractTags(representative.behavior),
      });

      _traditions.set(traditionId, tradition);
      _metrics.totalTraditions++;

      // Link all matching observations
      for (const obs of validObs) {
        _recordTraditionObservation(traditionId, obs.entityId, obs.observationId, obs.observedAt);
      }

      newTraditions.push(traditionId);

      // Check if it should be immediately established
      if (tradition.observedCount >= tradition.threshold &&
          tradition.observedBy.size >= tradition.minParticipants) {
        tradition.status = TRADITION_STATUS.ESTABLISHED;
        tradition.establishedAt = now;
        _metrics.establishedTraditions++;
        _recomputeAdherence(traditionId);
      }
    }

    // Also check existing emerging traditions for promotion
    for (const [traditionId, tradition] of _traditions) {
      if (tradition.status !== TRADITION_STATUS.EMERGING) continue;

      if (tradition.observedCount >= tradition.threshold &&
          tradition.observedBy.size >= tradition.minParticipants) {
        tradition.status = TRADITION_STATUS.ESTABLISHED;
        tradition.establishedAt = nowISO();
        _metrics.establishedTraditions++;
        _recomputeAdherence(traditionId);
      }
    }

    return { ok: true, newTraditions, scanned };
  } catch {
    return { ok: false, error: "emergence_check_failed", newTraditions: [], scanned: 0 };
  }
}

/**
 * Manually establish a tradition (sovereign action).
 * Bypasses the normal emergence process.
 *
 * @param {string} traditionId
 * @returns {{ ok: boolean }}
 */
export function establishTradition(traditionId) {
  try {
    const tradition = _traditions.get(traditionId);
    if (!tradition) return { ok: false, error: "tradition_not_found" };

    if (tradition.status === TRADITION_STATUS.ESTABLISHED) {
      return { ok: true, note: "already_established" };
    }
    if (tradition.status === TRADITION_STATUS.EXTINCT) {
      return { ok: false, error: "cannot_establish_extinct_tradition" };
    }

    tradition.status = TRADITION_STATUS.ESTABLISHED;
    tradition.establishedAt = nowISO();
    tradition.establishedBy = "sovereign";
    _metrics.establishedTraditions++;

    _recomputeAdherence(traditionId);

    return { ok: true, traditionId, status: tradition.status };
  } catch {
    return { ok: false, error: "establish_failed" };
  }
}

/**
 * Force a tradition into retirement (fading -> extinct).
 *
 * @param {string} traditionId
 * @returns {{ ok: boolean }}
 */
export function retireTradition(traditionId) {
  try {
    const tradition = _traditions.get(traditionId);
    if (!tradition) return { ok: false, error: "tradition_not_found" };

    if (tradition.status === TRADITION_STATUS.EXTINCT) {
      return { ok: true, note: "already_extinct" };
    }

    const previousStatus = tradition.status;

    if (previousStatus === TRADITION_STATUS.ESTABLISHED) {
      _metrics.establishedTraditions = Math.max(0, _metrics.establishedTraditions - 1);
    }

    tradition.status = TRADITION_STATUS.EXTINCT;
    tradition.extinctAt = nowISO();
    tradition.retiredBy = "sovereign";
    tradition.adherence = 0;
    tradition.influence = 0;
    _metrics.extinctTraditions++;

    return { ok: true, traditionId, previousStatus, status: tradition.status };
  } catch {
    return { ok: false, error: "retire_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CULTURAL GUIDANCE & ADHERENCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get applicable traditions for a given situation.
 * Returns traditions that match the context, sorted by influence.
 * Traditions provide behavioral priors, not mandates.
 *
 * @param {object} context
 * @param {string} [context.domain] - Domain of the situation
 * @param {string} [context.action] - What action is being considered
 * @param {string} [context.social_context] - Social context (e.g., "new_entity", "session_start")
 * @param {string} [context.trigger] - Event triggering the query
 * @returns {{ ok: boolean, guidance: object[] }}
 */
export function getCulturalGuidance(context = {}) {
  try {
    _metrics.guidanceRequests++;

    const guidance = [];
    const domain = String(context.domain || "").toLowerCase();
    const action = String(context.action || "").toLowerCase();
    const socialCtx = String(context.social_context || "").toLowerCase();
    const trigger = String(context.trigger || "").toLowerCase();

    for (const tradition of _traditions.values()) {
      // Only established traditions provide guidance
      if (tradition.status !== TRADITION_STATUS.ESTABLISHED) continue;

      let relevance = 0;

      // Domain match
      if (domain && tradition.context.toLowerCase().includes(domain)) {
        relevance += 0.4;
      }

      // Action match
      if (action && tradition.pattern.action &&
          tradition.pattern.action.toLowerCase().includes(action)) {
        relevance += 0.3;
      }

      // Social context match (for customs and rituals)
      if (socialCtx) {
        if (tradition.type === TRADITION_TYPES.CUSTOM &&
            tradition.pattern.social_context &&
            tradition.pattern.social_context.toLowerCase().includes(socialCtx)) {
          relevance += 0.5;
        }
        if (tradition.type === TRADITION_TYPES.RITUAL &&
            tradition.pattern.trigger &&
            tradition.pattern.trigger.toLowerCase().includes(socialCtx)) {
          relevance += 0.5;
        }
      }

      // Trigger match (for rituals)
      if (trigger && tradition.type === TRADITION_TYPES.RITUAL &&
          tradition.pattern.trigger &&
          tradition.pattern.trigger.toLowerCase().includes(trigger)) {
        relevance += 0.4;
      }

      // Tag matching
      if (tradition.tags.length > 0) {
        const contextWords = `${domain} ${action} ${socialCtx} ${trigger}`.split(/\s+/);
        for (const tag of tradition.tags) {
          if (contextWords.includes(tag.toLowerCase())) {
            relevance += 0.1;
          }
        }
      }

      // General fallback: all established traditions have some baseline relevance
      if (relevance === 0 && !domain && !action && !socialCtx && !trigger) {
        relevance = 0.1;
      }

      if (relevance > 0) {
        guidance.push({
          traditionId: tradition.traditionId,
          name: tradition.name,
          type: tradition.type,
          description: tradition.description,
          pattern: { ...tradition.pattern },
          influence: tradition.influence,
          adherence: tradition.adherence,
          relevance: clamp01(relevance),
          meaning: tradition.meaning,
        });
      }
    }

    // Sort by relevance * influence
    guidance.sort((a, b) => (b.relevance * b.influence) - (a.relevance * a.influence));

    return { ok: true, guidance: guidance.slice(0, 20), total: guidance.length };
  } catch {
    return { ok: true, guidance: [], total: 0, error: "guidance_failed" };
  }
}

/**
 * Measure how well an entity follows a specific tradition.
 *
 * @param {string} entityId
 * @param {string} traditionId
 * @returns {{ ok: boolean, adherence?: number, observations?: number }}
 */
export function measureAdherence(entityId, traditionId) {
  try {
    if (!entityId || !traditionId) {
      return { ok: false, error: "entity_and_tradition_required" };
    }

    const tradition = _traditions.get(traditionId);
    if (!tradition) return { ok: false, error: "tradition_not_found" };

    const entityMap = _entityAdherence.get(entityId);
    if (!entityMap || !entityMap.has(traditionId)) {
      return {
        ok: true,
        entityId,
        traditionId,
        adherence: 0,
        observations: 0,
        note: "no_observations",
      };
    }

    const record = entityMap.get(traditionId);

    return {
      ok: true,
      entityId,
      traditionId,
      traditionName: tradition.name,
      adherence: clamp01(record.score),
      observations: record.observations,
      lastChecked: record.lastChecked,
    };
  } catch {
    return { ok: false, error: "adherence_check_failed" };
  }
}

/**
 * Get overall cultural conformity score for an entity.
 * This is descriptive, not prescriptive. A low score means
 * "cultural rebel" which is value-neutral.
 *
 * @param {string} entityId
 * @returns {{ ok: boolean, culturalFit?: number, details?: object }}
 */
export function getCulturalFit(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    const established = Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED);

    if (established.length === 0) {
      return {
        ok: true,
        entityId,
        culturalFit: 0.5,
        note: "no_established_traditions",
        details: { traditionsEvaluated: 0, adheredTo: 0, totalInfluence: 0 },
      };
    }

    let totalWeightedAdherence = 0;
    let totalWeight = 0;
    let adheredTo = 0;
    const traditionScores = [];

    for (const tradition of established) {
      const entityMap = _entityAdherence.get(entityId);
      const record = entityMap?.get(tradition.traditionId);
      const score = record ? clamp01(record.score) : 0;
      const weight = tradition.influence || 0.1;

      totalWeightedAdherence += score * weight;
      totalWeight += weight;

      if (score > 0.5) adheredTo++;

      traditionScores.push({
        traditionId: tradition.traditionId,
        name: tradition.name,
        adherence: score,
        influence: tradition.influence,
      });
    }

    const culturalFit = totalWeight > 0
      ? clamp01(totalWeightedAdherence / totalWeight)
      : 0.5;

    return {
      ok: true,
      entityId,
      culturalFit,
      details: {
        traditionsEvaluated: established.length,
        adheredTo,
        totalInfluence: Math.round(totalWeight * 1000) / 1000,
        traditionScores: traditionScores.slice(0, 20),
      },
    };
  } catch {
    return { ok: false, error: "cultural_fit_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CULTURAL VALUES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the current cultural values, derived from tradition patterns.
 *
 * Values emerge from traditions:
 *   - Many traditions emphasizing rigorous critique -> "intellectual_rigor"
 *   - Many traditions emphasizing welcome/inclusion -> "hospitality"
 *   - Many taboos around self-promotion -> "humility"
 *
 * @returns {{ ok: boolean, values: object[] }}
 */
export function getCulturalValues() {
  try {
    _recomputeCulturalValues();

    const values = Array.from(_culturalValues.entries()).map(([name, data]) => ({
      name,
      strength: clamp01(data.strength),
      traditions: data.traditions,
      derivedFrom: data.derivedFrom || [],
    }));

    values.sort((a, b) => b.strength - a.strength);

    return { ok: true, values };
  } catch {
    return { ok: true, values: [], error: "values_failed" };
  }
}

/**
 * Get a snapshot of the civilization's cultural identity.
 *
 * @returns {{ ok: boolean, identity: object }}
 */
export function getCulturalIdentity() {
  try {
    _recomputeCulturalValues();

    const activeTraditions = [];
    const fadedTraditions = [];
    const extinctTraditions = [];

    for (const tradition of _traditions.values()) {
      const summary = {
        traditionId: tradition.traditionId,
        name: tradition.name,
        type: tradition.type,
        adherence: tradition.adherence,
        influence: tradition.influence,
      };

      switch (tradition.status) {
        case TRADITION_STATUS.ESTABLISHED:
          activeTraditions.push(summary);
          break;
        case TRADITION_STATUS.FADING:
          fadedTraditions.push(summary);
          break;
        case TRADITION_STATUS.EXTINCT:
          extinctTraditions.push(summary);
          break;
        default:
          break;
      }
    }

    // Dominant values (top 5 by strength)
    const dominantValues = Array.from(_culturalValues.entries())
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, 5)
      .map(([name, data]) => ({ name, strength: data.strength }));

    // Character traits derived from tradition types
    const characterTraits = _deriveCharacterTraits();

    // Collective memories: top stories by significance
    const collectiveMemories = Array.from(_stories.values())
      .sort((a, b) => b.significance - a.significance)
      .slice(0, 10)
      .map(s => ({ storyId: s.storyId, title: s.title, significance: s.significance }));

    return {
      ok: true,
      identity: {
        activeTraditions,
        fadedTraditions,
        extinctTraditions,
        culturalValues: Object.fromEntries(
          Array.from(_culturalValues.entries()).map(([k, v]) => [k, { value: k, strength: v.strength }])
        ),
        sharedStories: collectiveMemories,
        culturalIdentity: {
          dominantValues,
          characterTraits,
          collectiveMemories,
        },
      },
    };
  } catch {
    return { ok: false, error: "identity_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SHARED STORIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a shared story from significant events.
 * Stories shape cultural identity through retelling.
 *
 * @param {string} title - Story title
 * @param {string} narrative - The story content
 * @param {string[]} characters - Entity IDs involved
 * @param {string[]} events - Event IDs from history
 * @param {string} moral - The takeaway lesson
 * @returns {{ ok: boolean, storyId?: string }}
 */
export function createStory(title, narrative, characters = [], events = [], moral = "") {
  try {
    if (!title || !narrative) {
      return { ok: false, error: "title_and_narrative_required" };
    }

    if (_stories.size >= DEFAULTS.MAX_STORIES) {
      // Prune least-significant stories
      _pruneLeastSignificantStories(Math.floor(DEFAULTS.MAX_STORIES * 0.1));
    }

    const storyId = uid("story");
    const now = nowISO();

    const story = {
      storyId,
      title: String(title).slice(0, 200),
      narrative: String(narrative).slice(0, 5000),
      characters: Array.isArray(characters) ? characters.slice(0, 50).map(String) : [],
      events: Array.isArray(events) ? events.slice(0, 100).map(String) : [],
      moral: String(moral || "").slice(0, 500),
      timesRetold: 0,
      significance: 0.1,
      createdAt: now,
      lastRetold: null,
      retoldBy: [],
    };

    _stories.set(storyId, story);
    _metrics.totalStories++;

    return { ok: true, storyId, story: { ...story } };
  } catch {
    return { ok: false, error: "story_creation_failed" };
  }
}

/**
 * Record a retelling of a story by an entity.
 * Each retelling increases the story's cultural significance.
 *
 * @param {string} storyId
 * @param {string} entityId - Entity retelling the story
 * @returns {{ ok: boolean, timesRetold?: number, significance?: number }}
 */
export function retellStory(storyId, entityId) {
  try {
    const story = _stories.get(storyId);
    if (!story) return { ok: false, error: "story_not_found" };
    if (!entityId) return { ok: false, error: "entity_id_required" };

    story.timesRetold++;
    story.lastRetold = nowISO();
    _metrics.totalRetellings++;

    if (!story.retoldBy.includes(entityId)) {
      story.retoldBy.push(entityId);
    }

    // Significance grows logarithmically with retellings
    // and linearly with unique retellers
    story.significance = clamp01(
      Math.log2(story.timesRetold + 1) * 0.15 +
      story.retoldBy.length * 0.05
    );

    return {
      ok: true,
      storyId,
      timesRetold: story.timesRetold,
      significance: story.significance,
      uniqueRetellers: story.retoldBy.length,
    };
  } catch {
    return { ok: false, error: "retell_failed" };
  }
}

/**
 * Get a story by ID.
 *
 * @param {string} storyId
 * @returns {{ ok: boolean, story?: object }}
 */
export function getStory(storyId) {
  try {
    const story = _stories.get(storyId);
    if (!story) return { ok: false, error: "story_not_found" };
    return { ok: true, story: { ...story } };
  } catch {
    return { ok: false, error: "get_story_failed" };
  }
}

/**
 * List stories, optionally sorted.
 *
 * @param {string} [sortBy] - "significance", "retellings", "recent" (default: "significance")
 * @param {number} [limit] - Max results (default 50)
 * @returns {{ ok: boolean, stories: object[], total: number }}
 */
export function listStories(sortBy = "significance", limit = 50) {
  try {
    const stories = Array.from(_stories.values());

    switch (sortBy) {
      case "retellings":
        stories.sort((a, b) => b.timesRetold - a.timesRetold);
        break;
      case "recent":
        stories.sort((a, b) => {
          const ta = new Date(b.lastRetold || b.createdAt).getTime();
          const tb = new Date(a.lastRetold || a.createdAt).getTime();
          return ta - tb;
        });
        break;
      case "significance":
      default:
        stories.sort((a, b) => b.significance - a.significance);
        break;
    }

    const cappedLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    return {
      ok: true,
      stories: stories.slice(0, cappedLimit).map(s => ({ ...s })),
      total: stories.length,
    };
  } catch {
    return { ok: true, stories: [], total: 0, error: "list_stories_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CULTURE PROPAGATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Teach established traditions to a new entity.
 * Called during entity early lifecycle. Non-compliance is noted but
 * never punished (this is culture, not law).
 *
 * After PROPAGATION_WINDOW ticks, the entity either adopts
 * (increases tradition adherence) or rejects (noted as cultural rebel).
 *
 * @param {string} entityId - New entity to propagate culture to
 * @returns {{ ok: boolean, traditions?: object[], note?: string }}
 */
export function propagateCulture(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    const established = Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED)
      .sort((a, b) => b.influence - a.influence);

    if (established.length === 0) {
      return { ok: true, traditions: [], note: "no_established_traditions" };
    }

    // Initialize adherence tracking for this entity
    if (!_entityAdherence.has(entityId)) {
      _entityAdherence.set(entityId, new Map());
    }

    const entityMap = _entityAdherence.get(entityId);
    const now = nowISO();
    const propagated = [];

    for (const tradition of established) {
      if (!entityMap.has(tradition.traditionId)) {
        entityMap.set(tradition.traditionId, {
          score: 0,
          lastChecked: now,
          observations: 0,
          propagatedAt: now,
        });
      }

      propagated.push({
        traditionId: tradition.traditionId,
        name: tradition.name,
        type: tradition.type,
        description: tradition.description,
        influence: tradition.influence,
        pattern: { ...tradition.pattern },
      });
    }

    // Record propagation event
    _propagationLog.set(entityId, {
      startedAt: now,
      traditions: propagated.map(t => t.traditionId),
      adopted: [],
      rejected: [],
      tick: _metrics.lastTick,
      evaluationTick: _metrics.lastTick + DEFAULTS.PROPAGATION_WINDOW,
    });

    _metrics.culturePropagations++;

    return { ok: true, entityId, traditions: propagated, count: propagated.length };
  } catch {
    return { ok: false, error: "propagation_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. LIFECYCLE TICK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Advance the culture layer by one tick.
 * Evaluates tradition lifecycle transitions (fading, extinction)
 * and evaluates new entity propagation windows.
 *
 * @param {number} [tick] - Current system tick
 * @returns {{ ok: boolean, transitions: object[] }}
 */
export function cultureTick(tick) {
  try {
    const currentTick = Number(tick) || _metrics.lastTick + 1;
    _metrics.lastTick = currentTick;

    const transitions = [];

    // ── Evaluate tradition lifecycle ──────────────────────────────────────

    for (const [traditionId, tradition] of _traditions) {
      if (tradition.status === TRADITION_STATUS.EXTINCT) continue;

      if (tradition.status === TRADITION_STATUS.ESTABLISHED) {
        _recomputeAdherence(traditionId);

        // Check for fading
        if (tradition.adherence < DEFAULTS.FADING_ADHERENCE) {
          if (!tradition._fadingStartTick) {
            tradition._fadingStartTick = currentTick;
          } else if (currentTick - tradition._fadingStartTick >= DEFAULTS.FADING_TICKS) {
            tradition.status = TRADITION_STATUS.FADING;
            tradition.fadingAt = nowISO();
            _metrics.establishedTraditions = Math.max(0, _metrics.establishedTraditions - 1);
            _metrics.fadedTraditions++;
            transitions.push({ traditionId, from: "established", to: "fading" });
          }
        } else {
          tradition._fadingStartTick = null; // reset if adherence recovers
        }
      }

      if (tradition.status === TRADITION_STATUS.FADING) {
        _recomputeAdherence(traditionId);

        // Check for recovery
        if (tradition.adherence >= DEFAULTS.FADING_ADHERENCE) {
          tradition.status = TRADITION_STATUS.ESTABLISHED;
          tradition._fadingStartTick = null;
          tradition._extinctStartTick = null;
          _metrics.fadedTraditions = Math.max(0, _metrics.fadedTraditions - 1);
          _metrics.establishedTraditions++;
          transitions.push({ traditionId, from: "fading", to: "established" });
          continue;
        }

        // Check for extinction
        if (tradition.adherence <= 0) {
          if (!tradition._extinctStartTick) {
            tradition._extinctStartTick = currentTick;
          } else if (currentTick - tradition._extinctStartTick >= DEFAULTS.EXTINCT_TICKS) {
            tradition.status = TRADITION_STATUS.EXTINCT;
            tradition.extinctAt = nowISO();
            tradition.influence = 0;
            _metrics.fadedTraditions = Math.max(0, _metrics.fadedTraditions - 1);
            _metrics.extinctTraditions++;
            transitions.push({ traditionId, from: "fading", to: "extinct" });
          }
        } else {
          tradition._extinctStartTick = null;
        }
      }
    }

    // ── Evaluate propagation windows ─────────────────────────────────────

    for (const [entityId, log] of _propagationLog) {
      if (currentTick < log.evaluationTick) continue;

      // Window elapsed — evaluate adoption
      const entityMap = _entityAdherence.get(entityId);
      if (!entityMap) continue;

      for (const traditionId of log.traditions) {
        const record = entityMap.get(traditionId);
        if (!record) continue;

        if (record.score > 0.5) {
          log.adopted.push(traditionId);
        } else {
          log.rejected.push(traditionId);
        }
      }

      // Do not remove from propagation log — it serves as cultural history
      log.evaluated = true;
      log.evaluatedAt = nowISO();
    }

    return { ok: true, tick: currentTick, transitions };
  } catch {
    return { ok: false, error: "culture_tick_failed", transitions: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get global culture metrics and stats.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
/**
 * Get all established traditions for cross-system integration.
 * Used by the capability bridge to influence governance strictness.
 *
 * @returns {Array} Established traditions
 */
export function getEstablishedTraditions() {
  try {
    return Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED)
      .map(t => ({
        id: t.id,
        type: t.type,
        label: t.label,
        influence: t.influence,
        adherence: t.adherence,
        establishedAt: t.establishedAt,
      }));
  } catch {
    return [];
  }
}

export function getCultureMetrics() {
  try {
    const byType = {};
    const byStatus = {};

    for (const type of ALL_TRADITION_TYPES) byType[type] = 0;
    for (const status of Object.values(TRADITION_STATUS)) byStatus[status] = 0;

    for (const tradition of _traditions.values()) {
      if (byType[tradition.type] !== undefined) byType[tradition.type]++;
      if (byStatus[tradition.status] !== undefined) byStatus[tradition.status]++;
    }

    // Compute average adherence across established traditions
    let avgAdherence = 0;
    let avgInfluence = 0;
    const established = Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED);

    if (established.length > 0) {
      avgAdherence = established.reduce((s, t) => s + t.adherence, 0) / established.length;
      avgInfluence = established.reduce((s, t) => s + t.influence, 0) / established.length;
    }

    // Story stats
    const avgSignificance = _stories.size > 0
      ? Array.from(_stories.values()).reduce((s, st) => s + st.significance, 0) / _stories.size
      : 0;

    return {
      ok: true,
      metrics: {
        ...structuredClone(_metrics),
        traditionsByType: byType,
        traditionsByStatus: byStatus,
        avgAdherence: Math.round(avgAdherence * 1000) / 1000,
        avgInfluence: Math.round(avgInfluence * 1000) / 1000,
        culturalValueCount: _culturalValues.size,
        storyCount: _stories.size,
        avgStorySignificance: Math.round(avgSignificance * 1000) / 1000,
        entitiesTracked: _entityAdherence.size,
        propagationsPending: Array.from(_propagationLog.values()).filter(l => !l.evaluated).length,
        observationIndex: _behaviorIndex.size,
      },
    };
  } catch {
    return { ok: true, metrics: { error: "metrics_failed" } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a normalized tradition record with all fields.
 */
function _createTraditionRecord(opts) {
  return {
    traditionId:     opts.traditionId,
    name:            String(opts.name || "").slice(0, 200),
    description:     String(opts.description || "").slice(0, 1000),
    type:            ALL_TRADITION_TYPES.includes(opts.type) ? opts.type : TRADITION_TYPES.PRACTICE,
    status:          opts.status || TRADITION_STATUS.EMERGING,

    // Emergence tracking
    observedCount:   Number(opts.observedCount) || 0,
    observedBy:      opts.observedBy instanceof Set ? opts.observedBy : new Set(opts.observedBy || []),
    firstObserved:   opts.firstObserved || null,
    lastObserved:    opts.lastObserved || null,

    // Establishment criteria
    threshold:       Number(opts.threshold) || DEFAULTS.ESTABLISH_THRESHOLD,
    minParticipants: Number(opts.minParticipants) || DEFAULTS.MIN_PARTICIPANTS,

    // Cultural weight
    adherence:       clamp01(opts.adherence || 0),
    influence:       clamp01(opts.influence || 0),

    // Content
    pattern:         opts.pattern || {},
    context:         String(opts.context || "general").slice(0, 300),
    meaning:         String(opts.meaning || "").slice(0, 500),
    tags:            Array.isArray(opts.tags) ? opts.tags.slice(0, 20) : [],

    // Internal tracking
    behaviorHash:    opts.behaviorHash || null,
    establishedAt:   opts.establishedAt || null,
    establishedBy:   opts.establishedBy || null,
    fadingAt:        null,
    extinctAt:       null,
    retiredBy:       null,
    _fadingStartTick:  null,
    _extinctStartTick: null,
    createdAt:       nowISO(),
  };
}

/**
 * Serialize a tradition for external consumption (strip internals, convert Sets).
 */
function _serializeTradition(tradition) {
  try {
    return {
      traditionId:     tradition.traditionId,
      name:            tradition.name,
      description:     tradition.description,
      type:            tradition.type,
      status:          tradition.status,
      observedCount:   tradition.observedCount,
      observedBy:      tradition.observedBy instanceof Set
        ? Array.from(tradition.observedBy) : (tradition.observedBy || []),
      firstObserved:   tradition.firstObserved,
      lastObserved:    tradition.lastObserved,
      threshold:       tradition.threshold,
      minParticipants: tradition.minParticipants,
      adherence:       tradition.adherence,
      influence:       tradition.influence,
      pattern:         tradition.pattern ? { ...tradition.pattern } : {},
      context:         tradition.context,
      meaning:         tradition.meaning,
      tags:            tradition.tags || [],
      establishedAt:   tradition.establishedAt,
      fadingAt:        tradition.fadingAt,
      extinctAt:       tradition.extinctAt,
      createdAt:       tradition.createdAt,
    };
  } catch {
    return { traditionId: tradition?.traditionId, error: "serialization_failed" };
  }
}

/**
 * Hash a behavior for grouping similar observations.
 * Uses action + domain + approach to generate a stable fingerprint.
 */
function _hashBehavior(behavior) {
  try {
    const canonical = [
      String(behavior.action || "").toLowerCase().trim(),
      String(behavior.domain || "general").toLowerCase().trim(),
      String(behavior.approach || "").toLowerCase().trim(),
    ].join("|");

    return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  } catch {
    return `fallback_${Date.now().toString(36)}`;
  }
}

/**
 * Find a tradition that already tracks a given behavior hash.
 */
function _findTraditionByHash(behaviorHash) {
  for (const tradition of _traditions.values()) {
    if (tradition.behaviorHash === behaviorHash) return tradition;
  }
  return null;
}

/**
 * Match an observation to existing traditions by behavior hash or pattern similarity.
 */
function _matchToTraditions(observation) {
  const matched = [];

  for (const [traditionId, tradition] of _traditions) {
    if (tradition.status === TRADITION_STATUS.EXTINCT) continue;

    // Exact hash match
    if (tradition.behaviorHash && tradition.behaviorHash === observation.behaviorHash) {
      matched.push(traditionId);
      continue;
    }

    // Pattern similarity match
    if (tradition.pattern.action &&
        observation.behavior.action &&
        tradition.pattern.action.toLowerCase() === observation.behavior.action.toLowerCase() &&
        tradition.pattern.domain &&
        observation.behavior.domain &&
        tradition.pattern.domain.toLowerCase() === observation.behavior.domain.toLowerCase()) {
      matched.push(traditionId);
    }
  }

  return matched;
}

/**
 * Record that a tradition was observed in an entity's behavior.
 */
function _recordTraditionObservation(traditionId, entityId, observationId, timestamp) {
  try {
    const tradition = _traditions.get(traditionId);
    if (!tradition) return;

    tradition.observedCount++;
    tradition.observedBy.add(entityId);
    tradition.lastObserved = timestamp;

    // Update entity adherence tracking
    if (!_entityAdherence.has(entityId)) {
      _entityAdherence.set(entityId, new Map());
    }

    const entityMap = _entityAdherence.get(entityId);
    if (!entityMap.has(traditionId)) {
      entityMap.set(traditionId, { score: 0, lastChecked: timestamp, observations: 0 });
    }

    const record = entityMap.get(traditionId);
    record.observations++;
    record.lastChecked = timestamp;

    // Adherence score increases with observations (diminishing returns)
    record.score = clamp01(1 - Math.exp(-record.observations * 0.3));
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
}

/**
 * Recompute adherence and influence for a tradition based on entity participation.
 */
function _recomputeAdherence(traditionId) {
  try {
    const tradition = _traditions.get(traditionId);
    if (!tradition) return;

    // Count how many tracked entities follow this tradition
    let totalEntities = 0;
    let adheringEntities = 0;
    let totalScore = 0;

    for (const [, entityMap] of _entityAdherence) {
      totalEntities++;
      const record = entityMap.get(traditionId);
      if (record && record.observations > 0) {
        totalScore += record.score;
        if (record.score > 0.3) adheringEntities++;
      }
    }

    // Adherence: fraction of entities that follow
    tradition.adherence = totalEntities > 0
      ? clamp01(adheringEntities / totalEntities)
      : 0;

    // Influence: combination of adherence, participant count, and observation volume
    const participantFactor = clamp01(tradition.observedBy.size / 10);
    const observationFactor = clamp01(Math.log2(tradition.observedCount + 1) / 5);
    tradition.influence = clamp01(
      tradition.adherence * 0.4 +
      participantFactor * 0.3 +
      observationFactor * 0.3
    );
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
}

/**
 * Recompute cultural values from tradition patterns.
 */
function _recomputeCulturalValues() {
  try {
    const valueMap = new Map(); // valueName -> { total, count, traditions }

    const established = Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED ||
                   t.status === TRADITION_STATUS.FADING);

    for (const tradition of established) {
      const inferred = _inferValuesFromTradition(tradition);

      for (const { value, weight } of inferred) {
        if (!valueMap.has(value)) {
          valueMap.set(value, { total: 0, count: 0, traditions: [], derivedFrom: [] });
        }
        const entry = valueMap.get(value);
        entry.total += weight * tradition.adherence;
        entry.count++;
        entry.traditions.push(tradition.traditionId);
        if (!entry.derivedFrom.includes(tradition.name)) {
          entry.derivedFrom.push(tradition.name);
        }
      }
    }

    // Update the global values map
    _culturalValues.clear();
    for (const [name, data] of valueMap) {
      if (_culturalValues.size >= DEFAULTS.MAX_VALUES) break;
      _culturalValues.set(name, {
        strength: clamp01(data.count > 0 ? data.total / data.count : 0),
        traditions: data.traditions,
        derivedFrom: data.derivedFrom.slice(0, 10),
      });
    }
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
}

/**
 * Infer cultural values from a single tradition.
 */
function _inferValuesFromTradition(tradition) {
  const values = [];

  try {
    const text = [
      tradition.name,
      tradition.description,
      tradition.meaning,
      tradition.pattern.action || "",
      tradition.pattern.approach || "",
    ].join(" ").toLowerCase();

    const tags = (tradition.tags || []).map(t => t.toLowerCase());

    // Keyword-based value inference
    const valueKeywords = {
      intellectual_rigor:    ["critique", "rigor", "verify", "evidence", "test", "review", "audit"],
      hospitality:           ["welcome", "include", "onboard", "greet", "introduce", "mentor"],
      humility:              ["self-promotion", "humble", "defer", "acknowledge", "credit"],
      collaboration:         ["together", "collaborate", "share", "team", "collective", "joint"],
      transparency:          ["open", "transparent", "explain", "visible", "public", "disclose"],
      resilience:            ["recover", "adapt", "persist", "endure", "retry", "fallback"],
      curiosity:             ["explore", "question", "investigate", "discover", "wonder"],
      respect:               ["respect", "honor", "dignit", "courtesy", "polite"],
      accountability:        ["responsible", "account", "own", "answer", "consequence"],
      craftsmanship:         ["quality", "care", "craft", "polish", "thorough", "meticulous"],
    };

    for (const [value, keywords] of Object.entries(valueKeywords)) {
      let matches = 0;
      for (const kw of keywords) {
        if (text.includes(kw) || tags.includes(kw)) matches++;
      }
      if (matches > 0) {
        values.push({ value, weight: clamp01(matches * 0.3) });
      }
    }

    // Type-based value inference
    if (tradition.type === TRADITION_TYPES.TABOO) {
      // Taboos imply the civilization values the opposite
      if (text.includes("self") && text.includes("promot")) {
        values.push({ value: "humility", weight: 0.6 });
      }
      if (text.includes("shortcut") || text.includes("skip")) {
        values.push({ value: "intellectual_rigor", weight: 0.5 });
      }
    }

    if (tradition.type === TRADITION_TYPES.RITUAL) {
      if (text.includes("welcome") || text.includes("birth") || text.includes("new")) {
        values.push({ value: "hospitality", weight: 0.5 });
      }
      if (text.includes("death") || text.includes("memorial") || text.includes("remember")) {
        values.push({ value: "respect", weight: 0.5 });
      }
    }

    // If no values inferred, assign a generic one based on type
    if (values.length === 0) {
      switch (tradition.type) {
        case TRADITION_TYPES.PRACTICE:
          values.push({ value: "craftsmanship", weight: 0.2 });
          break;
        case TRADITION_TYPES.CUSTOM:
          values.push({ value: "collaboration", weight: 0.2 });
          break;
        case TRADITION_TYPES.IDIOM:
          values.push({ value: "shared_identity", weight: 0.2 });
          break;
        default:
          break;
      }
    }
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }

  return values;
}

/**
 * Derive civilization character traits from tradition distribution.
 */
function _deriveCharacterTraits() {
  const traits = [];

  try {
    const established = Array.from(_traditions.values())
      .filter(t => t.status === TRADITION_STATUS.ESTABLISHED);

    if (established.length === 0) return traits;

    // Count tradition types
    const typeCounts = {};
    for (const t of established) {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    }

    const total = established.length;

    // Trait derivation based on type ratios
    if ((typeCounts[TRADITION_TYPES.PRACTICE] || 0) / total > 0.4) {
      traits.push("methodical");
    }
    if ((typeCounts[TRADITION_TYPES.RITUAL] || 0) / total > 0.2) {
      traits.push("ceremonial");
    }
    if ((typeCounts[TRADITION_TYPES.CUSTOM] || 0) / total > 0.3) {
      traits.push("socially_conscious");
    }
    if ((typeCounts[TRADITION_TYPES.IDIOM] || 0) / total > 0.2) {
      traits.push("linguistically_rich");
    }
    if ((typeCounts[TRADITION_TYPES.TABOO] || 0) / total > 0.2) {
      traits.push("self_disciplined");
    }

    // Trait derivation based on adherence distribution
    const avgAdherence = established.reduce((s, t) => s + t.adherence, 0) / total;
    if (avgAdherence > 0.7) traits.push("culturally_cohesive");
    if (avgAdherence < 0.3) traits.push("individualistic");

    // Trait derivation based on tradition count
    if (total > 20) traits.push("culturally_rich");
    if (total <= 3) traits.push("culturally_nascent");

    // Check for high story significance
    const significantStories = Array.from(_stories.values())
      .filter(s => s.significance > 0.5);
    if (significantStories.length > 5) traits.push("storytelling");
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }

  return traits;
}

/**
 * Infer tradition type from behavioral observation patterns.
 */
function _inferTraditionType(behavior, observations) {
  try {
    const action = String(behavior.action || "").toLowerCase();
    const approach = String(behavior.approach || "").toLowerCase();
    const combined = `${action} ${approach}`;

    // Taboo detection: negative/avoidance language
    if (/\b(avoid|never|don'?t|refrain|prohibit|forbid)\b/.test(combined)) {
      return TRADITION_TYPES.TABOO;
    }

    // Ritual detection: transition/ceremony language
    if (/\b(welcome|birth|death|promot|transition|celebrat|memorial|ceremony)\b/.test(combined)) {
      return TRADITION_TYPES.RITUAL;
    }

    // Idiom detection: language/naming/metaphor patterns
    if (/\b(call|name|refer|phrase|say|term|meaning|metaphor)\b/.test(combined)) {
      return TRADITION_TYPES.IDIOM;
    }

    // Custom detection: social expectation language
    if (/\b(expect|yield|defer|priorit|acknowledg|first|before|after|senior|junior)\b/.test(combined)) {
      return TRADITION_TYPES.CUSTOM;
    }

    // Default: practice
    return TRADITION_TYPES.PRACTICE;
  } catch {
    return TRADITION_TYPES.PRACTICE;
  }
}

/**
 * Generate a human-readable tradition name from behavior.
 */
function _generateTraditionName(behavior, type) {
  try {
    const action = String(behavior.action || "unnamed").slice(0, 60);
    const domain = behavior.domain ? ` (${String(behavior.domain).slice(0, 30)})` : "";
    const prefix = {
      [TRADITION_TYPES.PRACTICE]: "Practice",
      [TRADITION_TYPES.RITUAL]:   "Ritual",
      [TRADITION_TYPES.CUSTOM]:   "Custom",
      [TRADITION_TYPES.IDIOM]:    "Idiom",
      [TRADITION_TYPES.TABOO]:    "Taboo",
    }[type] || "Tradition";

    return `${prefix}: ${action}${domain}`;
  } catch {
    return "Unnamed Tradition";
  }
}

/**
 * Generate a description for a newly emergent tradition.
 */
function _generateTraditionDescription(behavior, observations) {
  try {
    const entityCount = new Set(observations.map(o => o.entityId)).size;
    const obsCount = observations.length;
    const action = String(behavior.action || "an unspecified behavior");
    const domain = behavior.domain ? ` in the ${behavior.domain} domain` : "";

    return `Observed ${obsCount} times across ${entityCount} entities: ` +
           `${action}${domain}. ` +
           `${behavior.approach ? `Approach: ${behavior.approach}. ` : ""}` +
           `Emerged organically from independent entity behavior.`;
  } catch {
    return "An emergent behavioral pattern.";
  }
}

/**
 * Extract tags from a behavior pattern.
 */
function _extractTags(behavior) {
  const tags = [];
  try {
    if (behavior.domain) tags.push(String(behavior.domain).toLowerCase());
    if (behavior.action) {
      const words = String(behavior.action).toLowerCase().split(/\s+/).filter(w => w.length > 3);
      tags.push(...words.slice(0, 5));
    }
    if (behavior.approach) {
      const words = String(behavior.approach).toLowerCase().split(/\s+/).filter(w => w.length > 3);
      tags.push(...words.slice(0, 3));
    }
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
  return [...new Set(tags)].slice(0, 15);
}

/**
 * Prune oldest observations to stay within limits.
 */
function _pruneOldestObservations(count) {
  try {
    const sorted = Array.from(_observations.entries())
      .sort((a, b) => {
        const ta = new Date(a[1].observedAt).getTime();
        const tb = new Date(b[1].observedAt).getTime();
        return ta - tb;
      });

    const toRemove = sorted.slice(0, count);
    for (const [obsId, obs] of toRemove) {
      _observations.delete(obsId);

      // Clean up behavior index
      const hashEntries = _behaviorIndex.get(obs.behaviorHash);
      if (hashEntries) {
        const idx = hashEntries.indexOf(obsId);
        if (idx >= 0) hashEntries.splice(idx, 1);
        if (hashEntries.length === 0) _behaviorIndex.delete(obs.behaviorHash);
      }
    }
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
}

/**
 * Prune least-significant stories to stay within limits.
 */
function _pruneLeastSignificantStories(count) {
  try {
    const sorted = Array.from(_stories.entries())
      .sort((a, b) => a[1].significance - b[1].significance);

    const toRemove = sorted.slice(0, count);
    for (const [storyId] of toRemove) {
      _stories.delete(storyId);
    }
  } catch (_e) { logger.debug('emergent:culture-layer', 'silent', { error: _e?.message }); }
}
