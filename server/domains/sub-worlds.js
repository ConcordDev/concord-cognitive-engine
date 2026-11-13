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

import { guardAnonWrites } from "../lib/lens-authz.js";
import { badNumber, readingOrNull } from "../lib/finite-input.js";
import { seedSubWorldStarterContent } from "../lib/sub-world-starter-content.js";

export default function registerSubWorldsActions(registerLensActionRaw) {
  registerLensActionRaw = guardAnonWrites(registerLensActionRaw); // anonymous callers can read, not write (lib/lens-authz.js)
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
  // ── Real-worlds mirror ──────────────────────────────────────────────
  // The lens's own hand-off contract (`visit` returns `{ travel:
  // {destination_world_id} }`) only works if `destination_world_id`
  // resolves through the ACTUAL cross-world travel path
  // (`POST /api/worlds/travel` → `travelToWorld` → `loadWorld`, which
  // reads `SELECT * FROM worlds WHERE id = ? AND status = 'active'`).
  // Without a mirrored row there, every "Enter" click was fabricated
  // success — the toast said "routing to world-travel" but the
  // destination could never actually be loaded (404 "Destination world
  // not found"). The in-memory STATE record above stays the CANONICAL
  // source for the creator-platform layer (settings/analytics/editor);
  // this is a best-effort mirror so the real travel system can find the
  // world at all. Never throws — a missing/minimal `worlds` table (unit
  // tests, early boot) degrades to "lens works, 3D travel doesn't".
  function mirrorWorldRow(ctx, w) {
    const db = ctx?.db;
    if (!db) return;
    try {
      db.prepare(`
        INSERT INTO worlds (id, name, universe_type, description, created_by, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          universe_type = excluded.universe_type,
          description = excluded.description
      `).run(w.world_id, w.name, w.kind, w.description || null, actor(ctx));
    } catch (_e) { /* best-effort mirror; the lens record stays canonical */ }
  }
  function setWorldRowStatus(ctx, worldId, status) {
    const db = ctx?.db;
    if (!db) return;
    try {
      db.prepare(`UPDATE worlds SET status = ? WHERE id = ?`).run(status, worldId);
    } catch (_e) { /* best-effort */ }
  }
  function deleteWorldRow(ctx, worldId) {
    const db = ctx?.db;
    if (!db) return;
    try {
      db.prepare(`DELETE FROM worlds WHERE id = ?`).run(worldId);
    } catch (_e) { /* best-effort */ }
  }

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
  // ── B15 seam bridge — the discovery union ─────────────────────────
  // Register B15 (Lead pricing, world-creator.md addendum 2026-11-06):
  // three populations hold worlds and, before this bridge, no reader
  // saw beyond its own — (1) this lens's STATE store (canonical here),
  // (2) world-creator's drafts in STATE.worldCreatorLens (publish sets
  // visibility inside the home store only), (3) the `worlds` table
  // (migration 042), written by the playtest mint (POST /api/worlds)
  // and by this lens's spawn mirror. The bridge's shape is DISCOVERY
  // UNIONING: no write path changes; discover/list union the three
  // populations AT THE READ, visibility enforced at the read, deduped
  // by world identity. A store world's mirrored table row renders
  // once, as the store object; a minted draft renders once, keyed by
  // its publishedWorldId; a draft and its unlinked mint are two
  // objects and render as two, honestly.
  function bridgeVisits(s) {
    if (!(s.bridgeVisits instanceof Map)) s.bridgeVisits = new Map(); // worldKey -> { count, visitors: [] }
    return s.bridgeVisits;
  }
  function bridgeCount(s, key) {
    const e = bridgeVisits(s).get(key);
    return { visits: e?.count || 0, unique_visitors: Array.isArray(e?.visitors) ? e.visitors.length : 0 };
  }
  function bridgeRecordVisit(s, key, userId) {
    const m = bridgeVisits(s);
    if (!m.has(key)) m.set(key, { count: 0, visitors: [] });
    const e = m.get(key);
    e.count += 1;
    if (!e.visitors.includes(userId)) e.visitors.push(userId);
    return e;
  }
  // Worlds-table rows (active only — loadWorld's own predicate), read
  // best-effort: a missing/minimal table (unit tests, early boot)
  // degrades to "the table population is empty", never a failed read.
  function tableWorldRows(ctx) {
    const db = ctx?.db;
    if (!db) return [];
    try {
      return db.prepare(
        `SELECT id, name, universe_type, description, created_by, created_at, rule_modulators
           FROM worlds WHERE status = 'active'`
      ).all();
    } catch (_e) { return []; }
  }
  function tableWorldRow(ctx, id) {
    const db = ctx?.db;
    if (!db || !id) return null;
    try {
      return db.prepare(
        `SELECT id, name, universe_type, description, created_by, created_at, rule_modulators
           FROM worlds WHERE id = ? AND status = 'active'`
      ).get(id) || null;
    } catch (_e) { return null; }
  }
  // FIX-world-creator-013 (founder ruling A, 2026-11-13): a playtest
  // mint carries rule_modulators.playtest — a private, owner-only
  // copy of a world-creator draft, never a public world.
  function isPlaytestRow(row) {
    if (!row?.rule_modulators) return false;
    try {
      const mods = typeof row.rule_modulators === "string" ? JSON.parse(row.rule_modulators) : row.rule_modulators;
      return !!mods?.playtest?.draftId;
    } catch (_e) { return false; }
  }
  function creatorDrafts() {
    const wc = globalThis._concordSTATE?.worldCreatorLens;
    if (!wc || !(wc.drafts instanceof Map)) return [];
    const out = [];
    for (const [creatorId, drafts] of wc.drafts.entries()) {
      for (const d of drafts || []) out.push({ creatorId, draft: d });
    }
    return out;
  }
  function findDraftAnywhere(draftId) {
    return creatorDrafts().find(({ draft }) => draft.id === draftId) || null;
  }
  // Bridged rows ride publicView's shape (GalleryPanel renders them
  // unmodified) plus the bridge fields: source · enterId · enterable ·
  // enterNote. can_edit/is_owner stay false — the store-scoped verbs
  // (settings/editor/analytics/favorite) never act on a bridged row.
  function favCount(s, id) {
    let n = 0;
    if (s.favorites instanceof Map) for (const set of s.favorites.values()) if (set.has(id)) n += 1;
    return n;
  }
  // created_at arrives as unix seconds, unix ms, or an ISO string.
  // Number("2026-11-01") is NaN, which used to stamp every table row at 0
  // and make "recent" a no-op.
  function epochMs(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v <= 0) return 0;
      return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
    }
    const text = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
      const n = Number(text);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function byName(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""));
  }
  function draftView(s, creatorId, d, viewerId) {
    const enterId = d.publishedWorldId || null;
    const counts = bridgeCount(s, `draft:${d.id}`);
    return {
      world_id: d.id,
      forge_app_dtu_id: null,
      name: d.name,
      description: d.description || "",
      thumbnail: "",
      kind: d.universeType || "concordia-hub",
      privacy: d.visibility || "private",
      status: "active",
      capacity: 16,
      spawned_by_user_id: creatorId,
      spawned_at: Date.parse(d.createdAt) || 0,
      updated_at: Date.parse(d.updatedAt) || 0,
      visits: counts.visits,
      unique_visitors: counts.unique_visitors,
      favorites: favCount(s, d.id),
      editors: [],
      popularity: Math.round(10 * Math.max(0, 30 - (now() - (Date.parse(d.createdAt) || now())) / 86_400_000) / 30),
      is_owner: false,
      can_edit: false,
      source: "world_creator",
      enterId,
      enterable: !!enterId,
      enterNote: enterId ? null : "Not yet playtested into a world — playtest this draft in World Creator to enter it.",
    };
  }
  function tableView(s, row, viewerId) {
    const counts = bridgeCount(s, `world:${row.id}`);
    return {
      world_id: row.id,
      forge_app_dtu_id: null,
      name: row.name,
      description: row.description || "",
      thumbnail: "",
      kind: row.universe_type || "concordia-hub",
      // FIX-world-creator-013: a playtest copy reads private in its
      // owner's own lists too — the hardcoded "public" was the lie
      // that made a private copy look published.
      privacy: isPlaytestRow(row) ? "private" : "public",
      status: "active",
      capacity: 16,
      spawned_by_user_id: row.created_by || "",
      spawned_at: epochMs(row.created_at),
      updated_at: epochMs(row.created_at),
      visits: counts.visits,
      unique_visitors: counts.unique_visitors,
      favorites: favCount(s, row.id),
      editors: [],
      popularity: Math.round(10 * Math.max(0, 30 - (epochMs(row.created_at) ? (now() - epochMs(row.created_at)) / 86_400_000 : 0)) / 30),
      is_owner: false,
      can_edit: false,
      source: "worlds_table",
      enterId: row.id,
      enterable: true,
      enterNote: null,
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
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const badNum = badNumericField(params, ["capacity"]);
    if (badNum) return { ok: false, error: "bad_numeric_field", field: badNum };
    const name = clean(params.name, 120);
    if (name.length < 3) return { ok: false, error: "name must be at least 3 characters" };
    const kind = KINDS.has(params.kind) ? params.kind : "physics_simulator";
    const privacy = PRIVACY.has(params.privacy) ? params.privacy : "public";
    const capacity = params.capacity === undefined || params.capacity === null || params.capacity === ""
      ? 16
      : readingOrNull(params.capacity, { min: 1, max: 200, fallback: null });
    if (capacity === null || capacity !== Math.trunc(capacity)) return badNumber("capacity", "must be a whole number from 1 to 200");
    const w = {
      world_id: newId("subw"),
      forge_app_dtu_id: clean(params.forgeAppDtuId, 80) || null,
      name,
      description: clean(params.description, 1000),
      thumbnail: clean(params.thumbnail, 600),
      kind,
      privacy,
      status: "active",
      capacity,
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
    mirrorWorldRow(ctx, w);
    // Wave 4 gap-closure — a freshly-mirrored `worlds` row previously stayed
    // a bare-minimum shell (default-empty modulators, zero NPCs). Apply
    // kind-appropriate physics/rule-modulator presets + a small deterministic
    // starter NPC roster through the same world_npcs write path real
    // authored worlds use. Best-effort — never blocks the in-memory STATE
    // record, which stays canonical for the lens itself.
    seedSubWorldStarterContent(ctx?.db, { worldId: w.world_id, kind: w.kind });
    return { ok: true, result: { world: publicView(w, actor(ctx)) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── List own worlds ─────────────────────────────────────────────────
  // B15: My Worlds is the caller's union across populations — their
  // store worlds, their world-creator drafts at ANY visibility (their
  // own records), and their worlds-table rows not backed by a store
  // world or claimed as a draft's mint. Store rows come first in the
  // shipped order; bridged rows follow, newest first.
  registerLensAction("sub_worlds", "list", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    let list = [...userWorlds(s, me)];
    if (params.status && STATUS.has(params.status)) list = list.filter((w) => w.status === params.status);
    list.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const out = list.map((w) => ({ ...publicView(w, me), source: "sub_worlds", enterId: w.world_id, enterable: true, enterNote: null }));
    if (!params.status || params.status === "active") {
      const storeIds = new Set();
      for (const l of s.worlds.values()) for (const w of l) storeIds.add(w.world_id);
      const claimedMints = new Set();
      const bridged = [];
      for (const { creatorId, draft } of creatorDrafts()) {
        if (draft.publishedWorldId) claimedMints.add(draft.publishedWorldId);
        if (creatorId !== me) continue;
        bridged.push(draftView(s, creatorId, draft, me));
      }
      for (const row of tableWorldRows(ctx)) {
        if (storeIds.has(row.id) || claimedMints.has(row.id)) continue;
        if (row.created_by !== me) continue;
        bridged.push(tableView(s, row, me));
      }
      bridged.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
      out.push(...bridged);
    }
    return { ok: true, result: { worlds: out } };
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
    const sortKey = String(params.sort || "popular").toLowerCase().replace(/[\s-]+/g, "_");
    const sort = sortKey === "recent" || sortKey === "newest" ? "recent"
      : (sortKey === "favorites" || sortKey === "most_favorited") ? "favorites"
      : "popular";
    let all = [];
    for (const list of s.worlds.values()) {
      for (const w of list) {
        if (w.status === "archived") continue;
        // Discovery surfaces public always, unlisted/private only to owner/editors.
        if (w.privacy !== "public" && !canEdit(w, me)) continue;
        const view = { ...publicView(w, me), source: "sub_worlds", enterId: w.world_id, enterable: true, enterNote: null };
        // The per-user sets are the count "most favorited" sorts. favoriteCount
        // can drift from that set, so the card shows the larger honest count.
        view.favorites = Math.max(favCount(s, w.world_id), Number(w.favoriteCount) || 0);
        all.push(view);
      }
    }
    // B15 union — the other two populations, visibility at the read:
    // world-creator drafts surface ONLY when public (private AND
    // unlisted drafts stay invisible to every other account here;
    // unlisted drafts surface to their owner through My Worlds), and
    // worlds-table rows surface unless a store world or a surfaced
    // draft already claims the identity.
    const storeIds = new Set();
    for (const l of s.worlds.values()) for (const w of l) storeIds.add(w.world_id);
    const claimedMints = new Set();
    for (const { creatorId, draft } of creatorDrafts()) {
      if (draft.publishedWorldId) claimedMints.add(draft.publishedWorldId);
      if (draft.visibility !== "public") continue;
      all.push(draftView(s, creatorId, draft, me));
    }
    for (const row of tableWorldRows(ctx)) {
      if (storeIds.has(row.id) || claimedMints.has(row.id)) continue;
      // FIX-world-creator-013: playtest copies are private — they
      // never surface in the public gallery, claimed or not (a public
      // draft's copy surfaces as the draft view above; sharing is
      // what publishing is for).
      if (isPlaytestRow(row)) continue;
      all.push(tableView(s, row, me));
    }
    if (query) {all = all.filter((w) =>
      w.name.toLowerCase().includes(query) || (w.description || "").toLowerCase().includes(query));}
    if (kindFilter) all = all.filter((w) => w.kind === kindFilter);
    const favN = (w) => Number(w.favorites) || 0;
    const when = (w) => Number(w.spawned_at) || Number(w.updated_at) || 0;
    const popN = (w) => Number(w.popularity) || 0;
    if (sort === "recent") all.sort((a, b) => when(b) - when(a) || popN(b) - popN(a) || byName(a, b));
    else if (sort === "favorites") all.sort((a, b) => favN(b) - favN(a) || popN(b) - popN(a) || byName(a, b));
    else all.sort((a, b) => popN(b) - popN(a) || favN(b) - favN(a) || byName(a, b));
    return {
      ok: true,
      result: {
        worlds: all.slice(0, num(params.limit, 60)),
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
    if (params.capacity != null && params.capacity !== "") {
      const capacity = readingOrNull(params.capacity, { min: 1, max: 200, fallback: null });
      if (capacity === null || capacity !== Math.trunc(capacity)) return badNumber("capacity", "must be a whole number from 1 to 200");
      w.capacity = capacity;
    }
    if (params.kind != null) {
      if (!KINDS.has(params.kind)) return { ok: false, error: "invalid kind" };
      w.kind = params.kind;
    }
    w.updated_at = now();
    save();
    mirrorWorldRow(ctx, w);
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
    if (!hit) {
      // FIX-world-creator-013: a playtest copy lives only in the
      // worlds table — the owner's Settings/Delete verb reaches it
      // here, so a playtest copy is disposable by its owner even
      // while its draft lives. Owner-only, like the store path.
      const row = tableWorldRow(ctx, clean(params.worldId, 80));
      if (row && isPlaytestRow(row)) {
        if (row.created_by !== me) return { ok: false, error: "only the owner can archive" };
        if (params.hardDelete === true) {
          deleteWorldRow(ctx, row.id);
          return { ok: true, result: { deleted: true, world_id: row.id } };
        }
        setWorldRowStatus(ctx, row.id, "archived");
        return { ok: true, result: { archived: true, world_id: row.id } };
      }
      return { ok: false, error: "world not found" };
    }
    // Only the owner may archive/delete; editors cannot.
    if (hit.world.spawned_by_user_id !== me) return { ok: false, error: "only the owner can archive" };
    if (params.hardDelete === true) {
      const list = userWorlds(s, hit.ownerId);
      const idx = list.findIndex((w) => w.world_id === hit.world.world_id);
      if (idx >= 0) list.splice(idx, 1);
      s.visitLog.delete(hit.world.world_id);
      save();
      deleteWorldRow(ctx, hit.world.world_id);
      return { ok: true, result: { deleted: true, world_id: params.worldId } };
    }
    hit.world.status = "archived";
    hit.world.updated_at = now();
    save();
    // Archiving must also close off the real travel path — `loadWorld`
    // only resolves `status = 'active'` rows, matching the domain's own
    // `visit` refusal for archived worlds.
    setWorldRowStatus(ctx, hit.world.world_id, "archived");
    return { ok: true, result: { archived: true, world: publicView(hit.world, me) } };
  });

  // ── Visit — inline "enter" handoff to world-travel + visitor count ──
  registerLensAction("sub_worlds", "visit", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = actor(ctx);
    const wantedId = clean(params.worldId, 80);
    const hit = findWorld(s, wantedId);
    if (!hit) {
      // B15 bridged resolution — Enter learns the other populations.
      // A worlds-table id resolves through loadWorld's own predicate
      // (an active row); a draft id resolves through its minted world.
      // Private/unlisted drafts are enterable only by their creator,
      // the A3 privacy shape. Enter never fabricates a destination:
      // an unminted draft refuses in words.
      const row = tableWorldRow(ctx, wantedId);
      if (row) {
        const minted = creatorDrafts().find(({ draft }) => draft.publishedWorldId === row.id);
        if (minted && minted.draft.visibility === "private" && minted.creatorId !== me) {
          return { ok: false, error: "world is private" };
        }
        // FIX-world-creator-013: a playtest copy is owner-only —
        // nobody else enters it, claimed or not, unless its draft
        // has been published public (sharing is publishing's job).
        if (isPlaytestRow(row) && row.created_by !== me && !(minted && minted.draft.visibility === "public")) {
          return { ok: false, error: "world is private" };
        }
        const e = bridgeRecordVisit(s, `world:${row.id}`, me);
        save();
        return {
          ok: true,
          result: {
            travel: { destination_world_id: row.id, name: row.name, kind: row.universe_type },
            visits: e.count,
            unique_visitors: e.visitors.length,
          },
        };
      }
      const found = findDraftAnywhere(wantedId);
      if (found) {
        const { creatorId, draft } = found;
        if (draft.visibility === "private" && creatorId !== me) return { ok: false, error: "world is private" };
        if (!draft.publishedWorldId) {
          return { ok: false, error: "This draft has not been playtested into a world yet — playtest it in World Creator to enter it." };
        }
        const mintRow = tableWorldRow(ctx, draft.publishedWorldId);
        if (!mintRow) return { ok: false, error: "world not found" };
        const e = bridgeRecordVisit(s, `draft:${draft.id}`, me);
        save();
        return {
          ok: true,
          result: {
            travel: { destination_world_id: mintRow.id, name: mintRow.name, kind: mintRow.universe_type },
            visits: e.count,
            unique_visitors: e.visitors.length,
          },
        };
      }
      return { ok: false, error: "world not found" };
    }
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
    const favId = clean(params.worldId, 80);
    const hit = findWorld(s, favId);
    if (!hit) {
      // B15: favorites learn the bridged populations, keyed by the
      // discovery row's identity (draft id · table id). The count is
      // derived from the favorite sets themselves — no counter is
      // stored on a row this lens does not own.
      const isDraft = !!findDraftAnywhere(favId);
      const isTable = !isDraft && !!tableWorldRow(ctx, favId);
      if (!isDraft && !isTable) return { ok: false, error: "world not found" };
      if (!s.favorites.has(me)) s.favorites.set(me, new Set());
      const favs = s.favorites.get(me);
      const wantFav = params.favorite !== false;
      const had = favs.has(favId);
      if (wantFav && !had) favs.add(favId);
      else if (!wantFav && had) favs.delete(favId);
      let count = 0;
      for (const set of s.favorites.values()) if (set.has(favId)) count += 1;
      save();
      return { ok: true, result: { favorited: favs.has(favId), favorites: count } };
    }
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
      if (hit && hit.world.status !== "archived") {
        out.push({ ...publicView(hit.world, me), source: "sub_worlds", enterId: hit.world.world_id, enterable: true, enterNote: null });
        continue;
      }
      // B15: bridged favorites render from their own populations —
      // a favorited draft renders as itself, a table world as itself.
      const found = findDraftAnywhere(wid);
      if (found) { out.push(draftView(s, found.creatorId, found.draft, me)); continue; }
      const row = tableWorldRow(ctx, wid);
      if (row) out.push(tableView(s, row, me));
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
