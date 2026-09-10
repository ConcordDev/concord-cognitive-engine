// shared-state — Redis write-through for process-local maps that split multi-HTTP.
//
// Fail-soft: memory is always primary (sync). Redis is write-behind / read-through
// when a client is connected. SQLite optional for durable session-activity rows.
// See docs/CONCURRENCY_STATE_AUDIT.md Tier S.
//
// Intentionally NOT covered (derived / per-node OK): STATE.qualia, STATE.shadowDtus.
// Chat sessions + styleVectors: Redis KV write-through (this module) + nginx sticky.
// Socket rooms: @socket.io/redis-adapter fans out; we also mirror membership sets
// for observability / drain hooks.

const PREFIX = () => process.env.REDIS_PREFIX || "concord:";

const SESSION_TTL_SEC = () =>
  Math.max(300, Number(process.env.CONCORD_CHAT_SESSION_TTL_SEC) || 7 * 86400);
const STYLE_TTL_SEC = () =>
  Math.max(300, Number(process.env.CONCORD_STYLE_VECTOR_TTL_SEC) || 7 * 86400);
const ROOM_TTL_SEC = () =>
  Math.max(60, Number(process.env.CONCORD_SOCKET_ROOM_TTL_SEC) || 86400);

/** Serialize chat session for Redis (Sets → arrays; cap messages). */
export function serializeChatSession(sess) {
  if (!sess || typeof sess !== "object") return null;
  const participantIds = sess.participantIds
    ? Array.from(sess.participantIds instanceof Set ? sess.participantIds : sess.participantIds)
    : [];
  return {
    ownerId: sess.ownerId ?? null,
    participantIds,
    createdAt: sess.createdAt || null,
    messages: Array.isArray(sess.messages) ? sess.messages.slice(-60) : [],
    currentLens: sess.currentLens ?? null,
    lensHistory: Array.isArray(sess.lensHistory) ? sess.lensHistory.slice(-20) : [],
    crossDomainContext:
      sess.crossDomainContext && typeof sess.crossDomainContext === "object"
        ? sess.crossDomainContext
        : {},
    updatedAt: sess.updatedAt || new Date().toISOString(),
  };
}

/** Rehydrate Redis payload into an in-memory session shape. */
export function deserializeChatSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const participantIds = new Set(
    Array.isArray(raw.participantIds) ? raw.participantIds.filter(Boolean).map(String) : []
  );
  return {
    ownerId: raw.ownerId ?? null,
    participantIds,
    createdAt: raw.createdAt || new Date().toISOString(),
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-200) : [],
    currentLens: raw.currentLens ?? null,
    lensHistory: Array.isArray(raw.lensHistory) ? raw.lensHistory.slice(-40) : [],
    crossDomainContext:
      raw.crossDomainContext && typeof raw.crossDomainContext === "object"
        ? raw.crossDomainContext
        : {},
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * @param {() => import('redis').RedisClientType | null | undefined} getRedis
 */
export function createSessionActivityBridge(getRedis, opts = {}) {
  const ttlSec = Math.max(
    60,
    Number(opts.ttlSec) ||
      Math.ceil((Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 7 * 86400000) / 1000) * 2
  );
  const keyFor = (jti) => `${PREFIX()}session-activity:${jti}`;

  return {
    /** Fire-and-forget write-behind after local Map.set */
    writeBehindTouch(jti, ts) {
      if (!jti) return;
      const redis = getRedis?.();
      if (!redis) return;
      redis.setEx(keyFor(jti), ttlSec, String(ts)).catch(() => {});
    },
    writeBehindClear(jti) {
      if (!jti) return;
      const redis = getRedis?.();
      if (!redis) return;
      redis.del(keyFor(jti)).catch(() => {});
    },
    /** Async read-through — merge peer node's lastSeen into local Map */
    async hydrateInto(localMap, jti) {
      if (!jti || !localMap) return null;
      const redis = getRedis?.();
      if (!redis) return localMap.get(jti) ?? null;
      try {
        const raw = await redis.get(keyFor(jti));
        if (!raw) return localMap.get(jti) ?? null;
        const ts = Number(raw);
        if (!Number.isFinite(ts)) return localMap.get(jti) ?? null;
        const local = localMap.get(jti);
        if (local === undefined || ts > local) localMap.set(jti, ts);
        return localMap.get(jti);
      } catch {
        return localMap.get(jti) ?? null;
      }
    },
  };
}

