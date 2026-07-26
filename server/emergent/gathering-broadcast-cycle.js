// server/emergent/gathering-broadcast-cycle.js
//
// V1.2 Wave A ("Society & Presence") — spontaneous gathering broadcast.
//
// The real detection logic already exists: `spontaneousGatherings()`
// (server/lib/city-presence.js) clusters the world's LIVE, server-tracked
// player positions into `cellSize`-metre cells and returns any cell with
// >= minCount co-located players, honest-empty when nobody's clustered
// (contract-tested at server/tests/spontaneous-gatherings.test.js). It is
// already reachable via the `world.gatherings` macro (server.js) and
// rendered by `EventsGatherings.tsx` — but only as a PULL: the panel calls
// the macro once on mount and never again, so nothing tells a player who
// ISN'T looking at that panel "hey, people are actually gathering near you
// right now."
//
// This module is the missing PUSH half, following the exact wire-a-real-
// heartbeat + broadcast shape `sovereign-manifestation-cycle.js` and
// `aerial-traffic-cycle.js` already established this session: lazy-import
// the real engine, run it on a schedule, broadcast ONLY a genuine result to
// the world's own room, never fabricate activity. It does not replace the
// pull-based macro (a client that wants a snapshot on demand still gets
// one) — it adds the missing ambient "this is happening near you" signal.
//
// This is intentionally NOT folded into the formal `world_events` system
// (server/lib/world-events.js / world-event-scheduler.js): that system is
// scheduled, ceremonial (RSVP, entry fees, host NPC, DTU-generating
// rewards) and exists to author "a concert starts at 7pm." A spontaneous
// gathering has no host, no schedule, no economy — it is just "N real
// players happen to be standing in the same place right now," which
// dissolves the moment they walk away. Bolting that onto `world_events`
// would mean inventing a fake host/RSVP/reward shape for something that
// has none of those properties by nature (scope discipline: this unit adds
// no reward/DTU/economy hooks of its own).
//
// ── Cadence + dedup ──────────────────────────────────────────────────────
// Frequency 4 (~1 min at 15s ticks) — frequent enough that "people are here
// right now" reads as live, cheap enough that scanning the in-memory
// presence map every minute is a non-issue (spontaneousGatherings is a pure
// in-memory scan, no DB I/O). A gathering's id is deterministic per
// (worldId, cell) — see spontaneousGatherings' `gather_${worldId}_${cx}:${cz}`
// — so the same physical cluster re-detected on consecutive passes would
// spam the room without a cooldown; REBROADCAST_COOLDOWN_MS (default 3 min,
// same order as sovereign-manifestation-cycle's 5 min gate) throttles
// repeat broadcasts of a STILL-ACTIVE gathering. The per-world cooldown map
// is pruned to only the gathering ids currently detected on each pass, so a
// gathering that dissolves (players scatter) and later reforms at the same
// cell is treated as new — never blocked by a stale timestamp from a
// cluster that no longer exists.
//
// ── Scope: 'global', not 'world' ─────────────────────────────────────────
// Same reasoning as aerial-traffic-cycle.js: the handler discovers every
// active world itself (spontaneousGatherings scans the whole in-memory
// presence map, not a single shard's slice) — marking this 'world' would
// re-run the same worlds once per active shard once CONCORD_SHARD_WORLDS is
// enabled. Set at the registration site in server.js.
//
// Kill-switch: CONCORD_GATHERING_DETECTOR=0. Never throws — every path
// returns a plain { ok, ... } object per the heartbeat invariant.

import logger from "../logger.js";
import { spontaneousGatherings } from "../lib/city-presence.js";

const MAX_WORLDS_PER_PASS = 8;

/** Design dials — grep-able, env-overridable, matches the Phase-D "first-draft constants" convention. */
export const GATHERING_MIN_COUNT = Number(process.env.CONCORD_GATHERING_MIN_COUNT) || 3;
export const GATHERING_CELL_SIZE_M = Number(process.env.CONCORD_GATHERING_CELL_SIZE_M) || 50;
export const REBROADCAST_COOLDOWN_MS = Number(process.env.CONCORD_GATHERING_COOLDOWN_MS) || 3 * 60 * 1000;

/**
 * Discover worlds with real recent activity. Mirrors aerial-traffic-cycle's
 * discoverActiveWorlds exactly (same fallback chain, same honest-empty on a
 * minimal build missing either table) so both cycles agree on "which worlds
 * are alive right now" without a shared DB round-trip.
 */
