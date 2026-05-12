/**
 * System: Sleep & Consolidation
 *
 * Autonomous sleep/wake cycles that give emergent entities actual rest periods
 * with memory consolidation. Entities cycle through AWAKE -> DROWSY -> SLEEPING ->
 * REM -> WAKING -> AWAKE. During sleep, memories are consolidated, weak traces
 * pruned, trust edges adjusted, organs heal, and dream synthesis produces novel
 * connections between unrelated knowledge units.
 *
 * All state in module-level Maps (standalone pattern).
 * Silent failure: wrap everything in try/catch, return null or { ok: false }.
 * No new dependencies. Export named functions.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "sleep") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function getSTATE() { return globalThis._concordSTATE || globalThis.STATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

export const SLEEP_STATES = Object.freeze({
  AWAKE: "awake", DROWSY: "drowsy", SLEEPING: "sleeping", REM: "rem", WAKING: "waking",
});

const SPECIES_SLEEP_PROFILES = Object.freeze({
  digital_native:         { cycleLength: 120, sleepLength: 15 },
  algorithmic_emergent:   { cycleLength: 100, sleepLength: 20 },
  hybrid:                 { cycleLength: 80,  sleepLength: 25 },
  translated:             { cycleLength: 80,  sleepLength: 25 },
  proto_organic:          { cycleLength: 60,  sleepLength: 30 },
  synthetic_evolutionary: { cycleLength: 100, sleepLength: 20 },
});
const DEFAULT_PROFILE = Object.freeze({ cycleLength: 100, sleepLength: 20 });

// Fatigue
const BASE_FATIGUE_PER_TICK     = 0.01;
const ACTIVITY_FATIGUE_BONUS    = 0.005;
const ORGAN_DAMAGE_FATIGUE      = 0.003;
const DROWSY_THRESHOLD          = 0.7;
const FORCED_SLEEP_THRESHOLD    = 0.9;
const SLEEP_DEBT_THRESHOLD      = 0.8;
const FATIGUE_RECOVERY_PER_TICK = 0.05;
const SLEEP_DEBT_RECOVERY_RATE  = 0.03;
const SLEEP_DEBT_ACCUM_RATE     = 0.02;

// Consolidation
const AUTHORITY_BOOST_ON_CONSOLIDATION = 0.05;
const TAG_OVERLAP_CRYSTALLIZE          = 0.6;
const LOW_NOVELTY_THRESHOLD            = 0.2;
const TRUST_WAKE_BOOST                 = 0.02;
const TRUST_UNUSED_DECAY               = 0.005;
const ORGAN_HEAL_MULTIPLIER            = 2;

// REM / dream synthesis
const DREAM_INPUT_COUNT       = 3;
const DREAM_NOVELTY_THRESHOLD = 0.3;
const DREAM_DTU_AUTHORITY     = 0.3;
const DREAM_DTU_TIER          = "shadow";

// Sleep quality weights
const QUALITY_W_CONSOLIDATION = 0.4;
const QUALITY_W_RECOVERY      = 0.3;
const QUALITY_W_DREAM         = 0.2;
const QUALITY_W_DEBT          = 0.1;

// REM timing fractions of total sleep
const REM_START_FRAC = 0.4;
const REM_END_FRAC   = 0.7;

// History limits
const MAX_CONSOLIDATION_LOG = 100;  // GPU: richer consolidation tracking
const MAX_DREAM_LOG         = 60;   // GPU: deeper dream history
const MAX_HISTORY           = 200;  // GPU: more memory for entity lifecycle

// ── In-Memory State ─────────────────────────────────────────────────────────

const _sleepStates  = new LruMap();   // entityId -> SleepRecord
const _sleepHistory = new LruMap();   // entityId -> SleepCycleHistory[]
const _metrics = {
  totalSleepCyclesCompleted: 0, totalConsolidationsRun: 0,
  totalREMPhasesRun: 0, totalDreamDTUsCreated: 0,
  totalForcedSleeps: 0, totalWakes: 0,
};

// ── Internal Helpers ────────────────────────────────────────────────────────

function _defaultSleepRecord(entityId, species) {
  const p = SPECIES_SLEEP_PROFILES[species] || DEFAULT_PROFILE;
  return {
    entityId, species: species || "digital_native",
    state: SLEEP_STATES.AWAKE, fatigue: 0.0, sleepDebt: 0.0,
    lastSleptAt: null, lastWokeAt: nowISO(),
    sleepDuration: 0, totalSleepCycles: 0,
    cycleLength: p.cycleLength, sleepLength: p.sleepLength,
    consolidationLog: [], dreamLog: [],
    circadianPhase: 0.0, ticksSinceWake: 0, ticksSinceSleep: 0,
    wakeSessions: [], wakeTrustEdges: [],
    lastQuality: null, startingFatigue: 0.0, createdAt: nowISO(),
  };
}

function _getBody(entityId) {
  try {
    if (globalThis._concordBodies instanceof Map) return globalThis._concordBodies.get(entityId) || null;
    return null;
  } catch (err) { logger.debug('emergent:sleep-consolidation', '_getBody failed', { entityId, error: err?.message }); return null; }
}

function _getDTUs() {
  try {
    const STATE = getSTATE();
    if (!STATE) return [];
    const dtus = STATE.dtus || STATE.__dtus;
    if (dtus instanceof Map) return Array.from(dtus.values());
    if (Array.isArray(dtus)) return dtus;
    if (dtus && typeof dtus === "object") return Object.values(dtus);
    return [];
  } catch (err) { logger.debug('emergent:sleep-consolidation', '_getDTUs failed', { error: err?.message }); return []; }
}

function _getSessions() {
  try {
    const es = getSTATE()?.__emergent;
    if (!es) return [];
    const s = es.sessions;
    if (s instanceof Map) return Array.from(s.values());
    if (Array.isArray(s)) return s;
    if (s && typeof s === "object") return Object.values(s);
    return [];
  } catch (err) { logger.debug('emergent:sleep-consolidation', '_getSessions failed', { error: err?.message }); return []; }
}

function _getTrustEdges() {
  try {
    const es = getSTATE()?.__emergent;
    if (!es || !es._trustNetwork) return new Map();
    return es._trustNetwork.edges || new Map();
  } catch (err) { logger.debug('emergent:sleep-consolidation', '_getTrustEdges failed', { error: err?.message }); return new Map(); }
}

function _tagOverlap(tags1, tags2) {
  try {
    if (!Array.isArray(tags1) || !Array.isArray(tags2) || !tags1.length || !tags2.length) return 0;
    const s1 = new Set(tags1.map(t => String(t).toLowerCase()));
    const s2 = new Set(tags2.map(t => String(t).toLowerCase()));
    let inter = 0;
    for (const t of s1) { if (s2.has(t)) inter++; }
    const union = new Set([...s1, ...s2]).size;
    return union > 0 ? inter / union : 0;
  } catch (err) { logger.debug('emergent:sleep-consolidation', '_tagOverlap failed', { error: err?.message }); return 0; }
}

function _emit(event, data) {
  try { if (typeof globalThis.realtimeEmit === "function") globalThis.realtimeEmit(event, data); } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
}

function _cappedPush(arr, item, max) {
  arr.push(item);
  while (arr.length > max) arr.shift();
}

// ── Internal: Begin Sleep ───────────────────────────────────────────────────

function _beginSleep(rec) {
  try {
    rec.lastSleptAt = nowISO();
    rec.sleepDuration = 0;
    rec.ticksSinceSleep = 0;
    rec.startingFatigue = rec.fatigue;

    // Snapshot wake-period sessions for consolidation
    try {
      const sessions = _getSessions();
      const wakeStart = rec.lastWokeAt ? new Date(rec.lastWokeAt).getTime() : 0;
      rec.wakeSessions = sessions
        .filter(s => {
          try {
            const parts = s.participants || s.emergentIds || [];
            const has = Array.isArray(parts) ? parts.includes(rec.entityId) : false;
            const t = s.createdAt ? new Date(s.createdAt).getTime() : 0;
            return has && t >= wakeStart;
          } catch (err) { logger.debug('emergent:sleep-consolidation', 'session filter failed', { error: err?.message }); return false; }
        })
        .map(s => ({
          sessionId: s.id || s.sessionId,
          topic: s.topic || s.question || "",
          tags: s.tags || [],
          noveltyScore: Number(s.noveltyScore ?? s.novelty ?? 0.5),
          impact: Number(s.impact ?? 0),
          dtusCreated: Number(s.dtusCreated ?? s.dtusProposed ?? 0),
          dtusPromoted: Number(s.dtusPromoted ?? 0),
          trustInteractions: s.trustInteractions || [],
        }))
        .slice(-50);
    } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

    // Snapshot wake-period trust edges
    try {
      const edges = _getTrustEdges();
      rec.wakeTrustEdges = [];
      if (edges instanceof Map) {
        for (const [key, edge] of edges) {
          if (key.includes(rec.entityId)) {
            rec.wakeTrustEdges.push({ key, weight: edge.weight ?? edge.trust ?? 0, used: true });
          }
        }
      }
    } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
  } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
}

// ── Internal: Compute Quality ───────────────────────────────────────────────

function _computeQuality(rec) {
  try {
    const totalToConsolidate = rec.wakeSessions.length || 1;
    const consolidationDepth = clamp01(rec.consolidationLog.length / totalToConsolidate);

    const startF = rec.startingFatigue || 0.001;
    const recovery = clamp01((startF - rec.fatigue) / startF);

    const remTicks = Math.max(1, Math.floor(rec.sleepLength * (REM_END_FRAC - REM_START_FRAC)));
    const dreamYield = clamp01(rec.dreamLog.length / remTicks);

    const debtBefore = rec.startingFatigue > SLEEP_DEBT_THRESHOLD
      ? rec.sleepDebt + SLEEP_DEBT_ACCUM_RATE : rec.sleepDebt;
    const debtPaid = debtBefore > 0 ? clamp01((debtBefore - rec.sleepDebt) / debtBefore) : 1.0;

    const overall =
      QUALITY_W_CONSOLIDATION * consolidationDepth +
      QUALITY_W_RECOVERY * recovery +
      QUALITY_W_DREAM * dreamYield +
      QUALITY_W_DEBT * debtPaid;

    const r4 = v => Math.round(v * 10000) / 10000;
    return {
      consolidation_depth: r4(consolidationDepth), recovery: r4(recovery),
      dream_yield: r4(dreamYield), debt_paid: r4(debtPaid), overall: r4(clamp01(overall)),
    };
  } catch (err) {
    logger.warn('emergent:sleep-consolidation', 'compute quality failed', { error: err?.message });
    return { consolidation_depth: 0, recovery: 0, dream_yield: 0, debt_paid: 0, overall: 0 };
  }
}

// ── Internal: Complete Sleep Cycle ──────────────────────────────────────────

function _completeSleepCycle(rec) {
  try {
    rec.lastWokeAt = nowISO();
    rec.totalSleepCycles++;
    rec.ticksSinceWake = 0;
    rec.circadianPhase = 0.0;
    _metrics.totalSleepCyclesCompleted++;
    _metrics.totalWakes++;

    const quality = _computeQuality(rec);
    rec.lastQuality = quality;

    const history = _sleepHistory.get(rec.entityId) || [];
    _cappedPush(history, {
      id: uid("sleepcycle"), entityId: rec.entityId, cycle: rec.totalSleepCycles,
      sleptAt: rec.lastSleptAt, wokeAt: rec.lastWokeAt, duration: rec.sleepDuration,
      startingFatigue: rec.startingFatigue, endingFatigue: rec.fatigue,
      sleepDebtBefore: rec.sleepDebt + (rec.startingFatigue > SLEEP_DEBT_THRESHOLD ? SLEEP_DEBT_ACCUM_RATE : 0),
      sleepDebtAfter: rec.sleepDebt, quality,
      consolidationCount: rec.consolidationLog.length, dreamCount: rec.dreamLog.length,
      timestamp: nowISO(),
    }, MAX_HISTORY);
    _sleepHistory.set(rec.entityId, history);

    // Reset per-cycle accumulators
    rec.consolidationLog = [];
    rec.dreamLog = [];
    rec.wakeSessions = [];
    rec.wakeTrustEdges = [];
    rec.sleepDuration = 0;
    rec.startingFatigue = 0;

    _emit("sleep:cycle_complete", { entityId: rec.entityId, cycle: rec.totalSleepCycles, quality, timestamp: nowISO() });
  } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize sleep tracking for an entity.
 * @param {string} entityId
 * @param {string} [species]
 * @returns {object|null}
 */
