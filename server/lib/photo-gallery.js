// server/lib/photo-gallery.js
//
// Phase BE1 — photo gallery + sharing.
//
// Clients post a data: URL to savePhoto; this module writes the blob
// under ./data/photos/<id>.<ext> — the extension the bytes earn
// (FIX-photos-008; it was always .png when imports were re-encoded) —
// and inserts the row. sharePhoto mints a kind='photo' DTU so the royalty cascade
// fires when the photo is cited.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import logger from "../logger.js";
import { storeArtifact } from "./artifact-store.js";

const PHOTO_DIR = process.env.CONCORD_PHOTO_DIR ||
  path.resolve(process.cwd(), "data", "photos");
const MAX_BLOB_BYTES = 5 * 1024 * 1024; // 5 MB cap per photo

async function _ensureDir(dir) {
  try { await fsp.mkdir(dir, { recursive: true }); } catch { /* exists */ }
}

/**
 * FIX-photos-008: the image format from the BYTES, never from a claim.
 * An imported JPEG used to be re-encoded to PNG by the client before
 * it ever reached the server, so the original format (and its EXIF)
 * was destroyed and the detail view truthfully reported "PNG". The
 * client now sends the original bytes; the blob is stored under the
 * extension its magic bytes earn, and reads report the real format.
 */
export function imageFormatOf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return { ext: "png", mime: "image/png", label: "PNG" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg", label: "JPEG" };
  if (buf.toString("ascii", 0, 4) === "GIF8") return { ext: "gif", mime: "image/gif", label: "GIF" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp", label: "WebP" };
  return null;
}

/** JPEG dimensions from the first SOF0/SOF2 segment. Returns {} if none. */
function jpegDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return {};
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) return {};
    const marker = buf[off + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    const len = buf.readUInt16BE(off + 2);
    if (!Number.isFinite(len) || len < 2) return {};
    off += 2 + len;
  }
  return {};
}

function blobDimensions(buf) {
  return imageFormatOf(buf)?.ext === "jpg" ? jpegDimensions(buf) : pngDimensions(buf);
}

