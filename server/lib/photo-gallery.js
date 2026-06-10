// server/lib/photo-gallery.js
//
// Phase BE1 — photo gallery + sharing.
//
// PhotoMode.tsx posts a data: URL (base64 PNG) to savePhoto; this
// module writes the blob under ./data/photos/<id>.png and inserts
// the row. sharePhoto mints a kind='photo' DTU so the royalty cascade
// fires when the photo is cited.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import logger from "../logger.js";

const PHOTO_DIR = process.env.CONCORD_PHOTO_DIR ||
  path.resolve(process.cwd(), "data", "photos");
const MAX_BLOB_BYTES = 5 * 1024 * 1024; // 5 MB cap per photo

async function _ensureDir(dir) {
  try { await fsp.mkdir(dir, { recursive: true }); } catch { /* exists */ }
}

async function _writeBlob(dataUrl, blobPath) {
  // dataUrl looks like 'data:image/png;base64,iVBORw0...'.
  const m = String(dataUrl || "").match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return { ok: false, error: "invalid_data_url" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.byteLength > MAX_BLOB_BYTES) return { ok: false, error: "blob_too_large" };
  try {
    // Async fs — a ≤5 MB PNG write must not block the event loop.
    await _ensureDir(path.dirname(blobPath));
    await fsp.writeFile(blobPath, buf);
    return { ok: true, bytes: buf.byteLength };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function savePhoto(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, dataUrl, caption, visibility = "private" } = opts;
  if (!dataUrl) return { ok: false, error: "missing_dataUrl" };
  if (!["private", "friends", "public"].includes(visibility)) {
    return { ok: false, error: "invalid_visibility" };
  }

  const id = `ph_${crypto.randomBytes(8).toString("hex")}`;
  const blobPath = path.join(PHOTO_DIR, `${id}.png`);
  const blob = await _writeBlob(dataUrl, blobPath);
  if (!blob.ok) return blob;

  try {
    db.prepare(`
      INSERT INTO user_photos
        (id, user_id, world_id, caption, blob_path, visibility)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId || null, caption || null, blobPath, visibility);
    logger.info?.("photo-gallery", "saved", { id, userId, bytes: blob.bytes });
    return { ok: true, id, blobPath, bytes: blob.bytes };
  } catch (err) {
    // Rollback the blob.
    await fsp.unlink(blobPath).catch(() => { /* ignore */ });
    return { ok: false, error: err?.message };
  }
}

/** Mint a kind='photo' DTU so the royalty cascade can fire. */
export function sharePhoto(db, photoId, opts = {}) {
  if (!db || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const p = db.prepare(`SELECT * FROM user_photos WHERE id = ?`).get(photoId);
    if (!p) return { ok: false, error: "no_photo" };
    if (p.dtu_id) return { ok: true, dtuId: p.dtu_id, alreadyShared: true };

    const dtuId = `dtu_photo_${crypto.randomBytes(6).toString("hex")}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, title, type, creator_id, created_at, body_json)
        VALUES (?, ?, 'photo', ?, unixepoch(), ?)
      `).run(
        dtuId,
        p.caption || `Photo ${photoId}`,
        p.user_id,
        JSON.stringify({ source_photo_id: photoId, blob_path: p.blob_path }),
      );
    } catch (err) {
      // dtus table missing on minimal builds — still flip visibility.
      logger.debug?.("photo-gallery", "dtu_insert_skipped", { error: err?.message });
    }

    db.prepare(`UPDATE user_photos SET dtu_id = ?, visibility = 'public' WHERE id = ?`)
      .run(dtuId, photoId);
    return { ok: true, dtuId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMyPhotos(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, caption, taken_at, dtu_id, visibility
      FROM user_photos WHERE user_id = ?
      ORDER BY taken_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export function listPublicPhotosInWorld(db, worldId, limit = 50) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, user_id, caption, taken_at, dtu_id
      FROM user_photos
      WHERE world_id = ? AND visibility = 'public'
      ORDER BY taken_at DESC LIMIT ?
    `).all(worldId, Math.max(1, Math.min(500, limit)));
  } catch { return []; }
}

export function deletePhoto(db, userId, photoId) {
  if (!db || !userId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const p = db.prepare(`SELECT user_id, blob_path FROM user_photos WHERE id = ?`).get(photoId);
    if (!p) return { ok: false, error: "no_photo" };
    if (p.user_id !== userId) return { ok: false, error: "not_owner" };
    db.prepare(`DELETE FROM user_photos WHERE id = ?`).run(photoId);
    try { fs.unlinkSync(p.blob_path); } catch { /* may be gone */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { PHOTO_DIR, MAX_BLOB_BYTES };
