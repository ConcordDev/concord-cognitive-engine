// Photo releases: a finished photo put out into the world, free or sold in
// Concord Coin. The edit is frozen at release time, so what a buyer gets is
// exactly what was published even if the photographer keeps editing.
// Everyone may see a watermarked proof of a published release; the full
// file goes to the photographer, to buyers (who keep it after a withdraw),
// and to anyone when the release is free.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { PHOTO_DIR } from "../photo-gallery.js";
import { normalizeEdit, outputSize } from "./develop.js";
import { renderPhoto } from "./render.js";
import { exportExif } from "./store.js";

export const RELEASE_MAX_PRICE = 1000;
export const PROOF_EDGE = 1200;
const r2 = (n) => Math.round(n * 100) / 100;
// eslint-disable-next-line no-control-regex -- strips control characters from user text on purpose
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const RELEASE_DIR = () => path.join(PHOTO_DIR, "releases");

function displayName(db, userId) {
  try { const r = db.prepare("SELECT username FROM users WHERE id = ?").get(String(userId)); return r?.username ? String(r.username).slice(0, 40) : null; }
  catch { return null; }
}

export function getRelease(db, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) return null;
  return db.prepare("SELECT * FROM photo_releases WHERE id = ?").get(id) || null;
}

export const ownsRelease = (db, rel, userId) => !!userId && !!db.prepare("SELECT 1 FROM photo_release_owners WHERE release_id = ? AND user_id = ?").get(rel.id, userId);

/** May this person download the full file? */
export function canDownload(db, rel, userId) {
  if (!rel) return false;
  if (userId && rel.user_id === userId) return true;
  if (ownsRelease(db, rel, userId)) return true;
  return rel.status === "published" && !(rel.price_cc > 0);
}

/** May this person see it at all (the proof and the listing)? */
export const canSee = (db, rel, userId) => !!rel && (rel.status === "published" || rel.user_id === userId || ownsRelease(db, rel, userId));

export function releaseView(db, rel, userId) {
  return {
    id: rel.id, photoId: rel.user_id === userId ? rel.photo_id : undefined,
    title: rel.title, description: rel.description || "", priceCC: rel.price_cc,
    width: rel.width, height: rel.height, format: rel.format, longEdge: rel.long_edge,
    status: rel.status, publishedAt: rel.published_at,
    photographer: { name: displayName(db, rel.user_id) || "A photographer", isMe: rel.user_id === userId },
    owned: ownsRelease(db, rel, userId),
    canDownload: canDownload(db, rel, userId),
    buyers: rel.user_id === userId ? db.prepare("SELECT COUNT(*) c FROM photo_release_owners WHERE release_id = ?").get(rel.id).c : null,
    proofUrl: `/api/photos/releases/${rel.id}/proof`,
    downloadUrl: `/api/photos/releases/${rel.id}/download`,
  };
}

