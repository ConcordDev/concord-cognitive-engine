// server/emergent/aerial-traffic-cycle.js
//
// C16 — ambient aerial traffic ("non-empty sky"). A small, real,
// server-scheduled population of background air entities (see
// server/lib/aerial-traffic.js's header for the full design rationale:
// route sourcing, flavor grounding, altitude/speed dials). This module is
// the thin heartbeat wrapper — all the pure math lives in the lib file,
// following the same split every other cycle in this directory uses
// (lattice-quest-cycle.js → lattice-quest-composer.js,
// creature-flock-cycle.js → creature-behaviors.js,
// npc-conversation-initiator.js → npc-dialogue.js).
//
// ── Two cadences inside one heartbeat ───────────────────────────────────
// The governor tick's finest grain is 15s (CLAUDE.md "Heartbeat tick (every
// 15s)"). Position broadcasts run every due tick (frequency: 1, the
// tightest cadence the scheduler offers — same as `refusal-field-sweep`)
// so the Godot-side SnapshotBuffer (world-lens-godot/net/snapshot_buffer.gd,
// reused UNMODIFIED — see world-lens-godot/world/aerial_traffic_controller.gd)
// has real, frequent samples to interpolate between. Actually SPAWNING a
// new entity is gated separately, internally, to roughly every
// SPAWN_CHECK_INTERVAL_MS (~3 min, inside the task brief's ~2-5 min
// guidance) via a stored `lastSpawnAttemptAt` wall-clock timestamp — the
// same pattern `sovereign-manifestation-cycle.js` uses for its own
// `raid._lastManifestAt` gate. This is not a mismatch: "broadcast
// positions often, change the population rarely" is the correct shape for
// background traffic that should feel alive without ever flooding the sky.
//
// ── Honest interpolation-smoothness caveat ──────────────────────────────
// SnapshotBuffer's RENDER_DELAY_MS=120 / MAX_HORIZON_MS=250 were tuned for
// ~100ms player/NPC position streams (city:positions). At a real 15s
// broadcast cadence, the buffer's own documented "hold last, never
// extrapolate" behavior means an aerial entity visually holds position for
// most of each 15s window rather than gliding continuously — an honest
// degrade (never fabricated smoothness), acceptable for slow, distant,
// background sky objects, but a real visual-quality question that needs a
// real Godot binary to judge. Queued in world-lens-godot/VISUAL_QA.md
// rather than guessed at.
//
// ── Scope: 'global', not 'world' ─────────────────────────────────────────
// The handler discovers ALL active worlds itself (no ctx.worldId filter) —
// the same shape `scheme-overhear-cycle` and `world-zone-hazard-cycle` were
// corrected to `scope: 'global'` for (see their "Track A" comments at their
// registerHeartbeat call sites in server.js): marking a handler like this
// `scope: 'world'` would re-run the SAME worlds once per active shard once
// CONCORD_SHARD_WORLDS is enabled. Set at the registration site.
//
// Kill-switch: CONCORD_AERIAL_TRAFFIC=0. Never throws — every path returns
// a plain { ok, ... } object per the heartbeat invariant.

import logger from "../logger.js";
import {
  routeForWorld,
  spawnEntity,
  shouldSpawnMore,
  shouldDespawn,
  computeSnapshot,
  landingPadsForWorld,
  listDistricts,
} from "../lib/aerial-traffic.js";

const MAX_WORLDS_PER_PASS = 8;

/** Design dial — see module header "Two cadences" section. */
export const SPAWN_CHECK_INTERVAL_MS = Number(process.env.CONCORD_AERIAL_SPAWN_INTERVAL_MS) || 3 * 60 * 1000;

