// server/lib/runtime/event-bus.js
//
// Concord Runtime — Event Bus (docs/CONCORD_RUNTIME_MASTER_SPEC.md §9).
// A typed pub/sub so domains can react to each other without hard-coding
// integrations (Dila -> Predict -> Pentester -> DTU -> Zuko -> Trading ->
// Concordia becoming spaghetti is exactly what this exists to prevent).
//
// Deliberately NOT socket.io/realtimeEmit — this is an IN-PROCESS bus for
// server-side capability orchestration, distinct from the existing
// user-facing realtime layer. A handler that wants to also notify a
// connected browser still calls realtimeEmit itself; this bus is one more
// input to that decision, not a replacement for it.
//
// Built on Node's own EventEmitter — no new dependency, and EventEmitter
// already gives synchronous fan-out with per-listener error isolation
// concerns handled the standard way (a throwing listener does not stop
// the others in Node's dispatch loop, but see the try/catch below anyway
// — publish() must NEVER let a subscriber's bug break the publisher).
//
// ── Enforcement, added 2026-09-13 (audit finding) ───────────────────────
// This file used to describe itself as "not enforced — closed taxonomies
// rot fast in a 260-lens codebase," and left it at that. That's the right
// call for REJECTING unknown events (never do that — see below), but it
// left the taxonomy purely aspirational: publish() accepted any string
// with no shape and no record of what was actually flowing, which is
// exactly the "not yet as self-describing as the DTU topology" gap a
// full-Concord cross-lens audit named. Two additions close it without
// touching the original design's core promise (publish() still never
// throws, never blocks, never rejects an unlisted event name):
//   1. EVENT_SCHEMAS + registerEventType() — an OPT-IN shape a domain can
//      attach to an event name. publish() validates against it when one
//      exists and records a `bus.shape_violation` meta-event on mismatch
//      (same non-blocking pattern as the existing bus.listener_error) —
//      never rejects the publish.
//   2. unregisteredEventStats() — every event name published that has NO
//      schema attached is now counted (not silently invisible), so the
//      taxonomy can grow from observed real usage instead of guesswork.
import { EventEmitter } from "node:events";

// The taxonomy from the master spec §9. Not a gate — publishing an
// unlisted event name still works, and always will (closed taxonomies rot
// fast in a 260-lens codebase). What changed is that unlisted usage is now
// COUNTED (see unregisteredEventStats) instead of invisible.
export const KNOWN_EVENTS = [
  "prediction.created", "prediction.resolved",
  "experiment.started", "experiment.completed",
  "finding.created", "finding.validated",
  "dtu.created", "dtu.updated", "dtu.composted",
  "market.observed", "trade.executed", "trade.resolved",
  "agent.task.created", "agent.task.completed",
  "capability.invoked", "capability.completed", "capability.failed",
  "capability.promoted", "capability.rejected",
  "constellation.observed",
  "item.crafted",
  "marketplace.purchased",
  "achievement.unlocked",
  "royalty.paid",
  "dtu.cited",
  "auction.settled",
  "quest.reward_granted",
];

// Opt-in payload shapes, keyed by event name. { required: string[] }.
// A schema here does NOT make the event name reserved or exclusive — it
// only means publish() will flag a payload missing one of these fields.
// Seeded with the events this repo already has real producers for;
// registerEventType() lets any domain add its own without editing this
// file (the same "don't force a closed taxonomy" reasoning as KNOWN_EVENTS,
// applied to shapes instead of names).
// Every entry below is evidence-based — checked against this event
// name's actual real caller(s) at the time it was added, not guessed from
// the name. Two lessons from doing that check (2026-09-13): a first draft
// of this map required "id" on finding.created/trade.executed because
// that felt like the obvious shape — neither real caller actually sends
// an "id" field, which would have made this map itself the thing
// generating false-positive violations on day one. And agent.task.created
// / agent.task.completed are deliberately ABSENT here: mission-runtime.js
// and dila.js both publish agent.task.completed with entirely different
// shapes (one mission-tracking, one a bare status ping) — there is no
// honest common required field to assert, so this stays undocumented
// (KNOWN_EVENTS-only) rather than papering over the inconsistency.
const EVENT_SCHEMAS = new Map([
  ["prediction.created", { required: ["id"] }],           // domains/predict.js
  ["prediction.resolved", { required: ["id"] }],          // domains/predict.js
  ["finding.created", { required: ["kind"] }],             // domains/predict.js + lib/runtime/pentester-control.js — the only field both real callers share
  ["trade.executed", { required: ["venue"] }],             // lib/runtime/trading-observe.js
  ["trade.resolved", { required: ["venue"] }],             // lib/runtime/trading-observe.js
  ["capability.invoked", { required: ["capability"] }],    // lib/runtime/execution-envelope.js
  ["capability.completed", { required: ["capability"] }],  // lib/runtime/execution-envelope.js
  ["capability.failed", { required: ["capability"] }],     // lib/runtime/execution-envelope.js
  ["capability.promoted", { required: ["capability"] }],   // domains/predict.js
  ["capability.rejected", { required: ["capability"] }],   // domains/predict.js
  ["item.crafted", { required: ["userId", "dtuId"] }],     // lib/crafting/craft-engine.js — added alongside this schema, see that file
  ["dtu.created", { required: ["id"] }],                    // server.js's ConcordEventBus, bridged — see the "Concord Runtime bridge" comment near `const eventBus = new ConcordEventBus()`
  ["dtu.updated", { required: ["id"] }],                    // same bridge
  ["dtu.composted", { required: ["id"] }],                  // same bridge
  ["marketplace.purchased", { required: ["dtuId", "price"] }], // server.js's marketplace.purchaseWithRoyalties macro
  ["achievement.unlocked", { required: ["userId", "achievementId"] }], // lib/achievement-engine.js's unlockAchievement
  ["royalty.paid", { required: ["recipientId", "amount"] }],           // economy/royalty-cascade.js's distributeRoyalties
  ["dtu.cited", { required: ["parentCreatorId", "childId", "parentId"] }], // economy/royalty-cascade.js's registerCitation, new-citation-only
  ["auction.settled", { required: ["auctionId", "winningBidCc"] }],    // lib/auctions.js's settleAuction, sold-only (not the no-bid expiry branch)
  ["quest.reward_granted", { required: ["userId", "questId"] }],       // lib/quest-rewards.js's grantQuestRewards, non-empty-reward-only
]);

