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

// ── State ───────────────────────────────────────────────────────────────────

/** userId -> { cityId, x, y, z, direction, action, lastUpdate, avatar } */
const _userPositions = new Map();

/** "${cityId}:${chunkX}:${chunkZ}" -> Set<userId> */
const _cityChunks = new Map();

const CHUNK_SIZE = 100; // metres per chunk edge
const MAX_VISIBLE_AVATARS = 100;

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
export function updateUserPosition(userId, { cityId, x, y, z, direction, action }) {
  const prev = _userPositions.get(userId);
  const newChunkX = toChunk(x);
  const newChunkZ = toChunk(z);

  // Remove from old chunk if city or chunk changed
  if (prev) {
    const oldChunkX = toChunk(prev.x);
    const oldChunkZ = toChunk(prev.z);
    if (prev.cityId !== cityId || oldChunkX !== newChunkX || oldChunkZ !== newChunkZ) {
      removeFromChunk(userId, prev.cityId, oldChunkX, oldChunkZ);
      addToChunk(userId, cityId, newChunkX, newChunkZ);
    }
  } else {
    addToChunk(userId, cityId, newChunkX, newChunkZ);
  }

  const entry = {
    cityId,
    x,
    y,
    z,
    direction,
    action,
    lastUpdate: Date.now(),
    avatar: prev?.avatar ?? null,
  };
  _userPositions.set(userId, entry);

  const nearby = getNearbyUsers(userId);
  return { nearby };
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
 * Get all users within `radius` metres of the given user in the same city.
 *
 * @param {string} userId
 * @param {number} [radius=500]
 * @returns {object[]}
 */
export function getNearbyUsers(userId, radius = 500) {
  const pos = _userPositions.get(userId);
  if (!pos) return [];

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
 * Remove a user from the presence system (on disconnect / leave).
 * @param {string} userId
 */
export function removeUser(userId) {
  const pos = _userPositions.get(userId);
  if (pos) {
    removeFromChunk(userId, pos.cityId, toChunk(pos.x), toChunk(pos.z));
    _userPositions.delete(userId);
    logger.debug("city-presence", `User ${userId} removed from presence`);
  }
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
  // Collect distinct cityIds on each tick
  const timer = setInterval(() => {
    const cities = new Set();
    for (const [, pos] of _userPositions) {
      cities.add(pos.cityId);
    }
    for (const cityId of cities) {
      broadcastPositions(cityId, realtimeEmit);
    }
  }, intervalMs);

  logger.info("city-presence", `Presence broadcast started (${intervalMs}ms interval)`);

  return () => {
    clearInterval(timer);
    logger.info("city-presence", "Presence broadcast stopped");
  };
}

/**
 * Return aggregate presence statistics.
 * @returns {{ totalOnline: number, byCityCount: Map<string, number> }}
 */
export function getPresenceStats() {
  const byCityCount = new Map();
  for (const [, pos] of _userPositions) {
    byCityCount.set(pos.cityId, (byCityCount.get(pos.cityId) || 0) + 1);
  }
  return {
    totalOnline: _userPositions.size,
    byCityCount,
  };
}