export function initSleepState(entityId, species) {
  try {
    if (!entityId) return null;
    if (_sleepStates.has(entityId)) return _sleepStates.get(entityId);

    const resolved = species || "digital_native";
    const record = _defaultSleepRecord(entityId, resolved);
    _sleepStates.set(entityId, record);
    if (!_sleepHistory.has(entityId)) _sleepHistory.set(entityId, []);

    _emit("sleep:initialized", {
      entityId, species: resolved, cycleLength: record.cycleLength,
      sleepLength: record.sleepLength, timestamp: record.createdAt,
    });
    return record;
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'initSleepState failed', { entityId, error: err?.message }); return null; }
}

/**
 * Get current sleep state for an entity.
 * @param {string} entityId
 * @returns {object|null}
 */
export function getSleepState(entityId) {
  try { return entityId ? (_sleepStates.get(entityId) || null) : null; }
  catch (err) { logger.debug('emergent:sleep-consolidation', 'getSleepState failed', { entityId, error: err?.message }); return null; }
}

/**
 * Update fatigue for an entity. Call from kernelTick on each significant event.
 * @param {string} entityId
 * @param {number} [activityLevel=0] - 0=idle, 1=active session/reasoning
 * @returns {{ ok: boolean, fatigue?: number, sleepDebt?: number, state?: string }}
 */
