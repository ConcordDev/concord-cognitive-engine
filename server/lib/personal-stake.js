// server/lib/personal-stake.js
//
// Legibility Wave 2 — route the systemic through the personal.
//
// A faction war / a resolved scheme is abstract until it touches the player's
// own thread. This resolver asks, for each online player, "does this event pull
// on a stake of YOURS?" — via the signals already computed: faction reputation
// (the faction you've stood with / one that despises you), npc-asymmetry (an NPC
// who holds a grudge against you, or whom you wronged), and forward-sim (a thing
// you foresaw). When the stake clears a threshold it broadcasts ONE enriched
// `world:personal-stake` event tagged `forUserId` (realtimeEmit has no per-user
// room; the client bridge filters), carrying a one-line thread + a diegetic
// anchor position when the event has one. A single stake moment beats a feed row.
//
// Pure-DB + best-effort: every read is guarded; this never throws into a caller.

import { getFactionReputation } from "./faction-reputation.js";

export const STAKE_THRESHOLD = 0.5;
const ALLIED_TIERS = new Set(["friendly", "honored", "exalted"]);
const ENEMY_TIERS = new Set(["hostile", "hated"]);

/**
 * Score one player's stake in an emergent event.
 * @param {object} event { kind, worldId, factionId?, targetFactionId?, npcIds?:string[], schemeKind?, outcome?, worldPos? }
 * @returns {null | { stake, reason, thread, severity, juiceKind, worldPos }}
 */
export function scoreStake(db, event, userId, worldId) {
  if (!db || !userId || !event) return null;
  let stake = 0;
  let thread = null;
  let reason = null;

  // ── Faction tie ──────────────────────────────────────────────────────
  for (const [fid, role] of [[event.factionId, "primary"], [event.targetFactionId, "target"]]) {
    if (!fid) continue;
    try {
      const rep = getFactionReputation(db, userId, fid, worldId);
      if (rep && ALLIED_TIERS.has(rep.tier)) {
        if (stake < 0.6) { stake = 0.6; reason = "faction_ally"; thread = role === "target"
          ? "a faction you've stood with is the target" : "the faction you've stood with is on the move"; }
      } else if (rep && ENEMY_TIERS.has(rep.tier)) {
        if (stake < 0.5) { stake = 0.5; reason = "faction_enemy"; thread = "a faction that despises you is stirring"; }
      }
    } catch { /* rep cache optional */ }
  }

  // ── NPC asymmetry (grudge held against you, by an NPC in this event) ──
  if (Array.isArray(event.npcIds) && event.npcIds.length) {
    try {
      const placeholders = event.npcIds.map(() => "?").join(",");
      const g = db.prepare(`
        SELECT npc_id, narrative FROM npc_grudges
        WHERE target_kind = 'player' AND target_id = ? AND resolved_at IS NULL
          AND npc_id IN (${placeholders}) LIMIT 1
      `).get(userId, ...event.npcIds);
      if (g) { if (stake < 0.55) { stake = 0.55; reason = "npc_grudge"; thread = "one who holds a grudge against you is entangled in it"; } }
    } catch { /* grudges table optional */ }
  }

  // ── Forward-sim (a thing you foresaw — npc OR faction subject) ───────
  const subjects = [...(event.npcIds || []), event.factionId, event.targetFactionId].filter(Boolean);
  if (subjects.length) {
    try {
      const placeholders = subjects.map(() => "?").join(",");
      const p = db.prepare(`
        SELECT anticipated FROM forward_predictions
        WHERE user_id = ? AND realised_at IS NULL AND subject_id IN (${placeholders}) LIMIT 1
      `).get(userId, ...subjects);
      if (p) { stake = Math.min(1, stake + 0.4); if (!thread) { reason = "foreseen"; thread = "something you foresaw is coming to pass"; } }
    } catch { /* predictions optional */ }
  }

  if (stake < STAKE_THRESHOLD) return null;
  const severity = stake >= 0.85 ? "high" : stake >= 0.6 ? "medium" : "low";
  const juiceKind = reason === "faction_enemy" || event.outcome === "complete" ? "failure"
    : reason === "foreseen" ? "milestone" : "discovery";
  return { stake, reason, thread, severity, juiceKind, worldPos: event.worldPos || null };
}

/**
 * For an emergent event, broadcast a personal-stake to each online player it
 * pulls on. event.worldId scopes the candidate set; the client filters forUserId.
 * @returns {number} how many stake events fired
 */
export async function maybeEmitPersonalStake(db, event, emitFn = globalThis._concordRealtimeEmit) {
  if (typeof emitFn !== "function" || !db || !event) return 0;
  // World-scoped events (schemes) scan that world; global events (faction wars —
  // factions aren't per-world) scan all online players, scoring each against
  // their OWN current world's reputation.
  let candidates = []; // [{ userId, worldId }]
  try {
    const cp = await import("./city-presence.js");
    if (event.worldId) {
      candidates = (cp.getUserIdsInWorld?.(event.worldId) || []).map((u) => ({ userId: u, worldId: event.worldId }));
    } else {
      candidates = (cp.getOnlineUserIds?.() || []).map((u) => ({ userId: u, worldId: cp.getUserPosition?.(u)?.worldId || "concordia-hub" }));
    }
  } catch { return 0; }
  let fired = 0;
  for (const { userId, worldId } of candidates) {
    try {
      const s = scoreStake(db, event, userId, worldId);
      if (s) {
        emitFn("world:personal-stake", {
          forUserId: userId,
          kind: event.kind,
          headline: event.headline || null,
          thread: s.thread,
          reason: s.reason,
          severity: s.severity,
          juiceKind: s.juiceKind,
          worldPos: s.worldPos,
        });
        fired++;
      }
    } catch { /* per-user best-effort */ }
  }
  return fired;
}