/**
 * Chat STATE.sessions Redis write-through.
 * Local Map remains sync primary; Redis is shared cache across HTTP workers.
 *
 * @param {() => import('redis').RedisClientType | null | undefined} getRedis
 */
export function createChatSessionBridge(getRedis) {
  const keyFor = (sid) => `${PREFIX()}chat-session:${sid}`;
  const dirty = new Set();

  return {
    markDirty(sessionId) {
      if (sessionId) dirty.add(String(sessionId));
    },
    /** Immediate write-behind (also clears dirty bit for sid). */
    writeBehindSession(sessionId, sess) {
      if (!sessionId || !sess) return;
      const sid = String(sessionId);
      dirty.delete(sid);
      const redis = getRedis?.();
      if (!redis) return;
      const payload = serializeChatSession(sess);
      if (!payload) return;
      redis
        .setEx(keyFor(sid), SESSION_TTL_SEC(), JSON.stringify(payload))
        .catch(() => {});
    },
    writeBehindClear(sessionId) {
      if (!sessionId) return;
      const sid = String(sessionId);
      dirty.delete(sid);
      const redis = getRedis?.();
      if (!redis) return;
      redis.del(keyFor(sid)).catch(() => {});
    },
    /**
     * Flush dirty session ids from a local Map (call from saveStateDebounced).
     * Caps to 200 per flush to bound Redis write storms.
     */
    flushDirty(localMap, limit = 200) {
      if (!localMap || dirty.size === 0) return 0;
      const redis = getRedis?.();
      if (!redis) {
        dirty.clear();
        return 0;
      }
      let n = 0;
      for (const sid of [...dirty]) {
        if (n >= limit) break;
        dirty.delete(sid);
        const sess = localMap.get(sid);
        if (!sess) continue;
        const payload = serializeChatSession(sess);
        if (!payload) continue;
        redis.setEx(keyFor(sid), SESSION_TTL_SEC(), JSON.stringify(payload)).catch(() => {});
        n++;
      }
      return n;
    },
    /** Read-through: if local miss (or force), load peer session from Redis. */
    async hydrateInto(localMap, sessionId, { force = false } = {}) {
      if (!sessionId || !localMap) return null;
      const sid = String(sessionId);
      if (!force && localMap.has(sid)) return localMap.get(sid);
      const redis = getRedis?.();
      if (!redis) return localMap.get(sid) ?? null;
      try {
        const raw = await redis.get(keyFor(sid));
        if (!raw) return localMap.get(sid) ?? null;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const sess = deserializeChatSession(parsed);
        if (!sess) return localMap.get(sid) ?? null;
        if (!localMap.has(sid) || force) {
          // Prefer peer if local empty/missing; merge messages by taking longer trail
          const local = localMap.get(sid);
          if (
            !local ||
            force ||
            (sess.messages?.length || 0) > (local.messages?.length || 0)
          ) {
            localMap.set(sid, sess);
          }
        }
        return localMap.get(sid);
      } catch {
        return localMap.get(sid) ?? null;
      }
    },
    /**
     * Write the most recently inserted sessions (Map insertion order).
     * Covers in-place mutations (messages.push) that skip Map.set.
     */
    writeBehindRecent(localMap, limit = 50) {
      if (!localMap) return 0;
      const redis = getRedis?.();
      if (!redis) return 0;
      const entries = Array.from(localMap.entries());
      const slice = entries.slice(-Math.max(1, limit));
      let n = 0;
      for (const [sid, sess] of slice) {
        const payload = serializeChatSession(sess);
        if (!payload) continue;
        redis.setEx(keyFor(String(sid)), SESSION_TTL_SEC(), JSON.stringify(payload)).catch(() => {});
        dirty.delete(String(sid));
        n++;
      }
      return n;
    },
    dirtySize() {
      return dirty.size;
    },
  };
}

