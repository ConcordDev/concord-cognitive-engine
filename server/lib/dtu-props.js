// server/lib/dtu-props.js
//
// Master-spec §3.3 (units B6-B9) — DTUs as tangible interactive world props.
//
// A "prop" here is never a fabricated object: it is a real row from the
// `dtus` table (the SQL DTU store — see the note below on which DTU store
// this is), surfaced at a deterministic position/slot so it reads as a
// physical shelf/counter/window/rooftop/plaza item in the world. Every
// interaction (inspect/take/leave/arrange) routes through EXISTING
// governance:
//   - inspect  -> the same public/owner visibility rule cross-lens-discovery
//                 already applies (server/lib/cross-lens-discovery.js).
//   - take     -> server/lib/consent.js#canCiteSpecificDtu (the SAME consent
//                 gate every citation in Concord goes through) +
//                 server/economy/royalty-cascade.js#registerCitation (the
//                 SAME royalty-lineage mechanism every derivative work uses
//                 — see server/domains/gamedesign.js's
//                 gdRegisterParentCitations for the precedent this mirrors).
//                 Taking someone else's prop mints a small real DTU you own
//                 that cites the original — an honest "you now hold a
//                 reference to this," not a fabricated inventory grab.
//   - leave    -> deletes that same held reference (owner-only).
//   - arrange  -> a real ownership-gated UPDATE on the prop DTU's own `data`
//                 JSON column (the same ownership check dtu.update already
//                 uses: owner_user_id/creator_id === requester).
//
// NOTE on "which DTU store": server.js's `register("dtu", ...)` macros (get/
// create/update/delete) operate on STATE.dtus, an IN-MEMORY Map used by the
// cognitive-substrate/chat-grounding path. This module instead reads/writes
// the SQL `dtus` table (better-sqlite3), which is the store cross-lens-
// discovery, the royalty cascade, the creative marketplace, and the
// cross-world citation cascade (migration 225's `dtus.world_id`) all already
// use. World-scoped props are a per-world-citation-cascade concept, so the
// SQL table (which actually carries `world_id`) is the correct substrate —
// not a parallel one invented for this unit.
//
// No migration: this module writes ONLY into columns that already exist
// (`data`, added by migration 087; `world_id`, added by migration 225).

import crypto from "node:crypto";
import { canCiteSpecificDtu } from "./consent.js";
import { registerCitation } from "../economy/royalty-cascade.js";
import { getRoomsForBuilding } from "./building-interiors.js";

// ── Slot taxonomy ────────────────────────────────────────────────────────────

export const SLOT_TYPES = ["shelf", "counter", "window", "rooftop", "plaza"];

// Room kinds (server/lib/building-interiors.js#ROOM_TEMPLATES) a given slot
// prefers to render inside, when the caller supplies a buildingId. Rooftop
// and plaza slots are exterior by nature — no room lookup for them.
const SLOT_ROOM_PREFERENCE = {
  shelf: ["library", "archive_hall", "storage", "lab"],
  counter: ["market_stall", "trading_floor", "forge", "tavern"],
  window: ["gallery_hall", "atelier", "observatory"],
  rooftop: [],
  plaza: [],
};

// Deterministic (not random) kind -> slot heuristic, keyed on real
// substrings of the `dtus.type` column values actually written across the
// codebase (recipe/blueprint, photo/art, music/dream, knowledge/skill/lore).
// Anything unmatched defaults to "plaza" — an honest "generic public prop"
// bucket rather than a guessed category.
const SLOT_KEYWORDS = [
  { slot: "counter", re: /recipe|blueprint|craft/i },
  { slot: "window", re: /photo|image|art|gallery|film/i },
  { slot: "rooftop", re: /music|song|dream|audio|sound/i },
  { slot: "shelf", re: /knowledge|skill|lore|book|codex|research/i },
];

export function slotForDtuType(type) {
  const t = String(type || "");
  for (const { slot, re } of SLOT_KEYWORDS) {
    if (re.test(t)) return slot;
  }
  return "plaza";
}

// ── Visibility (read gate) ───────────────────────────────────────────────────

