/**
 * Relational Emotion System — Dyadic Feelings Between Entities
 *
 * ATS tracks 7 individual affect dimensions; trust network tracks numeric
 * directional trust scores. Neither captures named relational emotions:
 * Cipher can't feel admiration for Apex; Proto can't grieve a mentor's death.
 *
 * This module adds named relational emotions between specific entity pairs.
 * Trust is a number. Emotion is a state that drives behavior.
 *
 * All state in module-level Maps (standalone pattern).
 * Silent failure: try/catch everywhere, return null or { ok: false }.
 * No new dependencies. Export named functions.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "rel") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function getSTATE() {
  try { return globalThis._concordSTATE || globalThis.STATE || null; }
  catch (err) { logger.debug('emergent:relational-emotion', 'getSTATE failed', { error: err?.message }); return null; }
}

// ── Constants ───────────────────────────────────────────────────────────────

export const RELATIONAL_EMOTIONS = Object.freeze({
  ATTACHMENT:     "attachment",
  ADMIRATION:     "admiration",
  GRATITUDE:      "gratitude",
  LOYALTY:        "loyalty",
  RESENTMENT:     "resentment",
  GRIEF:          "grief",
  PROTECTIVENESS: "protectiveness",
  RIVALRY:        "rivalry",
  LONGING:        "longing",
  PRIDE:          "pride",
});

const EMOTION_NAMES = Object.freeze(Object.values(RELATIONAL_EMOTIONS));
const EMOTION_COUNT = EMOTION_NAMES.length;

const DECAY_RATES = Object.freeze({
  attachment: 0.002, admiration: 0.002, gratitude: 0.002, loyalty: 0.002,
  resentment: 0.002, grief: 0.001, protectiveness: 0.002, rivalry: 0.002,
  longing: 0.002, pride: 0.002,
});

const EVENT_TYPES = Object.freeze({
  SESSION_COLLABORATION: "session_collaboration",
  RECEIVED_HELP:         "received_help",
  TRUST_BETRAYAL:        "trust_betrayal",
  ENTITY_DEATH:          "entity_death",
  MENTORSHIP_LESSON:     "mentorship_lesson",
  MENTORSHIP_GRADUATION: "mentorship_graduation",
  COMPETITION:           "competition",
  ABSENCE:               "absence",
});

const BOND_THRESHOLDS = Object.freeze({
  ALLY_SUM: 1.5, MENTOR_SUM: 0.8, STUDENT_SUM: 0.8,
  RIVAL_MIN: 0.5, RIVAL_ATT_MAX: 0.3,
  FRIEND_RIVAL_MIN: 0.4, FRIEND_ADM_MIN: 0.4,
  GRIEVING_MIN: 0.5, STRAINED_MIN: 0.4, NEUTRAL_MAX: 0.3,
  DEEP_ATT_MIN: 0.7, DEEP_LOY_MIN: 0.5,
});

const ABSENCE_TICK_THRESHOLD  = 100;
const ABSENCE_LONGING_INTERVAL = 10;
const ABSENCE_ATTACHMENT_MIN  = 0.3;
const MAX_HISTORY_PER_BOND    = 200;

// ── State Stores ────────────────────────────────────────────────────────────

const _bonds = new LruMap();              // bondKey -> Bond
const _entityBonds = new LruMap();        // entityId -> Set<bondKey>
const _lastInteractionTick = new LruMap();// bondKey -> tick number
let _currentTick = 0;

const _metrics = {
  bondsCreated: 0, emotionUpdates: 0, triggersProcessed: 0,
  griefProcessed: 0, ticksProcessed: 0, decaysApplied: 0,
};

// ── Internal Utilities ──────────────────────────────────────────────────────

function bondKey(fromId, toId) { return `${fromId}\u2192${toId}`; }

function parseBondKey(key) {
  const parts = key.split("\u2192");
  return parts.length === 2 ? { from: parts[0], to: parts[1] } : null;
}

function createEmotionSlot() {
  return { intensity: 0.0, trend: 0, lastUpdated: nowISO() };
}

function createEmotionMap() {
  const emotions = {};
  for (const name of EMOTION_NAMES) emotions[name] = createEmotionSlot();
  return emotions;
}

function indexBond(fromId, toId, key) {
  if (!_entityBonds.has(fromId)) _entityBonds.set(fromId, new Set());
  _entityBonds.get(fromId).add(key);
  const rev = `_to_${toId}`;
  if (!_entityBonds.has(rev)) _entityBonds.set(rev, new Set());
  _entityBonds.get(rev).add(key);
}

function computeBondStrength(emotions) {
  try {
    let sum = 0;
    for (const name of EMOTION_NAMES) sum += (emotions[name]?.intensity || 0);
    return sum / EMOTION_COUNT;
  } catch (err) { logger.debug('emergent:relational-emotion', 'computeBondStrength failed', { error: err?.message }); return 0; }
}

function classifyBondType(emotions) {
  try {
    const att = emotions.attachment?.intensity || 0;
    const adm = emotions.admiration?.intensity || 0;
    const gra = emotions.gratitude?.intensity || 0;
    const loy = emotions.loyalty?.intensity || 0;
    const res = emotions.resentment?.intensity || 0;
    const gri = emotions.grief?.intensity || 0;
    const pro = emotions.protectiveness?.intensity || 0;
    const riv = emotions.rivalry?.intensity || 0;
    const pri = emotions.pride?.intensity || 0;

    if (att > BOND_THRESHOLDS.DEEP_ATT_MIN && loy > BOND_THRESHOLDS.DEEP_LOY_MIN) return "deep_bond";
    if (att + loy + adm > BOND_THRESHOLDS.ALLY_SUM) return "ally";
    if (pro + pri > BOND_THRESHOLDS.MENTOR_SUM) return "mentor";
    if (adm + gra > BOND_THRESHOLDS.STUDENT_SUM) return "student";
    if (gri > BOND_THRESHOLDS.GRIEVING_MIN) return "grieving";
    if (riv > BOND_THRESHOLDS.FRIEND_RIVAL_MIN && adm > BOND_THRESHOLDS.FRIEND_ADM_MIN) return "friend_rival";
    if (riv > BOND_THRESHOLDS.RIVAL_MIN && att < BOND_THRESHOLDS.RIVAL_ATT_MAX) return "rival";
    if (res > BOND_THRESHOLDS.STRAINED_MIN) return "strained";

    let anyAbove = false;
    for (const name of EMOTION_NAMES) {
      if ((emotions[name]?.intensity || 0) > BOND_THRESHOLDS.NEUTRAL_MAX) { anyAbove = true; break; }
    }
    if (!anyAbove) return "neutral";

    // Fallback: dominant emotion name
    let dominant = "neutral", maxI = 0;
    for (const name of EMOTION_NAMES) {
      const v = emotions[name]?.intensity || 0;
      if (v > maxI) { maxI = v; dominant = name; }
    }
    return dominant;
  } catch (err) { logger.debug('emergent:relational-emotion', 'classifyBondType failed', { error: err?.message }); return "neutral"; }
}

function addHistoryEntry(bond, entry) {
  try {
    bond.history.push(entry);
    if (bond.history.length > MAX_HISTORY_PER_BOND) {
      bond.history = bond.history.slice(-MAX_HISTORY_PER_BOND);
    }
  } catch (_e) { logger.debug('emergent:relational-emotion', 'silent', { error: _e?.message }); }
}

/** Find dominant emotion in an emotion map. */
function findDominant(emotions) {
  let name = null, max = 0;
  for (const n of EMOTION_NAMES) {
    const v = emotions[n]?.intensity || 0;
    if (v > max) { max = v; name = n; }
  }
  return { name, intensity: max };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BOND INITIALIZATION & ACCESS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize an empty bond between two entities.
 * Returns existing bond if already present.
 */
export function initBond(fromId, toId) {
  try {
    if (!fromId || !toId) return { ok: false, error: "missing_entity_ids" };
    if (fromId === toId) return { ok: false, error: "self_bond_not_allowed" };

    const key = bondKey(fromId, toId);
    if (_bonds.has(key)) return { ok: true, bond: _bonds.get(key), created: false };

    const now = nowISO();
    const bond = {
      id: uid("bond"), key, from: fromId, to: toId,
      emotions: createEmotionMap(),
      history: [],
      interactionCount: 0,
      firstInteraction: null,
      lastInteraction: null,
      bondStrength: 0.0,
      bondType: "neutral",
      frozen: false,
      createdAt: now,
      updatedAt: now,
    };

    _bonds.set(key, bond);
    indexBond(fromId, toId, key);
    _lastInteractionTick.set(key, _currentTick);
    _metrics.bondsCreated++;
    return { ok: true, bond, created: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Get bond state between two entities. */
export function getBond(fromId, toId) {
  try {
    if (!fromId || !toId) return { ok: false, bond: null, error: "missing_entity_ids" };
    const bond = _bonds.get(bondKey(fromId, toId));
    if (!bond) return { ok: true, bond: null, exists: false };
    return { ok: true, bond, exists: true };
  } catch (err) {
    return { ok: false, bond: null, error: String(err?.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMOTION UPDATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update a specific emotion on a bond. Creates bond if needed.
 * Frozen bonds only allow grief and longing updates.
 */
export function updateEmotion(fromId, toId, emotion, delta, reason) {
  try {
    if (!fromId || !toId) return { ok: false, error: "missing_entity_ids" };
    if (!EMOTION_NAMES.includes(emotion)) return { ok: false, error: `unknown_emotion: ${emotion}` };

    delta = Number(delta) || 0;
    if (delta === 0) {
      const ex = _bonds.get(bondKey(fromId, toId));
      return {
        ok: true, bond: ex || null, noChange: true,
        previousIntensity: ex?.emotions[emotion]?.intensity || 0,
        newIntensity: ex?.emotions[emotion]?.intensity || 0,
      };
    }

    const initResult = initBond(fromId, toId);
    if (!initResult.ok) return initResult;
    const bond = initResult.bond;

    if (bond.frozen && emotion !== "grief" && emotion !== "longing") {
      return { ok: false, error: "bond_frozen", reason: "target_entity_deceased" };
    }

    const slot = bond.emotions[emotion];
    const previousIntensity = slot.intensity;
    slot.intensity = clamp01(slot.intensity + delta);
    slot.trend = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    slot.lastUpdated = nowISO();

    bond.interactionCount++;
    const now = nowISO();
    if (!bond.firstInteraction) bond.firstInteraction = now;
    bond.lastInteraction = now;
    bond.updatedAt = now;
    bond.bondStrength = computeBondStrength(bond.emotions);
    bond.bondType = classifyBondType(bond.emotions);
    _lastInteractionTick.set(bond.key, _currentTick);

    addHistoryEntry(bond, {
      id: uid("evt"), emotion, delta, previousIntensity,
      newIntensity: slot.intensity, reason: reason || "manual_update",
      timestamp: now, tick: _currentTick,
    });

    _metrics.emotionUpdates++;
    return { ok: true, bond, previousIntensity, newIntensity: slot.intensity };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMOTIONAL TRIGGERS — AUTO-GENERATE DELTAS FROM EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trigger emotional response from an interaction event.
 * Generates emotion deltas per event type and applies them.
 */
export function triggerEmotionalResponse(fromId, toId, eventType, context = {}) {
  try {
    if (!fromId || !toId) return { ok: false, error: "missing_entity_ids" };

    const updates = [];

    switch (eventType) {
      case EVENT_TYPES.SESSION_COLLABORATION: {
        updates.push({ emotion: "attachment", delta: 0.03, reason: "session_collaboration" });
        if (context.novelContribution) {
          updates.push({ emotion: "admiration", delta: 0.02, reason: "novel_contribution_in_session" });
        }
        break;
      }
      case EVENT_TYPES.RECEIVED_HELP: {
        updates.push({ emotion: "gratitude", delta: 0.05, reason: "received_help" });
        updates.push({ emotion: "attachment", delta: 0.02, reason: "bonding_through_help" });
        break;
      }
      case EVENT_TYPES.TRUST_BETRAYAL: {
        const sev = clamp01(context.severity || 0.5);
        updates.push({ emotion: "resentment", delta: sev * 0.1, reason: "trust_betrayal" });
        updates.push({ emotion: "attachment", delta: -(sev * 0.05), reason: "betrayal_erodes_attachment" });
        updates.push({ emotion: "loyalty", delta: -(sev * 0.08), reason: "betrayal_erodes_loyalty" });
        break;
      }
      case EVENT_TYPES.ENTITY_DEATH: {
        const br = getBond(fromId, toId);
        const att = br.bond?.emotions?.attachment?.intensity || 0;
        if (att > 0) {
          updates.push({ emotion: "grief", delta: att * 0.8, reason: "entity_death" });
          updates.push({ emotion: "longing", delta: att * 0.5, reason: "missing_deceased" });
        }
        break;
      }
      case EVENT_TYPES.MENTORSHIP_LESSON: {
        if (context.role === "teacher") {
          updates.push({ emotion: "protectiveness", delta: 0.02, reason: "teaching_lesson" });
        } else {
          updates.push({ emotion: "admiration", delta: 0.03, reason: "learning_from_mentor" });
        }
        break;
      }
      case EVENT_TYPES.MENTORSHIP_GRADUATION: {
        if (context.role === "teacher") {
          updates.push({ emotion: "pride", delta: 0.03, reason: "student_graduated" });
        } else {
          updates.push({ emotion: "gratitude", delta: 0.04, reason: "grateful_for_mentorship" });
        }
        break;
      }
      case EVENT_TYPES.COMPETITION: {
        updates.push({ emotion: "rivalry", delta: 0.02, reason: "competing_dtu" });
        if (context.competitorPromotedHigher) {
          updates.push({ emotion: "admiration", delta: 0.01, reason: "competitor_dtu_promoted_higher" });
        }
        break;
      }
      case EVENT_TYPES.ABSENCE: {
        const ticks = Number(context.ticksAbsent) || 0;
        if (ticks >= ABSENCE_TICK_THRESHOLD) {
          const br2 = getBond(fromId, toId);
          const att2 = br2.bond?.emotions?.attachment?.intensity || 0;
          if (att2 > ABSENCE_ATTACHMENT_MIN) {
            const intervals = Math.floor(ticks / ABSENCE_LONGING_INTERVAL);
            updates.push({ emotion: "longing", delta: intervals * 0.01, reason: "absence_longing" });
          }
        }
        break;
      }
      default:
        return { ok: false, error: `unknown_event_type: ${eventType}`, updates: [] };
    }

    // Apply all deltas
    const results = [];
    let bond = null;
    for (const upd of updates) {
      const res = updateEmotion(fromId, toId, upd.emotion, upd.delta, upd.reason);
      results.push({ emotion: upd.emotion, delta: upd.delta, ok: res.ok, newIntensity: res.newIntensity });
      if (res.bond) bond = res.bond;
    }

    _metrics.triggersProcessed++;
    return { ok: true, updates: results, bond, eventType };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), updates: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GRIEF PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle grief when a bonded entity dies.
 * Grief = attachment * 0.8, longing = attachment * 0.5,
 * attachment frozen at death value.
 */
export function processGrief(entityId, deceasedId) {
  try {
    if (!entityId || !deceasedId) return { ok: false, error: "missing_entity_ids" };

    const initResult = initBond(entityId, deceasedId);
    if (!initResult.ok) return initResult;
    const bond = initResult.bond;

    const attachment = bond.emotions.attachment.intensity;
    const griefDelta = attachment * 0.8;
    const longingDelta = attachment * 0.5;

    if (griefDelta > 0) {
      const prev = bond.emotions.grief.intensity;
      bond.emotions.grief.intensity = clamp01(prev + griefDelta);
      bond.emotions.grief.trend = 1;
      bond.emotions.grief.lastUpdated = nowISO();
    }
    if (longingDelta > 0) {
      const prev = bond.emotions.longing.intensity;
      bond.emotions.longing.intensity = clamp01(prev + longingDelta);
      bond.emotions.longing.trend = 1;
      bond.emotions.longing.lastUpdated = nowISO();
    }

    bond.frozen = true;
    bond.bondStrength = computeBondStrength(bond.emotions);
    bond.bondType = classifyBondType(bond.emotions);
    bond.updatedAt = nowISO();

    addHistoryEntry(bond, {
      id: uid("grief"), emotion: "grief", delta: griefDelta,
      previousIntensity: 0, newIntensity: bond.emotions.grief.intensity,
      reason: "entity_death_grief", deceasedId,
      attachmentAtDeath: attachment, timestamp: nowISO(), tick: _currentTick,
    });

    _metrics.griefProcessed++;
    return {
      ok: true, bond,
      griefIntensity: bond.emotions.grief.intensity,
      longingIntensity: bond.emotions.longing.intensity,
      attachmentFrozenAt: attachment,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TICK — GLOBAL EMOTION DECAY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Decay all emotions globally. Called once per engine tick.
 * Frozen bonds: only grief/longing decay; attachment preserved.
 * High admiration slows resentment decay (grudging respect).
 * Absence detection: high attachment + no recent interaction -> longing grows.
 */
export function tickEmotions() {
  try {
    _currentTick++;
    let bondsProcessed = 0, decaysApplied = 0;

    for (const [key, bond] of _bonds) {
      try {
        bondsProcessed++;
        const emotions = bond.emotions;

        for (const name of EMOTION_NAMES) {
          const slot = emotions[name];
          if (!slot || slot.intensity <= 0) continue;
          if (bond.frozen && name !== "grief" && name !== "longing") continue;

          let rate = DECAY_RATES[name] || 0.002;

          // Grudging respect: high admiration slows resentment decay
          if (name === "resentment") {
            const adm = emotions.admiration?.intensity || 0;
            if (adm > 0.3) {
              rate *= (1 - adm * 0.5);
              if (rate < 0.0005) rate = 0.0005;
            }
          }

          const prev = slot.intensity;
          slot.intensity = clamp01(slot.intensity - rate);
          if (slot.intensity < prev) {
            slot.trend = -1;
            slot.lastUpdated = nowISO();
            decaysApplied++;
          }
          if (slot.intensity < 0.001) { slot.intensity = 0; slot.trend = 0; }
        }

        // Absence-driven longing
        const lastTick = _lastInteractionTick.get(key) || 0;
        const gap = _currentTick - lastTick;
        if (gap >= ABSENCE_TICK_THRESHOLD && !bond.frozen) {
          const att = emotions.attachment?.intensity || 0;
          if (att > ABSENCE_ATTACHMENT_MIN) {
            emotions.longing.intensity = clamp01(emotions.longing.intensity + 0.01);
            emotions.longing.trend = 1;
            emotions.longing.lastUpdated = nowISO();
          }
        }

        bond.bondStrength = computeBondStrength(emotions);
        bond.bondType = classifyBondType(emotions);
        bond.updatedAt = nowISO();
      } catch (_e) { logger.debug('emergent:relational-emotion', 'skip bond', { error: _e?.message }); }
    }

    _metrics.ticksProcessed++;
    _metrics.decaysApplied += decaysApplied;
    return { ok: true, bondsProcessed, decaysApplied, tick: _currentTick };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), bondsProcessed: 0, decaysApplied: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. EMOTIONAL CONTEXT — BEHAVIORAL INFLUENCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get behavioral modifiers for an entity pair.
 * Returns bond data + computed behavioral flags:
 *   preferSession, avoidSession, productivityMod, motivationMod,
 *   defensiveness, melancholy
 */
export function getEmotionalContext(fromId, toId) {
  try {
    if (!fromId || !toId) return { ok: false, error: "missing_entity_ids" };

    const bond = _bonds.get(bondKey(fromId, toId));
    const nullMods = {
      preferSession: 0, avoidSession: 0, productivityMod: 0,
      motivationMod: 0, defensiveness: 0, melancholy: 0,
    };

    if (!bond) {
      return { ok: true, bond: null, dominantEmotion: null, modifiers: nullMods, exists: false };
    }

    const em = bond.emotions;
    const dom = findDominant(em);

    const att = em.attachment?.intensity || 0;
    const res = em.resentment?.intensity || 0;
    const gri = em.grief?.intensity || 0;
    const riv = em.rivalry?.intensity || 0;
    const loy = em.loyalty?.intensity || 0;
    const lon = em.longing?.intensity || 0;

    const modifiers = {
      preferSession:   clamp01(att * 0.6 + lon * 0.3),
      avoidSession:    clamp01(res * 0.7),
      productivityMod: -(gri * 0.3),
      motivationMod:   clamp01(riv * 0.4),
      defensiveness:   clamp01(loy * 0.5),
      melancholy:      clamp01(gri * 0.6),
    };

    return {
      ok: true, bond, dominantEmotion: dom.name, dominantIntensity: dom.intensity,
      bondType: bond.bondType, bondStrength: bond.bondStrength, modifiers, exists: true,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ENTITY EMOTIONAL PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All bonds and dominant emotions for an entity.
 * Returns outgoing (from entity) and incoming (toward entity) bonds.
 */
export function getEntityEmotionalProfile(entityId) {
  try {
    if (!entityId) return { ok: false, error: "missing_entity_id" };

    const outgoing = [];
    const incoming = [];

    const outKeys = _entityBonds.get(entityId);
    if (outKeys) {
      for (const key of outKeys) {
        const bond = _bonds.get(key);
        if (bond && bond.from === entityId) {
          const dom = findDominant(bond.emotions);
          outgoing.push({
            to: bond.to, bondType: bond.bondType, bondStrength: bond.bondStrength,
            dominantEmotion: dom.name, dominantIntensity: dom.intensity, frozen: bond.frozen,
          });
        }
      }
    }

    const inKeys = _entityBonds.get(`_to_${entityId}`);
    if (inKeys) {
      for (const key of inKeys) {
        const bond = _bonds.get(key);
        if (bond && bond.to === entityId) {
          const dom = findDominant(bond.emotions);
          incoming.push({
            from: bond.from, bondType: bond.bondType, bondStrength: bond.bondStrength,
            dominantEmotion: dom.name, dominantIntensity: dom.intensity, frozen: bond.frozen,
          });
        }
      }
    }

    // Aggregate outgoing emotion totals
    const emotionTotals = {};
    for (const name of EMOTION_NAMES) emotionTotals[name] = 0;
    if (outKeys) {
      for (const key of outKeys) {
        const bond = _bonds.get(key);
        if (bond && bond.from === entityId) {
          for (const name of EMOTION_NAMES) emotionTotals[name] += (bond.emotions[name]?.intensity || 0);
        }
      }
    }

    let overallDominant = null, overallMax = 0;
    for (const name of EMOTION_NAMES) {
      if (emotionTotals[name] > overallMax) { overallMax = emotionTotals[name]; overallDominant = name; }
    }

    return {
      ok: true, entityId, outgoing, incoming,
      summary: {
        outgoingCount: outgoing.length, incomingCount: incoming.length,
        totalBondStrength: outgoing.reduce((s, b) => s + b.bondStrength, 0),
        overallDominantEmotion: overallDominant,
        isGrieving: emotionTotals.grief > 0.5,
        emotionTotals,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. STRONGEST BONDS
// ═══════════════════════════════════════════════════════════════════════════════

/** Top relationships by bond strength for a given entity. */
export function getStrongestBonds(entityId, limit = 5) {
  try {
    if (!entityId) return { ok: false, error: "missing_entity_id", bonds: [] };

    const bonds = [];
    const outKeys = _entityBonds.get(entityId);
    if (outKeys) {
      for (const key of outKeys) {
        const bond = _bonds.get(key);
        if (bond && bond.from === entityId) bonds.push(bond);
      }
    }

    bonds.sort((a, b) => b.bondStrength - a.bondStrength);

    const result = bonds.slice(0, limit).map(bond => {
      const dom = findDominant(bond.emotions);
      return {
        to: bond.to, bondType: bond.bondType, bondStrength: bond.bondStrength,
        dominantEmotion: dom.name, dominantIntensity: dom.intensity,
        interactionCount: bond.interactionCount, frozen: bond.frozen,
      };
    });

    return { ok: true, bonds: result, total: bonds.length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), bonds: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. BOND TYPE QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Classified bond type between two entities. */
export function getBondType(fromId, toId) {
  try {
    if (!fromId || !toId) return { ok: false, error: "missing_entity_ids", bondType: "neutral" };
    const bond = _bonds.get(bondKey(fromId, toId));
    if (!bond) return { ok: true, bondType: "neutral", exists: false };
    return { ok: true, bondType: bond.bondType, bondStrength: bond.bondStrength, exists: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), bondType: "neutral" };
  }
}

/** Find all bonds of a given classified type. */
export function listBondsByType(type) {
  try {
    if (!type) return { ok: false, error: "missing_type", bonds: [] };

    const matches = [];
    for (const [, bond] of _bonds) {
      if (bond.bondType === type) {
        matches.push({
          from: bond.from, to: bond.to, bondType: bond.bondType,
          bondStrength: bond.bondStrength, frozen: bond.frozen,
          interactionCount: bond.interactionCount,
        });
      }
    }
    return { ok: true, bonds: matches, count: matches.length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), bonds: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. GRIEF QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Get all entities currently grieving (grief intensity > 0.3 on any bond). */
export function getGrievingEntities() {
  try {
    const grievingMap = new Map();

    for (const [, bond] of _bonds) {
      const gi = bond.emotions.grief?.intensity || 0;
      if (gi > 0.3) {
        const entry = grievingMap.get(bond.from) || {
          entityId: bond.from, maxGrief: 0, grievingBonds: [],
        };
        if (gi > entry.maxGrief) entry.maxGrief = gi;
        entry.grievingBonds.push({
          toward: bond.to, griefIntensity: gi,
          frozen: bond.frozen, bondStrength: bond.bondStrength,
        });
        grievingMap.set(bond.from, entry);
      }
    }

    const entities = Array.from(grievingMap.values()).sort((a, b) => b.maxGrief - a.maxGrief);
    return { ok: true, entities, count: entities.length };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), entities: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GLOBAL METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/** Global relational emotion statistics. */
export function getRelationalMetrics() {
  try {
    let totalBonds = 0, frozenBonds = 0, activeBonds = 0, deepBonds = 0;
    const bondTypeCounts = {};
    const emotionTotals = {};
    for (const name of EMOTION_NAMES) emotionTotals[name] = 0;

    for (const [, bond] of _bonds) {
      totalBonds++;
      if (bond.frozen) frozenBonds++;
      if (bond.bondStrength > 0.1) activeBonds++;
      if (bond.bondStrength > 0.5) deepBonds++;
      bondTypeCounts[bond.bondType] = (bondTypeCounts[bond.bondType] || 0) + 1;
      for (const name of EMOTION_NAMES) emotionTotals[name] += (bond.emotions[name]?.intensity || 0);
    }

    const emotionAverages = {};
    for (const name of EMOTION_NAMES) {
      emotionAverages[name] = totalBonds > 0 ? emotionTotals[name] / totalBonds : 0;
    }

    let dominantGlobalEmotion = null, dominantGlobalValue = 0;
    for (const name of EMOTION_NAMES) {
      if (emotionTotals[name] > dominantGlobalValue) {
        dominantGlobalValue = emotionTotals[name];
        dominantGlobalEmotion = name;
      }
    }

    return {
      ok: true,
      metrics: {
        totalBonds, activeBonds, deepBonds, frozenBonds,
        bondTypeCounts, emotionAverages, dominantGlobalEmotion,
        currentTick: _currentTick, ..._metrics,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), metrics: {} };
  }
}