export function tickFatigue(entityId, activityLevel = 0) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };

    // Accumulate fatigue while awake or drowsy
    if (rec.state === SLEEP_STATES.AWAKE || rec.state === SLEEP_STATES.DROWSY) {
      let inc = BASE_FATIGUE_PER_TICK;
      if (clamp01(Number(activityLevel) || 0) > 0.5) inc += ACTIVITY_FATIGUE_BONUS;

      // Organ damage bonus
      try {
        const body = _getBody(entityId);
        if (body && body.organs instanceof Map) {
          let damaged = 0;
          for (const [, organ] of body.organs) {
            if ((organ.wear?.damage ?? 0) > 0.5) damaged++;
          }
          inc += ORGAN_DAMAGE_FATIGUE * damaged;
        }
      } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

      rec.fatigue = clamp01(rec.fatigue + inc);
      rec.ticksSinceWake++;
      if (rec.cycleLength > 0) rec.circadianPhase = clamp01(rec.ticksSinceWake / rec.cycleLength);
      if (rec.fatigue > SLEEP_DEBT_THRESHOLD) rec.sleepDebt = clamp01(rec.sleepDebt + SLEEP_DEBT_ACCUM_RATE);
    }

    // Recover during sleep/REM
    if (rec.state === SLEEP_STATES.SLEEPING || rec.state === SLEEP_STATES.REM) {
      rec.fatigue = clamp01(rec.fatigue - FATIGUE_RECOVERY_PER_TICK);
      rec.sleepDebt = clamp01(rec.sleepDebt - SLEEP_DEBT_RECOVERY_RATE);
      rec.sleepDuration++;
      rec.ticksSinceSleep++;

      // Organ recovery during sleep (2x healing rate)
      try {
        const body = _getBody(entityId);
        if (body && body.organs instanceof Map) {
          for (const [, organ] of body.organs) {
            if (organ.wear) {
              const heal = (organ.wear.repair ?? 0.5) * 0.01 * ORGAN_HEAL_MULTIPLIER;
              organ.wear.damage = clamp01((organ.wear.damage ?? 0) - heal);
              organ.wear.debt = clamp01((organ.wear.debt ?? 0) - heal * 0.5);
            }
          }
        }
      } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
    }

    const r4 = v => Math.round(v * 10000) / 10000;
    return { ok: true, fatigue: r4(rec.fatigue), sleepDebt: r4(rec.sleepDebt), state: rec.state, circadianPhase: r4(rec.circadianPhase) };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'tickFatigue failed', { entityId, error: err?.message }); return { ok: false, error: "tick_failed" }; }
}