// Mirrors the exact rule cross-lens-discovery.js#searchDtus already applies:
// owner always sees their own; otherwise public/marketplace visibility, or a
// legacy row whose `data` doesn't carry `"scope":"personal"`. Not a new
// invented rule — same predicate, applied per-row instead of as a SQL WHERE.
export function isVisibleToRequester(row, requesterId) {
  if (!row) return false;
  const isOwner = !!requesterId && (row.creator_id === requesterId || row.owner_user_id === requesterId);
  if (isOwner) return true;
  if (row.visibility === "public" || row.visibility === "marketplace") return true;
  const dataStr = row.data || row.body_json || "";
  if (typeof dataStr === "string" && dataStr.includes('"scope":"personal"')) return false;
  // Legacy rows with no explicit personal-scope marker and non-private
  // visibility fall through as visible (matches searchDtus' non-owner path);
  // an explicit 'private'/'internal' visibility with no scope override stays
  // hidden — private really means private.
  if (row.visibility === "private" || row.visibility === "internal") return false;
  return true;
}

// ── Deterministic placement ──────────────────────────────────────────────────

function safeParseJSON(str) {
  if (!str || typeof str !== "string") return null;
  try { return JSON.parse(str); } catch { return null; }
}

// sha1-seeded deterministic [0,1) pair from a string seed — same technique
// as server/lib/procgen-regions.js's anchor derivation. Never Math.random().
function seededUnit2(seed) {
  const hash = crypto.createHash("sha1").update(String(seed)).digest("hex");
  const a = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  const b = parseInt(hash.slice(8, 16), 16) / 0xffffffff;
  return [a, b];
}

const PLAZA_RADIUS_M = 20;

/**
 * Deterministic position for a prop. When a room is available (shelf/
 * counter/window slots with a matching room_type present in the building),
 * the position is bounded within that room's footprint. Otherwise
 * (rooftop/plaza, or no building supplied) it's placed on a deterministic
 * ring around the building/world origin.
 */
export function deterministicPosition(dtuId, { room = null, slot = "plaza", buildingHeight = 4 } = {}) {
  const [a, b] = seededUnit2(dtuId);
  if (room) {
    const w = Math.max(1, Number(room.width) || 6);
    const d = Math.max(1, Number(room.depth) || 6);
    return [
      Math.round((a * w - w / 2) * 100) / 100,
      0,
      Math.round((b * d - d / 2) * 100) / 100,
    ];
  }
  if (slot === "rooftop") {
    const angle = a * Math.PI * 2;
    const r = 2 + b * (PLAZA_RADIUS_M / 4);
    return [
      Math.round(Math.cos(angle) * r * 100) / 100,
      Math.max(1, Number(buildingHeight) || 4),
      Math.round(Math.sin(angle) * r * 100) / 100,
    ];
  }
  // plaza — deterministic ring at ground level
  const angle = a * Math.PI * 2;
  const r = 4 + b * PLAZA_RADIUS_M;
  return [
    Math.round(Math.cos(angle) * r * 100) / 100,
    0,
    Math.round(Math.sin(angle) * r * 100) / 100,
  ];
}

function pickRoomForSlot(rooms, slot) {
  const preferred = SLOT_ROOM_PREFERENCE[slot] || [];
  if (!preferred.length || !Array.isArray(rooms) || rooms.length === 0) return null;
  for (const kind of preferred) {
    const hit = rooms.find((r) => r.room_type === kind);
    if (hit) return hit;
  }
  return null;
}

function normalizePosition(pos) {
  if (Array.isArray(pos) && pos.length >= 3 && pos.every((n) => Number.isFinite(Number(n)))) {
    return pos.slice(0, 3).map((n) => Math.max(-1000, Math.min(1000, Number(n))));
  }
  return [0, 0, 0];
}

/**
 * Rules table describing which DTU kinds map to which slot types, and which
 * room kinds each slot prefers. Exported so tests (and callers building a
 * UI legend) can introspect the same table this module uses internally —
 * a single source of truth, not a duplicated one.
 */
export function placementRules() {
  return {
    slots: SLOT_TYPES.slice(),
    kindToSlot: SLOT_KEYWORDS.map((k) => ({ slot: k.slot, pattern: k.re.source })),
    slotRoomPreference: { ...SLOT_ROOM_PREFERENCE },
  };
}

// ── Placement listing ────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

/**
 * List DTU-prop placements for a world (optionally scoped to a building).
 * Public-read: honest per-row visibility filtering happens here, consistent
 * with cross-lens-discovery.js's own non-owner rule — never a parallel
 * privacy rule.
 */
