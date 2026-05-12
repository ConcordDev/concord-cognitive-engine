/**
 * LOAF II.1 — Event-Sourced Cognition Bus + LOAF II.3 — Deterministic Replay Engine
 *
 * All cognition emits events:
 *   episode_recorded, transfer_extracted, world_update_proposed,
 *   dispute_opened, dispute_resolved, council_vote,
 *   reward_issued, thread_scheduled, thread_terminated
 *
 * Supports deterministic replay + sharding.
 *
 * Replay Engine:
 * Given: event stream, seed, model version
 * Replay: decisions, transfers, attention scheduling, learning updates
 */

import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

const EVENT_TYPES = Object.freeze([
  "episode_recorded",
  "transfer_extracted",
  "world_update_proposed",
  "dispute_opened",
  "dispute_resolved",
  "council_vote",
  "reward_issued",
  "thread_scheduled",
  "thread_terminated",
  "gate_checked",
  "budget_consumed",
  "provenance_validated",
  "quarantine_added",
  "quarantine_released",
  "contribution_tracked",
  "reflection_assessed",
  "strategy_updated",
  "skill_compiled",
  "sandbox_created",
  "federation_exported",
  "federation_imported",
  "epistemic_classified",
  "reality_check",
  "normative_applied",
  "drift_detected",
  "timeline_forked",
  "causality_updated",
]);

// Event log (append-only)
const eventLog = [];
const MAX_LOG_SIZE = 100000;

// Subscribers
const subscribers = new LruMap(); // eventType -> Set<callback>

// Sequence counter for deterministic ordering
let sequence = 0;

/**
 * Emit a cognition event to the bus.
 * All events are appended to the log and dispatched to subscribers.
 */
function emit(type, payload = {}, meta = {}) {
  if (!EVENT_TYPES.includes(type) && !type.startsWith("custom.")) {
    // Allow custom events but track unknown types
    meta._unknownType = true;
  }

  const event = {
    seq: ++sequence,
    type,
    payload,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
    meta: {
      ...meta,
      actorId: meta.actorId || null,
      sessionId: meta.sessionId || null,
      shard: meta.shard || null,
    },
  };

  // Append to log
  eventLog.push(event);

  // Trim if too large (keep recent events)
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.splice(0, eventLog.length - MAX_LOG_SIZE);
  }

  // Dispatch to subscribers
  const typeSubscribers = subscribers.get(type);
  if (typeSubscribers) {
    for (const cb of typeSubscribers) {
      try { cb(event); } catch (_e) { logger.debug('cognition-bus', 'subscriber errors don\'t break the bus', { error: _e?.message }); }
    }
  }

  // Dispatch to wildcard subscribers
  const wildcardSubscribers = subscribers.get("*");
  if (wildcardSubscribers) {
    for (const cb of wildcardSubscribers) {
      try { cb(event); } catch (_e) { logger.debug('cognition-bus', 'subscriber errors don\'t break the bus', { error: _e?.message }); }
    }
  }

  return event;
}

/**
 * Subscribe to events on the bus.
 * @param {string} type - Event type or "*" for all events
 * @param {Function} callback - Called with event object
 * @returns {Function} unsubscribe function
 */
function subscribe(type, callback) {
  if (!subscribers.has(type)) {
    subscribers.set(type, new Set());
  }
  subscribers.get(type).add(callback);

  return () => {
    const subs = subscribers.get(type);
    if (subs) subs.delete(callback);
  };
}

/**
 * Query the event log with filters.
 */
function queryEvents({ type, since, until, actorId, sessionId, shard, limit = 100, offset = 0 } = {}) {
  let results = eventLog;

  if (type) results = results.filter(e => e.type === type);
  if (since) results = results.filter(e => e.ts >= since);
  if (until) results = results.filter(e => e.ts <= until);
  if (actorId) results = results.filter(e => e.meta.actorId === actorId);
  if (sessionId) results = results.filter(e => e.meta.sessionId === sessionId);
  if (shard) results = results.filter(e => e.meta.shard === shard);

  const total = results.length;
  results = results.slice(offset, offset + limit);

  return { events: results, total, offset, limit };
}

/**
 * Get event log snapshot for replay.
 */
function getSnapshot(fromSeq = 0, toSeq = Infinity) {
  return eventLog.filter(e => e.seq >= fromSeq && e.seq <= toSeq);
}

// ===== DETERMINISTIC REPLAY ENGINE =====

