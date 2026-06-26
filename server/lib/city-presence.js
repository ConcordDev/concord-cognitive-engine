/**
 * Concord City — Live Co-Presence System
 *
 * Tracks user positions in cities and broadcasts nearby positions
 * via WebSocket so avatars appear in real-time for all users.
 *
 * Spatial chunking (100x100m) keeps lookups efficient even with
 * thousands of concurrent users per city.
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";
import { maxFootSpeedFor, agilityLevelFor, awardSprintXp } from "./movement/foot-speed.js";
import { speedScaledRadius } from "./movement/interest-management.js";

// Speedster S3 — last observed speed per user, for the speed-scaled interest
// radius. Set on each validated move; read by getNearbyUsers when CONCORD_SPEED_AOI.
const _lastSpeed = new Map();

// ── State ───────────────────────────────────────────────────────────────────

/** userId -> { cityId, x, y, z, direction, action, lastUpdate, avatar, dirty } */
const _userPositions = new Map();

/** "${cityId}:${chunkX}:${chunkZ}" -> Set<userId> */
const _cityChunks = new Map();

/** Pluggable DB handle + fireTrigger hook set by server.js at startup. */
let _db = null;
let _fireTrigger = null;
let _flushTimer = null;
let _npcSpawnTimer = null;

const CHUNK_SIZE = 100; // metres per chunk edge
const MAX_VISIBLE_AVATARS = 100;
const FLUSH_INTERVAL_MS = 30_000; // persist dirty positions every 30s

// ── Movement validation ─────────────────────────────────────────────────────
// Anti-cheat bounds. Walking values match AvatarSystem3D's client-side
// MOVE_SPEED (5m/s) and RUN_SPEED (12m/s) with generous slack for latency.
// Vehicles raise the ceiling. The vehicle type the server trusts is whatever
// is currently set on the in-memory presence entry via setUserVehicle() —
// callers must verify ownership against the vehicles table before flipping
// the type, and the entry is reset to null whenever the player dismounts.
const MAX_SPRINT_SPEED_MPS = 16;            // Walking + sprint ceiling, with latency slack
const VEHICLE_MAX_SPEED_MPS = Object.freeze({
  walk:   16,
  car:    40,
  glider: 60,
  plane: 150,
});
const FRAME_DISTANCE_RATIO = 16;            // single-frame ceiling = max_speed * ratio
const MIN_UPDATE_INTERVAL_MS = 20;          // no faster than 50Hz from any one user
const GRACE_PERIOD_MS = 500;                // first few updates after login skip speed check

/**
 * Server-authoritative max-speed lookup. Caller passes in the entry's
 * vehicle_type (already validated against DB at mount time); unknowns
 * fall back to walking.
 */
export function getMaxSpeedForVehicle(vehicleType) {
  return VEHICLE_MAX_SPEED_MPS[vehicleType] ?? VEHICLE_MAX_SPEED_MPS.walk;
}

/** Single-frame teleport ceiling, scaled by vehicle type. */
function getMaxFrameDistance(vehicleType) {
  return getMaxSpeedForVehicle(vehicleType) * FRAME_DISTANCE_RATIO;
}

// ── NPC state ──────────────────────────────────────────────────────────────
// NPCs live in the same spatial-chunking system as players but track their
// own state (occupation, patrolPath, HP). The broadcast loop emits them
// alongside players so the frontend's AvatarSystem3D can render both through
// the same pipeline.
//
// npcId → { cityId, x, y, z, direction, health, maxHealth, occupation,
//           patrolPath, patrolIndex, lastMoveAt, isHostile }
const _npcState = new Map();

// Player combat / HP state is piggy-backed onto the position entry
// (entry.health, entry.maxHealth, entry.stamina, entry.maxStamina) —
// already declared above in the position entry shape. See updateUserPosition.

/**
 * Inject persistence and trigger hooks. Called once at server startup.
 * Passing `null` for either disables that side-effect (useful for tests).
 *
 * @param {object} opts
 * @param {object} [opts.db]          - better-sqlite3 handle with the
 *                                      035_player_world_state migration.
 * @param {Function} [opts.fireTrigger] - (cityId, triggerId, ctx) => void
 *                                      from world-mechanics.js.
 */
export function configurePresence({ db = null, fireTrigger = null } = {}) {
  _db = db;
  _fireTrigger = fireTrigger;
}

/**
 * Load a player's last-saved position from SQLite and seed the
 * in-memory map. Called on first authenticated socket connect /
 * first HTTP presence ping so users land back where they logged out.
 *
 * @param {string} userId
 * @returns {object|null} Restored position or null if nothing saved.
 */