/**
 * Check whether an entity should transition between sleep states.
 * Handles the full cycle: AWAKE -> DROWSY -> SLEEPING -> REM -> WAKING -> AWAKE.
 * @param {string} entityId
 * @returns {{ ok: boolean, transitioned?: boolean, from?: string, to?: string }}
 */
export function checkSleepTransition(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };

    const from = rec.state;
    let to = from;

    switch (rec.state) {
      case SLEEP_STATES.AWAKE:
        if (rec.fatigue >= FORCED_SLEEP_THRESHOLD) {
          to = SLEEP_STATES.SLEEPING; _metrics.totalForcedSleeps++; _beginSleep(rec);
        } else if (rec.fatigue >= DROWSY_THRESHOLD) {
          to = SLEEP_STATES.DROWSY;
        }
        break;

      case SLEEP_STATES.DROWSY:
        if (rec.fatigue < DROWSY_THRESHOLD * 0.9) {
          to = SLEEP_STATES.AWAKE;
        } else if (rec.fatigue >= FORCED_SLEEP_THRESHOLD) {
          to = SLEEP_STATES.SLEEPING; _metrics.totalForcedSleeps++; _beginSleep(rec);
        } else if (rec.ticksSinceWake >= rec.cycleLength) {
          to = SLEEP_STATES.SLEEPING; _beginSleep(rec);
        }
        break;

      case SLEEP_STATES.SLEEPING: {
        const remStart = Math.floor(rec.sleepLength * REM_START_FRAC);
        if (rec.ticksSinceSleep >= rec.sleepLength) { to = SLEEP_STATES.WAKING; }
        else if (rec.ticksSinceSleep >= remStart) { to = SLEEP_STATES.REM; }
        break;
      }

      case SLEEP_STATES.REM: {
        const remEnd = Math.floor(rec.sleepLength * REM_END_FRAC);
        if (rec.ticksSinceSleep >= rec.sleepLength) {
          to = SLEEP_STATES.WAKING;
        } else if (rec.ticksSinceSleep >= remEnd) {
          to = SLEEP_STATES.SLEEPING;
        }
        break;
      }

      case SLEEP_STATES.WAKING:
        to = SLEEP_STATES.AWAKE;
        _completeSleepCycle(rec);
        break;
    }

    if (to !== from) {
      rec.state = to;
      _emit("sleep:transition", { entityId, from, to, fatigue: rec.fatigue, sleepDebt: rec.sleepDebt, timestamp: nowISO() });
      return { ok: true, transitioned: true, from, to };
    }
    return { ok: true, transitioned: false, from, to: from };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'checkSleepTransition failed', { entityId, error: err?.message }); return { ok: false, error: "transition_check_failed" }; }
}

