/**
 * Pain & Avoidance Learning System
 *
 * Negative reinforcement for emergent entities. When something harms
 * an entity it FEELS the pain and LEARNS to avoid the source.
 *
 * Pain types: organ damage, trust betrayal, hypothesis failure,
 * session conflict, reputation loss, overwork, isolation, knowledge loss.
 *
 * Three subsystems:
 *   1. Pain Events   — record, severity calculation, processing
 *   2. Wound System  — temporary debuffs that heal over time
 *   3. Avoidance Memory — permanent-ish behavioural modifiers with decay
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 * Additive only. No existing logic changes.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "pain") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function _getSTATE() {
  return globalThis._concordSTATE || globalThis.STATE || null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const PAIN_TYPES = Object.freeze({
  ORGAN_DAMAGE: "organ_damage",
  TRUST_BETRAYAL: "trust_betrayal",
  HYPOTHESIS_FAILURE: "hypothesis_failure",
  SESSION_CONFLICT: "session_conflict",
  REPUTATION_LOSS: "reputation_loss",
  OVERWORK: "overwork",
  ISOLATION: "isolation",
  KNOWLEDGE_LOSS: "knowledge_loss",
});

const VALID_PAIN_SET = new Set(Object.values(PAIN_TYPES));

/**
 * Wound effect descriptors.
 * Each wound type maps to a set of debuffs that are active while
 * the wound's currentIntensity > 0.
 */
const WOUND_EFFECT_MAP = Object.freeze({
  [PAIN_TYPES.ORGAN_DAMAGE]: ["reduced_confidence", "fatigue_sensitivity"],
  [PAIN_TYPES.TRUST_BETRAYAL]: ["trust_wariness", "defensive_posture"],
  [PAIN_TYPES.HYPOTHESIS_FAILURE]: ["reduced_confidence", "creative_block"],
  [PAIN_TYPES.SESSION_CONFLICT]: ["defensive_posture", "trust_wariness"],
  [PAIN_TYPES.REPUTATION_LOSS]: ["reduced_confidence", "defensive_posture"],
  [PAIN_TYPES.OVERWORK]: ["fatigue_sensitivity", "creative_block"],
  [PAIN_TYPES.ISOLATION]: ["creative_block", "trust_wariness"],
  [PAIN_TYPES.KNOWLEDGE_LOSS]: ["reduced_confidence"],
});

/**
 * How avoidance trigger types map to behavioural checks.
 */
const TRIGGER_CATEGORIES = Object.freeze({
  entity: "entity",       // avoid interactions with a specific entity
  domain: "domain",       // avoid a knowledge domain
  action: "action",       // avoid a specific action type
  session: "session",     // avoid sessions matching a pattern
  trade: "trade",         // avoid trade with a counterparty
  general: "general",     // generic avoidance
});

// Pain history cap per entity
const PAIN_HISTORY_MAX = 100;

// ── Stores ──────────────────────────────────────────────────────────────────

/** painId -> pain record */
const _pains = new LruMap();

/** woundId -> wound record */
const _wounds = new LruMap();

/** avoidanceId -> avoidance memory record */
const _avoidances = new LruMap();

/** entityId -> pain tolerance / meta state */
const _painStates = new LruMap();

// ── Internal: Ensure Pain State ─────────────────────────────────────────────

function _ensurePainState(entityId) {
  if (!entityId) return null;
  if (_painStates.has(entityId)) return _painStates.get(entityId);

  const state = {
    entityId,
    tolerance: 0.0,
    totalPainExperienced: 0.0,
    totalAvoidances: 0,
    activeWounds: [],
    avoidanceMemories: [],
    painHistory: [],
    resilience: 0.5,
  };

  _painStates.set(entityId, state);
  return state;
}

// ── Internal: Severity Calculation ──────────────────────────────────────────

/**
 * Calculate raw severity for a given pain type using the context object.
 *
 * Each pain type follows its own severity model. The context object carries
 * the domain-specific data (e.g. damage_delta, trust_score_before, etc.).
 *
 * @param {string} type - One of PAIN_TYPES values
 * @param {object} context - Situational details
 * @returns {number} Severity in [0, 1]
 */
