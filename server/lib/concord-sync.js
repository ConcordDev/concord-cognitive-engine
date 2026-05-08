/**
 * Concord Sync — Real-Time Synchronization Engine
 *
 * Manages collaborative rooms with presence tracking, state synchronization,
 * conflict resolution, and object locking. Designed for real-time multi-user
 * experiences within Concord Global City.
 *
 * Features:
 *   - Room creation with configurable max users and state storage
 *   - User presence with auto-assigned colors and cursor tracking
 *   - Optimistic state sync with pluggable conflict resolution
 *   - Object locking with 30-second auto-release
 *   - Heartbeat-based stale session detection
 *   - Simulated broadcast for event distribution
 */

'use strict';

// ── Constants ───────────────────────────────────────────────────────────────

const COLOR_PALETTE = Object.freeze([
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
]);

const LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_USERS = 200;
const STALE_THRESHOLD_MS = 15_000; // 3 missed heartbeats

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix) {
  const hex = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${hex}` : hex;
}

function now() {
  return Date.now();
}

function deepGet(obj, path) {
  if (!path) return obj;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function deepSet(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── ConcordSync ─────────────────────────────────────────────────────────────

class ConcordSync {
  constructor() {
    /** roomId -> { id, config, state, users, locks, cursors, log, createdAt, lastActivity } */
    this.rooms = new Map();

    /** global session index: userId -> { roomId, joinedAt, lastHeartbeat, color } */
    this.sessions = new Map();

    /** broadcast listeners: roomId -> [callback, ...] */
    this._listeners = new Map();

    /** metrics */
    this._messageCount = 0;
    this._metricsWindowStart = now();
  }

  // ── Room lifecycle ──────────────────────────────────────────────────────

  /**
   * Create a collaborative room.
   * @param {string} roomId - unique room identifier
   * @param {object} [config] - room configuration
   * @returns {object} room descriptor
   */
  createRoom(roomId, config = {}) {
    if (this.rooms.has(roomId)) {
      return { ok: false, error: 'room_exists', roomId };
    }

    const room = {
      id: roomId,
      config: {
        maxUsers: config.maxUsers || DEFAULT_MAX_USERS,
        persistent: config.persistent || false,
        name: config.name || roomId,
      },
      state: config.initialState ? cloneDeep(config.initialState) : {},
      stateVersion: 0,
      users: new Map(),
      locks: new Map(),
      cursors: new Map(),
      log: [],
      createdAt: now(),
      lastActivity: now(),
    };

    this.rooms.set(roomId, room);
    return { ok: true, roomId, createdAt: room.createdAt };
  }

  /**
   * Add a user to a room.
   * @param {string} roomId
   * @param {object} user - { id, name, avatar? }
   * @returns {object} join result with assigned color
   */
  joinRoom(roomId, user) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.users.size >= room.config.maxUsers) {
      return { ok: false, error: 'room_full' };
    }
    if (room.users.has(user.id)) {
      return { ok: false, error: 'already_joined' };
    }

    const colorIndex = room.users.size % COLOR_PALETTE.length;
    const color = COLOR_PALETTE[colorIndex];

    const presence = {
      id: user.id,
      name: user.name || 'Anonymous',
      avatar: user.avatar || null,
      color,
      status: 'active',
      joinedAt: now(),
      lastHeartbeat: now(),
      cursorPosition: null,
    };

    room.users.set(user.id, presence);
    room.lastActivity = now();

    this.sessions.set(user.id, {
      roomId,
      joinedAt: presence.joinedAt,
      lastHeartbeat: presence.lastHeartbeat,
      color,
    });

    this.broadcast(roomId, 'user:joined', {
      userId: user.id,
      name: presence.name,
      color,
    });

    return { ok: true, color, userCount: room.users.size };
  }

  /**
   * Remove a user from a room, releasing any held locks.
   * @param {string} roomId
   * @param {string} userId
   * @returns {object} leave result
   */
  leaveRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (!room.users.has(userId)) return { ok: false, error: 'not_in_room' };

    // Release all locks held by this user
    const releasedLocks = [];
    for (const [objectId, lock] of room.locks) {
      if (lock.userId === userId) {
        room.locks.delete(objectId);
        releasedLocks.push(objectId);
      }
    }

    room.users.delete(userId);
    room.cursors.delete(userId);
    room.lastActivity = now();
    this.sessions.delete(userId);

    this.broadcast(roomId, 'user:left', { userId, releasedLocks });

    return { ok: true, releasedLocks, userCount: room.users.size };
  }

  // ── State synchronization ───────────────────────────────────────────────

  /**
   * Apply a state change to a room with conflict detection.
   * @param {string} roomId
   * @param {object} change - { path, value, userId, baseVersion? }
   * @returns {object} result with new version or conflict info
   */
  updateState(roomId, change) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };

    const { path, value, userId, baseVersion } = change;

    // Conflict detection: if caller provides baseVersion, check for divergence
    if (baseVersion !== undefined && baseVersion !== room.stateVersion) {
      const currentValue = deepGet(room.state, path);
      const conflict = {
        ok: false,
        error: 'conflict',
        path,
        localValue: value,
        remoteValue: currentValue,
        localVersion: baseVersion,
        remoteVersion: room.stateVersion,
      };
      return conflict;
    }

    // Check if path is locked by another user
    if (path) {
      const rootObject = path.split('.')[0];
      const lock = room.locks.get(rootObject);
      if (lock && lock.userId !== userId) {
        return { ok: false, error: 'locked', lockedBy: lock.userId, objectId: rootObject };
      }
    }

    // Apply the change
    if (path) {
      deepSet(room.state, path, cloneDeep(value));
    } else {
      room.state = cloneDeep(value);
    }

    room.stateVersion++;
    room.lastActivity = now();

    const entry = {
      version: room.stateVersion,
      path: path || '/',
      userId,
      timestamp: now(),
    };
    room.log.push(entry);
    if (room.log.length > 500) room.log.shift();

    this._messageCount++;

    this.broadcast(roomId, 'state:updated', {
      path: path || '/',
      version: room.stateVersion,
      userId,
    });

    return { ok: true, version: room.stateVersion };
  }

  /**
   * Get the full room state or a specific path.
   * @param {string} roomId
   * @param {string} [path] - dot-delimited path
   * @returns {*} state value or undefined
   */
  getState(roomId, path) {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    const val = path ? deepGet(room.state, path) : room.state;
    return val !== undefined ? cloneDeep(val) : undefined;
  }

  // ── Cursor tracking ─────────────────────────────────────────────────────

  /**
   * Update a user's cursor position.
   * @param {string} roomId
   * @param {string} userId
   * @param {object} position - { x, y, z, target? }
   */
  trackCursor(roomId, userId, position) {
    const room = this.rooms.get(roomId);
    if (!room || !room.users.has(userId)) return { ok: false, error: 'invalid_room_or_user' };

    const cursor = {
      x: position.x || 0,
      y: position.y || 0,
      z: position.z || 0,
      target: position.target || null,
      updatedAt: now(),
    };

    room.cursors.set(userId, cursor);
    room.lastActivity = now();

    const user = room.users.get(userId);
    user.lastHeartbeat = now();
    user.cursorPosition = cursor;

    const session = this.sessions.get(userId);
    if (session) session.lastHeartbeat = now();

    return { ok: true };
  }

  /**
   * Get all cursor positions in a room.
   * @param {string} roomId
   * @returns {object} userId -> cursor map
   */
  getCursors(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return {};

    const result = {};
    for (const [userId, cursor] of room.cursors) {
      const user = room.users.get(userId);
      result[userId] = {
        ...cursor,
        color: user ? user.color : null,
        name: user ? user.name : 'Unknown',
      };
    }
    return result;
  }

  // ── Object locking ──────────────────────────────────────────────────────

  /**
   * Acquire a lock on an object. Auto-releases after 30 seconds.
   * @param {string} roomId
   * @param {string} objectId
   * @param {string} userId
   * @returns {object} lock result
   */
  lock(roomId, objectId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (!room.users.has(userId)) return { ok: false, error: 'not_in_room' };

    const existing = room.locks.get(objectId);
    if (existing) {
      // Check if existing lock has expired
      if (now() - existing.acquiredAt > LOCK_TTL_MS) {
        room.locks.delete(objectId);
      } else if (existing.userId !== userId) {
        return { ok: false, error: 'already_locked', lockedBy: existing.userId };
      } else {
        // Same user re-acquiring — refresh
        existing.acquiredAt = now();
        return { ok: true, refreshed: true };
      }
    }

    const lockEntry = {
      objectId,
      userId,
      acquiredAt: now(),
      expiresAt: now() + LOCK_TTL_MS,
    };

    room.locks.set(objectId, lockEntry);
    room.lastActivity = now();

    this.broadcast(roomId, 'lock:acquired', { objectId, userId });

    return { ok: true, expiresAt: lockEntry.expiresAt };
  }

  /**
   * Release a lock on an object.
   * @param {string} roomId
   * @param {string} objectId
   * @param {string} userId
   * @returns {object} unlock result
   */
  unlock(roomId, objectId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };

    const existing = room.locks.get(objectId);
    if (!existing) return { ok: false, error: 'not_locked' };
    if (existing.userId !== userId) return { ok: false, error: 'not_lock_owner' };

    room.locks.delete(objectId);
    room.lastActivity = now();

    this.broadcast(roomId, 'lock:released', { objectId, userId });

    return { ok: true };
  }

  /**
   * Check if an object is locked.
   * @param {string} roomId
   * @param {string} objectId
   * @returns {object|false} lock info or false
   */
  isLocked(roomId, objectId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const lock = room.locks.get(objectId);
    if (!lock) return false;

    // Check expiry
    if (now() - lock.acquiredAt > LOCK_TTL_MS) {
      room.locks.delete(objectId);
      return false;
    }

    return {
      locked: true,
      userId: lock.userId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
    };
  }

  // ── Presence ────────────────────────────────────────────────────────────

  /**
   * Get presence info for all users in a room.
   * @param {string} roomId
   * @returns {Array} user presence list
   */
  getPresence(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const currentTime = now();
    const presence = [];

    for (const [userId, user] of room.users) {
      const idle = currentTime - user.lastHeartbeat > HEARTBEAT_INTERVAL_MS * 2;
      const stale = currentTime - user.lastHeartbeat > STALE_THRESHOLD_MS;

      let status = 'active';
      if (stale) status = 'stale';
      else if (idle) status = 'idle';

      presence.push({
        userId,
        name: user.name,
        color: user.color,
        avatar: user.avatar,
        status,
        joinedAt: user.joinedAt,
        lastHeartbeat: user.lastHeartbeat,
        cursor: room.cursors.get(userId) || null,
      });
    }

    return presence;
  }

  // ── Conflict resolution ─────────────────────────────────────────────────

  /**
   * Resolve a state conflict between local and remote values.
   * @param {*} local - local value
   * @param {*} remote - remote value
   * @param {string} strategy - 'last-write-wins' | 'both-apply' | 'manual'
   * @returns {object} resolution result
   */
  resolveConflict(local, remote, strategy) {
    switch (strategy) {
      case 'last-write-wins':
        return { resolved: true, value: remote, strategy };

      case 'both-apply':
        // Merge arrays or objects; primitives fall back to remote
        if (Array.isArray(local) && Array.isArray(remote)) {
          return { resolved: true, value: [...remote, ...local], strategy };
        }
        if (typeof local === 'object' && local !== null &&
            typeof remote === 'object' && remote !== null) {
          return { resolved: true, value: { ...local, ...remote }, strategy };
        }
        return { resolved: true, value: remote, strategy };

      case 'manual':
        return {
          resolved: false,
          strategy,
          local,
          remote,
          message: 'Manual resolution required — present both values to user.',
        };

      default:
        return { resolved: false, error: 'unknown_strategy', strategy };
    }
  }

  // ── Broadcast ───────────────────────────────────────────────────────────

  /**
   * Simulated broadcast to all users in a room.
   * @param {string} roomId
   * @param {string} event - event name
   * @param {*} data - event payload
   */
  broadcast(roomId, event, data) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this._messageCount++;

    const message = {
      id: uid('msg'),
      roomId,
      event,
      data,
      timestamp: now(),
      recipients: Array.from(room.users.keys()),
    };

    room.log.push({ type: 'broadcast', event, timestamp: message.timestamp });
    if (room.log.length > 500) room.log.shift();

    // Notify registered listeners
    const listeners = this._listeners.get(roomId);
    if (listeners) {
      for (const callback of listeners) {
        try { callback(message); } catch (_) { /* silent */ }
      }
    }

    return message;
  }

  /**
   * Register a listener for room broadcasts (for testing / integration).
   * @param {string} roomId
   * @param {Function} callback
   */
  onBroadcast(roomId, callback) {
    if (!this._listeners.has(roomId)) {
      this._listeners.set(roomId, []);
    }
    this._listeners.get(roomId).push(callback);
  }

  // ── Metrics & maintenance ───────────────────────────────────────────────

  /**
   * Get aggregate stats across all rooms.
   * @returns {object} stats
   */
  getRoomStats() {
    let totalUsers = 0;
    let totalLocks = 0;

    for (const room of this.rooms.values()) {
      totalUsers += room.users.size;
      totalLocks += room.locks.size;
    }

    const elapsed = Math.max(1, (now() - this._metricsWindowStart) / 1000);
    const messagesPerSecond = Math.round((this._messageCount / elapsed) * 100) / 100;

    return {
      totalRooms: this.rooms.size,
      totalUsers,
      totalLocks,
      totalSessions: this.sessions.size,
      messagesPerSecond,
      uptimeMs: now() - this._metricsWindowStart,
    };
  }

  /**
   * Remove rooms with no activity for longer than maxIdleMs.
   * @param {number} [maxIdleMs=300000] - idle threshold (default 5 minutes)
   * @returns {object} cleanup result
   */
  cleanupStaleRooms(maxIdleMs = 300_000) {
    const currentTime = now();
    const removed = [];

    for (const [roomId, room] of this.rooms) {
      if (currentTime - room.lastActivity > maxIdleMs) {
        // Remove sessions for users in this room
        for (const userId of room.users.keys()) {
          this.sessions.delete(userId);
        }
        this._listeners.delete(roomId);
        this.rooms.delete(roomId);
        removed.push(roomId);
      }
    }

    return { removed, count: removed.length };
  }
}

module.exports = ConcordSync;