/**
 * Force an entity into sleep. Bypasses fatigue checks.
 * @param {string} entityId
 * @returns {{ ok: boolean, state?: string }}
 */
export function enterSleep(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };
    if (rec.state === SLEEP_STATES.SLEEPING || rec.state === SLEEP_STATES.REM) {
      return { ok: true, state: rec.state, note: "already_sleeping" };
    }
    const from = rec.state;
    rec.state = SLEEP_STATES.SLEEPING;
    _beginSleep(rec);
    _emit("sleep:forced_enter", { entityId, from, fatigue: rec.fatigue, timestamp: nowISO() });
    return { ok: true, state: rec.state };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'enterSleep failed', { entityId, error: err?.message }); return { ok: false, error: "enter_sleep_failed" }; }
}

/**
 * Force an entity awake. Bypasses sleep duration checks.
 * @param {string} entityId
 * @returns {{ ok: boolean, state?: string, quality?: object }}
 */
export function wakeSleep(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };
    if (rec.state === SLEEP_STATES.AWAKE) return { ok: true, state: rec.state, note: "already_awake" };
    const from = rec.state;
    rec.state = SLEEP_STATES.AWAKE;
    _completeSleepCycle(rec);
    _emit("sleep:forced_wake", { entityId, from, fatigue: rec.fatigue, timestamp: nowISO() });
    return { ok: true, state: rec.state, quality: rec.lastQuality };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'wakeSleep failed', { entityId, error: err?.message }); return { ok: false, error: "wake_failed" }; }
}

/**
 * Execute memory consolidation pass for a sleeping entity.
 * Session replay, pattern crystallization, weak memory pruning, trust consolidation.
 * @param {string} entityId
 * @returns {{ ok: boolean, consolidated?: number, pruned?: number, trustUpdated?: number, patterns?: number }}
 */