/**
 * Create a replay context from an event stream snapshot.
 * Given: event stream, seed, model version
 * Produces: deterministic replay of decisions
 */
function createReplayContext(events, seed, modelVersion) {
  // Simple PRNG for deterministic randomness
  let rngState = hashSeed(seed);
  function nextRandom() {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  }

  return {
    events: [...events],
    seed,
    modelVersion: String(modelVersion || "1.0"),
    cursor: 0,
    decisions: [],
    nextRandom,
    getState: function () {
      return {
        cursor: this.cursor,
        totalEvents: this.events.length,
        decisionsCount: this.decisions.length,
        progress: this.events.length > 0 ? this.cursor / this.events.length : 1,
      };
    },
  };
}

/**
 * Replay a single step in the context.
 */
function replayStep(ctx) {
  if (ctx.cursor >= ctx.events.length) {
    return { done: true, cursor: ctx.cursor };
  }

  const event = ctx.events[ctx.cursor];
  ctx.cursor++;

  // Reconstruct decision based on event type
  const decision = {
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    replayedAt: new Date().toISOString(),
    deterministic: true,
  };

  // Apply deterministic replay logic based on event type
  switch (event.type) {
    case "episode_recorded":
      decision.action = "record_learning";
      decision.data = { episode: event.payload };
      break;
    case "transfer_extracted":
      decision.action = "extract_transfer";
      decision.data = { pattern: event.payload };
      break;
    case "council_vote":
      decision.action = "tally_vote";
      decision.data = { vote: event.payload };
      break;
    case "thread_scheduled":
      decision.action = "schedule_thread";
      decision.data = { thread: event.payload };
      break;
    case "strategy_updated":
      decision.action = "update_strategy";
      decision.data = { strategy: event.payload };
      break;
    default:
      decision.action = "passthrough";
      decision.data = event.payload;
  }

  ctx.decisions.push(decision);
  return { done: false, decision, cursor: ctx.cursor };
}

/**
 * Replay all events in the context.
 */
function replayAll(ctx) {
  const decisions = [];
  while (ctx.cursor < ctx.events.length) {
    const result = replayStep(ctx);
    if (result.done) break;
    decisions.push(result.decision);
  }
  return {
    ok: true,
    decisions,
    totalReplayed: decisions.length,
    seed: ctx.seed,
    modelVersion: ctx.modelVersion,
  };
}

function hashSeed(seed) {
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.cognitionBus = {
    stats: { eventsEmitted: 0, subscriberCount: 0, replaysRun: 0, queriesRun: 0 },
  };

  register("loaf.bus", "status", (ctx) => {
    const cb = ctx.state.__loaf.cognitionBus;
    return {
      ok: true,
      eventLogSize: eventLog.length,
      currentSequence: sequence,
      eventTypes: EVENT_TYPES,
      subscriberCount: Array.from(subscribers.values()).reduce((s, set) => s + set.size, 0),
      stats: cb.stats,
    };
  }, { public: true });

  register("loaf.bus", "emit", (ctx, input = {}) => {
    const cb = ctx.state.__loaf.cognitionBus;
    const event = emit(String(input.type || "custom.event"), input.payload || {}, {
      actorId: ctx.actor?.id, sessionId: input.sessionId, shard: input.shard, ...input.meta,
    });
    cb.stats.eventsEmitted++;
    return { ok: true, event };
  }, { public: false });

  register("loaf.bus", "query", (ctx, input = {}) => {
    const cb = ctx.state.__loaf.cognitionBus;
    cb.stats.queriesRun++;
    return { ok: true, ...queryEvents(input) };
  }, { public: true });

  register("loaf.bus", "snapshot", (_ctx, input = {}) => {
    const events = getSnapshot(Number(input.fromSeq || 0), Number(input.toSeq || Infinity));
    return { ok: true, events, count: events.length };
  }, { public: true });

  register("loaf.bus", "replay", (ctx, input = {}) => {
    const cb = ctx.state.__loaf.cognitionBus;
    const events = input.events || getSnapshot(Number(input.fromSeq || 0), Number(input.toSeq || Infinity));
    const replayCtx = createReplayContext(events, input.seed || "default", input.modelVersion);
    const result = replayAll(replayCtx);
    cb.stats.replaysRun++;
    return result;
  }, { public: false });
}

export {
  EVENT_TYPES,
  emit,
  subscribe,
  queryEvents,
  getSnapshot,
  createReplayContext,
  replayStep,
  replayAll,
  init,
};