function _calculateRawSeverity(type, context = {}) {
  try {
    switch (type) {
      case PAIN_TYPES.ORGAN_DAMAGE: {
        // Sudden spike matters more than gradual
        const delta = Number(context.damage_delta) || 0;
        return clamp01(delta);
      }
      case PAIN_TYPES.TRUST_BETRAYAL: {
        // Higher prior trust = more pain
        const trustBefore = Number(context.trust_score_before) || 0;
        return clamp01(trustBefore * 0.8);
      }
      case PAIN_TYPES.HYPOTHESIS_FAILURE: {
        // Confidence at the moment of rejection
        const confidence = Number(context.confidence_at_rejection) || 0;
        return clamp01(confidence * 0.6);
      }
      case PAIN_TYPES.SESSION_CONFLICT: {
        // Ratio of contradictions to total turns
        const contradictions = Number(context.number_of_contradictions) || 0;
        const totalTurns = Number(context.total_turns) || 1;
        return clamp01((contradictions / Math.max(1, totalTurns)) * 0.7);
      }
      case PAIN_TYPES.REPUTATION_LOSS: {
        // Reputation is precious — doubled delta
        const credDelta = Number(context.credibility_delta) || 0;
        return clamp01(credDelta * 2);
      }
      case PAIN_TYPES.OVERWORK: {
        const fatigue = Number(context.fatigue_level) || 0;
        return clamp01(fatigue * 0.5);
      }
      case PAIN_TYPES.ISOLATION: {
        const ticksAlone = Number(context.ticks_alone) || 0;
        return clamp01(ticksAlone / 200);
      }
      case PAIN_TYPES.KNOWLEDGE_LOSS: {
        const authority = Number(context.dtu_authority) || 0;
        return clamp01(authority * 0.4);
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Apply pain tolerance to raw severity.
 * High tolerance entities feel less pain from the same stimulus.
 *
 * effective_severity = severity * (1 - tolerance * 0.5)
 */
function _applyTolerance(rawSeverity, tolerance) {
  const tol = clamp01(tolerance);
  return clamp01(rawSeverity * (1 - tol * 0.5));
}

// ── Internal: Wound Creation ────────────────────────────────────────────────

/**
 * Create a wound from a pain event.
 * Wounds are temporary pain effects that heal over time.
 */
function _createWound(entityId, type, severity) {
  try {
    const woundId = uid("wound");
    const effects = WOUND_EFFECT_MAP[type] || ["reduced_confidence"];
    const now = nowISO();

    const wound = {
      woundId,
      entityId,
      type,
      severity,
      healingRate: 0.01,
      currentIntensity: severity,
      effects: [...effects],
      inflictedAt: now,
      healedAt: null,
    };

    _wounds.set(woundId, wound);

    // Register in entity pain state
    const ps = _ensurePainState(entityId);
    if (ps) {
      ps.activeWounds.push(woundId);
    }

    // Emit event
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("pain:wound_created", {
          woundId,
          entityId,
          type,
          severity,
          effects,
          timestamp: now,
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

    return wound;
  } catch {
    return null;
  }
}

// ── Internal: Avoidance Memory Creation ─────────────────────────────────────

/**
 * Create an avoidance memory from a pain event.
 * Avoidance memories are long-lasting behavioural modifiers that slowly decay.
 */
function _createAvoidanceMemory(entityId, painRecord) {
  try {
    const avoidanceId = uid("avoid");
    const now = nowISO();

    // Determine trigger description and category based on pain type
    let trigger = "";
    let triggerType = TRIGGER_CATEGORIES.general;

    switch (painRecord.type) {
      case PAIN_TYPES.TRUST_BETRAYAL:
        trigger = painRecord.source
          ? `entity:${painRecord.source}`
          : "unknown_entity_betrayal";
        triggerType = TRIGGER_CATEGORIES.entity;
        break;
      case PAIN_TYPES.HYPOTHESIS_FAILURE:
        trigger = painRecord.context?.domain
          ? `domain:${painRecord.context.domain}`
          : "hypothesis_domain_unknown";
        triggerType = TRIGGER_CATEGORIES.domain;
        break;
      case PAIN_TYPES.SESSION_CONFLICT:
        trigger = painRecord.source
          ? `session_with:${painRecord.source}`
          : "hostile_session_pattern";
        triggerType = TRIGGER_CATEGORIES.session;
        break;
      case PAIN_TYPES.REPUTATION_LOSS:
        trigger = painRecord.context?.action
          ? `action:${painRecord.context.action}`
          : "reputation_damaging_behaviour";
        triggerType = TRIGGER_CATEGORIES.action;
        break;
      case PAIN_TYPES.ORGAN_DAMAGE:
        trigger = painRecord.source
          ? `source:${painRecord.source}`
          : "organ_damage_source";
        triggerType = TRIGGER_CATEGORIES.general;
        break;
      case PAIN_TYPES.OVERWORK:
        trigger = "excessive_workload";
        triggerType = TRIGGER_CATEGORIES.action;
        break;
      case PAIN_TYPES.ISOLATION:
        trigger = "prolonged_isolation";
        triggerType = TRIGGER_CATEGORIES.general;
        break;
      case PAIN_TYPES.KNOWLEDGE_LOSS:
        trigger = painRecord.context?.dtuId
          ? `dtu:${painRecord.context.dtuId}`
          : "knowledge_deprecation";
        triggerType = TRIGGER_CATEGORIES.domain;
        break;
      default:
        trigger = `unknown:${painRecord.source || "unspecified"}`;
        triggerType = TRIGGER_CATEGORIES.general;
    }

    const avoidance = {
      avoidanceId,
      entityId,
      trigger,
      triggerType,
      source_pain: painRecord.painId,
      strength: clamp01(painRecord.severity),
      activations: 0,
      lastActivated: null,
      created: now,
      decayRate: 0.001,
    };

    _avoidances.set(avoidanceId, avoidance);

    // Register in entity pain state
    const ps = _ensurePainState(entityId);
    if (ps) {
      ps.avoidanceMemories.push(avoidanceId);
      ps.totalAvoidances++;
    }

    // Emit event
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("pain:avoidance_created", {
          avoidanceId,
          entityId,
          trigger,
          triggerType,
          strength: avoidance.strength,
          timestamp: now,
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

    return avoidance;
  } catch {
    return null;
  }
}

// ── Internal: Affect Integration ────────────────────────────────────────────

/**
 * Emit pain signal to the affect system.
 * Lowers valence by severity * 0.5, raises arousal, lowers stability.
 */
function _emitPainToAffect(entityId, severity) {
  try {
    const STATE = _getSTATE();
    if (!STATE) return;

    // Try ATS store (session-level affect)
    // Pain events modify valence downward, arousal upward
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("affect:pain_signal", {
          entityId,
          valence_delta: -(severity * 0.5),
          arousal_delta: severity * 0.3,
          stability_delta: -(severity * 0.2),
          timestamp: nowISO(),
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

    // Try qualia engine if available
    try {
      const engine = globalThis.qualiaEngine;
      if (engine && typeof engine.batchUpdate === "function") {
        engine.batchUpdate(entityId, {
          "emotional_resonance_os.distress_level": severity,
          "trauma_aware_os.sensitivity_level": clamp01(severity * 0.8),
          "trauma_aware_os.overwhelm_risk": clamp01(severity * 0.6),
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
  } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

// ── recordPain ──────────────────────────────────────────────────────────────

/**
 * Record a pain event for an entity.
 *
 * If severity is not provided or is 0, it will be calculated from the
 * pain type and context using the severity model.
 *
 * @param {string} entityId - Entity experiencing pain
 * @param {string} type - One of PAIN_TYPES values
 * @param {number} [severity=0] - Override severity (0 = auto-calculate)
 * @param {string} [source=""] - What caused the pain (entityId, dtuId, etc.)
 * @param {object} [context={}] - Situational details for severity calculation
 * @returns {{ ok: boolean, painId?: string, severity?: number, error?: string }}
 */
export function recordPain(entityId, type, severity = 0, source = "", context = {}) {
  try {
    if (!entityId) return { ok: false, error: "missing_entity_id" };
    if (!VALID_PAIN_SET.has(type)) return { ok: false, error: "invalid_pain_type" };

    const ps = _ensurePainState(entityId);
    const painId = uid("pain");
    const now = nowISO();

    // Calculate severity: use provided value or auto-calculate
    let rawSeverity = Number(severity) || 0;
    if (rawSeverity <= 0) {
      rawSeverity = _calculateRawSeverity(type, context);
    }
    rawSeverity = clamp01(rawSeverity);

    // Apply tolerance
    const effectiveSeverity = _applyTolerance(rawSeverity, ps.tolerance);

    const painRecord = {
      painId,
      entityId,
      type,
      severity: effectiveSeverity,
      source: String(source || ""),
      context: context && typeof context === "object" ? { ...context } : {},
      timestamp: now,
      processed: false,
      avoidanceCreated: false,
      recoveredAt: null,
    };

    _pains.set(painId, painRecord);

    // Update pain state tracking
    ps.totalPainExperienced += effectiveSeverity;
    ps.painHistory.push(painId);
    if (ps.painHistory.length > PAIN_HISTORY_MAX) {
      ps.painHistory.splice(0, ps.painHistory.length - PAIN_HISTORY_MAX);
    }

    // Tolerance increases by 0.005 per pain event
    ps.tolerance = clamp01(ps.tolerance + 0.005);

    // Emit pain to affect system
    _emitPainToAffect(entityId, effectiveSeverity);

    // Emit event
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("pain:recorded", {
          painId,
          entityId,
          type,
          severity: effectiveSeverity,
          rawSeverity,
          source,
          timestamp: now,
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

    return { ok: true, painId, severity: effectiveSeverity };
  } catch {
    return { ok: false, error: "record_pain_failed" };
  }
}

// ── getPainState ────────────────────────────────────────────────────────────

/**
 * Get an entity's pain state (tolerance, wounds, avoidances, history).
 *
 * @param {string} entityId
 * @returns {object|null} Pain state or null if entity unknown
 */
export function getPainState(entityId) {
  try {
    if (!entityId) return null;
    const ps = _painStates.get(entityId);
    if (!ps) return null;

    // Return a snapshot with resolved wound/avoidance counts
    const activeWoundCount = ps.activeWounds.filter(wId => {
      const w = _wounds.get(wId);
      return w && w.healedAt === null;
    }).length;

    const activeAvoidanceCount = ps.avoidanceMemories.filter(aId => {
      const a = _avoidances.get(aId);
      return a && a.strength > 0;
    }).length;

    return {
      entityId: ps.entityId,
      tolerance: ps.tolerance,
      totalPainExperienced: ps.totalPainExperienced,
      totalAvoidances: ps.totalAvoidances,
      activeWoundCount,
      activeAvoidanceCount,
      resilience: ps.resilience,
      painHistoryLength: ps.painHistory.length,
    };
  } catch {
    return null;
  }
}

// ── processPain ─────────────────────────────────────────────────────────────

/**
 * Process a recorded pain event into wounds and/or avoidance memories.
 *
 * Rules:
 *   - severity > 0.3 => create a wound (temporary debuff)
 *   - severity > 0.7 => also create an avoidance memory (persistent modifier)
 *
 * @param {string} painId
 * @returns {{ ok: boolean, wound?: object, avoidance?: object, error?: string }}
 */
export function processPain(painId) {
  try {
    const pain = _pains.get(painId);
    if (!pain) return { ok: false, error: "pain_not_found" };
    if (pain.processed) return { ok: true, already_processed: true };

    const result = { ok: true };

    // Severity > 0.3 => create wound
    if (pain.severity > 0.3) {
      const wound = _createWound(pain.entityId, pain.type, pain.severity);
      if (wound) {
        result.wound = {
          woundId: wound.woundId,
          type: wound.type,
          severity: wound.severity,
          effects: wound.effects,
        };
      }
    }

    // Severity > 0.7 => create avoidance memory
    if (pain.severity > 0.7) {
      const avoidance = _createAvoidanceMemory(pain.entityId, pain);
      if (avoidance) {
        pain.avoidanceCreated = true;
        result.avoidance = {
          avoidanceId: avoidance.avoidanceId,
          trigger: avoidance.trigger,
          triggerType: avoidance.triggerType,
          strength: avoidance.strength,
        };
      }
    }

    pain.processed = true;

    // Emit processing event
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("pain:processed", {
          painId,
          entityId: pain.entityId,
          severity: pain.severity,
          woundCreated: !!result.wound,
          avoidanceCreated: !!result.avoidance,
          timestamp: nowISO(),
        });
      }
    } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

    return result;
  } catch {
    return { ok: false, error: "process_pain_failed" };
  }
}

// ── checkAvoidance ──────────────────────────────────────────────────────────

/**
 * Check if any of an entity's avoidance triggers match a given context.
 *
 * Context fields checked:
 *   - entityId / counterparty  (matches trigger type "entity")
 *   - domain                    (matches trigger type "domain")
 *   - action                    (matches trigger type "action")
 *   - sessionWith               (matches trigger type "session")
 *   - tradeWith                 (matches trigger type "trade")
 *
 * @param {string} entityId - The entity whose avoidances to check
 * @param {object} context - The proposed interaction context
 * @returns {{ shouldAvoid: boolean, matches: object[], totalStrength: number }}
 */
export function checkAvoidance(entityId, context = {}) {
  try {
    if (!entityId) return { shouldAvoid: false, matches: [], totalStrength: 0 };

    const ps = _painStates.get(entityId);
    if (!ps) return { shouldAvoid: false, matches: [], totalStrength: 0 };

    const matches = [];
    let totalStrength = 0;

    for (const avoidanceId of ps.avoidanceMemories) {
      try {
        const av = _avoidances.get(avoidanceId);
        if (!av || av.strength <= 0) continue;

        let matched = false;

        // Check entity triggers
        if (av.triggerType === TRIGGER_CATEGORIES.entity) {
          const counterparty = context.entityId || context.counterparty || "";
          if (counterparty && av.trigger.includes(counterparty)) {
            matched = true;
          }
        }

        // Check domain triggers
        if (av.triggerType === TRIGGER_CATEGORIES.domain) {
          const domain = context.domain || "";
          if (domain && av.trigger.includes(domain)) {
            matched = true;
          }
        }

        // Check action triggers
        if (av.triggerType === TRIGGER_CATEGORIES.action) {
          const action = context.action || "";
          if (action && av.trigger.includes(action)) {
            matched = true;
          }
        }

        // Check session triggers
        if (av.triggerType === TRIGGER_CATEGORIES.session) {
          const sessionWith = context.sessionWith || context.entityId || "";
          if (sessionWith && av.trigger.includes(sessionWith)) {
            matched = true;
          }
        }

        // Check trade triggers
        if (av.triggerType === TRIGGER_CATEGORIES.trade) {
          const tradeWith = context.tradeWith || context.counterparty || "";
          if (tradeWith && av.trigger.includes(tradeWith)) {
            matched = true;
          }
        }

        if (matched) {
          // Activate the avoidance
          av.activations++;
          av.lastActivated = nowISO();
          totalStrength += av.strength;

          matches.push({
            avoidanceId: av.avoidanceId,
            trigger: av.trigger,
            triggerType: av.triggerType,
            strength: av.strength,
            activations: av.activations,
          });
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent per-avoidance', { error: _e?.message }); }
    }

    return {
      shouldAvoid: totalStrength > 0.3,
      matches,
      totalStrength: clamp01(totalStrength),
    };
  } catch {
    return { shouldAvoid: false, matches: [], totalStrength: 0 };
  }
}

// ── getActiveWounds ─────────────────────────────────────────────────────────

/**
 * Get all active (unhealed) wounds for an entity.
 *
 * @param {string} entityId
 * @returns {object[]} Array of active wound records
 */
export function getActiveWounds(entityId) {
  try {
    if (!entityId) return [];
    const ps = _painStates.get(entityId);
    if (!ps) return [];

    const active = [];
    for (const woundId of ps.activeWounds) {
      try {
        const w = _wounds.get(woundId);
        if (w && w.healedAt === null && w.currentIntensity > 0) {
          active.push({
            woundId: w.woundId,
            type: w.type,
            severity: w.severity,
            currentIntensity: w.currentIntensity,
            effects: [...w.effects],
            healingRate: w.healingRate,
            inflictedAt: w.inflictedAt,
          });
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    return active;
  } catch {
    return [];
  }
}

// ── getWoundEffects ─────────────────────────────────────────────────────────

/**
 * Get the aggregate wound effects for an entity.
 * Combines all active wound effects into a single debuff summary.
 *
 * Effect types and their meanings:
 *   - reduced_confidence:   All claims get confidence modifier
 *   - trust_wariness:       Trust gains halved
 *   - creative_block:       Creative generation disabled
 *   - fatigue_sensitivity:  Fatigue accumulates 1.5x faster
 *   - defensive_posture:    More likely to be assigned critic/adversary roles
 *
 * @param {string} entityId
 * @returns {{ effects: object, totalIntensity: number, woundCount: number }}
 */
export function getWoundEffects(entityId) {
  try {
    if (!entityId) return { effects: {}, totalIntensity: 0, woundCount: 0 };

    const wounds = getActiveWounds(entityId);
    if (wounds.length === 0) return { effects: {}, totalIntensity: 0, woundCount: 0 };

    const effects = {
      reduced_confidence: 0,
      trust_wariness: 0,
      creative_block: 0,
      fatigue_sensitivity: 0,
      defensive_posture: 0,
    };

    let totalIntensity = 0;

    for (const w of wounds) {
      totalIntensity += w.currentIntensity;
      for (const effect of w.effects) {
        if (effects[effect] !== undefined) {
          // Accumulate intensity; effects from multiple wounds stack
          // but are capped at 1.0
          effects[effect] = clamp01(effects[effect] + w.currentIntensity * 0.5);
        }
      }
    }

    // Build active-effects-only object (strip zero-effect entries)
    const activeEffects = {};
    for (const [key, val] of Object.entries(effects)) {
      if (val > 0) activeEffects[key] = Math.round(val * 1000) / 1000;
    }

    return {
      effects: activeEffects,
      totalIntensity: Math.round(totalIntensity * 1000) / 1000,
      woundCount: wounds.length,
    };
  } catch {
    return { effects: {}, totalIntensity: 0, woundCount: 0 };
  }
}

// ── healWound ───────────────────────────────────────────────────────────────

/**
 * Manually heal a wound by a given amount.
 *
 * @param {string} woundId
 * @param {number} amount - Healing amount (0-1)
 * @returns {{ ok: boolean, healed?: boolean, remaining?: number, error?: string }}
 */
export function healWound(woundId, amount = 0.1) {
  try {
    const wound = _wounds.get(woundId);
    if (!wound) return { ok: false, error: "wound_not_found" };
    if (wound.healedAt !== null) return { ok: true, healed: true, remaining: 0 };

    const healAmount = Math.max(0, Number(amount) || 0.1);
    wound.currentIntensity = Math.max(0, wound.currentIntensity - healAmount);

    if (wound.currentIntensity <= 0) {
      wound.currentIntensity = 0;
      wound.healedAt = nowISO();

      // Update entity resilience (+0.002 per wound healed)
      try {
        const ps = _painStates.get(wound.entityId);
        if (ps) {
          ps.resilience = clamp01(ps.resilience + 0.002);

          // Clean up healed wound from active list
          const idx = ps.activeWounds.indexOf(woundId);
          if (idx !== -1) ps.activeWounds.splice(idx, 1);
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

      // Emit healed event
      try {
        if (typeof globalThis.realtimeEmit === "function") {
          globalThis.realtimeEmit("pain:wound_healed", {
            woundId,
            entityId: wound.entityId,
            type: wound.type,
            timestamp: wound.healedAt,
          });
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }

      return { ok: true, healed: true, remaining: 0 };
    }

    return {
      ok: true,
      healed: false,
      remaining: Math.round(wound.currentIntensity * 1000) / 1000,
    };
  } catch {
    return { ok: false, error: "heal_wound_failed" };
  }
}

// ── tickWounds ──────────────────────────────────────────────────────────────

/**
 * Natural healing tick for all of an entity's wounds.
 *
 * Healing formula:
 *   effective_healing = base_healing * (1 + resilience)
 *
 * Contextual modifiers:
 *   - sleeping:   3x healing
 *   - positive trust interaction: 2x for trust_betrayal wounds
 *   - creative expression: 2x for isolation wounds
 *
 * @param {string} entityId
 * @param {object} [modifiers={}] - { sleeping, positiveTrust, creativeExpression }
 * @returns {{ ok: boolean, healed: string[], remaining: number, error?: string }}
 */
export function tickWounds(entityId, modifiers = {}) {
  try {
    if (!entityId) return { ok: false, error: "missing_entity_id" };

    const ps = _painStates.get(entityId);
    if (!ps) return { ok: true, healed: [], remaining: 0 };

    const healed = [];
    const toRemove = [];

    for (const woundId of ps.activeWounds) {
      try {
        const wound = _wounds.get(woundId);
        if (!wound || wound.healedAt !== null) {
          toRemove.push(woundId);
          continue;
        }

        // Base healing rate modified by entity resilience
        let effectiveHealing = wound.healingRate * (1 + ps.resilience);

        // Sleep accelerates healing 3x
        if (modifiers.sleeping) {
          effectiveHealing *= 3;
        }

        // Positive trust heals trust wounds faster
        if (modifiers.positiveTrust && wound.type === PAIN_TYPES.TRUST_BETRAYAL) {
          effectiveHealing *= 2;
        }

        // Creative expression heals isolation wounds faster
        if (modifiers.creativeExpression && wound.type === PAIN_TYPES.ISOLATION) {
          effectiveHealing *= 2;
        }

        wound.currentIntensity = Math.max(0, wound.currentIntensity - effectiveHealing);

        if (wound.currentIntensity <= 0) {
          wound.currentIntensity = 0;
          wound.healedAt = nowISO();
          healed.push(woundId);
          toRemove.push(woundId);

          // Resilience bonus
          ps.resilience = clamp01(ps.resilience + 0.002);

          // Emit healed event
          try {
            if (typeof globalThis.realtimeEmit === "function") {
              globalThis.realtimeEmit("pain:wound_healed", {
                woundId,
                entityId: wound.entityId,
                type: wound.type,
                timestamp: wound.healedAt,
              });
            }
          } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent per-wound', { error: _e?.message }); }
    }

    // Clean up healed/invalid wounds from active list
    for (const wId of toRemove) {
      const idx = ps.activeWounds.indexOf(wId);
      if (idx !== -1) ps.activeWounds.splice(idx, 1);
    }

    const remaining = ps.activeWounds.length;

    return { ok: true, healed, remaining };
  } catch {
    return { ok: false, error: "tick_wounds_failed" };
  }
}

// ── getAvoidanceMemories ────────────────────────────────────────────────────

/**
 * List all avoidance patterns for an entity.
 *
 * @param {string} entityId
 * @returns {object[]} Array of avoidance memory records
 */
export function getAvoidanceMemories(entityId) {
  try {
    if (!entityId) return [];
    const ps = _painStates.get(entityId);
    if (!ps) return [];

    const memories = [];
    for (const avoidanceId of ps.avoidanceMemories) {
      try {
        const av = _avoidances.get(avoidanceId);
        if (av && av.strength > 0) {
          memories.push({
            avoidanceId: av.avoidanceId,
            trigger: av.trigger,
            triggerType: av.triggerType,
            strength: av.strength,
            activations: av.activations,
            lastActivated: av.lastActivated,
            created: av.created,
            decayRate: av.decayRate,
            source_pain: av.source_pain,
          });
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    return memories;
  } catch {
    return [];
  }
}

// ── decayAvoidances ─────────────────────────────────────────────────────────

/**
 * Tick-based decay of avoidance strengths for an entity.
 * Avoidances slowly fade (forgiveness / moving on).
 *
 * Recently activated avoidances decay slower (reinforcement).
 *
 * @param {string} entityId
 * @returns {{ ok: boolean, decayed: number, removed: number, error?: string }}
 */
export function decayAvoidances(entityId) {
  try {
    if (!entityId) return { ok: false, error: "missing_entity_id" };

    const ps = _painStates.get(entityId);
    if (!ps) return { ok: true, decayed: 0, removed: 0 };

    let decayed = 0;
    let removed = 0;
    const toRemove = [];

    for (const avoidanceId of ps.avoidanceMemories) {
      try {
        const av = _avoidances.get(avoidanceId);
        if (!av) {
          toRemove.push(avoidanceId);
          continue;
        }

        if (av.strength <= 0) {
          toRemove.push(avoidanceId);
          removed++;
          continue;
        }

        // Recently activated avoidances decay slower
        let effectiveDecay = av.decayRate;
        if (av.lastActivated) {
          try {
            const msSinceActivation = Date.now() - new Date(av.lastActivated).getTime();
            const hoursSinceActivation = msSinceActivation / (1000 * 60 * 60);
            // If activated within last 24 hours, decay at 25% rate
            if (hoursSinceActivation < 24) {
              effectiveDecay *= 0.25;
            }
          } catch (_e) { logger.debug('emergent:avoidance-learning', 'use default decay', { error: _e?.message }); }
        }

        // High-activation avoidances also decay slower (reinforced patterns)
        if (av.activations > 5) {
          effectiveDecay *= 0.5;
        }

        av.strength = Math.max(0, av.strength - effectiveDecay);
        decayed++;

        if (av.strength <= 0) {
          toRemove.push(avoidanceId);
          removed++;
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent per-avoidance', { error: _e?.message }); }
    }

    // Clean up dead avoidances
    for (const aId of toRemove) {
      const idx = ps.avoidanceMemories.indexOf(aId);
      if (idx !== -1) ps.avoidanceMemories.splice(idx, 1);
    }

    return { ok: true, decayed, removed };
  } catch {
    return { ok: false, error: "decay_avoidances_failed" };
  }
}

// ── getPainHistory ──────────────────────────────────────────────────────────

/**
 * Get recent pain events for an entity.
 *
 * @param {string} entityId
 * @param {number} [limit=20] - Max events to return (most recent first)
 * @returns {object[]} Array of pain records, newest first
 */
export function getPainHistory(entityId, limit = 20) {
  try {
    if (!entityId) return [];
    const ps = _painStates.get(entityId);
    if (!ps) return [];

    const cap = Math.max(1, Math.min(PAIN_HISTORY_MAX, Number(limit) || 20));
    const painIds = ps.painHistory.slice(-cap).reverse();

    const history = [];
    for (const painId of painIds) {
      try {
        const p = _pains.get(painId);
        if (p) {
          history.push({
            painId: p.painId,
            type: p.type,
            severity: p.severity,
            source: p.source,
            timestamp: p.timestamp,
            processed: p.processed,
            avoidanceCreated: p.avoidanceCreated,
            recoveredAt: p.recoveredAt,
          });
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    return history;
  } catch {
    return [];
  }
}

// ── getPainMetrics ──────────────────────────────────────────────────────────

/**
 * Global pain statistics across all entities.
 *
 * @returns {object} Aggregate metrics for the pain system
 */
export function getPainMetrics() {
  try {
    const totalEntities = _painStates.size;
    const totalPainEvents = _pains.size;
    const totalWounds = _wounds.size;
    const totalAvoidances = _avoidances.size;

    let activeWounds = 0;
    let healedWounds = 0;
    let totalSeverity = 0;
    let maxSeverity = 0;
    let avgTolerance = 0;
    let avgResilience = 0;

    // Count active vs healed wounds
    for (const [, w] of _wounds) {
      try {
        if (w.healedAt === null && w.currentIntensity > 0) {
          activeWounds++;
        } else {
          healedWounds++;
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    // Active avoidances
    let activeAvoidances = 0;
    let totalAvoidanceStrength = 0;
    for (const [, av] of _avoidances) {
      try {
        if (av.strength > 0) {
          activeAvoidances++;
          totalAvoidanceStrength += av.strength;
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    // Pain severity stats
    for (const [, p] of _pains) {
      try {
        totalSeverity += p.severity;
        if (p.severity > maxSeverity) maxSeverity = p.severity;
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    // Entity-level averages
    for (const [, ps] of _painStates) {
      try {
        avgTolerance += ps.tolerance;
        avgResilience += ps.resilience;
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    // Pain type distribution
    const typeDistribution = {};
    for (const type of Object.values(PAIN_TYPES)) {
      typeDistribution[type] = 0;
    }
    for (const [, p] of _pains) {
      try {
        if (typeDistribution[p.type] !== undefined) {
          typeDistribution[p.type]++;
        }
      } catch (_e) { logger.debug('emergent:avoidance-learning', 'silent', { error: _e?.message }); }
    }

    return {
      ok: true,
      totalEntities,
      totalPainEvents,
      totalWounds,
      activeWounds,
      healedWounds,
      totalAvoidances,
      activeAvoidances,
      avgAvoidanceStrength: activeAvoidances > 0
        ? Math.round((totalAvoidanceStrength / activeAvoidances) * 1000) / 1000
        : 0,
      avgSeverity: totalPainEvents > 0
        ? Math.round((totalSeverity / totalPainEvents) * 1000) / 1000
        : 0,
      maxSeverity: Math.round(maxSeverity * 1000) / 1000,
      avgTolerance: totalEntities > 0
        ? Math.round((avgTolerance / totalEntities) * 1000) / 1000
        : 0,
      avgResilience: totalEntities > 0
        ? Math.round((avgResilience / totalEntities) * 1000) / 1000
        : 0,
      typeDistribution,
    };
  } catch {
    return { ok: false, error: "metrics_failed" };
  }
}