/**
 * STATE.styleVectors Redis write-through.
 * @param {() => import('redis').RedisClientType | null | undefined} getRedis
 */
export function createStyleVectorBridge(getRedis) {
  const keyFor = (sid) => `${PREFIX()}style-vector:${sid}`;
  const dirty = new Set();

  return {
    markDirty(sessionId) {
      if (sessionId) dirty.add(String(sessionId));
    },
    writeBehindStyle(sessionId, vec) {
      if (!sessionId || !vec || typeof vec !== "object") return;
      const sid = String(sessionId);
      dirty.delete(sid);
      const redis = getRedis?.();
      if (!redis) return;
      redis.setEx(keyFor(sid), STYLE_TTL_SEC(), JSON.stringify(vec)).catch(() => {});
    },
    writeBehindClear(sessionId) {
      if (!sessionId) return;
      const sid = String(sessionId);
      dirty.delete(sid);
      const redis = getRedis?.();
      if (!redis) return;
      redis.del(keyFor(sid)).catch(() => {});
    },
    flushDirty(localMap, limit = 200) {
      if (!localMap || dirty.size === 0) return 0;
      const redis = getRedis?.();
      if (!redis) {
        dirty.clear();
        return 0;
      }
      let n = 0;
      for (const sid of [...dirty]) {
        if (n >= limit) break;
        dirty.delete(sid);
        const vec = localMap.get(sid);
        if (!vec || typeof vec !== "object") continue;
        redis.setEx(keyFor(sid), STYLE_TTL_SEC(), JSON.stringify(vec)).catch(() => {});
        n++;
      }
      return n;
    },
    async hydrateInto(localMap, sessionId, { force = false } = {}) {
      if (!sessionId || !localMap) return null;
      const sid = String(sessionId);
      if (!force && localMap.has(sid)) return localMap.get(sid);
      const redis = getRedis?.();
      if (!redis) return localMap.get(sid) ?? null;
      try {
        const raw = await redis.get(keyFor(sid));
        if (!raw) return localMap.get(sid) ?? null;
        const vec = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!vec || typeof vec !== "object") return localMap.get(sid) ?? null;
        if (!localMap.has(sid) || force) localMap.set(sid, vec);
        return localMap.get(sid);
      } catch {
        return localMap.get(sid) ?? null;
      }
    },
    writeBehindRecent(localMap, limit = 50) {
      if (!localMap) return 0;
      const redis = getRedis?.();
      if (!redis) return 0;
      const entries = Array.from(localMap.entries());
      const slice = entries.slice(-Math.max(1, limit));
      let n = 0;
      for (const [sid, vec] of slice) {
        if (!vec || typeof vec !== "object") continue;
        redis.setEx(keyFor(String(sid)), STYLE_TTL_SEC(), JSON.stringify(vec)).catch(() => {});
        dirty.delete(String(sid));
        n++;
      }
      return n;
    },
    dirtySize() {
      return dirty.size;
    },
  };
}

/**
 * Mirror socket.io room membership into Redis sets (complement to redis-adapter).
 * Adapter already fans out events; this gives an explicit membership key for
 * drain / sticky observability.
 *
 * @param {() => import('redis').RedisClientType | null | undefined} getRedis
 */
export function createSocketRoomBridge(getRedis) {
  const keyFor = (room) => `${PREFIX()}socket-room:${room}`;

  return {
    writeBehindJoin(room, socketId) {
      if (!room || !socketId) return;
      const redis = getRedis?.();
      if (!redis) return;
      const k = keyFor(String(room));
      const ttl = ROOM_TTL_SEC();
      redis
        .multi()
        .sAdd(k, String(socketId))
        .expire(k, ttl)
        .exec()
        .catch(() => {});
    },
    writeBehindLeave(room, socketId) {
      if (!room || !socketId) return;
      const redis = getRedis?.();
      if (!redis) return;
      redis.sRem(keyFor(String(room)), String(socketId)).catch(() => {});
    },
    async members(room) {
      const redis = getRedis?.();
      if (!redis || !room) return [];
      try {
        return (await redis.sMembers(keyFor(String(room)))) || [];
      } catch {
        return [];
      }
    },
  };
}