function discoverActiveWorlds(db) {
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT ?
    `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
  } catch { /* world_visits optional — honest empty below */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0
        LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch { /* world_npcs optional too */ }
  }
  return worlds;
}

/**
 * Given the current real gatherings for one world and that world's
 * previously-broadcast cooldown map, decide which gatherings are due for a
 * (re)broadcast right now. Pure function — no I/O, no clock beyond the
 * caller-supplied `nowMs` — so it's independently unit-testable without
 * standing up presence state or a heartbeat.
 *
 * Mutates nothing; returns a NEW cooldown map plus the subset of
 * `gatherings` that should be broadcast.
 *
 * @param {Array<{id:string, location:string, playerCount:number, description:string}>} gatherings
 * @param {Map<string, number>} prevCooldowns - gatheringId -> lastBroadcastAtMs
 * @param {number} nowMs
 * @returns {{ cooldowns: Map<string, number>, due: Array }}
 */
export function selectDueGatherings(gatherings, prevCooldowns, nowMs) {
  const list = Array.isArray(gatherings) ? gatherings : [];
  const prev = prevCooldowns instanceof Map ? prevCooldowns : new Map();
  const currentIds = new Set(list.map((g) => g.id));

  // Honest hygiene: drop cooldown entries for gatherings that are no longer
  // detected (they dissolved) so a future re-formation at the same cell is
  // never throttled by a stale timestamp from a cluster that no longer
  // exists.
  const cooldowns = new Map();
  for (const [id, ts] of prev) {
    if (currentIds.has(id)) cooldowns.set(id, ts);
  }

  const due = [];
  for (const g of list) {
    // Sentinel: a gathering never seen before (no cooldown entry yet) must
    // be due immediately regardless of the current clock value — using `0`
    // here would wrongly read as "broadcast at the Unix epoch," which is
    // only "long enough ago" when `nowMs` is a real wall-clock timestamp.
    // -Infinity makes "never broadcast" honestly always-due.
    const lastAt = cooldowns.has(g.id) ? cooldowns.get(g.id) : -Infinity;
    if (nowMs - lastAt < REBROADCAST_COOLDOWN_MS) continue;
    cooldowns.set(g.id, nowMs);
    due.push(g);
  }

  return { cooldowns, due };
}

export async function runGatheringBroadcastCycle({ db, state, io } = {}) {
  if (process.env.CONCORD_GATHERING_DETECTOR === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  if (!state) return { ok: false, reason: "no_state" };

  if (!(state.gatheringBroadcast instanceof Map)) state.gatheringBroadcast = new Map();

  const nowMs = Date.now();
  const worlds = discoverActiveWorlds(db);
  if (worlds.length === 0) return { ok: true, worldsTouched: 0, reason: "no_active_worlds" };

  const totals = { ok: true, worldsTouched: 0, worldsBroadcast: 0, gatheringsDetected: 0, gatheringsBroadcast: 0 };

  for (const worldId of worlds) {
    try {
      totals.worldsTouched++;

      let gatherings = [];
      try {
        gatherings = spontaneousGatherings(worldId, {
          cellSize: GATHERING_CELL_SIZE_M,
          minCount: GATHERING_MIN_COUNT,
        });
      } catch { /* honest empty — never fabricate a gathering on a read failure */ }

      totals.gatheringsDetected += Array.isArray(gatherings) ? gatherings.length : 0;

      // Honest-empty: nobody's actually clustered here right now — the
      // correct, expected state most passes. Nothing to broadcast.
      if (!Array.isArray(gatherings) || gatherings.length === 0) {
        // Still prune any stale per-world cooldown state so a dissolved
        // gathering doesn't linger in memory forever.
        if (state.gatheringBroadcast.has(worldId)) state.gatheringBroadcast.delete(worldId);
        continue;
      }

      const prevCooldowns = state.gatheringBroadcast.get(worldId) || new Map();
      const { cooldowns, due } = selectDueGatherings(gatherings, prevCooldowns, nowMs);
      state.gatheringBroadcast.set(worldId, cooldowns);

      if (due.length === 0) continue;
      totals.gatheringsBroadcast += due.length;

      const payload = { worldId, gatherings: due };

      // Route through the Godot mirror when available — same DET-C-era
      // pattern aerial-traffic-cycle.js adopted (docs/GODOT_PROTOCOL.md
      // §4/§7): prefer the injected world-room emitter (fans out to BOTH
      // socket.io and any connected Godot client) over a raw `io.to()` call
      // that would only reach the web client. Both paths target the
      // `world:<id>` room ONLY — never a global broadcast — so a gathering
      // in one world is never leaked to players in a different world.
      const emitWorld = globalThis._concordEmitToWorld;
      let emitted = false;
      if (typeof emitWorld === "function") {
        const r = emitWorld(worldId, "world:gathering-detected", payload);
        emitted = !!r?.ok;
      } else if (io) {
        try {
          io.to(`world:${worldId}`).emit("world:gathering-detected", payload);
          emitted = true;
        } catch { /* realtime emit is best-effort — never blocks the tick */ }
      }
      if (emitted) totals.worldsBroadcast++;
    } catch (err) {
      // One world's failure must never stop the pass for the others, or the
      // tick itself (heartbeat invariant) — same posture as
      // aerial-traffic-cycle.js's per-world try/catch.
      try {
        logger?.warn?.("gathering-broadcast-cycle", "world_failed", { worldId, error: err?.message });
      } catch { /* logging best-effort */ }
    }
  }

  return totals;
}

export default { runGatheringBroadcastCycle, selectDueGatherings, GATHERING_MIN_COUNT, GATHERING_CELL_SIZE_M, REBROADCAST_COOLDOWN_MS };