export function loadPlayerState(userId) {
  if (!_db || !userId) return null;
  try {
    const row = _db.prepare(
      `SELECT user_id, city_id, district_id, x, y, z, rotation, direction,
              current_animation, action, health, max_health, stamina, max_stamina,
              client_state_json, last_seen_at
         FROM player_world_state WHERE user_id = ?`
    ).get(userId);
    if (!row) return null;
    // Wave 5b — fill the presence `avatar` field once per join so other players
    // see the character THIS player created (broadcastPositions already ships
    // `p.avatar`; it was always null). Prefer a saved avatar appearance, fall back
    // to the user-level one. KS CONCORD_PLAYER_APPEARANCE_SYNC=0. Best-effort —
    // mig 187 columns may be absent on minimal builds.
    let avatar = null;
    if (process.env.CONCORD_PLAYER_APPEARANCE_SYNC !== "0") {
      try {
        const u = _db.prepare(`SELECT appearance_json FROM users WHERE id = ?`).get(userId);
        if (u?.appearance_json) avatar = JSON.parse(u.appearance_json);
        if (!avatar) {
          const a = _db.prepare(
            `SELECT appearance_json FROM avatars WHERE user_id = ? AND appearance_json IS NOT NULL LIMIT 1`
          ).get(userId);
          if (a?.appearance_json) avatar = JSON.parse(a.appearance_json);
        }
      } catch { /* appearance columns optional (mig 187) */ }
    }
    const entry = {
      cityId: row.city_id,
      districtId: row.district_id || null,
      x: row.x,
      y: row.y,
      z: row.z,
      direction: row.direction || 0,
      rotation: row.rotation || 0,
      action: row.action || "idle",
      currentAnimation: row.current_animation || "idle",
      health: row.health,
      maxHealth: row.max_health,
      stamina: row.stamina,
      maxStamina: row.max_stamina,
      avatar,
      clientState: (() => { try { return JSON.parse(row.client_state_json || "{}"); } catch { return {}; } })(),
      lastUpdate: Date.now(),
      dirty: false,
    };
    _userPositions.set(userId, entry);
    addToChunk(userId, entry.cityId, toChunk(entry.x), toChunk(entry.z));
    return entry;
  } catch (err) {
    logger.warn?.("city-presence", `loadPlayerState failed for ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * Flush all dirty (modified since last save) positions to SQLite.
 * Called periodically by the flush timer and on each disconnect.
 * Upsert-by-user-id so it's idempotent.
 */
export function flushDirtyPositions() {
  if (!_db || _userPositions.size === 0) return { flushed: 0 };
  let flushed = 0;
  try {
    const stmt = _db.prepare(`
      INSERT INTO player_world_state
        (user_id, city_id, district_id, x, y, z, rotation, direction,
         current_animation, action, health, max_health, stamina, max_stamina,
         chunk_x, chunk_z, client_state_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        city_id          = excluded.city_id,
        district_id      = excluded.district_id,
        x                = excluded.x,
        y                = excluded.y,
        z                = excluded.z,
        rotation         = excluded.rotation,
        direction        = excluded.direction,
        current_animation = excluded.current_animation,
        action           = excluded.action,
        health           = excluded.health,
        max_health       = excluded.max_health,
        stamina          = excluded.stamina,
        max_stamina      = excluded.max_stamina,
        chunk_x          = excluded.chunk_x,
        chunk_z          = excluded.chunk_z,
        client_state_json = excluded.client_state_json,
        last_seen_at     = excluded.last_seen_at
    `);
    const tx = _db.transaction(() => {
      for (const [userId, pos] of _userPositions) {
        if (!pos.dirty) continue;
        stmt.run(
          userId,
          pos.cityId || "concordia-central",
          pos.districtId || null,
          pos.x || 0,
          pos.y || 0,
          pos.z || 0,
          pos.rotation || 0,
          pos.direction || 0,
          pos.currentAnimation || "idle",
          pos.action || "idle",
          pos.health ?? 100,
          pos.maxHealth ?? 100,
          pos.stamina ?? 100,
          pos.maxStamina ?? 100,
          toChunk(pos.x || 0),
          toChunk(pos.z || 0),
          JSON.stringify(pos.clientState || {}),
        );
        pos.dirty = false;
        flushed++;
      }
    });
    tx();
  } catch (err) {
    logger.warn?.("city-presence", `flushDirtyPositions failed: ${err.message}`);
  }
  return { flushed };
}

/**
 * Persist a player immediately (e.g. on disconnect). Wraps
 * flushDirtyPositions for a single user.
 */
export function persistPlayer(userId) {
  const pos = _userPositions.get(userId);
  if (pos) pos.dirty = true;
  return flushDirtyPositions();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function chunkKey(cityId, chunkX, chunkZ) {
  return `${cityId}:${chunkX}:${chunkZ}`;
}

function toChunk(coord) {
  return Math.floor(coord / CHUNK_SIZE);
}

function removeFromChunk(userId, cityId, chunkX, chunkZ) {
  const key = chunkKey(cityId, chunkX, chunkZ);
  const set = _cityChunks.get(key);
  if (set) {
    set.delete(userId);
    if (set.size === 0) _cityChunks.delete(key);
  }
}

function addToChunk(userId, cityId, chunkX, chunkZ) {
  const key = chunkKey(cityId, chunkX, chunkZ);
  let set = _cityChunks.get(key);
  if (!set) {
    set = new Set();
    _cityChunks.set(key, set);
  }
  set.add(userId);
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Update a user's position in the city. Handles chunk migration when the
 * user crosses a chunk boundary.
 *
 * @param {string} userId
 * @param {{ cityId: string, x: number, y: number, z: number, direction: number, action: string }} pos
 * @returns {{ nearby: object[] }} Nearby user positions after the update.
 */
export function updateUserPosition(userId, { cityId, x, y, z, direction, action, rotation, currentAnimation, districtId, worldId }) {
  const prev = _userPositions.get(userId);
  const now = Date.now();

  // ── Movement validation (anti-cheat / sanity) ────────────────────────
  // Only applies once a player has an existing position — the first
  // update after login establishes the baseline.
  if (prev) {
    const dt = now - prev.lastUpdate;
    if (dt < MIN_UPDATE_INTERVAL_MS) {
      // Client is flooding — silently drop the update instead of
      // polluting presence state. 50Hz cap per-user mirrors the
      // server broadcast rate.
      return { ok: false, reason: "rate_limited", nearby: getNearbyUsers(userId), chunkCrossed: false };
    }
    // Skip speed check if the user is changing cities (teleport /
    // portal) or during the grace period right after login.
    const isCityTransition = prev.cityId !== cityId;
    const graceActive = prev.createdAt && (now - prev.createdAt) < GRACE_PERIOD_MS;
    if (!isCityTransition && !graceActive && dt > 0) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const dz = z - prev.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Vehicle-aware speed ceiling. The vehicle type was validated against
      // the vehicles table at mount time and stored on the entry; we trust
      // the server-side entry, NEVER a client-supplied vehicle hint.
      const vehicleType = prev?.vehicleType || "walk";
      // Speedster S1 — on-foot, the anti-cheat ceiling rises with the player's
      // agility (movement.sprint level) instead of the static walk:16 table, so a
      // legitimately-fast runner isn't false-flagged as a speed-hacker. Derived
      // server-side from the stored skill (can't be forged). Off
      // (CONCORD_EARNED_SPEED unset) → the legacy static cap, byte-identical.
      const _onFoot = !vehicleType || vehicleType === "walk";
      let maxSpeed, maxFrameDistance;
      if (_onFoot && process.env.CONCORD_EARNED_SPEED !== "0") {
        maxSpeed = maxFootSpeedFor(agilityLevelFor(_db, userId));
        maxFrameDistance = maxSpeed * FRAME_DISTANCE_RATIO;
      } else {
        maxSpeed = getMaxSpeedForVehicle(vehicleType);
        maxFrameDistance = getMaxFrameDistance(vehicleType);
      }

      // Hard ceiling regardless of dt — real players can't teleport
      if (distance > maxFrameDistance) {
        logger.debug?.("city-presence", `rejected teleport by ${userId}: ${distance.toFixed(1)}m in ${dt}ms (${vehicleType})`);
        return {
          ok: false,
          reason: "teleport_detected",
          prev: { x: prev.x, y: prev.y, z: prev.z },
          nearby: getNearbyUsers(userId),
          chunkCrossed: false,
        };
      }
      // Speed check: distance / dt must be under the vehicle's max
      const speedMps = distance / (dt / 1000);
      if (speedMps > maxSpeed) {
        logger.debug?.("city-presence", `rejected speed hack by ${userId}: ${speedMps.toFixed(1)}m/s (${vehicleType} max ${maxSpeed})`);
        return {
          ok: false,
          reason: "speed_hack_detected",
          observedSpeed: speedMps,
          maxSpeed,
          vehicleType,
          prev: { x: prev.x, y: prev.y, z: prev.z },
          nearby: getNearbyUsers(userId),
          chunkCrossed: false,
        };
      }
      // Speedster S1 — earn movement.sprint XP for distance actually run on foot.
      // Gated to genuine sprinting speed (≥3 m/s) so idle/jitter can't farm it;
      // off (CONCORD_EARNED_SPEED unset) → no XP, byte-identical.
      if (_onFoot && distance > 0 && speedMps >= 3 && process.env.CONCORD_EARNED_SPEED !== "0") {
        try { awardSprintXp(_db, userId, distance); } catch { /* xp best-effort */ }
      }
      // S3 — remember the mover's speed for the speed-scaled interest radius.
      if (Number.isFinite(speedMps)) _lastSpeed.set(userId, speedMps);
    }
  }

  const newChunkX = toChunk(x);
  const newChunkZ = toChunk(z);
  let chunkCrossed = false;
  let cityChanged = false;

  // Remove from old chunk if city or chunk changed
  if (prev) {
    const oldChunkX = toChunk(prev.x);
    const oldChunkZ = toChunk(prev.z);
    if (prev.cityId !== cityId || oldChunkX !== newChunkX || oldChunkZ !== newChunkZ) {
      removeFromChunk(userId, prev.cityId, oldChunkX, oldChunkZ);
      addToChunk(userId, cityId, newChunkX, newChunkZ);
      chunkCrossed = true;
      cityChanged = prev.cityId !== cityId;
    }
  } else {
    addToChunk(userId, cityId, newChunkX, newChunkZ);
    chunkCrossed = true;
  }

  const entry = {
    cityId,
    // Phase M — track per-world presence so getWorldUserCount /
    // getPlayersInCell / soft-cap pooling can scope correctly. Movement paths
    // (server.js / routes/world.js) pass cityId but not worldId, so fall back to
    // cityId — in Concordia the city id IS the world id (e.g. "concordia-hub").
    // Without this, getPlayersNear / spontaneousGatherings filter out everyone.
    worldId: worldId ?? prev?.worldId ?? cityId ?? null,
    districtId: districtId ?? prev?.districtId ?? null,
    x,
    y,
    z,
    direction: direction ?? prev?.direction ?? 0,
    rotation: rotation ?? prev?.rotation ?? 0,
    action: action ?? prev?.action ?? "idle",
    currentAnimation: currentAnimation ?? prev?.currentAnimation ?? "idle",
    health: prev?.health ?? 100,
    maxHealth: prev?.maxHealth ?? 100,
    stamina: prev?.stamina ?? 100,
    maxStamina: prev?.maxStamina ?? 100,
    clientState: prev?.clientState ?? {},
    // Vehicle state — carried over from previous entry. Only setUserVehicle
    // can flip this, never the position update path. That separation is
    // what makes vehicle anti-cheat authoritative.
    vehicleId:   prev?.vehicleId   ?? null,
    vehicleType: prev?.vehicleType ?? null,
    lastUpdate: now,
    createdAt: prev?.createdAt ?? now,
    dirty: true, // mark for next flush
    avatar: prev?.avatar ?? null,
  };
  _userPositions.set(userId, entry);

  // Fire world-mechanics triggers when the player crosses a chunk
  // (or city) boundary. The hook is optional — tests and stand-alone
  // uses of this module just skip it. `_fireTrigger` is set at server
  // startup via configurePresence({ fireTrigger }).
  if (chunkCrossed && _fireTrigger) {
    try {
      if (cityChanged && prev) {
        _fireTrigger(prev.cityId, "player_leaves_zone", {
          userId,
          zoneId: `${prev.cityId}:${toChunk(prev.x)}:${toChunk(prev.z)}`,
        });
      }
      _fireTrigger(cityId, "player_enters_zone", {
        userId,
        zoneId: `${cityId}:${newChunkX}:${newChunkZ}`,
        districtId: entry.districtId,
      });
    } catch (err) {
      logger.debug?.("city-presence", `fireTrigger failed: ${err.message}`);
    }
  }

  const nearby = getNearbyUsers(userId);
  return { ok: true, nearby, chunkCrossed };
}

/**
 * Get a user's current position record.
 * @param {string} userId
 * @returns {object|undefined}
 */
export function getUserPosition(userId) {
  return _userPositions.get(userId);
}

/**
 * Restore a player's resource bars to full. Used by the PvP training match
 * Safe Reset between rounds. No-op if the player has no live presence.
 * Returns true if the bars were touched.
 */
export function restorePlayerBars(userId) {
  const p = _userPositions.get(userId);
  if (!p) return false;
  p.health      = p.maxHealth ?? 100;
  p.stamina     = p.maxStamina ?? 100;
  p.mana        = p.maxMana ?? 100;
  p.bioPower    = p.maxBioPower ?? 100;
  p.perception  = p.maxPerception ?? 100;
  // Reset any per-zone armor too so the next round starts clean
  p.limbArmor = { head: 100, torso: 100, left_arm: 100, right_arm: 100, left_leg: 100, right_leg: 100 };
  return true;
}

/**
 * Authoritative vehicle mount / dismount. The route handler MUST verify
 * vehicle ownership against the vehicles table before calling this — the
 * presence layer trusts whatever it is given, by design. Callers pass
 * vehicleType=null to dismount.
 *
 * @param {string} userId
 * @param {{ vehicleId: string|null, vehicleType: string|null }} args
 * @returns {boolean} true if the entry was updated, false if user has no
 *                   active presence to flip yet (mount before first move).
 */
export function setUserVehicle(userId, { vehicleId = null, vehicleType = null } = {}) {
  const entry = _userPositions.get(userId);
  if (!entry) {
    // No presence yet — stash a stub so the next position update inherits
    // the vehicle state. Walking is the implicit default.
    _userPositions.set(userId, {
      cityId: "concordia-central",
      districtId: null,
      x: 0, y: 0, z: 0,
      direction: 0, rotation: 0,
      action: "idle", currentAnimation: "idle",
      health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
      clientState: {},
      vehicleId, vehicleType,
      lastUpdate: Date.now(), createdAt: Date.now(),
      dirty: true, avatar: null,
    });
    return true;
  }
  entry.vehicleId   = vehicleId;
  entry.vehicleType = vehicleType;
  entry.dirty       = true;
  return true;
}

/** Read the server-side vehicle the player is currently on. Null = on foot. */
export function getUserVehicle(userId) {
  const e = _userPositions.get(userId);
  if (!e) return { vehicleId: null, vehicleType: null };
  return { vehicleId: e.vehicleId ?? null, vehicleType: e.vehicleType ?? null };
}

/**
 * Get all users within `radius` metres of the given user in the same city.
 *
 * @param {string} userId
 * @param {number} [radius=500]
 * @returns {object[]}
 */
export function getNearbyUsers(userId, radius = 500) {
  const pos = _userPositions.get(userId);
  if (!pos) return [];

  // S3 — speed-scaled interest radius: a fast mover sees/is-seen farther ahead so
  // chunk boundary crossings smooth instead of thrashing. Only when the caller
  // used the default radius + CONCORD_SPEED_AOI is on; explicit radii are honored.
  if (radius === 500 && process.env.CONCORD_SPEED_AOI === "1") {
    radius = speedScaledRadius(_lastSpeed.get(userId) || 0);
  }

  const radiusSq = radius * radius;
  const chunkRadius = Math.ceil(radius / CHUNK_SIZE);
  const cx = toChunk(pos.x);
  const cz = toChunk(pos.z);

  const results = [];

  for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
    for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
      const key = chunkKey(pos.cityId, cx + dx, cz + dz);
      const set = _cityChunks.get(key);
      if (!set) continue;
      for (const uid of set) {
        if (uid === userId) continue;
        const other = _userPositions.get(uid);
        if (!other || other.cityId !== pos.cityId) continue;
        if (distanceSq(pos, other) <= radiusSq) {
          results.push({
            userId: uid,
            x: other.x,
            y: other.y,
            z: other.z,
            direction: other.direction,
            action: other.action,
            avatar: other.avatar,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Count how many users are currently in a city.
 * @param {string} cityId
 * @returns {number}
 */
export function getCityUserCount(cityId) {
  let count = 0;
  for (const [, pos] of _userPositions) {
    if (pos.cityId === cityId) count++;
  }
  return count;
}

/**
 * Return the userIds of every player currently present in the given city.
 * Used by emergent systems (quest push, world events, NPC announcements)
 * to deliver realtime notifications only to players who are actually there.
 * @param {string} cityId
 * @returns {string[]}
 */
export function getUserIdsInCity(cityId) {
  const ids = [];
  for (const [userId, pos] of _userPositions) {
    if (pos.cityId === cityId) ids.push(userId);
  }
  return ids;
}

/**
 * Phase M — multiplayer density helpers.
 * Worlds are presence-keyed by `worldId` (set when a player travels via
 * /api/worlds/travel + Socket.IO `world:join`). These helpers expose per-
 * world player counts to the shard manager (soft cap), spectator mode
 * (head count), and the world picker (live density indicator).
 */
export function getWorldUserCount(worldId) {
  if (!worldId) return 0;
  let count = 0;
  for (const [, pos] of _userPositions) {
    if (pos.worldId === worldId) count++;
  }
  return count;
}

export function getUserIdsInWorld(worldId) {
  const ids = [];
  for (const [userId, pos] of _userPositions) {
    if (pos.worldId === worldId) ids.push(userId);
  }
  return ids;
}

/** All currently-present user ids (across every world). Used by global-scope
 *  signals (e.g. faction-war personal-stake) that aren't tied to one world. */
export function getOnlineUserIds() {
  return [..._userPositions.keys()];
}

/**
 * Return all players within a single 50m spatial cell in a world.
 * Used by signal-propagation and combat fan-out so 200 concurrent users
 * only get events that matter to their cell, not the whole world.
 */
export function getPlayersInCell(worldId, cellX, cellZ, cellSize = 50) {
  const out = [];
  if (!worldId) return out;
  for (const [userId, pos] of _userPositions) {
    if (pos.worldId !== worldId) continue;
    const px = Math.floor((Number(pos.x) || 0) / cellSize);
    const pz = Math.floor((Number(pos.z) || 0) / cellSize);
    if (px === cellX && pz === cellZ) out.push(userId);
  }
  return out;
}

// Spontaneous gatherings — cluster the world's currently-present players into
// `cellSize`-metre cells; any cell with >= minCount players is a "gathering".
// Reads live in-memory presence (freshest), bounded by the number of online
// users. Returns the Gathering shape the EventsGatherings panel renders.
export function spontaneousGatherings(worldId, { cellSize = 50, minCount = 2, limit = 20 } = {}) {
  if (!worldId) return [];
  const cells = new Map(); // "cx:cz" -> { count, district, cx, cz }
  for (const [, pos] of _userPositions) {
    // Movement paths (server.js / routes/world.js) set cityId, not worldId, so
    // pos.worldId falls back to cityId. Match on either so a client that scopes
    // by cityId still surfaces — otherwise the panel reads empty even with
    // co-located players (PR review on this helper).
    if (pos.worldId !== worldId && pos.cityId !== worldId) continue;
    const cx = Math.floor((Number(pos.x) || 0) / cellSize);
    const cz = Math.floor((Number(pos.z) || 0) / cellSize);
    const key = `${cx}:${cz}`;
    const cur = cells.get(key) || { count: 0, district: pos.districtId || null, cx, cz };
    cur.count += 1;
    if (!cur.district && pos.districtId) cur.district = pos.districtId;
    cells.set(key, cur);
  }
  const out = [];
  for (const [key, c] of cells) {
    if (c.count < minCount) continue;
    const location = c.district || `area ${c.cx},${c.cz}`;
    out.push({
      id: `gather_${worldId}_${key}`,
      location,
      playerCount: c.count,
      description: `${c.count} players gathering at ${location}`,
    });
  }
  out.sort((a, b) => b.playerCount - a.playerCount);
  return out.slice(0, limit);
}

// Proximity — userIds of currently-present players within `radiusCells` of the
// point (x,z) in a world. radiusCells=1 over 50m cells = a 3×3 window (~150m).
// Powers proximity chat: "who is physically near me right now."
export function getPlayersNear(worldId, x, z, { cellSize = 50, radiusCells = 1 } = {}) {
  if (!worldId) return [];
  const ccx = Math.floor((Number(x) || 0) / cellSize);
  const ccz = Math.floor((Number(z) || 0) / cellSize);
  const out = [];
  for (const [userId, pos] of _userPositions) {
    // See spontaneousGatherings: match worldId OR cityId so the movement-path
    // cityId fallback doesn't strand co-located players in proximity chat.
    if (pos.worldId !== worldId && pos.cityId !== worldId) continue;
    const px = Math.floor((Number(pos.x) || 0) / cellSize);
    const pz = Math.floor((Number(pos.z) || 0) / cellSize);
    if (Math.abs(px - ccx) <= radiusCells && Math.abs(pz - ccz) <= radiusCells) out.push(userId);
  }
  return out;
}

/**
 * Remove a user from the presence system (on disconnect / leave).
 * Persists their final position to SQLite before dropping them from
 * the in-memory map, so they land back in the same spot next login.
 * @param {string} userId
 */
export function removeUser(userId) {
  const pos = _userPositions.get(userId);
  if (pos) {
    // Final persist before dropping — mark dirty and flush just this user
    pos.dirty = true;
    flushDirtyPositions();
    removeFromChunk(userId, pos.cityId, toChunk(pos.x), toChunk(pos.z));
    _userPositions.delete(userId);
    logger.debug("city-presence", `User ${userId} removed from presence`);
  }
}

// Default stale threshold — entries with `lastUpdate` older than this are
// presumed-disconnected and pruned. Override via env. Disconnect handlers
// (server.js:7112,7120) handle the happy path; this sweep covers the
// crash-recovery / never-cleanly-disconnected cases.
const STALE_PRESENCE_MS = Number(process.env.CONCORD_PRESENCE_STALE_MS) || 10 * 60 * 1000;

/**
 * Periodic stale-entry sweep. Removes any user position whose `lastUpdate`
 * is older than STALE_PRESENCE_MS. Returns { ok, pruned, scanned }.
 *
 * Wire from a heartbeat module — see server.js registerHeartbeat
 * "presence-stale-sweep" at frequency 20 (≈5 min at 15s ticks).
 */
export function sweepStalePresence(now = Date.now()) {
  let pruned = 0;
  const scanned = _userPositions.size;
  for (const [userId, pos] of _userPositions.entries()) {
    if ((now - (pos.lastUpdate || 0)) > STALE_PRESENCE_MS) {
      // Reuse removeUser for consistency: same chunk-removal + flush path
      // happy-path disconnect uses.
      try { removeUser(userId); pruned++; }
      catch (err) { logger.warn?.("city_presence", "sweep_remove_failed", { userId, err: err?.message }); }
    }
  }
  return { ok: true, pruned, scanned };
}

/**
 * Get the set of user IDs in a specific chunk.
 * @param {string} cityId
 * @param {number} chunkX
 * @param {number} chunkZ
 * @returns {Set<string>}
 */
export function getChunkUsers(cityId, chunkX, chunkZ) {
  return _cityChunks.get(chunkKey(cityId, chunkX, chunkZ)) ?? new Set();
}

/**
 * Broadcast position updates for every occupied chunk in a city.
 * Caps at MAX_VISIBLE_AVATARS per chunk — furthest users are dropped first.
 *
 * @param {string} cityId
 * @param {(event: string, data: object) => void} realtimeEmit
 */
export function broadcastPositions(cityId, realtimeEmit) {
  const visited = new Set();

  for (const [key, userSet] of _cityChunks) {
    if (visited.has(key)) continue;
    if (!key.startsWith(`${cityId}:`)) continue;
    visited.add(key);

    const parts = key.split(":");
    const chunkX = Number(parts[1]);
    const chunkZ = Number(parts[2]);

    let users = [];
    for (const uid of userSet) {
      const p = _userPositions.get(uid);
      if (!p) continue;
      users.push({
        userId: uid,
        x: p.x,
        y: p.y,
        z: p.z,
        direction: p.direction,
        action: p.action,
        avatar: p.avatar,
        vehicleId:   p.vehicleId   ?? null,
        vehicleType: p.vehicleType ?? null,
        displayName: uid, // caller may enrich later
      });
    }

    // Cap visible avatars — keep closest to chunk centre
    if (users.length > MAX_VISIBLE_AVATARS) {
      const centreX = (chunkX + 0.5) * CHUNK_SIZE;
      const centreZ = (chunkZ + 0.5) * CHUNK_SIZE;
      users.sort((a, b) => {
        const da = (a.x - centreX) ** 2 + (a.z - centreZ) ** 2;
        const db = (b.x - centreX) ** 2 + (b.z - centreZ) ** 2;
        return da - db;
      });
      users = users.slice(0, MAX_VISIBLE_AVATARS);
    }

    if (users.length === 0) continue;

    realtimeEmit("city:positions", {
      cityId,
      chunk: { x: chunkX, z: chunkZ },
      users,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Start periodic position broadcasts for all occupied cities.
 *
 * @param {(event: string, data: object) => void} realtimeEmit
 * @param {number} [intervalMs=100]
 * @returns {() => void} Cleanup function to stop broadcasting.
 */
export function startPresenceBroadcast(realtimeEmit, intervalMs = 100) {
  // Stamina regen runs at 1/sec (every 10th broadcast tick)
  let staminaRegenCounter = 0;
  // Collect distinct cityIds on each tick
  const timer = setInterval(() => {
    const cities = new Set();
    for (const [, pos] of _userPositions) {
      cities.add(pos.cityId);
    }
    for (const cityId of cities) {
      broadcastPositions(cityId, realtimeEmit);
    }
    // Stamina regen — 1 point per second
    staminaRegenCounter++;
    if (staminaRegenCounter >= 10) {
      regenStamina();
      staminaRegenCounter = 0;
    }
  }, intervalMs);

  // Periodic flush of dirty positions to SQLite — survives restart.
  if (!_flushTimer && _db) {
    _flushTimer = setInterval(() => {
      try {
        flushDirtyPositions();
      } catch (err) {
        logger.warn?.("city-presence", `periodic flush failed: ${err.message}`);
      }
    }, FLUSH_INTERVAL_MS);
    _flushTimer.unref?.();
  }

  logger.info("city-presence", `Presence broadcast started (${intervalMs}ms interval, flush every ${FLUSH_INTERVAL_MS}ms)`);

  return () => {
    clearInterval(timer);
    if (_flushTimer) {
      clearInterval(_flushTimer);
      _flushTimer = null;
    }
    // Final flush so any in-flight positions land on disk
    try { flushDirtyPositions(); } catch (_e) { /* shutdown, don't care */ }
    logger.info("city-presence", "Presence broadcast stopped");
  };
}

/**
 * Return aggregate presence statistics.
 * @returns {{ totalOnline: number, byCityCount: Map<string, number>, npcCount: number }}
 */
export function getPresenceStats() {
  const byCityCount = new Map();
  for (const [, pos] of _userPositions) {
    byCityCount.set(pos.cityId, (byCityCount.get(pos.cityId) || 0) + 1);
  }
  return {
    totalOnline: _userPositions.size,
    byCityCount,
    npcCount: _npcState.size,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NPC MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spawn an NPC in the world. Returns the generated NPC id.
 *
 * @param {object} opts
 * @param {string} opts.cityId
 * @param {string} [opts.id] - optional fixed id (otherwise generated)
 * @param {string} opts.name
 * @param {string} [opts.occupation='citizen']
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.z
 * @param {Array<{x,y,z}>} [opts.patrolPath] - optional waypoints
 * @param {number} [opts.health=100]
 * @param {boolean} [opts.isHostile=false]
 * @param {object} [opts.appearance]
 */
export function spawnNpc({
  cityId, id, name, occupation = "citizen",
  x, y = 0, z, patrolPath = [],
  health = 100, isHostile = false, appearance = null,
}) {
  if (!cityId || typeof x !== "number" || typeof z !== "number") {
    return { ok: false, error: "missing_position" };
  }
  const npcId = id || `npc_${randomUUID().slice(0, 12)}`;
  _npcState.set(npcId, {
    id: npcId,
    cityId,
    name: name || npcId,
    occupation,
    x, y, z,
    direction: 0,
    health,
    maxHealth: health,
    patrolPath,
    patrolIndex: 0,
    lastMoveAt: Date.now(),
    isHostile: !!isHostile,
    appearance,
    animation: "idle",
  });
  return { ok: true, npcId };
}

/**
 * Remove an NPC from the world (death, despawn, etc.).
 */
export function despawnNpc(npcId) {
  const existed = _npcState.delete(npcId);
  return { ok: existed };
}

/**
 * Get an NPC's current state.
 */
export function getNpc(npcId) {
  return _npcState.get(npcId);
}

/**
 * Get all NPCs currently in a given city.
 */
export function getCityNpcs(cityId) {
  const out = [];
  for (const npc of _npcState.values()) {
    if (npc.cityId === cityId) out.push(npc);
  }
  return out;
}

/**
 * Advance NPC patrol paths and broadcast their new positions alongside
 * player positions. Called from the same 100ms tick as `broadcastPositions`
 * so the frontend sees them through the same pipeline.
 */
function tickNpcs(cityId, realtimeEmit) {
  const now = Date.now();
  const perChunk = new Map(); // "cityId:cx:cz" -> [npc, ...]

  for (const npc of _npcState.values()) {
    if (npc.cityId !== cityId) continue;

    // Advance along patrol path at 2m/s if one is defined
    if (Array.isArray(npc.patrolPath) && npc.patrolPath.length > 0) {
      const dt = (now - npc.lastMoveAt) / 1000;
      if (dt > 0) {
        const target = npc.patrolPath[npc.patrolIndex % npc.patrolPath.length];
        const dx = target.x - npc.x;
        const dz = target.z - npc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const speed = 2; // m/s
        const stepDist = Math.min(dist, speed * dt);
        if (dist > 0.1) {
          npc.x += (dx / dist) * stepDist;
          npc.z += (dz / dist) * stepDist;
          npc.direction = Math.atan2(dx, dz);
          npc.animation = "walk";
        } else {
          npc.patrolIndex = (npc.patrolIndex + 1) % npc.patrolPath.length;
          npc.animation = "idle";
        }
        npc.lastMoveAt = now;
      }
    }

    // Group by chunk so we can emit per-chunk broadcasts like players
    const cx = toChunk(npc.x);
    const cz = toChunk(npc.z);
    const key = `${cityId}:${cx}:${cz}`;
    if (!perChunk.has(key)) perChunk.set(key, []);
    perChunk.get(key).push({
      id: npc.id,
      name: npc.name,
      occupation: npc.occupation,
      position: { x: npc.x, y: npc.y, z: npc.z },
      rotation: npc.direction,
      direction: npc.direction,
      currentAnimation: npc.animation,
      health: npc.health,
      maxHealth: npc.maxHealth,
      isHostile: npc.isHostile,
      appearance: npc.appearance,
      timestamp: now,
    });
  }

  for (const [key, npcs] of perChunk) {
    const parts = key.split(":");
    realtimeEmit("city:npcs", {
      cityId: parts[0],
      chunk: { x: Number(parts[1]), z: Number(parts[2]) },
      npcs,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Start the NPC spawn / tick loop. Calls `fireTrigger('entity_spawns')`
 * periodically so user-defined mechanics decide when NPCs appear, and
 * runs the patrol advance + broadcast on the same tick.
 *
 * @param {(event: string, data: object) => void} realtimeEmit
 * @param {number} [tickMs=1000] - NPC tick interval (different from
 *                                  the 100ms player broadcast tick to
 *                                  keep CPU budget reasonable)
 */
export function startNpcLoop(realtimeEmit, tickMs = 1000) {
  if (_npcSpawnTimer) return () => {};

  _npcSpawnTimer = setInterval(() => {
    // Collect distinct cityIds from active players — only tick NPCs
    // in cities that have players in them.
    const activeCities = new Set();
    for (const [, pos] of _userPositions) {
      activeCities.add(pos.cityId);
    }
    for (const cityId of activeCities) {
      // Fire the entity_spawns trigger so user-defined mechanics can
      // decide whether to spawn something. The fireTrigger hook will
      // call spawnNpc() itself if a mechanic says so.
      if (_fireTrigger) {
        try {
          _fireTrigger(cityId, "entity_spawns", {
            cityId,
            npcCount: getCityNpcs(cityId).length,
            playerCount: getPlayerCountInCity(cityId),
          });
        } catch (_e) { /* non-fatal */ }
      }
      // Advance patrols + broadcast the current NPC positions
      tickNpcs(cityId, realtimeEmit);
    }
  }, tickMs);
  _npcSpawnTimer.unref?.();

  logger.info?.("city-presence", `NPC loop started (${tickMs}ms tick)`);
  return () => {
    if (_npcSpawnTimer) {
      clearInterval(_npcSpawnTimer);
      _npcSpawnTimer = null;
    }
  };
}

/** Internal helper — count players in a given city. */
function getPlayerCountInCity(cityId) {
  let n = 0;
  for (const [, pos] of _userPositions) if (pos.cityId === cityId) n++;
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBAT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply an attack from one entity to another. Entities can be players
 * or NPCs — they're resolved by id against `_userPositions` and
 * `_npcState` respectively.
 *
 * Damage model: baseDamage ±20% variance, mitigated by zone armor, clamped to at least 1.
 * Critical hits (roll > 0.85) deal 2x damage.
 * Hit zone is randomly selected weighted toward torso; zone armor degrades each hit.
 * Armor thresholds: 67% = damaged (−15% mitigation), 33% = cracked (−40%), 0% = destroyed (no mitigation).
 * Range check: target must be within `range` metres.
 * Stamina cost: each attack costs 8 stamina; fails if attacker has < 8.
 *
 * @param {object} opts
 * @param {string} opts.attackerId
 * @param {string} opts.targetId
 * @param {number} [opts.baseDamage=10]
 * @param {number} [opts.range=3]       - attack range in metres
 * @param {number} [opts.armorPierce=0] - flat armor reduction
 * @returns {{
 *   ok: boolean, error?: string,
 *   damage?: number, isCrit?: boolean, hitZone?: string,
 *   targetHealth?: number, targetKilled?: boolean,
 *   attackerStamina?: number,
 *   limbDamage?: object, limbArmor?: object
 * }}
 */

// Hit zone weights: torso 35%, arms 15% each, legs 15% each, head 5%
const HIT_ZONE_TABLE = [
  { zone: 'torso',     weight: 35 },
  { zone: 'left_arm',  weight: 15 },
  { zone: 'right_arm', weight: 15 },
  { zone: 'left_leg',  weight: 15 },
  { zone: 'right_leg', weight: 15 },
  { zone: 'head',      weight: 5  },
];
const HIT_ZONE_TOTAL = HIT_ZONE_TABLE.reduce((s, z) => s + z.weight, 0);

function _pickHitZone() {
  let roll = Math.random() * HIT_ZONE_TOTAL;
  for (const entry of HIT_ZONE_TABLE) {
    roll -= entry.weight;
    if (roll <= 0) return entry.zone;
  }
  return 'torso';
}

// Returns mitigation multiplier (0–1) based on armor integrity for a zone
function _armorMitigation(armorPct) {
  if (armorPct <= 0)  return 0;    // destroyed — no mitigation
  if (armorPct <= 33) return 0.20; // cracked — 20% mitigation remaining
  if (armorPct <= 67) return 0.45; // damaged — 45% remaining
  return 0.70;                     // intact — full 70% mitigation
}

// Debuff names by zone and threshold
const ZONE_DEBUFFS = {
  head:       { 67: 'perception_impaired', 33: 'vision_blurred',   0: 'concussed'       },
  torso:      { 67: 'armor_damaged',       33: 'ribs_cracked',     0: 'chest_exposed'   },
  left_arm:   { 67: 'arm_weakened',        33: 'arm_damaged',      0: 'arm_broken'      },
  right_arm:  { 67: 'arm_weakened',        33: 'arm_damaged',      0: 'arm_broken'      },
  left_leg:   { 67: 'leg_slowed',          33: 'leg_damaged',      0: 'leg_broken'      },
  right_leg:  { 67: 'leg_slowed',          33: 'leg_damaged',      0: 'leg_broken'      },
};

function _getZoneDebuff(zone, armorPct) {
  const thresholds = ZONE_DEBUFFS[zone];
  if (!thresholds) return null;
  if (armorPct <= 0)  return thresholds[0];
  if (armorPct <= 33) return thresholds[33];
  if (armorPct <= 67) return thresholds[67];
  return null;
}

export function applyAttack({ attackerId, targetId, baseDamage = 10, range = 3, armorPierce = 0, contextModifiers = null, maxDamage = Infinity }) {
  if (!attackerId || !targetId) return { ok: false, error: "missing_ids" };
  if (attackerId === targetId) return { ok: false, error: "cannot_attack_self" };

  // Attacker must be a player (NPC-vs-NPC combat comes later)
  const attacker = _userPositions.get(attackerId);
  if (!attacker) return { ok: false, error: "attacker_not_found" };

  // Target can be either a player or an NPC
  const isPlayerTarget = _userPositions.has(targetId);
  const target = isPlayerTarget ? _userPositions.get(targetId) : _npcState.get(targetId);
  if (!target) return { ok: false, error: "target_not_found" };

  // Same-city check
  const targetCity = isPlayerTarget ? target.cityId : target.cityId;
  if (attacker.cityId !== targetCity) return { ok: false, error: "different_city" };

  // Range check
  const dx = attacker.x - target.x;
  const dy = (attacker.y || 0) - (target.y || 0);
  const dz = attacker.z - target.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > range) return { ok: false, error: "out_of_range", distance: dist, range };

  // Flow Combat context modifiers — caller can pass a modifiers object from
  // detectCombatContext() to scale stamina cost (aerial costs more, vehicle
  // costs less), damage (vehicle ramming hits harder, hacker attacks weaker
  // physically), and the defender's evade chance. Defaults are no-op.
  const mods = contextModifiers || {};
  const staminaMul = Number(mods.staminaCostMul ?? 1) || 1;
  const damageMul  = Number(mods.damageMul       ?? 1) || 1;
  const evadeBonus = Number(mods.evadeBonus      ?? 0) || 0;

  // Stamina check
  const STAMINA_COST = Math.max(1, Math.round(8 * staminaMul));
  if ((attacker.stamina || 0) < STAMINA_COST) {
    return { ok: false, error: "insufficient_stamina", stamina: attacker.stamina };
  }

  // Defender evade roll (context-bonus on top of any innate dodge stat).
  // Evade > 0 means the attack might whiff entirely.
  if (evadeBonus > 0 && Math.random() < evadeBonus) {
    return {
      ok: true,
      damage: 0,
      isCrit: false,
      evaded: true,
      targetHealth: target.health ?? target.hp ?? 0,
      targetMaxHealth: target.maxHealth ?? target.maxHp ?? 100,
      targetKilled: false,
      reason: "context_evade",
    };
  }

  // Damage variance ±20% then context multiplier
  const variance = 0.8 + Math.random() * 0.4;
  const variedBase = Math.max(1, Math.round(baseDamage * variance * damageMul));

  // Hit zone selection
  const hitZone = _pickHitZone();

  // Per-zone armor — initialize if first hit
  if (!target.limbArmor) {
    target.limbArmor = { head: 100, torso: 100, left_arm: 100, right_arm: 100, left_leg: 100, right_leg: 100 };
  }
  const zoneArmorBefore = target.limbArmor[hitZone] ?? 100;

  // Armor pierce reduces zone armor directly (per-hit, clamped 0–100)
  const effectivePierce = Math.min(armorPierce, zoneArmorBefore);
  const armorForCalc = Math.max(0, zoneArmorBefore - effectivePierce);

  // Mitigation: zone armor gives up to 70% damage reduction at full integrity
  const mitFactor = _armorMitigation(armorForCalc);
  const mitigated = Math.max(1, Math.floor(variedBase * (1 - mitFactor)));

  const isCrit = Math.random() > 0.85;
  // Server-authoritative ceiling: bound the resolved (post-crit) damage so a
  // client-supplied baseDamage can never one-shot regardless of variance/crit.
  // maxDamage defaults to Infinity (NPC/legacy callers unaffected); the socket
  // PvP path passes resolvedDamageCap() to close the injection exploit.
  const damage = Math.min(isCrit ? mitigated * 2 : mitigated, maxDamage);

  // Degrade zone armor — each hit reduces it; heavier hits + crits degrade more
  const armorDeg = Math.min(zoneArmorBefore, Math.ceil((damage / 3) + (isCrit ? 5 : 0)));
  target.limbArmor[hitZone] = Math.max(0, zoneArmorBefore - armorDeg);
  const zoneArmorAfter = target.limbArmor[hitZone];

  // Track zone-specific HP (tissue damage) — separate from global health
  if (!target.limbHealth) {
    target.limbHealth = { head: 100, torso: 100, left_arm: 100, right_arm: 100, left_leg: 100, right_leg: 100 };
  }
  // Zone takes proportional tissue damage (head/limbs are more fragile than torso)
  const zoneFragility = hitZone === 'head' ? 1.5 : (hitZone === 'torso' ? 0.6 : 1.0);
  const zoneDmg = Math.min(target.limbHealth[hitZone], Math.ceil(damage * zoneFragility * 0.3));
  target.limbHealth[hitZone] = Math.max(0, target.limbHealth[hitZone] - zoneDmg);

  // Apply to global health
  target.health = Math.max(0, (target.health || 100) - damage);
  const targetKilled = target.health === 0;

  // Zone debuffs — check new threshold crossing
  const newDebuff = _getZoneDebuff(hitZone, zoneArmorAfter);
  if (newDebuff) {
    if (!target.activeDebuffs) target.activeDebuffs = new Set();
    target.activeDebuffs.add(newDebuff);
  }

  // Attacker spends stamina + gets marked dirty for save
  attacker.stamina = Math.max(0, (attacker.stamina || 0) - STAMINA_COST);
  attacker.dirty = true;

  // Mark target dirty if it's a player
  if (isPlayerTarget) target.dirty = true;

  // Fire world-mechanics triggers
  if (_fireTrigger && !isPlayerTarget) {
    try {
      _fireTrigger(attacker.cityId, "npc_attacked", {
        attackerId,
        targetId,
        damage,
        npcType: target.occupation,
      });
      if (targetKilled) {
        _fireTrigger(attacker.cityId, "npc_defeated", {
          attackerId,
          targetId,
          npcType: target.occupation,
        });
      }
    } catch (_e) { /* non-fatal */ }
  }

  // Despawn dead NPCs
  if (targetKilled && !isPlayerTarget) {
    _npcState.delete(targetId);
  }

  return {
    ok: true,
    damage,
    isCrit,
    hitZone,
    targetHealth: target.health,
    targetMaxHealth: target.maxHealth || 100,
    targetKilled,
    attackerStamina: attacker.stamina,
    limbDamage: { ...target.limbHealth },
    limbArmor:  { ...target.limbArmor  },
    newDebuff,
  };
}

/**
 * Respawn a player at a safe location with full HP/stamina.
 * Called after death — typically at a district hub.
 */
export function respawnPlayer(userId, { cityId, x = 0, y = 0, z = 0 } = {}) {
  const pos = _userPositions.get(userId);
  if (!pos) return { ok: false, error: "player_not_found" };
  pos.health = pos.maxHealth || 100;
  pos.stamina = pos.maxStamina || 100;
  if (cityId) pos.cityId = cityId;
  pos.x = x;
  pos.y = y;
  pos.z = z;
  pos.currentAnimation = "idle";
  pos.action = "idle";
  pos.dirty = true;
  return { ok: true, position: { x, y, z }, health: pos.health };
}

/**
 * Return a sample of active NPCs for quest-emergence scanning.
 * Capped at 20 to avoid saturating the governor tick.
 */
export function getAllNPCsForEmergence() {
  const result = [];
  for (const [id, npc] of _npcState) {
    result.push({ id, worldId: npc.cityId, npcType: npc.occupation, needs: npc.needs ?? {} });
    if (result.length >= 20) break;
  }
  return result;
}

/**
 * Regenerate a player's stamina over time. Called from the broadcast
 * loop — adds 1 stamina per tick up to the max.
 */
function regenStamina() {
  for (const [, pos] of _userPositions) {
    if (pos.stamina < pos.maxStamina) {
      pos.stamina = Math.min(pos.maxStamina, pos.stamina + 1);
    }
  }
}