/**
 * Wrap Map.set/delete so session/style mutations auto mark-dirty + write-behind.
 * In-place object mutation still needs markDirty/flush via saveStateDebounced.
 */
export function installMapWriteThrough(map, { onSet, onDelete } = {}) {
  if (!map || typeof map.set !== "function") return map;
  if (map.__concordWriteThrough) return map;
  const origSet = map.set.bind(map);
  const origDelete = map.delete.bind(map);
  const origClear = map.clear.bind(map);
  map.set = (k, v) => {
    const r = origSet(k, v);
    try {
      onSet?.(k, v);
    } catch {
      /* fail-soft */
    }
    return r;
  };
  map.delete = (k) => {
    const r = origDelete(k);
    try {
      onDelete?.(k);
    } catch {
      /* fail-soft */
    }
    return r;
  };
  map.clear = () => {
    const keys = [...map.keys()];
    const r = origClear();
    for (const k of keys) {
      try {
        onDelete?.(k);
      } catch {
        /* fail-soft */
      }
    }
    return r;
  };
  map.__concordWriteThrough = true;
  return map;
}

/**
 * Shared macro rate-limit: Redis counter per window, OR local LruMap fallback.
 */
export function createMacroRateBridge(getRedis) {
  const keyFor = (macroKey, windowId) => `${PREFIX()}macro-rl:${macroKey}:${windowId}`;

  return {
    writeBehindHit(macroKey, windowMs) {
      if (!macroKey) return;
      const redis = getRedis?.();
      if (!redis) return;
      const windowId = Math.floor(Date.now() / windowMs);
      const k = keyFor(macroKey, windowId);
      const ttl = Math.max(2, Math.ceil(windowMs / 1000) + 1);
      redis
        .multi()
        .incr(k)
        .expire(k, ttl)
        .exec()
        .catch(() => {});
    },
    async remoteCount(macroKey, windowMs) {
      const redis = getRedis?.();
      if (!redis || !macroKey) return null;
      try {
        const windowId = Math.floor(Date.now() / windowMs);
        const raw = await redis.get(keyFor(macroKey, windowId));
        return raw == null ? 0 : Number(raw) || 0;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Soft API usage windows — same pattern as macro RL.
 */
export function createApiRateBridge(getRedis) {
  const keyFor = (userKey, windowId) => `${PREFIX()}api-rl:${userKey}:${windowId}`;
  return {
    writeBehindHit(userKey, windowMs) {
      if (!userKey) return;
      const redis = getRedis?.();
      if (!redis) return;
      const windowId = Math.floor(Date.now() / windowMs);
      const k = keyFor(userKey, windowId);
      const ttl = Math.max(2, Math.ceil(windowMs / 1000) + 1);
      redis
        .multi()
        .incr(k)
        .expire(k, ttl)
        .exec()
        .catch(() => {});
    },
  };
}

export function sharedStateCoverage() {
  return {
    writeThrough: [
      "_SESSION_ACTIVITY.lastSeen",
      "_macroRateLimits",
      "_TOKEN_BLACKLIST (pre-existing)",
      "sticky-session (observability, CONCORD_STICKY_REDIS)",
      "STATE.sessions (Redis KV chat-session:*)",
      "STATE.styleVectors (Redis KV style-vector:*)",
      "socket.io rooms (redis-adapter + socket-room:* membership mirror)",
    ],
    stickyRequired: [
      // Sticky still recommended for chat UX (avoids hydrate race on first hop)
      // but no longer correctness-hard for sessions/styleVectors/rooms.
    ],
    stickyRecommended: ["chat HTTP until hydrate settles", "long-lived SSE streams"],
    perNodeOk: ["STATE.qualia", "STATE.shadowDtus", "_llmQueue", "_breakers"],
  };
}
