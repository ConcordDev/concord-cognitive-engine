// server/domains/companion.js
//
// Mobile-companion lens-action domain (id "companion"). Backs the de-demo'd
// MobileCompanion panel with REAL per-user data:
//   - feed: the user's REAL recent activity — newest authored DTUs (creator_id /
//     owner_user_id) joined with their unread STATE-backed notifications — as a
//     newest-first list. EMPTY when the user has no activity. NEVER fabricated.
//   - notifications-list / notification-add / notification-mark-read: a
//     STATE-backed per-user notification inbox (round-trip, unread count).
//   - overnight-summary: a deterministic digest of what changed for the user
//     since a `since` timestamp, counted from the SAME real feed sources.
//     Empty / zeros when nothing changed.
//   - push-prefs-get / push-prefs-set: per-user notification settings round-trip.
//
// Honest by construction: aggregate REAL sources where present; return EMPTY
// ([] / zeros) where not. A user sees nothing until they author a DTU or
// receive a notification. No migrations — STATE-backed for the mutable bits,
// real DB reads for the activity feed.
//
// Per-user scope via ctx.actor.userId.

export default function registerCompanionActions(registerLensAction) {
  // ── STATE plumbing ───────────────────────────────────────────────
  function store() {
    if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
    const STATE = globalThis._concordSTATE;
    STATE.companionNotifications ??= new Map(); // userId -> Array<Notification>
    STATE.companionPushPrefs ??= new Map();     // userId -> { [key]: boolean }
    if (typeof STATE._companionNotifSeq !== "number") STATE._companionNotifSeq = 0;
    return STATE;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort */ }
    }
  }
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function userNotifications(STATE, userId) {
    if (!STATE.companionNotifications.has(userId)) STATE.companionNotifications.set(userId, []);
    return STATE.companionNotifications.get(userId);
  }

  // Default push-preference toggles (settings, NOT live data). A user that has
  // never set prefs gets these honest defaults.
  const PUSH_PREF_KEYS = [
    "buildComplete", "citationReceived", "disasterAlert", "friendOnline", "marketUpdate",
  ];
  const DEFAULT_PUSH_PREFS = {
    buildComplete: true,
    citationReceived: true,
    disasterAlert: true,
    friendOnline: false,
    marketUpdate: false,
  };
  function userPushPrefs(STATE, userId) {
    if (!STATE.companionPushPrefs.has(userId)) {
      STATE.companionPushPrefs.set(userId, { ...DEFAULT_PUSH_PREFS });
    }
    return STATE.companionPushPrefs.get(userId);
  }

  function tableExists(db, name) {
    try {
      return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    } catch (_e) { return false; }
  }

  // The REAL activity feed source: the user's authored DTUs, newest-first.
  // creator_id is the authored-by column (migration 087); fall back to
  // owner_user_id if creator_id is unpopulated in this env. Empty when there's
  // no DB / no dtus table / no authored rows. NEVER fabricated.
  function authoredDtus(db, userId, limit, sinceMs = null) {
    if (!db || !tableExists(db, "dtus")) return [];
    const cap = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const run = (ownerCol) => db.prepare(`
      SELECT d.id AS id, d.title AS title, d.type AS kind, d.created_at AS createdAt
      FROM dtus d
      WHERE d.${ownerCol} = ?
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(userId, cap);
    let rows;
    try { rows = run("creator_id"); }
    catch (_e) {
      try { rows = run("owner_user_id"); }
      catch (_e2) { return []; }
    }
    const toMs = (v) => {
      if (v == null) return 0;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
      const t = Date.parse(String(v));
      return Number.isFinite(t) ? t : 0;
    };
    let mapped = rows.map((r) => ({
      id: r.id,
      kind: r.kind || "dtu",
      title: r.title || "Untitled",
      at: r.createdAt ? new Date(toMs(r.createdAt)).toISOString() : new Date(0).toISOString(),
      ts: toMs(r.createdAt),
      source: "dtu",
    }));
    if (sinceMs != null) mapped = mapped.filter((m) => m.ts > sinceMs);
    return mapped;
  }

  // ── feed ─────────────────────────────────────────────────────────
  // The user's REAL recent activity aggregate: authored DTUs + their own
  // notifications, merged newest-first. EMPTY when the user has done nothing.
  registerLensAction("companion", "feed", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const db = ctx?.db;
      const limit = Math.min(Math.max(Number((params || {}).limit) || 25, 1), 200);

      const items = [];
      for (const d of authoredDtus(db, userId, limit)) {
        items.push({ id: d.id, kind: d.kind, title: d.title, at: d.at, ts: d.ts, source: "dtu" });
      }
      // Surface the user's own notifications as feed entries too (real, STATE-backed).
      for (const n of userNotifications(STATE, userId)) {
        items.push({
          id: n.id,
          kind: n.category || "notification",
          title: n.title,
          at: n.at,
          ts: Date.parse(n.at) || 0,
          source: "notification",
          read: !!n.read,
        });
      }
      items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const trimmed = items.slice(0, limit);
      return { ok: true, result: { feed: trimmed, count: trimmed.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── notifications-list ───────────────────────────────────────────
  registerLensAction("companion", "notifications-list", (ctx, _artifact, _params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const list = [...userNotifications(STATE, userId)].sort((a, b) => (b.seq || 0) - (a.seq || 0));
      const unreadCount = list.reduce((n, x) => n + (x.read ? 0 : 1), 0);
      return { ok: true, result: { notifications: list, count: list.length, unreadCount } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── notification-add ─────────────────────────────────────────────
  // Append a REAL notification to the caller's inbox. `title` is required;
  // `category` must be one of a fixed set (default "general").
  const CATEGORIES = ["general", "build", "citation", "disaster", "market", "social"];
  registerLensAction("companion", "notification-add", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const p = params || {};
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const categoryRaw = String(p.category || "general").trim().toLowerCase();
      const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : "general";
      const list = userNotifications(STATE, userId);
      const notif = {
        id: sid("ntf"),
        title,
        body: String(p.body || ""),
        category,
        read: false,
        at: new Date().toISOString(),
        seq: ++STATE._companionNotifSeq,
      };
      list.push(notif);
      if (list.length > 200) list.splice(0, list.length - 200);
      save();
      const unreadCount = list.reduce((n, x) => n + (x.read ? 0 : 1), 0);
      return { ok: true, result: { notification: notif, count: list.length, unreadCount } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── notification-mark-read ───────────────────────────────────────
  // Mark one notification (by id) or all (`all: true`) read. Returns the new
  // unread count. A missing id is rejected.
  registerLensAction("companion", "notification-mark-read", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const p = params || {};
      const list = userNotifications(STATE, userId);
      if (p.all === true) {
        for (const n of list) n.read = true;
        save();
        return { ok: true, result: { markedAll: true, unreadCount: 0, count: list.length } };
      }
      const id = String(p.id || "");
      if (!id) return { ok: false, error: "id required" };
      const target = list.find((n) => n.id === id);
      if (!target) return { ok: false, error: "notification not found" };
      target.read = true;
      save();
      const unreadCount = list.reduce((n, x) => n + (x.read ? 0 : 1), 0);
      return { ok: true, result: { id, read: true, unreadCount, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── overnight-summary ────────────────────────────────────────────
  // A deterministic digest of what changed for the user since `since` (an ISO
  // string or epoch ms). Counts come from the SAME real feed sources (authored
  // DTUs after `since` + unread notifications). Empty / zeros when nothing.
  registerLensAction("companion", "overnight-summary", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const db = ctx?.db;
      const p = params || {};
      // Default window: last 24h.
      let sinceMs;
      if (p.since !== undefined && p.since !== null && p.since !== "") {
        const n = Number(p.since);
        sinceMs = Number.isFinite(n) && n > 0
          ? (n < 1e12 ? n * 1000 : n)
          : Date.parse(String(p.since));
        if (!Number.isFinite(sinceMs)) return { ok: false, error: "invalid since timestamp" };
      } else {
        sinceMs = Date.now() - 24 * 60 * 60 * 1000;
      }

      const newDtus = authoredDtus(db, userId, 200, sinceMs);
      const notifs = userNotifications(STATE, userId);
      const newNotifs = notifs.filter((n) => (Date.parse(n.at) || 0) > sinceMs);
      const unreadCount = notifs.reduce((n, x) => n + (x.read ? 0 : 1), 0);

      // Per-category breakdown of new DTUs (deterministic, from real rows).
      const byKind = {};
      for (const d of newDtus) byKind[d.kind] = (byKind[d.kind] || 0) + 1;

      const changes = [
        ...newDtus.map((d) => ({
          id: d.id, source: "dtu", kind: d.kind, title: d.title, at: d.at, ts: d.ts,
        })),
        ...newNotifs.map((n) => ({
          id: n.id, source: "notification", kind: n.category, title: n.title,
          at: n.at, ts: Date.parse(n.at) || 0,
        })),
      ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

      return {
        ok: true,
        result: {
          since: new Date(sinceMs).toISOString(),
          newDtuCount: newDtus.length,
          newNotificationCount: newNotifs.length,
          unreadCount,
          totalChanges: changes.length,
          byKind,
          changes,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── push-prefs-get ───────────────────────────────────────────────
  registerLensAction("companion", "push-prefs-get", (ctx, _artifact, _params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const prefs = userPushPrefs(STATE, userId);
      return { ok: true, result: { prefs: { ...prefs }, keys: [...PUSH_PREF_KEYS] } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── push-prefs-set ───────────────────────────────────────────────
  // Patch one or more push-preference toggles. Only known keys are accepted;
  // an unknown key or a non-boolean value is rejected. Omitted keys untouched.
  registerLensAction("companion", "push-prefs-set", (ctx, _artifact, params = {}) => {
    try {
      const STATE = store();
      const userId = aid(ctx);
      const prefs = userPushPrefs(STATE, userId);
      const patch = (params && typeof params.prefs === "object" && params.prefs) || params || {};
      const entries = Object.entries(patch).filter(([k]) => PUSH_PREF_KEYS.includes(k));
      if (entries.length === 0) return { ok: false, error: "no known preference keys provided" };
      for (const [k, v] of entries) {
        if (typeof v !== "boolean") return { ok: false, error: `${k} must be a boolean` };
      }
      for (const [k, v] of entries) prefs[k] = v;
      save();
      return { ok: true, result: { prefs: { ...prefs } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