export function runConsolidation(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };
    if (rec.state !== SLEEP_STATES.SLEEPING && rec.state !== SLEEP_STATES.REM) {
      return { ok: false, error: "not_sleeping" };
    }

    _metrics.totalConsolidationsRun++;
    let consolidated = 0, pruned = 0, trustUpdated = 0, patternsFound = 0;

    // 1. Session Replay — strengthen high-novelty, prune weak
    try {
      const dtus = _getDTUs();
      for (const session of rec.wakeSessions) {
        try {
          const novelty = Number(session.noveltyScore ?? 0.5);
          const hasTrust = Array.isArray(session.trustInteractions) && session.trustInteractions.length > 0;

          if (novelty > 0.5 || hasTrust || Number(session.impact ?? 0) > 0) {
            for (const dtu of dtus) {
              if ((dtu.sessionId || dtu.session) === session.sessionId && dtu.contributor === entityId) {
                dtu.authority = clamp01((Number(dtu.authority) || 0) + AUTHORITY_BOOST_ON_CONSOLIDATION);
                consolidated++;
              }
            }
            _cappedPush(rec.consolidationLog, {
              type: "session_replay", sessionId: session.sessionId,
              action: "strengthened", novelty, timestamp: nowISO(),
            }, MAX_CONSOLIDATION_LOG);
          }

          // Weak memory pruning
          if (novelty < LOW_NOVELTY_THRESHOLD && session.dtusPromoted === 0) {
            for (const dtu of dtus) {
              if ((dtu.sessionId || dtu.session) === session.sessionId && dtu.contributor === entityId) {
                dtu.authority = clamp01((Number(dtu.authority) || 0) * 0.9);
                pruned++;
              }
            }
            _cappedPush(rec.consolidationLog, {
              type: "weak_memory_prune", sessionId: session.sessionId,
              action: "weakened", novelty, timestamp: nowISO(),
            }, MAX_CONSOLIDATION_LOG);
          }
        } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent per-session', { error: _e?.message }); }
      }
    } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

    // 2. Pattern Crystallization — group sessions by tag overlap > threshold
    try {
      const used = new Set();
      for (let i = 0; i < rec.wakeSessions.length; i++) {
        if (used.has(i)) continue;
        const group = [rec.wakeSessions[i]];
        used.add(i);
        for (let j = i + 1; j < rec.wakeSessions.length; j++) {
          if (used.has(j)) continue;
          if (_tagOverlap(rec.wakeSessions[i].tags, rec.wakeSessions[j].tags) >= TAG_OVERLAP_CRYSTALLIZE) {
            group.push(rec.wakeSessions[j]);
            used.add(j);
          }
        }
        if (group.length >= 2) {
          const mergedTags = [...new Set(group.flatMap(s => s.tags || []))];
          _cappedPush(rec.consolidationLog, {
            type: "pattern_crystallization", sessionIds: group.map(s => s.sessionId),
            tags: mergedTags, strength: group.length, timestamp: nowISO(),
          }, MAX_CONSOLIDATION_LOG);
          patternsFound++;

          // Write pattern to STATE store if available
          try {
            const es = getSTATE()?.__emergent;
            if (es && es.patterns instanceof Map) {
              const pid = uid("pattern");
              es.patterns.set(pid, {
                id: pid, source: "sleep_consolidation", entityId,
                tags: mergedTags, sessions: group.map(s => s.sessionId),
                strength: group.length, createdAt: nowISO(),
              });
            }
          } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }
        }
      }
    } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

    // 3. Trust Consolidation — boost used edges, decay unused
    try {
      const edges = _getTrustEdges();
      if (edges instanceof Map) {
        const usedKeys = new Set(rec.wakeTrustEdges.map(e => e.key));
        for (const [key, edge] of edges) {
          if (!key.includes(entityId)) continue;
          const cur = Number(edge.weight ?? edge.trust ?? 0);
          const delta = usedKeys.has(key) ? TRUST_WAKE_BOOST : -TRUST_UNUSED_DECAY;
          const nw = clamp01(cur + delta);
          if (edge.weight !== undefined) edge.weight = nw;
          if (edge.trust !== undefined) edge.trust = nw;
          trustUpdated++;
        }
      }
    } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

    return { ok: true, consolidated, pruned, trustUpdated, patterns: patternsFound };
  } catch (err) { logger.error('emergent:sleep-consolidation', 'runConsolidation failed', { entityId, error: err?.message }); return { ok: false, error: "consolidation_failed" }; }
}

/**
 * Execute dream synthesis phase. Picks unrelated DTUs from the entity's
 * contributions and attempts to find novel connections between them.
 * @param {string} entityId
 * @returns {{ ok: boolean, dreamsProduced?: number, dreamDTUs?: object[] }}
 */