function discoverActiveWorlds(db) {
  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT ?
    `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
  } catch { /* world_visits optional — same fallback chain as creature-flock-cycle */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0
        LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch { /* world_npcs optional too — honest empty below */ }
  }
  return worlds;
}

/**
 * Advance one world's ambient aerial-traffic fleet: GC expired entities,
 * (rarely) spawn a replacement, recompute + return the current broadcast
 * snapshot. Mutates `worldState.entities` in place; returns the new state
 * plus stats. Pure of I/O beyond the caller-supplied inputs — no DB access
 * of its own beyond the two already-fetched route sources.
 */
function advanceWorld({ worldId, worldState, landingPads, districts, nowMs }) {
  const stats = { spawned: 0, despawned: 0 };
  let entities = Array.isArray(worldState.entities) ? worldState.entities : [];

  const before = entities.length;
  entities = entities.filter((e) => !shouldDespawn({ entity: e, nowMs }));
  stats.despawned += before - entities.length;

  const { waypoints, source } = routeForWorld({ landingPads, districts });

  if (waypoints.length < 2) {
    // Route data isn't (or is no longer) real for this world — retire the
    // fleet honestly rather than keep broadcasting a stale/invented route.
    stats.despawned += entities.length;
    return { entities: [], lastSpawnAttemptAt: worldState.lastSpawnAttemptAt || 0, source, stats };
  }

  let lastSpawnAttemptAt = worldState.lastSpawnAttemptAt || 0;
  const dueForSpawnCheck = (nowMs - lastSpawnAttemptAt) >= SPAWN_CHECK_INTERVAL_MS;
  if (dueForSpawnCheck) {
    lastSpawnAttemptAt = nowMs;
    if (shouldSpawnMore({ activeCount: entities.length })) {
      entities = entities.concat([spawnEntity({ worldId, waypoints, nowMs, index: entities.length })]);
      stats.spawned++;
    }
  }

  return { entities, lastSpawnAttemptAt, source, stats };
}

export async function runAerialTrafficCycle({ db, state, io, tickCount: _t } = {}) {
  if (process.env.CONCORD_AERIAL_TRAFFIC === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  if (!state) return { ok: false, reason: "no_state" };

  if (!(state.aerialTraffic instanceof Map)) state.aerialTraffic = new Map();

  const nowMs = Date.now();
  const worlds = discoverActiveWorlds(db);
  if (worlds.length === 0) return { ok: true, worldsTouched: 0, reason: "no_active_worlds" };

  const totals = { ok: true, worldsTouched: 0, worldsBroadcast: 0, spawned: 0, despawned: 0 };

  for (const worldId of worlds) {
    try {
      const worldState = state.aerialTraffic.get(worldId) || { entities: [], lastSpawnAttemptAt: 0 };

      let landingPads = [];
      let districts = [];
      try { landingPads = landingPadsForWorld(worldId); } catch { /* honest empty */ }
      try { districts = listDistricts(db, worldId); } catch { /* honest empty */ }

      const advanced = advanceWorld({ worldId, worldState, landingPads, districts, nowMs });
      state.aerialTraffic.set(worldId, { entities: advanced.entities, lastSpawnAttemptAt: advanced.lastSpawnAttemptAt });

      totals.spawned += advanced.stats.spawned;
      totals.despawned += advanced.stats.despawned;
      totals.worldsTouched++;

      if (advanced.entities.length === 0) continue;

      const entities = advanced.entities.map((e) => computeSnapshot(e, nowMs)).filter(Boolean);
      if (entities.length === 0) continue;

      const payload = { worldId, entities, routeSource: advanced.source };

      // Route through the Godot mirror when available — same DET-C-era
      // pattern combat-polish.js and routes/worlds.js#emitWorldEvent
      // adopted (docs/GODOT_PROTOCOL.md §4/§7): prefer the injected
      // world-room emitter (which fans out to BOTH socket.io and any
      // connected Godot client) over a raw `io.to()` call that would only
      // reach the web client.
      const emitWorld = globalThis._concordEmitToWorld;
      let emitted = false;
      if (typeof emitWorld === "function") {
        const r = emitWorld(worldId, "world:aerial-traffic", payload);
        emitted = !!r?.ok;
      } else if (io) {
        try {
          io.to(`world:${worldId}`).emit("world:aerial-traffic", payload);
          emitted = true;
        } catch { /* realtime emit is best-effort — never blocks the tick */ }
      }
      if (emitted) totals.worldsBroadcast++;
    } catch (err) {
      // One world's failure must never stop the pass for the others, or
      // the tick itself (heartbeat invariant) — same posture as
      // creature-flock-cycle.js's per-world try/catch.
      try {
        logger?.warn?.("aerial-traffic-cycle", "world_failed", { worldId, error: err?.message });
      } catch { /* logging best-effort */ }
    }
  }

  return totals;
}

export default { runAerialTrafficCycle, SPAWN_CHECK_INTERVAL_MS };
