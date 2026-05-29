// server/lib/achievement-bridge.js
//
// Phase U2 — connects the achievement engine to the realtime event bus.
//
// The bridge intercepts realtimeEmit() and, for any of the high-signal
// events the catalog cares about, dispatches into evaluateAchievement.
// This is wrapping rather than replacing — every event still flows to
// Socket.IO, but a copy lands at the achievement engine first.
//
// Engineered as a wrapper around the parent process's realtimeEmit so
// shard workers (Phase I) automatically benefit — workers post emits
// back to the parent which then routes through this bridge.

import { evaluateAchievement } from "./achievement-engine.js";
import { recordObjectiveProgressFromEvent } from "./weekly-objectives.js";

const RELEVANT_EVENTS = new Set([
  "combat:hit",
  "combat:kill",
  "combat:flawless-victory",
  "boss:defeated",
  "tournament:complete",
  "dtu:created",
  "dtu:promoted",
  "marketplace:sold",
  "auction:settled",
  "user:traveled",
  "world:fog-rescue",
  "friend:request-accepted",
  "party:full",
  "marriage:ceremony",
  "quest:completed",
  "disease:cured",
  "plague:resolved",
  "skill:evolved",
  "resident:deployed",
]);

let _dbRef = null;

/** Initialise the bridge. Subsequent realtimeEmit calls auto-evaluate. */
export function initAchievementBridge(db) {
  _dbRef = db;
}

/**
 * Hook called by `realtimeEmit` for every event. Cheap fast-path filter
 * + extract userId(s) from the payload, dispatch.
 */
export function bridgeRealtimeEvent(eventKind, payload = {}) {
  if (!_dbRef) return;
  if (!RELEVANT_EVENTS.has(eventKind)) return;
  // Most events name the actor via one of these conventional keys.
  const userIds = _extractUserIds(eventKind, payload);
  for (const userId of userIds) {
    try {
      evaluateAchievement(_dbRef, userId, eventKind, payload);
    } catch { /* dispatch best-effort */ }
    // D2 — the same real events drive the weekly objective chain.
    try {
      recordObjectiveProgressFromEvent(_dbRef, userId, eventKind);
    } catch { /* dispatch best-effort */ }
  }
}

function _extractUserIds(eventKind, payload) {
  const ids = new Set();
  // Direct keys.
  for (const k of ["userId", "playerId", "killerId", "attackerId", "sellerId", "buyerId", "creatorId"]) {
    if (payload[k]) ids.add(payload[k]);
  }
  // combat:kill — the killer is the unlocker.
  if (eventKind === "combat:kill" && payload.killer) ids.add(payload.killer);
  if (eventKind === "combat:kill" && typeof payload.killer === "object") ids.add(payload.killer?.id);
  // tournament:complete — placement payouts have an array of winners.
  if (eventKind === "tournament:complete" && Array.isArray(payload.payouts)) {
    for (const p of payload.payouts) ids.add(p.userId);
  }
  // marriage:ceremony — both partners count.
  if (eventKind === "marriage:ceremony") {
    if (payload.partnerAId) ids.add(payload.partnerAId);
    if (payload.partnerBId) ids.add(payload.partnerBId);
  }
  // friend:request-accepted — emit names both sides; the engine credits
  // only the acceptor since that's who actually completed the loop.
  if (eventKind === "friend:request-accepted" && payload.acceptedBy) {
    ids.clear(); ids.add(payload.acceptedBy);
  }
  ids.delete(null); ids.delete(undefined); ids.delete("");
  return [...ids];
}