/** Validate and store a new release (the money half — minting and listing — is the caller's). */
export function prepareRelease(db, userId, params = {}) {
  if (!userId) return { ok: false, error: "sign in to release a photo" };
  const photoId = String(params.photoId || "");
  const row = /^[A-Za-z0-9_-]{3,80}$/.test(photoId) ? db.prepare("SELECT * FROM user_photos WHERE id = ?").get(photoId) : null;
  if (!row || row.user_id !== userId) return { ok: false, error: "photo not found" };
  const title = clean(params.title, 160) || clean(row.caption, 160);
  if (!title) return { ok: false, error: "title required" };
  const description = clean(params.description, 1000);
  const price = params.priceCC == null ? 0 : Number(params.priceCC);
  if ((params.priceCC != null && typeof params.priceCC !== "number") || !Number.isFinite(price) || price < 0 || price > RELEASE_MAX_PRICE || r2(price) !== price || (price > 0 && price < 0.5)) {
    return { ok: false, error: `priceCC must be 0 (free) or from 0.5 to ${RELEASE_MAX_PRICE} CC, in cents` };
  }
  const le = params.longEdge == null ? 0 : Math.round(Number(params.longEdge));
  if (!Number.isFinite(le) || (le !== 0 && (le < 640 || le > 16384))) return { ok: false, error: "longEdge is 0 (full size) or from 640 to 16384 pixels" };
  const format = params.format === "webp" ? "webp" : "jpeg";
  if (!row.width || !row.height) return { ok: false, error: "that photo hasn't finished importing" };
  if (db.prepare("SELECT 1 FROM photo_releases WHERE photo_id = ? AND status = 'published'").get(photoId)) return { ok: false, error: "this photo is already released; withdraw it first" };
  const edit = normalizeEdit(row.edit_json ? JSON.parse(row.edit_json) : {});
  let { width, height } = outputSize(row.width, row.height, edit);
  if (le && Math.max(width, height) > le) { const s = le / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
  return { ok: true, row, rel: { id: `prel_${crypto.randomBytes(8).toString("hex")}`, photo_id: photoId, user_id: userId, title, description, price_cc: price, long_edge: le, format, edit_json: JSON.stringify(edit), width, height } };
}

export function insertRelease(db, rel, dtuId) {
  db.prepare(`INSERT INTO photo_releases (id, photo_id, user_id, title, description, price_cc, long_edge, format, edit_json, width, height, dtu_id, status)
              VALUES (@id, @photo_id, @user_id, @title, @description, @price_cc, @long_edge, @format, @edit_json, @width, @height, @dtu_id, 'published')`).run({ ...rel, dtu_id: dtuId || null });
  return getRelease(db, rel.id);
}

/**
 * The rendered file for a release, cached on disk. kind = "proof" (small,
 * watermarked) or "full" (the release's own size and format).
 */
export async function releaseFile(db, rel, kind) {
  const row = db.prepare("SELECT * FROM user_photos WHERE id = ?").get(rel.photo_id);
  if (!row?.blob_path || !fs.existsSync(row.blob_path)) return { ok: false, error: "the original file is missing" };
  const ext = kind === "proof" ? "jpg" : rel.format === "webp" ? "webp" : "jpg";
  const file = path.join(RELEASE_DIR(), `${rel.id}_${kind}.${ext}`);
  if (fs.existsSync(file)) return { ok: true, file, mime: ext === "webp" ? "image/webp" : "image/jpeg" };
  await fsp.mkdir(RELEASE_DIR(), { recursive: true });
  const edit = JSON.parse(rel.edit_json);
  const job = kind === "proof"
    ? { path: row.blob_path, edit, format: "jpeg", quality: 82, longEdge: Math.min(PROOF_EDGE, Math.max(rel.width, rel.height)), exif: { IFD0: { Software: "Concord Darkroom" } }, watermark: rel.price_cc > 0 ? "PROOF · CONCORD" : null }
    : { path: row.blob_path, edit, format: rel.format, quality: 92, longEdge: rel.long_edge, exif: exportExif(row, { keepExif: true, keepLocation: false }) };
  const out = await renderPhoto(job);
  if (!out.ok) return out;
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, out.buf);
  await fsp.rename(tmp, file);
  return { ok: true, file, mime: ext === "webp" ? "image/webp" : "image/jpeg" };
}

export function listReleases(db, userId, { mine = false, owned = false } = {}) {
  let rows;
  if (mine) rows = db.prepare("SELECT * FROM photo_releases WHERE user_id = ? ORDER BY published_at DESC LIMIT 200").all(userId || "");
  else if (owned) rows = db.prepare("SELECT r.* FROM photo_releases r JOIN photo_release_owners o ON o.release_id = r.id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 200").all(userId || "");
  else rows = db.prepare("SELECT * FROM photo_releases WHERE status = 'published' ORDER BY published_at DESC LIMIT 200").all();
  return rows.map((r) => releaseView(db, r, userId));
}
