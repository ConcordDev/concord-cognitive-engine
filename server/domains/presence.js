// server/domains/presence.js
//
// Player-presence lens-action domain (id "presence"). Backs the de-demo'd
// PlayerPresence panel with REAL data: a recorded heartbeat per user with a
// {worldId, activity, position} payload, and live rosters/stats computed from
// those heartbeats. Empty by construction — no fabricated players; a world
// shows nobody until real users send heartbeats.
//
// In-memory, STATE-backed (no migrations). The store lives on the shared
// globalThis._concordSTATE as `STATE.presenceHeartbeats` (a Map keyed by
// `${worldId}::${userId}` → heartbeat record). When the optional public-profile
// store is present (STATE.users / STATE.profiles), active-list joins a few
// non-sensitive display fields; otherwise it returns the bare presence shape.
//
// Macros: heartbeat, active-list, presence-stats, clear-stale.

export default function registerPresenceActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function state() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    return globalThis._concordSTATE;
  }
  // Map<`${worldId}::${userId}`, Heartbeat>
  function store() {
    const STATE = state();
    if (!(STATE.presenceHeartbeats instanceof Map)) STATE.presenceHeartbeats = new Map();
    return STATE.presenceHeartbeats;
  }
  function savePresence() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const keyOf = (worldId, userId) => `${worldId}::${userId}`;

  // Default "recent" window for a heartbeat to count as online.
  const DEFAULT_WINDOW_MS = 5 * 60 * 1000;     // 5 minutes
  const MIN_WINDOW_MS = 10 * 1000;             // 10 seconds
  const MAX_WINDOW_MS = 60 * 60 * 1000;        // 1 hour
  const MAX_RESULTS = 200;

  // The activity vocabulary mirrors the panel's ActivityStatus union. An
  // unknown/absent activity normalises to "idle" so the UI always has a valid
  // status to render.
  const ACTIVITIES = [
    "building", "trading", "exploring", "socializing", "mentoring", "spectating", "idle",
  ];
  function normActivity(a) {
    const v = String(a || "").trim().toLowerCase();
    return ACTIVITIES.includes(v) ? v : "idle";
  }
  function clampWindow(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return DEFAULT_WINDOW_MS;
    return Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, n));
  }
  // Sanitise an incoming position into a plain {x,y,z} of finite numbers, or
  // null when none was supplied. Never trusts arbitrary objects.
  function normPosition(p) {
    if (!p || typeof p !== "object") return null;
    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x, y, z };
  }

  // Optional public-profile join. Returns ONLY non-sensitive display fields and
  // only when a profile store actually exists — otherwise {} so the caller
  // emits no fabricated profession/firm/etc.
  function publicProfile(userId) {
    const STATE = state();
    let u = null;
    if (STATE.users instanceof Map) u = STATE.users.get(userId);
    else if (STATE.profiles instanceof Map) u = STATE.profiles.get(userId);
    if (!u || typeof u !== "object") return {};
    const out = {};
    const name = u.displayName || u.username || u.name;
    if (name) out.name = String(name);
    if (u.avatar) out.avatar = String(u.avatar);
    return out;
  }

  // ── heartbeat ────────────────────────────────────────────────────
  // Record (upsert) the caller's presence in a world right now.
  registerLensAction("presence", "heartbeat", (ctx, _artifact, params = {}) => {
    try {
      const p = params || {};
      const userId = aid(ctx);
      const worldId = String(p.worldId || "").trim();
      if (!worldId) return { ok: false, error: "worldId required" };
      const activity = normActivity(p.activity || p.lens);
      // `lens` is accepted as a free-form label (e.g. which lens the user is on);
      // it's kept verbatim alongside the normalised activity for richer stats.
      const lens = p.lens !== undefined && p.lens !== null ? String(p.lens).slice(0, 64) : null;
      const position = normPosition(p.position);
      const now = Date.now();
      const hb = {
        userId,
        worldId,
        activity,
        lens,
        position,
        at: new Date(now).toISOString(),
        ts: now,
      };
      store().set(keyOf(worldId, userId), hb);
      savePresence();
      return { ok: true, result: { heartbeat: hb } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── active-list ──────────────────────────────────────────────────
  // Return users with a heartbeat in the given world inside the window. Real —
  // empty until heartbeats exist. Joins optional public-profile fields.
  registerLensAction("presence", "active-list", (ctx, _artifact, params = {}) => {
    try {
      const p = params || {};
      const worldId = String(p.worldId || "").trim();
      if (!worldId) return { ok: false, error: "worldId required" };
      const windowMs = clampWindow(p.windowMs);
      const limit = Math.max(1, Math.min(MAX_RESULTS, Number(p.limit) || 50));
      const now = Date.now();
      const cutoff = now - windowMs;
      const rows = [];
      for (const hb of store().values()) {
        if (hb.worldId !== worldId) continue;
        if (hb.ts < cutoff) continue;
        const row = {
          userId: hb.userId,
          worldId: hb.worldId,
          activity: hb.activity,
          lens: hb.lens,
          position: hb.position,
          lastSeenAt: hb.at,
          ageMs: now - hb.ts,
          online: true,
          ...publicProfile(hb.userId),
        };
        rows.push(row);
      }
      // Most-recently-seen first.
      rows.sort((a, b) => a.ageMs - b.ageMs);
      const players = rows.slice(0, limit);
      return { ok: true, result: { players, count: players.length, worldId, windowMs } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── presence-stats ───────────────────────────────────────────────
  // Count online users per world and per activity within a window. With no
  // worldId, aggregates across every world.
  registerLensAction("presence", "presence-stats", (_ctx, _artifact, params = {}) => {
    try {
      const p = params || {};
      const windowMs = clampWindow(p.windowMs);
      const filterWorld = p.worldId ? String(p.worldId).trim() : null;
      const now = Date.now();
      const cutoff = now - windowMs;
      let totalOnline = 0;
      const byWorld = {};
      const byActivity = {};
      for (const hb of store().values()) {
        if (hb.ts < cutoff) continue;
        if (filterWorld && hb.worldId !== filterWorld) continue;
        totalOnline += 1;
        byWorld[hb.worldId] = (byWorld[hb.worldId] || 0) + 1;
        byActivity[hb.activity] = (byActivity[hb.activity] || 0) + 1;
      }
      return {
        ok: true,
        result: {
          totalOnline,
          worldCount: Object.keys(byWorld).length,
          byWorld,
          byActivity,
          windowMs,
          ...(filterWorld ? { worldId: filterWorld } : {}),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── clear-stale ──────────────────────────────────────────────────
  // GC heartbeats older than `olderThanMs` (defaults to MAX_WINDOW_MS). Returns
  // how many rows were removed and how many remain.
  registerLensAction("presence", "clear-stale", (_ctx, _artifact, params = {}) => {
    try {
      const p = params || {};
      const olderThanMs = clampWindow(p.olderThanMs ?? MAX_WINDOW_MS);
      const now = Date.now();
      const cutoff = now - olderThanMs;
      const s = store();
      let removed = 0;
      for (const [k, hb] of s) {
        if (hb.ts < cutoff) { s.delete(k); removed += 1; }
      }
      if (removed > 0) savePresence();
      return { ok: true, result: { removed, remaining: s.size, olderThanMs } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