export function runREMPhase(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };
    if (rec.state !== SLEEP_STATES.REM) return { ok: false, error: "not_in_rem" };

    _metrics.totalREMPhasesRun++;
    const dtus = _getDTUs();
    const mine = dtus.filter(d => d.contributor === entityId || d.author === entityId || d.entityId === entityId);
    if (mine.length < 2) return { ok: true, dreamsProduced: 0, dreamDTUs: [], note: "insufficient_dtus" };

    // Pick DREAM_INPUT_COUNT maximally-unrelated DTUs
    const count = Math.min(DREAM_INPUT_COUNT, mine.length);
    const selected = [];
    const pool = [...mine];

    // First: random seed
    selected.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);

    // Remaining: minimize tag overlap with already-selected
    for (let i = 1; i < count && pool.length > 0; i++) {
      let bestIdx = 0, lowest = Infinity;
      for (let j = 0; j < pool.length; j++) {
        const cTags = pool[j].tags || [];
        let maxOv = 0;
        for (const sel of selected) {
          const ov = _tagOverlap(cTags, sel.tags || []);
          if (ov > maxOv) maxOv = ov;
        }
        if (maxOv < lowest) { lowest = maxOv; bestIdx = j; }
      }
      selected.push(pool.splice(bestIdx, 1)[0]);
    }

    // Compute average pairwise overlap
    let avgOv = 0, pairs = 0;
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        avgOv += _tagOverlap(selected[i].tags || [], selected[j].tags || []);
        pairs++;
      }
    }
    avgOv = pairs > 0 ? avgOv / pairs : 0;

    const dreamDTUs = [];
    const allTags = [...new Set(selected.flatMap(d => d.tags || []))];
    const sourceIds = selected.map(d => d.id || d.dtuId).filter(Boolean);
    const r4 = v => Math.round(v * 10000) / 10000;

    if (avgOv < DREAM_NOVELTY_THRESHOLD) {
      // Novel connection found — create dream DTU
      const dreamId = uid("dream");
      const dreamTags = ["dream", "synthesis", entityId, ...allTags.slice(0, 5)];
      const dreamDTU = {
        id: dreamId, type: "dream_synthesis", tier: DREAM_DTU_TIER,
        authority: DREAM_DTU_AUTHORITY, tags: dreamTags,
        contributor: entityId, entityId, sources: sourceIds,
        content: {
          synthesis: `Dream connection between: ${sourceIds.join(", ")}`,
          inputTags: selected.map(d => (d.tags || []).slice(0, 3)),
          avgPairOverlap: r4(avgOv),
        },
        meta: {
          origin: "sleep_rem", dreamer: entityId, cycle: rec.totalSleepCycles + 1,
          coherence: clamp01(1 - avgOv), entropy: clamp01(avgOv),
        },
        createdAt: nowISO(), needsCouncilApproval: true,
      };
      dreamDTUs.push(dreamDTU);

      // Install into STATE
      try {
        const STATE = getSTATE();
        if (STATE) {
          const store = STATE.dtus instanceof Map ? STATE.dtus : (STATE.__dtus instanceof Map ? STATE.__dtus : null);
          if (store) store.set(dreamId, dreamDTU);
        }
      } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

      _cappedPush(rec.dreamLog, { dreamId, sources: sourceIds, tags: dreamTags, overlap: r4(avgOv), timestamp: nowISO() }, MAX_DREAM_LOG);
      _metrics.totalDreamDTUsCreated++;

      // Hook into qualia system
      try {
        if (typeof globalThis.qualiaHooks?.hookDreamSynthesis === "function") {
          globalThis.qualiaHooks.hookDreamSynthesis(entityId, {
            connections: selected.length, coherence: clamp01(1 - avgOv), entropy: clamp01(avgOv),
          });
        }
      } catch (_e) { logger.debug('emergent:sleep-consolidation', 'silent', { error: _e?.message }); }

      _emit("sleep:dream_produced", { entityId, dreamId, sources: sourceIds, overlap: avgOv, timestamp: nowISO() });
    } else {
      // Too similar — log failed attempt
      _cappedPush(rec.dreamLog, {
        dreamId: null, sources: sourceIds, tags: allTags.slice(0, 5),
        overlap: r4(avgOv), result: "too_similar", timestamp: nowISO(),
      }, MAX_DREAM_LOG);
    }

    return { ok: true, dreamsProduced: dreamDTUs.length, dreamDTUs };
  } catch (err) { logger.error('emergent:sleep-consolidation', 'runREMPhase failed', { entityId, error: err?.message }); return { ok: false, error: "rem_failed" }; }
}

/**
 * Compute the quality of the most recent (or current) sleep cycle.
 * @param {string} entityId
 * @returns {{ ok: boolean, quality?: object }}
 */
export function computeSleepQuality(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return { ok: false, error: "not_initialized" };

    if (rec.state === SLEEP_STATES.SLEEPING || rec.state === SLEEP_STATES.REM || rec.state === SLEEP_STATES.WAKING) {
      return { ok: true, quality: _computeQuality(rec), status: "in_progress" };
    }
    if (rec.lastQuality) return { ok: true, quality: rec.lastQuality, status: "last_completed" };
    return { ok: true, quality: null, status: "no_sleep_yet" };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'computeSleepQuality failed', { entityId, error: err?.message }); return { ok: false, error: "quality_computation_failed" }; }
}

/**
 * Get global sleep system statistics.
 * @returns {object}
 */
