// server/domains/sub-worlds.js
//
// Sub-Worlds lens — Roblox / Rec Room parity for user-spawned, hostable
// worlds. The original `sub_world` macros (in server.js) only spawn a
// Forge-app DTU into the SQL `sub_worlds` table and list active rows.
// This domain (`sub_worlds`, plural) is the creator-platform layer the
// gap-spec asked for: a discovery gallery, inline visit, per-world
// settings, delete/archive, analytics (visits / favorites / popularity),
// thumbnails + descriptions, co-editor permissions, and an in-place
// world editor — none of which round-trip through the Forge lens.
//
// Per-user STATE model (consistent with answers / message / whiteboard
// domains): every sub-world a user creates is scoped to that user under
// `globalThis._concordSTATE.subWorldsLens`. Public/unlisted worlds are
// surfaced cross-user by the discovery gallery; private worlds never are.
// Handlers never throw — they return { ok, result?, error? }.

export default function registerSubWorldsActions(registerLensActionRaw) {
  // Dual-bus registration. The frontend reaches these handlers through
  // /api/lens/run → LENS_ACTIONS (the registerLensAction registry). But the
  // MACROS bus (runMacro / MCP host / the contract-derivation + macro-assassin
  // pipeline) is a SEPARATE map — a registerLensAction-only handler is invisible
  // to runMacro (it threw "macro domain not found: sub_worlds") and to the
  // assassin (no derived contract ⇒ 0 driven). This is the exact concord.math
  // CAS reachability bug noted in server.js:39139. We mirror every registration
  // into MACROS via globalThis._concordMACROS with a thin signature adapter so
  // the handlers are reachable on BOTH buses with byte-identical behavior —
  // LENS_ACTIONS signature is (ctx, artifact, params); the MACROS/runMacro
  // signature is (ctx, input). The adapter maps (ctx, input) → handler(ctx,
  // virtualArtifact, input). No handler logic changes.
  const registerLensAction = (domain, name, handler, spec) => {
    registerLensActionRaw(domain, name, handler, spec);
    try {
      const MACROS = globalThis._concordMACROS;
      if (MACROS && typeof MACROS.set === "function") {
        if (!MACROS.has(domain)) MACROS.set(domain, new Map());
        const adapter = (ctx, input = {}) =>
          handler(ctx, { id: null, domain, type: "domain_action", data: input || {}, meta: {} }, input || {});
        MACROS.get(domain).set(name, {
          fn: adapter,
          spec: { domain, name, note: "sub_worlds dual-bus (LENS_ACTIONS + MACROS)", ...(spec || {}) },
        });
      }
    } catch (_e) { /* MACROS mirror is best-effort; LENS_ACTIONS is the canonical path */ }
  };
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.subWorldsLens) STATE.subWorldsLens = {};
    const s = STATE.subWorldsLens;
    if (!(s.worlds instanceof Map)) s.worlds = new Map();       // userId -> Array<world>
    if (!(s.favorites instanceof Map)) s.favorites = new Map(); // userId -> Set(worldId)
    if (!(s.visitLog instanceof Map)) s.visitLog = new Map();   // worldId -> Array<{userId, at}>
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const newId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = () => Date.now();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  // Fail-CLOSED numeric guard (copied from domains/literary.js): any provided
  // numeric field must be a finite, non-negative, in-range value. An ABSENT
  // field is fine (the macro uses its default). A hostile NaN / Infinity / -1 /
  // 1e308 capacity is REJECTED rather than silently coerced to the default —
  // so a poisoned numeric param can never round-trip as { ok:true }.
  const badNumericField = (input, keys) => {
    for (const k of keys) {
      if (input == null || input[k] === undefined || input[k] === null) continue;
      const n = Number(input[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
    }
    return null;
  };
  const PRIVACY = new Set(["public", "unlisted", "private"]);
  const KINDS = new Set(["physics_simulator", "research_zone", "concord_substrate"]);
  const STATUS = new Set(["active", "paused", "archived"]);

  function userWorlds(s, userId) {
    if (!s.worlds.has(userId)) s.worlds.set(userId, []);
    return s.worlds.get(userId);
  }
  // Find a world (and its owner) anywhere in the registry by worldId.
  function findWorld(s, worldId) {
    for (const [ownerId, list] of s.worlds.entries()) {
      const w = list.find((x) => x.world_id === worldId);
      if (w) return { world: w, ownerId };
    }
    return null;
  }
  function canEdit(world, userId) {
    return world.spawned_by_user_id === userId
      || (Array.isArray(world.editors) && world.editors.includes(userId));
  }
  function publicView(w, viewerId) {
    return {
      world_id: w.world_id,
      forge_app_dtu_id: w.forge_app_dtu_id,
      name: w.name,
      description: w.description,
      thumbnail: w.thumbnail,
      kind: w.kind,
      privacy: w.privacy,
      status: w.status,
      capacity: w.capacity,
      spawned_by_user_id: w.spawned_by_user_id,
      spawned_at: w.spawned_at,
      updated_at: w.updated_at,
      visits: w.visits || 0,
      unique_visitors: (w.visitorIds || []).length,
      favorites: w.favoriteCount || 0,
      editors: w.editors || [],
      popularity: popularityScore(w),
      is_owner: w.spawned_by_user_id === viewerId,
      can_edit: canEdit(w, viewerId),
    };
  }
  // Popularity = visits + 3×favorites + recency bonus (decays over 30 days).
  function popularityScore(w) {
    const ageDays = (now() - (w.spawned_at || now())) / 86_400_000;
    const recency = Math.max(0, 30 - ageDays) / 30;
    return Math.round((w.visits || 0) + 3 * (w.favoriteCount || 0) + 10 * recency);
  }

  // ── Spawn ───────────────────────────────────────────────────────────
  // Register a new sub-world in the creator-platform layer. Unlike the
  // server.js `sub_world.spawn_from_forge`, this does not require a
  // pre-existing forge_app DTU row — the in-place editor can spawn a
  // blank substrate and author it here.
  registerLensAction("sub_worlds", "spawn", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const badNum = badNumericField(params, ["capacity"]);
    if (badNum) return { ok: false, error: "bad_numeric_field", field: badNum };
    const name = clean(params.name, 120);
    if (name.length < 3) return { ok: false, error: "name must be at least 3 characters" };
    const kind = KINDS.has(params.kind) ? params.kind : "physics_simulator";
    const privacy = PRIVACY.has(params.privacy) ? params.privacy : "public";
    const w = {
      world_id: newId("subw"),
      forge_app_dtu_id: clean(params.forgeAppDtuId, 80) || null,
      name,
      description: clean(params.description, 1000),
      thumbnail: clean(params.thumbnail, 600),
      kind,
      privacy,
      status: "active",
      capacity: Math.max(1, Math.min(200, num(params.capacity, 16))),
      spawned_by_user_id: actor(ctx),
      spawned_at: now(),
      updated_at: now(),
      visits: 0,
      visitorIds: [],
      favoriteCount: 0,
      editors: [],
      editorLog: [],
      blocks: [],
    };
    userWorlds(s, actor(ctx)).push(w);
    save();
    return { ok: true, result: { world: publicView(w, actor(ctx)) } };
  });

  // ── List own worlds ─────────────────────────────────────────────────
  registerLensAction("sub_worlds", "list", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    let list = [...userWorlds(s, me)];
    if (params.status && STATUS.has(params.status)) list = list.filter((w) => w.status === params.status);
    list.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return { ok: true, result: { worlds: list.map((w) => publicView(w, me)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Discovery gallery — browse public sub-worlds across all users ────
  registerLensAction("sub_worlds", "discover", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const badNum = badNumericField(params, ["limit"]);
    if (badNum) return { ok: false, error: "bad_numeric_field", field: badNum };
    const me = actor(ctx);
    const query = clean(params.query, 120).toLowerCase();
    const kindFilter = KINDS.has(params.kind) ? params.kind : null;
    const sort = ["popular", "recent", "favorites"].includes(params.sort) ? params.sort : "popular";
    let all = [];
    for (const list of s.worlds.values()) {
      for (const w of list) {
        if (w.status === "archived") continue;
        // Discovery surfaces public always, unlisted/private only to owner/editors.
        if (w.privacy !== "public" && !canEdit(w, me)) continue;
        all.push(w);
      }
    }
    if (query) {all = all.filter((w) =>
      w.name.toLowerCase().includes(query) || (w.description || "").toLowerCase().includes(query));}
    if (kindFilter) all = all.filter((w) => w.kind === kindFilter);
    if (sort === "recent") all.sort((a, b) => (b.spawned_at || 0) - (a.spawned_at || 0));
    else if (sort === "favorites") all.sort((a, b) => (b.favoriteCount || 0) - (a.favoriteCount || 0));
    else all.sort((a, b) => popularityScore(b) - popularityScore(a));
    return {
      ok: true,
      result: {
        worlds: all.slice(0, num(params.limit, 60)).map((w) => publicView(w, me)),
        total: all.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Per-world settings — rename, privacy, capacity, kind ────────────
  registerLensAction("sub_worlds", "update_settings", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const badNum = badNumericField(params, ["capacity"]);
    if (badNum) return { ok: false, error: "bad_numeric_field", field: badNum };
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const w = hit.world;
    if (params.name != null) {
      const nm = clean(params.name, 120);
      if (nm.length < 3) return { ok: false, error: "name must be at least 3 characters" };
      w.name = nm;
    }
    if (params.description != null) w.description = clean(params.description, 1000);
    if (params.thumbnail != null) w.thumbnail = clean(params.thumbnail, 600);
    if (params.privacy != null) {
      if (!PRIVACY.has(params.privacy)) return { ok: false, error: "invalid privacy" };
      w.privacy = params.privacy;
    }
    if (params.capacity != null) w.capacity = Math.max(1, Math.min(200, num(params.capacity, w.capacity)));
    if (params.kind != null) {
      if (!KINDS.has(params.kind)) return { ok: false, error: "invalid kind" };
      w.kind = params.kind;
    }
    w.updated_at = now();
    save();
    return { ok: true, result: { world: publicView(w, me) } };
  });

  // ── Status toggle — active / paused ─────────────────────────────────
  registerLensAction("sub_worlds", "set_status", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const status = params.status;
    if (status !== "active" && status !== "paused") return { ok: false, error: "status must be active or paused" };
    hit.world.status = status;
    hit.world.updated_at = now();
    save();
    return { ok: true, result: { world: publicView(hit.world, me) } };
  });

  // ── Delete / archive ────────────────────────────────────────────────
  registerLensAction("sub_worlds", "archive", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    // Only the owner may archive/delete; editors cannot.
    if (hit.world.spawned_by_user_id !== me) return { ok: false, error: "only the owner can archive" };
    if (params.hardDelete === true) {
      const list = userWorlds(s, hit.ownerId);
      const idx = list.findIndex((w) => w.world_id === hit.world.world_id);
      if (idx >= 0) list.splice(idx, 1);
      s.visitLog.delete(hit.world.world_id);
      save();
      return { ok: true, result: { deleted: true, world_id: params.worldId } };
    }
    hit.world.status = "archived";
    hit.world.updated_at = now();
    save();
    return { ok: true, result: { archived: true, world: publicView(hit.world, me) } };
  });

  // ── Visit — inline "enter" handoff to world-travel + visitor count ──
  registerLensAction("sub_worlds", "visit", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    const w = hit.world;
    if (w.status === "archived") return { ok: false, error: "world is archived" };
    if (w.privacy === "private" && !canEdit(w, me)) return { ok: false, error: "world is private" };
    w.visits = (w.visits || 0) + 1;
    if (!Array.isArray(w.visitorIds)) w.visitorIds = [];
    if (!w.visitorIds.includes(me)) w.visitorIds.push(me);
    if (!s.visitLog.has(w.world_id)) s.visitLog.set(w.world_id, []);
    s.visitLog.get(w.world_id).push({ userId: me, at: now() });
    save();
    return {
      ok: true,
      result: {
        // The travel hand-off contract: the page routes the user into
        // the existing world-travel system with this destination.
        travel: { destination_world_id: w.world_id, name: w.name, kind: w.kind },
        visits: w.visits,
        unique_visitors: w.visitorIds.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Favorite / unfavorite ───────────────────────────────────────────
  registerLensAction("sub_worlds", "favorite", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    const w = hit.world;
    if (!s.favorites.has(me)) s.favorites.set(me, new Set());
    const favs = s.favorites.get(me);
    const wantFav = params.favorite !== false;
    const had = favs.has(w.world_id);
    if (wantFav && !had) { favs.add(w.world_id); w.favoriteCount = (w.favoriteCount || 0) + 1; }
    else if (!wantFav && had) { favs.delete(w.world_id); w.favoriteCount = Math.max(0, (w.favoriteCount || 0) - 1); }
    save();
    return { ok: true, result: { favorited: favs.has(w.world_id), favorites: w.favoriteCount } };
  });

  // ── List my favorites ───────────────────────────────────────────────
  registerLensAction("sub_worlds", "my_favorites", (ctx, _a, _params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const favs = s.favorites.get(me) || new Set();
    const out = [];
    for (const wid of favs) {
      const hit = findWorld(s, wid);
      if (hit && hit.world.status !== "archived") out.push(publicView(hit.world, me));
    }
    out.sort((a, b) => b.popularity - a.popularity);
    return { ok: true, result: { worlds: out } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Analytics — visit timeline, popularity breakdown ────────────────
  registerLensAction("sub_worlds", "analytics", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const w = hit.world;
    const log = s.visitLog.get(w.world_id) || [];
    // Bucket visits by day (last 14 days).
    const dayMs = 86_400_000;
    const buckets = new Map();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now() - i * dayMs);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const v of log) {
      const key = new Date(v.at).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }
    const timeline = [...buckets.entries()].map(([day, count]) => ({ day, visits: count }));
    return {
      ok: true,
      result: {
        world_id: w.world_id,
        name: w.name,
        total_visits: w.visits || 0,
        unique_visitors: (w.visitorIds || []).length,
        favorites: w.favoriteCount || 0,
        popularity: popularityScore(w),
        editors: (w.editors || []).length,
        blocks: (w.blocks || []).length,
        timeline,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Permissions — invite / remove co-editors ────────────────────────
  registerLensAction("sub_worlds", "invite_editor", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (hit.world.spawned_by_user_id !== me) return { ok: false, error: "only the owner can invite editors" };
    const editorId = clean(params.editorUserId, 80);
    if (!editorId) return { ok: false, error: "editorUserId required" };
    if (editorId === me) return { ok: false, error: "owner is already an editor" };
    const w = hit.world;
    if (!Array.isArray(w.editors)) w.editors = [];
    if (w.editors.includes(editorId)) return { ok: false, error: "already an editor" };
    if (w.editors.length >= 20) return { ok: false, error: "editor limit (20) reached" };
    w.editors.push(editorId);
    w.updated_at = now();
    save();
    return { ok: true, result: { editors: w.editors } };
  });

  registerLensAction("sub_worlds", "remove_editor", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (hit.world.spawned_by_user_id !== me) return { ok: false, error: "only the owner can remove editors" };
    const editorId = clean(params.editorUserId, 80);
    const w = hit.world;
    w.editors = (w.editors || []).filter((e) => e !== editorId);
    w.updated_at = now();
    save();
    return { ok: true, result: { editors: w.editors } };
  });

  // ── In-place world editor — author blocks without leaving the lens ──
  // A "block" is one authored element of the world (terrain / spawn /
  // prop / script / zone). The Forge round-trip is no longer required.
  registerLensAction("sub_worlds", "editor_state", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const w = hit.world;
    return {
      ok: true,
      result: {
        world_id: w.world_id,
        name: w.name,
        blocks: w.blocks || [],
        editor_log: (w.editorLog || []).slice(-30),
      },
    };
  });

  const BLOCK_TYPES = new Set(["terrain", "spawn_point", "prop", "script", "zone", "light"]);

  registerLensAction("sub_worlds", "editor_add_block", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const w = hit.world;
    const type = BLOCK_TYPES.has(params.type) ? params.type : null;
    if (!type) return { ok: false, error: "invalid block type" };
    if (!Array.isArray(w.blocks)) w.blocks = [];
    if (w.blocks.length >= 500) return { ok: false, error: "block limit (500) reached" };
    const block = {
      id: newId("blk"),
      type,
      label: clean(params.label, 80) || type,
      x: num(params.x, 0),
      y: num(params.y, 0),
      z: num(params.z, 0),
      props: (params.props && typeof params.props === "object") ? params.props : {},
      created_by: me,
      created_at: now(),
    };
    w.blocks.push(block);
    if (!Array.isArray(w.editorLog)) w.editorLog = [];
    w.editorLog.push({ action: "add", blockId: block.id, type, by: me, at: now() });
    w.updated_at = now();
    save();
    return { ok: true, result: { block, blocks: w.blocks } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("sub_worlds", "editor_remove_block", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const hit = findWorld(s, clean(params.worldId, 80));
    if (!hit) return { ok: false, error: "world not found" };
    if (!canEdit(hit.world, me)) return { ok: false, error: "not authorized" };
    const w = hit.world;
    const blockId = clean(params.blockId, 80);
    const before = (w.blocks || []).length;
    w.blocks = (w.blocks || []).filter((b) => b.id !== blockId);
    if (w.blocks.length === before) return { ok: false, error: "block not found" };
    if (!Array.isArray(w.editorLog)) w.editorLog = [];
    w.editorLog.push({ action: "remove", blockId, by: me, at: now() });
    w.updated_at = now();
    save();
    return { ok: true, result: { blocks: w.blocks } };
  });
}