/**
 * Attach (or replace) a payload shape for an event name. Additive by
 * design — any domain can call this for its own events; it never needs to
 * touch this file. Malformed input is ignored, never thrown (registration
 * must be as safe as publish()).
 * @param {string} name
 * @param {{required?: string[]}} schema
 */
export function registerEventType(name, schema) {
  if (typeof name !== "string" || !name) return;
  const required = Array.isArray(schema?.required) ? schema.required.filter((k) => typeof k === "string") : [];
  EVENT_SCHEMAS.set(name, { required });
}

const bus = new EventEmitter();
bus.setMaxListeners(100); // generous — many domains may subscribe to a shared event

// Bounded in-memory recent-event ring, for the /api/runtime/events/recent
// observability surface (self-health §11's "the Runtime should continuously
// know" applies to its own event traffic too, not just subsystem status).
const RECENT_MAX = 500;
let recent = [];

// Unregistered-event-name tally — event names published with no
// EVENT_SCHEMAS entry, so the taxonomy's real-world coverage is
// observable rather than assumed. Unbounded key count is an accepted
// tradeoff here (event NAMES are a small, low-cardinality set by nature —
// unlike user IDs — so this cannot become a memory leak vector the way an
// per-payload cache would).
const unregisteredCounts = new Map();

function _recordMeta(name, payload) {
  recent.push({ name, payload, ts: Date.now() });
  if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);
}

/**
 * Publish an event. Fire-and-forget from the publisher's point of view — a
 * subscriber's error is caught and logged to the recent-event ring as a
 * `bus.listener_error` meta-event, never thrown back at the publisher. A
 * registered schema violation is similarly recorded as `bus.shape_violation`
 * and never blocks delivery — see the module header for why enforcement
 * here means "observable," not "rejecting."
 * @param {string} name  e.g. "prediction.created" — any string works, KNOWN_EVENTS is documentation, not a gate.
 * @param {object} [payload]
 */
export function publish(name, payload = {}) {
  const envelope = { name, payload, ts: Date.now() };
  recent.push(envelope);
  if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);

  try {
    const schema = EVENT_SCHEMAS.get(name);
    if (!schema) {
      unregisteredCounts.set(name, (unregisteredCounts.get(name) || 0) + 1);
    } else {
      const provided = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
      const missing = schema.required.filter((k) => !(k in provided));
      if (missing.length > 0) {
        _recordMeta("bus.shape_violation", { originalEvent: name, missing });
      }
    }
  } catch { /* validation must never block a publish */ }

  try {
    bus.emit(name, envelope);
    bus.emit("*", envelope); // wildcard subscribers (e.g. the observability route)
  } catch (err) {
    // EventEmitter.emit itself only throws for the special 'error' event
    // with no listener — this catch is defense-in-depth, not the normal path.
    try {
      _recordMeta("bus.emit_error", { originalEvent: name, error: err?.message });
    } catch { /* ring update must never throw */ }
  }
}

/**
 * Subscribe to an event by exact name, or "*" for every event.
 * @param {string} name
 * @param {(envelope: {name:string, payload:object, ts:number}) => void} listener
 * @returns {() => void} unsubscribe function
 */
export function subscribe(name, listener) {
  const wrapped = (envelope) => {
    try {
      listener(envelope);
    } catch (err) {
      // A subscriber's own bug must never propagate back to the publisher
      // or take down other subscribers of the same event.
      try {
        _recordMeta("bus.listener_error", { originalEvent: name, error: err?.message });
      } catch { /* ring update must never throw */ }
    }
  };
  bus.on(name, wrapped);
  return () => bus.off(name, wrapped);
}

/** @param {number} [limit] @returns recent events, newest first */
export function recentEvents(limit = 100) {
  return recent.slice(-limit).reverse();
}

/**
 * Event names published with no EVENT_SCHEMAS entry, most-frequent first.
 * The taxonomy-growth signal: a name showing up here repeatedly is a real
 * candidate for registerEventType(), grounded in actual usage rather than
 * a guess at what "should" be in KNOWN_EVENTS.
 * @param {number} [limit]
 * @returns {Array<{name: string, count: number}>}
 */
export function unregisteredEventStats(limit = 50) {
  return [...unregisteredCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** @internal Test-only. */
export function _reset() {
  bus.removeAllListeners();
  recent = [];
  unregisteredCounts.clear();
}