async function _writeBlob(buf, blobPath) {
  if (buf.byteLength > MAX_BLOB_BYTES) return { ok: false, error: "blob_too_large" };
  try {
    // Async fs — a ≤5 MB write must not block the event loop.
    await _ensureDir(path.dirname(blobPath));
    await fsp.writeFile(blobPath, buf);
    return { ok: true, bytes: buf.byteLength, ...blobDimensions(buf) };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Real dimensions from the PNG's own IHDR chunk — never derived/guessed.
 * IHDR is always the first chunk: signature (8) + length (4) + "IHDR" (4),
 * then width (4, big-endian) and height (4, big-endian). Returns {} (no
 * fabricated 0x0) if the buffer doesn't look like a PNG this reads.
 */
function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return {};
  if (buf.toString("ascii", 12, 16) !== "IHDR") return {};
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * F4 fix return — derive-on-read for a photo's dimensions/size. The
 * detail view (PhotoLightboxModal via photos.get) renders exactly the
 * row's width/height/size_bytes, so a row whose columns were never
 * populated (created before savePhoto captured them, or by a path
 * that did not) reads "unknown" forever — while its blob on disk
 * carries the truth: dimensions in its IHDR, size in its byte length.
 * When any of the three is null, fill from the blob and backfill the
 * row, so every standing row heals on its first detail read. A
 * missing/unreadable blob leaves the fields null: "unknown" stays
 * honest for a photo with no readable file.
 */
export function fillPhotoMetaFromBlob(db, row) {
  if (!db || !row) return row;
  // FIX-photos-008: the format rides every read, sniffed from the blob
  // itself (there is no format column; the bytes are the truth). Rows
  // stored before the fix hold PNG bytes and report PNG, correctly.
  let format = null;
  try {
    if (row.blob_path) format = imageFormatOf(fs.readFileSync(row.blob_path))?.label ?? null;
  } catch { /* an unreadable blob reports no format rather than a guess */ }
  const withFormat = { ...row, format };
  if (row.width != null && row.height != null && row.size_bytes != null) return withFormat;
  if (!row.blob_path) return withFormat;
  let buf;
  try { buf = fs.readFileSync(row.blob_path); } catch { return withFormat; }
  const dims = blobDimensions(buf);
  const filled = {
    width: row.width ?? dims.width ?? null,
    height: row.height ?? dims.height ?? null,
    size_bytes: row.size_bytes ?? buf.byteLength,
  };
  if (filled.width !== row.width || filled.height !== row.height || filled.size_bytes !== row.size_bytes) {
    try {
      db.prepare(`UPDATE user_photos SET width = ?, height = ?, size_bytes = ? WHERE id = ?`)
        .run(filled.width, filled.height, filled.size_bytes, row.id);
    } catch { /* the backfill is best-effort; the read still returns the truth */ }
  }
  return { ...withFormat, ...filled };
}

export async function savePhoto(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId, dataUrl, caption, visibility = "private", originalFilename } = opts;
  if (!dataUrl) return { ok: false, error: "missing_dataUrl" };
  if (!["private", "friends", "public"].includes(visibility)) {
    return { ok: false, error: "invalid_visibility" };
  }

  // FIX-photos-008: decode the data URL and store the bytes AS SENT —
  // no re-encode — under the extension the bytes themselves earn.
  const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return { ok: false, error: "invalid_data_url" };
  const buf = Buffer.from(m[2], "base64");
  const format = imageFormatOf(buf);
  if (!format) return { ok: false, error: "unsupported_image_format" };

  const id = `ph_${crypto.randomBytes(8).toString("hex")}`;
  const blobPath = path.join(PHOTO_DIR, `${id}.${format.ext}`);
  const blob = await _writeBlob(buf, blobPath);
  if (!blob.ok) return blob;
  // Truncate so an absurd client-supplied name can't bloat a row forever.
  const filename = typeof originalFilename === "string" ? originalFilename.slice(0, 255) : null;

  try {
    db.prepare(`
      INSERT INTO user_photos
        (id, user_id, world_id, caption, blob_path, visibility, width, height, size_bytes, original_filename)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, worldId || null, caption || null, blobPath, visibility,
      blob.width ?? null, blob.height ?? null, blob.bytes ?? null, filename,
    );
    logger.info?.("photo-gallery", "saved", { id, userId, bytes: blob.bytes });
    return { ok: true, id, blobPath, bytes: blob.bytes, width: blob.width, height: blob.height, format: format.label };
  } catch (err) {
    // Rollback the blob.
    await fsp.unlink(blobPath).catch(() => { /* ignore */ });
    return { ok: false, error: err?.message };
  }
}

/**
 * Mint a kind='photo' DTU so the royalty cascade can fire and the photo is
 * actually findable in the DTU Browser (My Vault + Global Library).
 *
 * Earlier builds `INSERT INTO dtus (...)` — a legacy SQL table nothing else
 * in the platform reads. The DTU Browser (`dtu.list`/`dtu.get`) resolves
 * against the live in-memory substrate, `STATE.dtus` (a Map), via
 * `userVisibleDTUs()`/`dtusArray()`. Writing only the SQL row minted a
 * record the owner could never find under any scope — a claimed object with
 * no findable id. This mints into the real substrate instead, in the same
 * shape `mountArtifactUploadRoutes` uses for a real findable upload DTU
 * (lib/artifact-upload-routes.js), so `ownerId`/`domain`/`visibility` match
 * what `dtu.list`'s "mine" and scope filters actually check.
 */
export async function sharePhoto(db, photoId, opts = {}) {
  if (!db || !photoId) return { ok: false, error: "missing_inputs" };
  const STATE = opts.STATE || globalThis.STATE || null;
  if (!STATE?.dtus) return { ok: false, error: "dtu_store_unavailable" };
  try {
    const p = db.prepare(`SELECT * FROM user_photos WHERE id = ?`).get(photoId);
    if (!p) return { ok: false, error: "no_photo" };
    if (p.dtu_id) return { ok: true, dtuId: p.dtu_id, alreadyShared: true };

    const dtuId = `dtu_photo_${crypto.randomBytes(6).toString("hex")}`;
    const nowIso = new Date().toISOString();
    const title = p.caption || `Photo ${photoId}`;
    // F6 fix return — the DTU must CARRY the photo, in the platform's
    // own media shape. The old mint attached a bespoke artifact
    // object ({ type:"image", url:"/api/photos/<id>/image",
    // sourcePhotoId }) that no consumer resolves: the artifact store
    // is the media contract (storeArtifact registers the bytes under
    // the DTU's id, streamed via /api/artifact/<id>/stream — the
    // shape lib/artifact-upload-routes.js mints for every upload
    // DTU), and the DTU detail view's preview is gated on
    // meta.primaryType. Register the blob FIRST: if the photo's
    // bytes cannot be read or stored, the share fails honestly
    // rather than minting a DTU whose content is only its caption.
    let artifactRef;
    let blobMime = "image/png";
    try {
      const buf = fs.readFileSync(p.blob_path);
      // FIX-photos-008: register the artifact under the blob's REAL
      // format, not a blanket image/png.
      const fmt = imageFormatOf(buf);
      blobMime = fmt?.mime || "image/png";
      artifactRef = await storeArtifact(dtuId, buf, blobMime, p.original_filename || `${photoId}.${fmt?.ext || "png"}`);
    } catch (err) {
      logger.debug?.("photo-gallery", "share_artifact_failed", { error: err?.message });
      return { ok: false, error: "photo_blob_unreadable" };
    }
    const dtu = {
      id: dtuId,
      tier: "regular",
      scope: "global",
      visibility: "public",
      domain: "photos",
      title,
      ownerId: p.user_id,
      createdBy: p.user_id,
      authorId: p.user_id,
      human: { summary: title, bullets: [] },
      core: { definitions: [], claims: [], examples: [] },
      machine: { kind: "photo", verifier: { format: blobMime, sizeBytes: artifactRef.sizeBytes, hash: artifactRef.hash } },
      artifact: artifactRef,
      lineage: { parents: [], children: [] },
      authority: { score: 0.5 },
      meta: {
        createdBy: p.user_id,
        ownerId: p.user_id,
        lens: "photos",
        type: "photo",
        tags: ["photos"],
        createdAt: nowIso,
        sourcePhotoId: photoId,
        primaryType: "display_image",
        artifactSize: artifactRef.sizeBytes,
      },
      createdAt: nowIso,
    };

    // The public flip and the dtu_id stamp are one write. If it doesn't land,
    // the photo stays private, dtu_id stays null, and nothing is minted.
    try {
      db.prepare(`UPDATE user_photos SET dtu_id = ?, visibility = 'public' WHERE id = ?`)
        .run(dtuId, photoId);
    } catch (err) {
      logger.debug?.("photo-gallery", "share_update_failed", { error: err?.message });
      return { ok: false, error: "share_update_failed" };
    }
    // Mint into the real substrate only after the SQL half lands, so a crash
    // between the two steps never leaves a dangling, unreferenced DTU.
    STATE.dtus.set(dtuId, dtu);
    return { ok: true, dtuId };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function parseTags(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((t) => typeof t === "string") : []; }
  catch { return []; }
}

export function listMyPhotos(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, caption, alt_text, tags, taken_at, dtu_id, visibility, favorite
      FROM user_photos WHERE user_id = ?
      ORDER BY taken_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(500, limit))).map((r) => ({ ...r, tags: parseTags(r.tags) }));
  } catch {
    // favorite column absent (pre-468 DB) — fall back to the base shape.
    try {
      return db.prepare(`
        SELECT id, world_id, caption, taken_at, dtu_id, visibility
        FROM user_photos WHERE user_id = ?
        ORDER BY taken_at DESC LIMIT ?
      `).all(userId, Math.max(1, Math.min(500, limit)));
    } catch { return []; }
  }
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
    try { db.prepare(`DELETE FROM photo_album_items WHERE photo_id = ?`).run(photoId); } catch { /* pre-468 */ }
    try { fs.unlinkSync(p.blob_path); } catch { /* may be gone */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export { PHOTO_DIR, MAX_BLOB_BYTES };

function _ownedPhoto(db, userId, photoId) {
  const p = db.prepare(`SELECT user_id FROM user_photos WHERE id = ?`).get(photoId);
  if (!p) return { ok: false, error: "no_photo" };
  if (p.user_id !== userId) return { ok: false, error: "not_owner" };
  return { ok: true };
}

function _ownedAlbum(db, userId, albumId) {
  const a = db.prepare(`SELECT id, user_id, name FROM photo_albums WHERE id = ?`).get(albumId);
  if (!a || a.user_id !== userId) return { ok: false, error: "no_album" };
  return { ok: true, album: a };
}

/** Edit an owned photo's caption, alt text, tags and/or favorite flag.
 *  FIX-photos-006: alt text + tags join the single caption field. */
export function updatePhoto(db, userId, photoId, patch = {}) {
  if (!db || !userId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const own = _ownedPhoto(db, userId, photoId);
    if (!own.ok) return own;
    if (patch.caption !== undefined) {
      const caption = String(patch.caption ?? "").trim().slice(0, 280);
      db.prepare(`UPDATE user_photos SET caption = ? WHERE id = ?`).run(caption || null, photoId);
    }
    if (patch.altText !== undefined) {
      const alt = String(patch.altText ?? "").trim().slice(0, 300);
      try { db.prepare(`UPDATE user_photos SET alt_text = ? WHERE id = ?`).run(alt || null, photoId); } catch { /* pre-504 DB */ }
    }
    if (patch.tags !== undefined) {
      const raw = Array.isArray(patch.tags) ? patch.tags : String(patch.tags || "").split(",");
      const tags = [...new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean).map((t) => t.slice(0, 40)))].slice(0, 12);
      try { db.prepare(`UPDATE user_photos SET tags = ? WHERE id = ?`).run(tags.length ? JSON.stringify(tags) : null, photoId); } catch { /* pre-504 DB */ }
    }
    if (patch.favorite !== undefined) {
      db.prepare(`UPDATE user_photos SET favorite = ? WHERE id = ?`).run(patch.favorite ? 1 : 0, photoId);
    }
    let photo;
    try {
      photo = db.prepare(`SELECT id, world_id, caption, alt_text, tags, taken_at, dtu_id, visibility, favorite FROM user_photos WHERE id = ?`).get(photoId);
      if (photo) photo = { ...photo, tags: parseTags(photo.tags) };
    } catch {
      photo = db.prepare(`SELECT id, world_id, caption, taken_at, dtu_id, visibility, favorite FROM user_photos WHERE id = ?`).get(photoId);
    }
    return { ok: true, photo };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listAlbums(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT a.id, a.name, a.created_at,
        (SELECT COUNT(*) FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = a.id) AS count,
        (SELECT i.photo_id FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = a.id ORDER BY p.taken_at DESC LIMIT 1) AS cover_photo_id
      FROM photo_albums a WHERE a.user_id = ?
      ORDER BY a.created_at DESC
    `).all(userId);
  } catch { return []; }
}

export function createAlbum(db, userId, name) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return { ok: false, error: "missing_name" };
  try {
    const id = `alb_${crypto.randomBytes(8).toString("hex")}`;
    db.prepare(`INSERT INTO photo_albums (id, user_id, name) VALUES (?, ?, ?)`).run(id, userId, n);
    return { ok: true, album: { id, name: n, count: 0, cover_photo_id: null } };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function deleteAlbum(db, userId, albumId) {
  if (!db || !userId || !albumId) return { ok: false, error: "missing_inputs" };
  try {
    const own = _ownedAlbum(db, userId, albumId);
    if (!own.ok) return own;
    db.transaction(() => {
      db.prepare(`DELETE FROM photo_album_items WHERE album_id = ?`).run(albumId);
      db.prepare(`DELETE FROM photo_albums WHERE id = ? AND user_id = ?`).run(albumId, userId);
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Add (add=true) or remove an owned photo from an owned album. Idempotent. */
export function setAlbumMembership(db, userId, albumId, photoId, add = true) {
  if (!db || !userId || !albumId || !photoId) return { ok: false, error: "missing_inputs" };
  try {
    const a = _ownedAlbum(db, userId, albumId);
    if (!a.ok) return a;
    const p = _ownedPhoto(db, userId, photoId);
    if (!p.ok) return p;
    if (add) db.prepare(`INSERT OR IGNORE INTO photo_album_items (album_id, photo_id) VALUES (?, ?)`).run(albumId, photoId);
    else db.prepare(`DELETE FROM photo_album_items WHERE album_id = ? AND photo_id = ?`).run(albumId, photoId);
    return { ok: true, albumId, photoId, member: !!add };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listAlbumPhotos(db, userId, albumId) {
  if (!db || !userId || !albumId) return { ok: false, error: "missing_inputs" };
  try {
    const a = _ownedAlbum(db, userId, albumId);
    if (!a.ok) return a;
    const photos = db.prepare(`
      SELECT p.id, p.world_id, p.caption, p.taken_at, p.dtu_id, p.visibility, p.favorite
      FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id
      WHERE i.album_id = ? AND p.user_id = ?
      ORDER BY p.taken_at DESC
    `).all(albumId, userId);
    return { ok: true, album: { id: a.album.id, name: a.album.name }, photos };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}
