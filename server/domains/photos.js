// server/domains/photos.js
//
// Photo gallery lens macros — the caller's gallery (list / get), the public
// world feed (world), and the share-mints-a-DTU verb (share).
//
// This is a THIN registration layer over the real photo lib
// (server/lib/photo-gallery.js); it owns NO blob/DB logic of its own. The
// HTTP routes in server.js (/api/photos/*) call the same lib functions, so
// the macro surface and the REST surface stay byte-for-byte consistent.
//
// Persistence is the live `user_photos` table (migration 243). A photo's blob
// lives under ./data/photos/<id>.png; sharing mints a kind='photo' DTU so the
// royalty cascade fires when the photo is cited. `get` returns one owned row;
// it never leaks another user's private photo (owner-or-public gate).
//
// Registered from server.js:
//   import registerPhotosMacros from "./domains/photos.js";
//   registerPhotosMacros(register);

import {
  listMyPhotos,
  listPublicPhotosInWorld,
  sharePhoto,
} from "../lib/photo-gallery.js";

// Fail-CLOSED numeric guard (copied from server/domains/literary.js). A caller
// that passes a numeric field at all must pass a finite, non-negative, bounded
// one; an absent field falls through to the macro default. Returns null when
// clean, or the offending key — the caller maps it to `invalid_<key>`.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

function actorUserId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

export default function registerPhotosMacros(register) {
  // The caller's own gallery (My photos). Per-user; never leaks across users.
  register("photos", "list", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorUserId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 500);
    const photos = listMyPhotos(db, userId, limit);
    return { ok: true, photos, count: photos.length };
  }, { note: "the caller's own photo gallery (My photos) — per-user, never leaks" });

  // A single photo row. Owner sees any of their own; non-owners only see
  // a photo that has been shared public. Mirrors the gallery's privacy model.
  register("photos", "get", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorUserId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const id = String(input.id || "").trim();
    if (!id) return { ok: false, reason: "missing_id" };
    let row;
    try {
      row = db.prepare(`
        SELECT id, user_id, world_id, caption, taken_at, dtu_id, visibility, blob_path
        FROM user_photos WHERE id = ?
      `).get(id);
    } catch (err) {
      return { ok: false, reason: err?.message || "query_failed" };
    }
    if (!row) return { ok: false, reason: "not_found" };
    if (row.user_id !== userId && row.visibility !== "public") {
      return { ok: false, reason: "not_found" }; // don't disclose existence
    }
    return { ok: true, photo: row };
  }, { note: "a single photo row — owner sees any of theirs, others only public" });

  // The public world feed (anyone can browse public photos in a world).
  register("photos", "world", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input.worldId || input.world_id || "").trim();
    if (!worldId) return { ok: false, reason: "missing_worldId" };
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 500);
    const photos = listPublicPhotosInWorld(db, worldId, limit);
    return { ok: true, photos, count: photos.length };
  }, { note: "public photo feed for a world — public-readable browse" });

  // Share = mint a kind='photo' DTU + flip visibility to public, so the
  // royalty cascade fires when the photo is later cited. Owner-only.
  register("photos", "share", (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorUserId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const photoId = String(input.photoId || input.id || "").trim();
    if (!photoId) return { ok: false, reason: "missing_photoId" };
    // Owner gate — only the photo's owner can publish it.
    let owner;
    try {
      owner = db.prepare(`SELECT user_id FROM user_photos WHERE id = ?`).get(photoId);
    } catch (err) {
      return { ok: false, reason: err?.message || "query_failed" };
    }
    if (!owner) return { ok: false, reason: "no_photo" };
    if (owner.user_id !== userId) return { ok: false, reason: "not_owner" };
    return sharePhoto(db, photoId);
  }, { note: "share a photo — mints a kind='photo' DTU + flips visibility public (owner-only)" });
}