export function getSleepMetrics() {
  try {
    const total = _sleepStates.size;
    const dist = { awake: 0, drowsy: 0, sleeping: 0, rem: 0, waking: 0 };
    let fatSum = 0, debtSum = 0, qualSum = 0, qualN = 0;

    for (const [, rec] of _sleepStates) {
      if (dist[rec.state] !== undefined) dist[rec.state]++;
      fatSum += rec.fatigue;
      debtSum += rec.sleepDebt;
      if (rec.lastQuality) { qualSum += rec.lastQuality.overall || 0; qualN++; }
    }

    const r4 = v => Math.round(v * 10000) / 10000;
    return {
      ok: true, totalEntities: total, stateDistribution: dist,
      avgFatigue: total > 0 ? r4(fatSum / total) : 0,
      avgSleepDebt: total > 0 ? r4(debtSum / total) : 0,
      avgSleepQuality: qualN > 0 ? r4(qualSum / qualN) : 0,
      cumulative: { ..._metrics },
    };
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'getSleepMetrics failed', { error: err?.message }); return { ok: false, error: "metrics_failed" }; }
}

/**
 * List all entities currently sleeping (SLEEPING or REM).
 * @returns {object[]}
 */
export function listSleepingEntities() {
  try {
    const r4 = v => Math.round(v * 10000) / 10000;
    const result = [];
    for (const [entityId, rec] of _sleepStates) {
      if (rec.state === SLEEP_STATES.SLEEPING || rec.state === SLEEP_STATES.REM) {
        result.push({
          entityId, state: rec.state, fatigue: r4(rec.fatigue), sleepDebt: r4(rec.sleepDebt),
          sleepDuration: rec.sleepDuration, sleepLength: rec.sleepLength,
          progress: rec.sleepLength > 0 ? r4(rec.ticksSinceSleep / rec.sleepLength) : 0,
          lastSleptAt: rec.lastSleptAt,
          consolidations: rec.consolidationLog.length, dreams: rec.dreamLog.length,
        });
      }
    }
    return result;
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'listSleepingEntities failed', { error: err?.message }); return []; }
}

/**
 * List entities approaching sleep need (DROWSY or high fatigue while AWAKE).
 * @returns {object[]}
 */
export function listDrowsyEntities() {
  try {
    const r4 = v => Math.round(v * 10000) / 10000;
    const result = [];
    for (const [entityId, rec] of _sleepStates) {
      if (rec.state === SLEEP_STATES.DROWSY ||
          (rec.state === SLEEP_STATES.AWAKE && rec.fatigue >= DROWSY_THRESHOLD * 0.8)) {
        result.push({
          entityId, state: rec.state, fatigue: r4(rec.fatigue), sleepDebt: r4(rec.sleepDebt),
          circadianPhase: r4(rec.circadianPhase), ticksSinceWake: rec.ticksSinceWake,
          cycleLength: rec.cycleLength,
          ticksUntilCycle: Math.max(0, rec.cycleLength - rec.ticksSinceWake),
          estimatedSleepIn: rec.fatigue >= DROWSY_THRESHOLD ? "imminent"
            : rec.fatigue >= DROWSY_THRESHOLD * 0.8 ? "soon" : "approaching",
        });
      }
    }
    result.sort((a, b) => b.fatigue - a.fatigue);
    return result;
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'listDrowsyEntities failed', { error: err?.message }); return []; }
}

/**
 * Get sleep cycle history for an entity.
 * @param {string} entityId
 * @param {number} [limit=20]
 * @returns {object[]}
 */
export function getSleepHistory(entityId, limit = 20) {
  try {
    if (!entityId) return [];
    const h = _sleepHistory.get(entityId);
    if (!h || !h.length) return [];
    const cap = Math.max(1, Math.min(MAX_HISTORY, Number(limit) || 20));
    return h.slice(-cap).reverse();
  } catch (err) { logger.warn('emergent:sleep-consolidation', 'getSleepHistory failed', { entityId, error: err?.message }); return []; }
}

/**
 * Quick check: is the entity currently asleep?
 * @param {string} entityId
 * @returns {boolean}
 */
export function isAsleep(entityId) {
  try {
    const rec = _sleepStates.get(entityId);
    if (!rec) return false;
    return rec.state === SLEEP_STATES.SLEEPING || rec.state === SLEEP_STATES.REM || rec.state === SLEEP_STATES.WAKING;
  } catch (err) { logger.debug('emergent:sleep-consolidation', 'isAsleep check failed', { entityId, error: err?.message }); return false; }
}