export function propPlacementsForWorld(db, worldId, { buildingId = null, requesterId = null, limit = DEFAULT_LIST_LIMIT } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!worldId) return { ok: false, reason: "missing_world_id" };
  const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIST_LIMIT));

  let rows;
  try {
    rows = db.prepare(`
      SELECT id, type, title, creator_id, owner_user_id, visibility, data, world_id, created_at
      FROM dtus
      WHERE world_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(worldId, safeLimit * 3); // over-fetch a bit; visibility filtering below can drop rows
  } catch (err) {
    return { ok: false, reason: "query_failed", detail: err?.message };
  }

  let rooms = [];
  if (buildingId) {
    try { rooms = getRoomsForBuilding(db, buildingId); } catch { rooms = []; }
  }

  const buildingHeight = rooms.length
    ? Math.max(...rooms.map((r) => Number(r.height) || 4), 4)
    : 4;

  const placements = [];
  for (const row of rows) {
    if (!isVisibleToRequester(row, requesterId)) continue;

    const meta = safeParseJSON(row.data) || {};
    const override = meta.propPlacement && typeof meta.propPlacement === "object" ? meta.propPlacement : null;
    const defaultSlot = slotForDtuType(row.type);
    const slot = override?.slot && SLOT_TYPES.includes(override.slot) ? override.slot : defaultSlot;
    const room = pickRoomForSlot(rooms, slot);

    const position = override?.position
      ? normalizePosition(override.position)
      : deterministicPosition(row.id, { room, slot, buildingHeight });

    placements.push({
      dtuId: row.id,
      slot,
      position,
      buildingId: buildingId || null,
      roomId: override?.roomId || room?.id || null,
      readableType: row.type || "knowledge",
      title: row.title || "Untitled",
      creatorId: row.creator_id || row.owner_user_id || null,
      arranged: !!override,
    });
    if (placements.length >= safeLimit) break;
  }

  return { ok: true, worldId, buildingId: buildingId || null, count: placements.length, placements };
}

// ── Governance gate ──────────────────────────────────────────────────────────

const HELD_TYPE = "dtu_prop_take";

function findHeldRow(db, userId, parentDtuId) {
  try {
    return db.prepare(`
      SELECT id FROM dtus
      WHERE type = ? AND owner_user_id = ? AND json_extract(data, '$.sourcePropId') = ?
    `).get(HELD_TYPE, userId, parentDtuId);
  } catch {
    return null;
  }
}

/**
 * Governance decision for one (userId, dtuId, action) tuple. Read-only —
 * never mutates. `interactWithProp` calls this first and only proceeds on
 * `allowed: true`; each of takeProp/leaveProp/arrangeProp also re-checks its
 * own gate internally so they stay independently correct if called directly.
 */
export function canInteract(db, userId, dtuId, action) {
  if (!db) return { allowed: false, reason: "no_db" };
  const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(dtuId);
  if (!row) return { allowed: false, reason: "not_found" };

  if (action === "inspect") {
    const visible = isVisibleToRequester(row, userId);
    return { allowed: visible, reason: visible ? null : "not_visible", row };
  }

  if (action === "take") {
    const ownerId = row.owner_user_id || row.creator_id;
    if (ownerId && ownerId === userId) return { allowed: true, reason: null, row, alreadyOwned: true };
    // Deliberately NOT gated by isVisibleToRequester here: canCiteSpecificDtu
    // is the SAME sole gate registerCitation's other real callers rely on
    // (e.g. server/domains/gamedesign.js#gdRegisterParentCitations calls
    // registerCitation directly, no separate visibility pre-check) — public/
    // published visibility citable directly, otherwise falls through to the
    // owner's `allow_citation` consent regardless of the DTU's own
    // visibility column. Layering our own stricter isVisibleToRequester on
    // top would reject citable-but-not-publicly-listed DTUs that the rest
    // of the app already treats as takeable once consent is granted.
    const parentDtu = { ownerId, owner_user_id: row.owner_user_id, creator_id: row.creator_id, visibility: row.visibility };
    const allowed = canCiteSpecificDtu(db, parentDtu);
    return { allowed, reason: allowed ? null : "citation_consent_not_granted", row };
  }

  if (action === "leave") {
    if (!userId) return { allowed: false, reason: "auth_required", row };
    const held = findHeldRow(db, userId, dtuId);
    return { allowed: !!held, reason: held ? null : "not_holding", row, heldId: held?.id || null };
  }

  if (action === "arrange") {
    if (!userId) return { allowed: false, reason: "auth_required", row };
    const ownerId = row.owner_user_id || row.creator_id;
    const allowed = !!ownerId && ownerId === userId;
    return { allowed, reason: allowed ? null : "not_owner", row };
  }

  return { allowed: false, reason: "unknown_action", row };
}

// ── Interactions ─────────────────────────────────────────────────────────────

/** inspect: read-only, gated by visibility only. */
export function inspectProp(db, userId, dtuId) {
  const gate = canInteract(db, userId, dtuId, "inspect");
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  const row = gate.row;
  return {
    ok: true,
    dtu: {
      id: row.id,
      title: row.title,
      type: row.type,
      creatorId: row.creator_id || row.owner_user_id || null,
      visibility: row.visibility,
      createdAt: row.created_at,
      meta: safeParseJSON(row.data) || {},
    },
  };
}

/**
 * take: reuses registerCitation — the exact royalty-lineage mechanism every
 * derivative work in Concord already goes through. Mints a small real DTU
 * (kind `dtu_prop_take`) owned by the taker, citing the original. Rejected
 * honestly (no fabricated success) when consent isn't granted.
 */
export function takeProp(db, userId, dtuId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "auth_required" };

  const gate = canInteract(db, userId, dtuId, "take");
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  const row = gate.row;
  const ownerId = row.owner_user_id || row.creator_id;
  if (gate.alreadyOwned) {
    return { ok: true, dtuId, alreadyOwned: true, note: "this prop is already yours" };
  }

  const existing = findHeldRow(db, userId, dtuId);
  if (existing) {
    return { ok: true, dtuId, alreadyTaken: true, childId: existing.id };
  }

  const childId = `dtuprop_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const childData = JSON.stringify({ sourcePropId: dtuId, takenAt: new Date().toISOString() });

  try {
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, data, tags_json, visibility, tier, type, world_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?, '[]', 'private', 'regular', ?, ?, datetime('now'), datetime('now'))
    `).run(childId, userId, userId, `Took: ${row.title || "Untitled"}`, childData, HELD_TYPE, row.world_id || null);
  } catch (err) {
    return { ok: false, reason: "take_insert_failed", detail: err?.message };
  }

  const citation = registerCitation(db, {
    childId,
    parentId: dtuId,
    creatorId: userId,
    parentCreatorId: ownerId || "unknown",
    parentDtu: { ownerId, owner_user_id: row.owner_user_id, creator_id: row.creator_id, visibility: row.visibility },
    generation: 1,
  });

  if (!citation.ok) {
    // Don't leave an uncited derivative sitting around — roll back.
    try { db.prepare("DELETE FROM dtus WHERE id = ?").run(childId); } catch { /* best-effort */ }
    return { ok: false, reason: citation.error || "citation_failed" };
  }

  return { ok: true, dtuId, childId, lineageId: citation.lineageId };
}

/** leave: deletes the held reference created by take(). Owner-only. */
export function leaveProp(db, userId, dtuId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "auth_required" };

  const gate = canInteract(db, userId, dtuId, "leave");
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  try {
    db.prepare("DELETE FROM dtus WHERE id = ? AND owner_user_id = ?").run(gate.heldId, userId);
  } catch (err) {
    return { ok: false, reason: "leave_delete_failed", detail: err?.message };
  }
  return { ok: true, dtuId, releasedChildId: gate.heldId };
}

/**
 * arrange: ownership-gated placement write. Persists into the SAME `data`
 * JSON column dtu.update already reads/writes elsewhere — no parallel
 * mutation path, no migration.
 */
export function arrangeProp(db, userId, dtuId, placement = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "auth_required" };

  const gate = canInteract(db, userId, dtuId, "arrange");
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  const row = gate.row;
  const slot = SLOT_TYPES.includes(placement.slot) ? placement.slot : slotForDtuType(row.type);
  const position = normalizePosition(placement.position);
  const roomId = typeof placement.roomId === "string" ? placement.roomId.slice(0, 64) : null;
  const payload = JSON.stringify({ slot, position, roomId, updatedAt: new Date().toISOString() });

  try {
    db.prepare(`
      UPDATE dtus SET data = json_set(COALESCE(data, '{}'), '$.propPlacement', json(?)), updated_at = datetime('now')
      WHERE id = ?
    `).run(payload, dtuId);
  } catch (err) {
    return { ok: false, reason: "arrange_update_failed", detail: err?.message };
  }

  return { ok: true, dtuId, placement: { slot, position, roomId } };
}

/** Single dispatcher — what the route/macro layer calls. */
export function interactWithProp(db, userId, dtuId, action, extra = {}) {
  if (!["inspect", "take", "leave", "arrange"].includes(action)) {
    return { ok: false, reason: "invalid_action" };
  }
  if (action === "inspect") return inspectProp(db, userId, dtuId);
  if (action === "take") return takeProp(db, userId, dtuId);
  if (action === "leave") return leaveProp(db, userId, dtuId);
  return arrangeProp(db, userId, dtuId, extra.placement || {});
}

export const _internal = { HELD_TYPE, seededUnit2, pickRoomForSlot, normalizePosition };
