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
import { EventEmitter } from "node:events";

// The taxonomy from the master spec §9. Not enforced (publishing an
// unlisted event name still works — closed taxonomies rot fast in a
// 260-lens codebase) but kept here as the canonical reference list.
export const KNOWN_EVENTS = [
  "prediction.created", "prediction.resolved",
  "experiment.started", "experiment.completed",
  "finding.created", "finding.validated",
  "dtu.created", "dtu.revised",
  "market.observed", "trade.executed", "trade.resolved",
  "agent.task.created", "agent.task.completed",
  "capability.invoked", "capability.completed", "capability.failed",
  "capability.promoted", "capability.rejected",
  "constellation.observed",
];

const bus = new EventEmitter();
bus.setMaxListeners(100); // generous — many domains may subscribe to a shared event

// Bounded in-memory recent-event ring, for the /api/runtime/events/recent
// observability surface (self-health §11's "the Runtime should continuously
// know" applies to its own event traffic too, not just subsystem status).
const RECENT_MAX = 500;
let recent = [];

/**
 * Publish an event. Fire-and-forget from the publisher's point of view — a
 * subscriber's error is caught and logged to the recent-event ring as a
 * `bus.listener_error` meta-event, never thrown back at the publisher.
 * @param {string} name  e.g. "prediction.created" — any string works, KNOWN_EVENTS is documentation, not a gate.
 * @param {object} [payload]
 */
export function publish(name, payload = {}) {
  const envelope = { name, payload, ts: Date.now() };
  recent.push(envelope);
  if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);
  try {
    bus.emit(name, envelope);
    bus.emit("*", envelope); // wildcard subscribers (e.g. the observability route)
  } catch (err) {
    // EventEmitter.emit itself only throws for the special 'error' event
    // with no listener — this catch is defense-in-depth, not the normal path.
    try {
      recent.push({ name: "bus.emit_error", payload: { originalEvent: name, error: err?.message }, ts: Date.now() });
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
        recent.push({ name: "bus.listener_error", payload: { originalEvent: name, error: err?.message }, ts: Date.now() });
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

/** @internal Test-only. */
export function _reset() {
  bus.removeAllListeners();
  recent = [];
}
