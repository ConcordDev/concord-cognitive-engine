// The Darkroom's catalog on the user_photos store (migrations 243, 468, 504,
// 516). An original is kept exactly as imported and never rewritten; an
// edit is a develop recipe (lib/darkroom/develop.js) saved beside it, with
// its history. Every function here takes the acting user's id and only ever
// reads or changes that user's own photos, presets and albums.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PHOTO_DIR, imageFormatOf } from "../photo-gallery.js";
import { parseExif, exifTime } from "./exif.js";
import { normalizeEdit, isDefaultEdit, defaultEdit } from "./develop.js";

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
export const MAX_IMPORT_PIXELS = 80_000_000;
export const PREVIEW_EDGE = 2048;
export const THUMB_EDGE = 480;
const HISTORY_KEEP = 200;
const DERIVED_DIR = () => path.join(PHOTO_DIR, "derived");
const IMPORT_FORMATS = { jpeg: ["jpg", "image/jpeg"], png: ["png", "image/png"], webp: ["webp", "image/webp"], tiff: ["tif", "image/tiff"], gif: ["gif", "image/gif"], heif: ["avif", "image/avif"] };
export const FLAGS = ["none", "pick", "reject"];
export const LABELS = ["red", "yellow", "green", "blue", "purple"];
const rid = (p) => `${p}_${crypto.randomBytes(8).toString("hex")}`;
const parseJSON = (s, d) => { if (!s) return d; try { return JSON.parse(s); } catch { return d; } };

/** Why a file can't be imported, said the way a person would want to hear it. */
function refuseFormat(buf) {
  const head = buf.subarray(0, 16).toString("latin1");
  if (/ftyp(heic|heix|hevc|mif1)/.test(head)) return "HEIC photos can't be read here yet: export it from your phone or Photos app as JPEG, then import that.";
  if (/^II\*\0/.test(head) || /^MM\0\*/.test(head)) return null; // TIFF (and TIFF-based RAW: sharp decides)
  return "That file isn't a photo this darkroom can read. It takes JPEG, PNG, WebP, TIFF, GIF or AVIF.";
}

/** Make (or re-make) the preview and thumbnail, and read the camera facts. */
export async function ensureDerivatives(db, row, { force = false } = {}) {
  if (!row?.blob_path) return row;
  if (!force && row.preview_path && row.thumb_path && fs.existsSync(row.preview_path) && fs.existsSync(row.thumb_path) && row.exif_json != null) return row;
  try {
    await fsp.mkdir(DERIVED_DIR(), { recursive: true });
    const meta = await sharp(row.blob_path, { limitInputPixels: MAX_IMPORT_PIXELS }).metadata();
    const exif = meta.exif ? parseExif(meta.exif) : {};
    const swap = (meta.orientation || 1) >= 5;
    const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
    const preview = path.join(DERIVED_DIR(), `${row.id}_p.jpg`), thumb = path.join(DERIVED_DIR(), `${row.id}_t.jpg`);
    const base = () => sharp(row.blob_path, { limitInputPixels: MAX_IMPORT_PIXELS }).rotate();
    await base().resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(preview);
    await base().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(thumb);
    const captured = exifTime(exif.capturedAt);
    db.prepare(`UPDATE user_photos SET preview_path = ?, thumb_path = ?, exif_json = ?, width = ?, height = ?, captured_at = COALESCE(captured_at, ?), mime = COALESCE(mime, ?) WHERE id = ?`)
      .run(preview, thumb, JSON.stringify(exif), width, height, captured, `image/${meta.format}`, row.id);
    return { ...row, preview_path: preview, thumb_path: thumb, exif_json: JSON.stringify(exif), width, height, captured_at: row.captured_at ?? captured };
  } catch (err) {
    return { ...row, derivative_error: String(err?.message || err).slice(0, 200) };
  }
}

/** Import a photo file exactly as it is. */
export async function importPhoto(db, userId, buf, { filename = null } = {}) {
  if (!db || !userId) return { ok: false, error: "sign in to import photos" };
  if (!Buffer.isBuffer(buf) || buf.length < 16) return { ok: false, error: "That upload was empty." };
  if (buf.length > MAX_IMPORT_BYTES) return { ok: false, error: `That file is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${MAX_IMPORT_BYTES / 1048576} MB.` };
  const refused = refuseFormat(buf);
  let meta;
  try { meta = await sharp(buf, { limitInputPixels: MAX_IMPORT_PIXELS }).metadata(); }
  catch (err) {
    if (/pixel limit/i.test(String(err?.message))) return { ok: false, error: `That photo is over ${MAX_IMPORT_PIXELS / 1e6} megapixels.` };
    return { ok: false, error: refused || "That file isn't a photo this darkroom can read." };
  }
  const fmt = IMPORT_FORMATS[meta.format];
  if (!fmt || (meta.format === "heif" && meta.compression !== "av1")) return { ok: false, error: refused || "That file isn't a photo this darkroom can read. It takes JPEG, PNG, WebP, TIFF, GIF or AVIF." };
  if ((meta.width || 0) * (meta.height || 0) > MAX_IMPORT_PIXELS) return { ok: false, error: `That photo is over ${MAX_IMPORT_PIXELS / 1e6} megapixels.` };
  const id = rid("ph");
  await fsp.mkdir(PHOTO_DIR, { recursive: true });
  const blobPath = path.join(PHOTO_DIR, `${id}.${fmt[0]}`);
  await fsp.writeFile(blobPath, buf);
  // eslint-disable-next-line no-control-regex -- strips control characters from user text on purpose
  const name = typeof filename === "string" ? filename.replace(/[\u0000-\u001f]/g, "").slice(0, 255) : null;
  const caption = name ? name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 280) || null : null;
  try {
    db.prepare(`INSERT INTO user_photos (id, user_id, world_id, caption, blob_path, visibility, size_bytes, original_filename, source, mime)
                VALUES (?, ?, NULL, ?, ?, 'private', ?, ?, 'import', ?)`).run(id, userId, caption, blobPath, buf.length, name, fmt[1]);
  } catch (err) {
    await fsp.unlink(blobPath).catch(() => {});
    return { ok: false, error: err?.message || "could not save the photo" };
  }
  const row = db.prepare("SELECT * FROM user_photos WHERE id = ?").get(id);
  const done = await ensureDerivatives(db, row, { force: true });
  if (done.derivative_error) {
    db.prepare("DELETE FROM user_photos WHERE id = ?").run(id);
    await fsp.unlink(blobPath).catch(() => {});
    return { ok: false, error: "That photo could not be decoded." };
  }
  return { ok: true, photo: view(db.prepare("SELECT * FROM user_photos WHERE id = ?").get(id)) };
}

function ownedRow(db, userId, photoId) {
  if (!userId || typeof photoId !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(photoId)) return null;
  const r = db.prepare("SELECT * FROM user_photos WHERE id = ?").get(photoId);
  return r && r.user_id === userId ? r : null;
}
export { ownedRow };

/** The catalog view of one photo row (no file paths). */
export function view(r) {
  if (!r) return null;
  const exif = parseJSON(r.exif_json, {});
  const edit = parseJSON(r.edit_json, null);
  return {
    id: r.id, caption: r.caption || null, altText: r.alt_text || null,
    tags: parseJSON(r.tags, []), favorite: !!r.favorite,
    rating: r.rating || 0, flag: r.flag || "none", label: r.color_label || null,
    width: r.width || null, height: r.height || null, sizeBytes: r.size_bytes || null,
    filename: r.original_filename || null, mime: r.mime || null,
    source: r.source || (r.world_id ? "concordia" : "import"), worldId: r.world_id || null,
    takenAt: r.taken_at || null, capturedAt: r.captured_at || null,
    camera: [exif.make, exif.model].filter(Boolean).join(" ").replace(/^(\w+) \1 /i, "$1 ") || null,
    lens: exif.lens || null,
    exif,
    edited: !!edit && !isDefaultEdit(edit), editedAt: r.edited_at || null,
    visibility: r.visibility, dtuId: r.dtu_id || null,
    thumbUrl: `/api/photos/${r.id}/thumb`, previewUrl: `/api/photos/${r.id}/preview`,
  };
}

// ── The library ──────────────────────────────────────────────────────

const SORTS = {
  captured: "COALESCE(captured_at, taken_at) DESC, id DESC",
  imported: "taken_at DESC, id DESC",
  rating: "rating DESC, COALESCE(captured_at, taken_at) DESC",
  name: "LOWER(COALESCE(caption, original_filename, id)) ASC",
};

/** A filter as a person sets it in the library bar (also a smart album's rule). */
export function cleanFilter(raw = {}) {
  const f = {};
  const minRating = Math.round(Number(raw.minRating));
  if (Number.isFinite(minRating) && minRating >= 1 && minRating <= 5) f.minRating = minRating;
  if (FLAGS.includes(raw.flag) && raw.flag !== "none") f.flag = raw.flag;
  else if (raw.flag === "unflagged") f.flag = "unflagged";
  if (LABELS.includes(raw.label)) f.label = raw.label;
  if (typeof raw.keyword === "string" && raw.keyword.trim()) f.keyword = raw.keyword.trim().toLowerCase().slice(0, 40);
  if (typeof raw.camera === "string" && raw.camera.trim()) f.camera = raw.camera.trim().slice(0, 80);
  if (typeof raw.text === "string" && raw.text.trim()) f.text = raw.text.trim().slice(0, 80);
  if (raw.edited === true || raw.edited === false) f.edited = raw.edited;
  if (["import", "concordia"].includes(raw.source)) f.source = raw.source;
  if (raw.favorite === true) f.favorite = true;
  return f;
}

export function listLibrary(db, userId, raw = {}) {
  if (!db || !userId) return { photos: [], total: 0, facets: null };
  const f = cleanFilter(raw);
  const where = ["user_id = ?"], args = [userId];
  if (f.minRating) { where.push("rating >= ?"); args.push(f.minRating); }
  if (f.flag === "unflagged") where.push("flag = 'none'");
  else if (f.flag) { where.push("flag = ?"); args.push(f.flag); }
  if (f.label) { where.push("color_label = ?"); args.push(f.label); }
  if (f.source) { where.push("source = ?"); args.push(f.source); }
  if (f.favorite) where.push("favorite = 1");
  if (f.edited === true) where.push("edit_json IS NOT NULL");
  if (f.edited === false) where.push("edit_json IS NULL");
  if (f.text) { where.push("(LOWER(COALESCE(caption,'')) LIKE ? OR LOWER(COALESCE(original_filename,'')) LIKE ? OR LOWER(COALESCE(tags,'')) LIKE ?)"); const t = `%${f.text.toLowerCase().replace(/[%_]/g, "")}%`; args.push(t, t, t); }
  const order = SORTS[raw.sort] || SORTS.captured;
  let rows = db.prepare(`SELECT * FROM user_photos WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 2000`).all(...args);
  let photos = rows.map(view);
  // Keyword, camera and "really edited" read parsed JSON, so they filter here.
  if (f.keyword) photos = photos.filter((p) => p.tags.includes(f.keyword));
  if (f.camera) photos = photos.filter((p) => (p.camera || "").toLowerCase().includes(f.camera.toLowerCase()));
  if (f.edited === true) photos = photos.filter((p) => p.edited);
  const all = db.prepare("SELECT rating, flag, color_label, tags, exif_json, source FROM user_photos WHERE user_id = ?").all(userId);
  const facets = { total: all.length, picks: 0, rejects: 0, rated: 0, labels: {}, keywords: {}, cameras: {}, concordia: 0 };
  for (const r of all) {
    if (r.flag === "pick") facets.picks++;
    if (r.flag === "reject") facets.rejects++;
    if (r.rating > 0) facets.rated++;
    if (r.color_label) facets.labels[r.color_label] = (facets.labels[r.color_label] || 0) + 1;
    for (const t of parseJSON(r.tags, [])) facets.keywords[t] = (facets.keywords[t] || 0) + 1;
    const ex = parseJSON(r.exif_json, {});
    const cam = [ex.make, ex.model].filter(Boolean).join(" ");
    if (cam) facets.cameras[cam] = (facets.cameras[cam] || 0) + 1;
    if (r.source === "concordia") facets.concordia++;
  }
  return { photos: photos.slice(0, 1000), total: photos.length, facets, filter: f };
}

/** Rate, flag, label, favourite, caption, alt text or keywords — on one photo or many. */
export function catalogSet(db, userId, ids, patch = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).slice(0, 500);
  if (!list.length) return { ok: false, error: "choose a photo" };
  const sets = [], args = [];
  if (patch.rating !== undefined) {
    const r = Math.round(Number(patch.rating));
    if (!Number.isFinite(r) || r < 0 || r > 5) return { ok: false, error: "rating is 0 to 5 stars" };
    sets.push("rating = ?"); args.push(r);
  }
  if (patch.flag !== undefined) { if (!FLAGS.includes(patch.flag)) return { ok: false, error: "flag is pick, reject or none" }; sets.push("flag = ?"); args.push(patch.flag); }
  if (patch.label !== undefined) { if (patch.label !== null && !LABELS.includes(patch.label)) return { ok: false, error: `label is one of ${LABELS.join(", ")}, or none` }; sets.push("color_label = ?"); args.push(patch.label); }
  if (patch.favorite !== undefined) { sets.push("favorite = ?"); args.push(patch.favorite ? 1 : 0); }
  if (patch.caption !== undefined) { sets.push("caption = ?"); args.push(String(patch.caption ?? "").trim().slice(0, 280) || null); }
  if (patch.altText !== undefined) { sets.push("alt_text = ?"); args.push(String(patch.altText ?? "").trim().slice(0, 300) || null); }
  let addTags = null, removeTags = null;
  const tagList = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((t) => String(t).trim().toLowerCase()).filter(Boolean).map((t) => t.slice(0, 40)))];
  if (patch.tags !== undefined) { const t = tagList(patch.tags).slice(0, 24); sets.push("tags = ?"); args.push(t.length ? JSON.stringify(t) : null); }
  if (patch.addTags !== undefined) addTags = tagList(patch.addTags);
  if (patch.removeTags !== undefined) removeTags = tagList(patch.removeTags);
  if (!sets.length && !addTags && !removeTags) return { ok: false, error: "nothing to change" };
  const owned = list.filter((id) => ownedRow(db, userId, id));
  if (owned.length !== list.length) return { ok: false, error: "photo not found" };
  db.transaction(() => {
    for (const id of owned) {
      if (sets.length) db.prepare(`UPDATE user_photos SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...args, id, userId);
      if (addTags || removeTags) {
        const cur = parseJSON(db.prepare("SELECT tags FROM user_photos WHERE id = ?").get(id)?.tags, []);
        let next = cur.concat(addTags || []).filter((t) => !(removeTags || []).includes(t));
        next = [...new Set(next)].slice(0, 24);
        db.prepare("UPDATE user_photos SET tags = ? WHERE id = ?").run(next.length ? JSON.stringify(next) : null, id);
      }
    }
  })();
  return { ok: true, photos: owned.map((id) => view(db.prepare("SELECT * FROM user_photos WHERE id = ?").get(id))) };
}

// ── Edits, history, snapshots ────────────────────────────────────────

export function getEdit(db, userId, photoId) {
  const r = ownedRow(db, userId, photoId);
  if (!r) return { ok: false, error: "photo not found" };
  const edit = r.edit_json ? normalizeEdit(parseJSON(r.edit_json, {})) : defaultEdit();
  const history = db.prepare("SELECT id, label, snapshot, created_at FROM photo_edit_history WHERE photo_id = ? AND user_id = ? ORDER BY id DESC LIMIT 100").all(photoId, userId)
    .map((h) => ({ id: h.id, label: h.label, snapshot: !!h.snapshot, at: h.created_at }));
  return { ok: true, photo: view(r), edit, history };
}

function writeEdit(db, userId, photoId, edit, label, snapshot = false) {
  const json = JSON.stringify(edit);
  const isDef = isDefaultEdit(edit);
  db.prepare("UPDATE user_photos SET edit_json = ?, edited_at = unixepoch() WHERE id = ? AND user_id = ?").run(isDef ? null : json, photoId, userId);
  const info = db.prepare("INSERT INTO photo_edit_history (photo_id, user_id, label, snapshot, edit_json) VALUES (?, ?, ?, ?, ?)").run(photoId, userId, String(label || "Edit").slice(0, 80), snapshot ? 1 : 0, json);
  // Keep the newest steps; snapshots are kept regardless.
  db.prepare(`DELETE FROM photo_edit_history WHERE photo_id = ? AND snapshot = 0 AND id NOT IN
              (SELECT id FROM photo_edit_history WHERE photo_id = ? AND snapshot = 0 ORDER BY id DESC LIMIT ?)`).run(photoId, photoId, HISTORY_KEEP);
  return Number(info.lastInsertRowid);
}

export function saveEdit(db, userId, photoId, rawEdit, label = "Edit") {
  const r = ownedRow(db, userId, photoId);
  if (!r) return { ok: false, error: "photo not found" };
  if (!rawEdit || typeof rawEdit !== "object") return { ok: false, error: "edit required" };
  if (JSON.stringify(rawEdit).length > 600_000) return { ok: false, error: "that edit is too large to save" };
  const edit = normalizeEdit(rawEdit);
  const historyId = writeEdit(db, userId, photoId, edit, label);
  return { ok: true, edit, historyId, edited: !isDefaultEdit(edit) };
}

export function snapshot(db, userId, photoId, name) {
  const r = ownedRow(db, userId, photoId);
  if (!r) return { ok: false, error: "photo not found" };
  const label = String(name || "").trim().slice(0, 80);
  if (!label) return { ok: false, error: "name the snapshot" };
  const edit = r.edit_json ? normalizeEdit(parseJSON(r.edit_json, {})) : defaultEdit();
  const id = db.prepare("INSERT INTO photo_edit_history (photo_id, user_id, label, snapshot, edit_json) VALUES (?, ?, ?, 1, ?)").run(photoId, userId, label, JSON.stringify(edit)).lastInsertRowid;
  return { ok: true, id: Number(id), label };
}

export function revertTo(db, userId, photoId, historyId) {
  const r = ownedRow(db, userId, photoId);
  if (!r) return { ok: false, error: "photo not found" };
  const h = db.prepare("SELECT * FROM photo_edit_history WHERE id = ? AND photo_id = ? AND user_id = ?").get(Number(historyId), photoId, userId);
  if (!h) return { ok: false, error: "that history step is gone" };
  const edit = normalizeEdit(parseJSON(h.edit_json, {}));
  writeEdit(db, userId, photoId, edit, `Back to: ${h.label}`.slice(0, 80));
  return { ok: true, edit };
}

// ── Presets, copy and paste, batch ───────────────────────────────────

export const PARTS = ["basic", "curve", "hsl", "detail", "effects", "geometry", "masks", "spots"];
const PRESET_PARTS = ["basic", "curve", "hsl", "detail", "effects"];

/** Lay the chosen parts of `from` over `onto`. */
export function mergeParts(onto, from, parts) {
  const a = normalizeEdit(onto), b = normalizeEdit(from);
  for (const p of parts) if (PARTS.includes(p)) a[p] = b[p];
  return normalizeEdit(a);
}

export function listPresets(db, userId) {
  return db.prepare("SELECT id, name, edit_json, created_at FROM photo_presets WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(userId)
    .map((p) => ({ id: p.id, name: p.name, edit: normalizeEdit(parseJSON(p.edit_json, {})), createdAt: p.created_at }));
}

export function createPreset(db, userId, name, rawEdit) {
  const n = String(name || "").trim().slice(0, 60);
  if (!n) return { ok: false, error: "name the preset" };
  if (!rawEdit || typeof rawEdit !== "object") return { ok: false, error: "edit required" };
  if (db.prepare("SELECT COUNT(*) c FROM photo_presets WHERE user_id = ?").get(userId).c >= 200) return { ok: false, error: "you have 200 presets; delete one first" };
  // A preset is a look, not a crop or a retouch: geometry, masks and spots stay out.
  const look = mergeParts(defaultEdit(), rawEdit, PRESET_PARTS);
  if (isDefaultEdit(look)) return { ok: false, error: "that preset would change nothing" };
  const id = rid("pre");
  db.prepare("INSERT INTO photo_presets (id, user_id, name, edit_json) VALUES (?, ?, ?, ?)").run(id, userId, n, JSON.stringify(look));
  return { ok: true, preset: { id, name: n, edit: look } };
}

export function deletePreset(db, userId, presetId) {
  const r = db.prepare("DELETE FROM photo_presets WHERE id = ? AND user_id = ?").run(String(presetId || ""), userId);
  return r.changes ? { ok: true } : { ok: false, error: "preset not found" };
}

/** Apply a preset (or another photo's settings) to many photos at once. */
export function applyToMany(db, userId, ids, { presetId, fromPhotoId, parts } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).slice(0, 500);
  if (!list.length) return { ok: false, error: "choose the photos" };
  let source, label;
  if (presetId) {
    const p = db.prepare("SELECT name, edit_json FROM photo_presets WHERE id = ? AND user_id = ?").get(String(presetId), userId);
    if (!p) return { ok: false, error: "preset not found" };
    source = parseJSON(p.edit_json, {}); label = `Preset: ${p.name}`;
    parts = parts?.length ? parts : PRESET_PARTS;
  } else if (fromPhotoId) {
    const r = ownedRow(db, userId, String(fromPhotoId));
    if (!r) return { ok: false, error: "photo not found" };
    source = parseJSON(r.edit_json, defaultEdit()); label = "Pasted settings";
    parts = parts?.length ? parts : PRESET_PARTS;
  } else return { ok: false, error: "choose a preset or a photo to copy from" };
  const chosen = parts.filter((p) => PARTS.includes(p));
  if (!chosen.length) return { ok: false, error: "choose what to apply" };
  for (const id of list) if (!ownedRow(db, userId, id)) return { ok: false, error: "photo not found" };
  db.transaction(() => {
    for (const id of list) {
      const r = ownedRow(db, userId, id);
      writeEdit(db, userId, id, mergeParts(parseJSON(r.edit_json, defaultEdit()), source, chosen), label);
    }
  })();
  return { ok: true, applied: list.length, parts: chosen };
}

// ── Albums, including smart ones ─────────────────────────────────────

export function createSmartAlbum(db, userId, name, rule) {
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return { ok: false, error: "name the album" };
  const f = cleanFilter(rule || {});
  if (!Object.keys(f).length) return { ok: false, error: "a smart album needs at least one rule" };
  const id = rid("alb");
  db.prepare("INSERT INTO photo_albums (id, user_id, name, rule_json) VALUES (?, ?, ?, ?)").run(id, userId, n, JSON.stringify(f));
  return { ok: true, album: { id, name: n, smart: true, rule: f } };
}

export function listAlbumsWithSmart(db, userId) {
  const rows = db.prepare("SELECT id, name, rule_json, created_at FROM photo_albums WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  return rows.map((a) => {
    if (a.rule_json) {
      const rule = parseJSON(a.rule_json, {});
      const lib = listLibrary(db, userId, rule);
      return { id: a.id, name: a.name, smart: true, rule, count: lib.total, coverPhotoId: lib.photos[0]?.id || null };
    }
    const count = db.prepare("SELECT COUNT(*) c FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = ? AND p.user_id = ?").get(a.id, userId).c;
    const cover = db.prepare("SELECT i.photo_id FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = ? ORDER BY COALESCE(p.captured_at, p.taken_at) DESC LIMIT 1").get(a.id);
    return { id: a.id, name: a.name, smart: false, count, coverPhotoId: cover?.photo_id || null };
  });
}

export function albumPhotos(db, userId, albumId) {
  const a = db.prepare("SELECT id, name, rule_json FROM photo_albums WHERE id = ? AND user_id = ?").get(String(albumId || ""), userId);
  if (!a) return { ok: false, error: "album not found" };
  if (a.rule_json) { const lib = listLibrary(db, userId, parseJSON(a.rule_json, {})); return { ok: true, album: { id: a.id, name: a.name, smart: true }, photos: lib.photos }; }
  const rows = db.prepare("SELECT p.* FROM photo_album_items i JOIN user_photos p ON p.id = i.photo_id WHERE i.album_id = ? AND p.user_id = ? ORDER BY COALESCE(p.captured_at, p.taken_at) DESC").all(a.id, userId);
  return { ok: true, album: { id: a.id, name: a.name, smart: false }, photos: rows.map(view) };
}

// ── Export settings → what the render worker needs ───────────────────

/** The EXIF to write into an export: camera facts kept, location only if asked. */
export function exportExif(row, { keepExif = true, keepLocation = false } = {}) {
  if (!keepExif) return { IFD0: { Software: "Concord Darkroom" } };
  const ex = parseJSON(row.exif_json, {});
  const ifd0 = { Software: "Concord Darkroom" }, ifd2 = {};
  if (ex.make) ifd0.Make = String(ex.make);
  if (ex.model) ifd0.Model = String(ex.model);
  const rat = (v, den = 1000) => `${Math.round(v * den)}/${den}`;
  if (ex.exposureTime > 0) ifd2.ExposureTime = ex.exposureTime >= 1 ? rat(ex.exposureTime, 10) : `1/${Math.round(1 / ex.exposureTime)}`;
  if (ex.fNumber > 0) ifd2.FNumber = rat(ex.fNumber, 10);
  if (ex.iso > 0) ifd2.ISOSpeedRatings = String(Math.round(ex.iso));
  if (ex.focalLength > 0) ifd2.FocalLength = rat(ex.focalLength, 10);
  if (ex.capturedAt) ifd2.DateTimeOriginal = String(ex.capturedAt);
  if (ex.lens) ifd2.LensModel = String(ex.lens);
  const out = { IFD0: ifd0, IFD2: ifd2 };
  if (keepLocation && ex.gps) {
    const dms = (v) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 100); return `${d}/1 ${m}/1 ${s}/100`; };
    out.IFD3 = { GPSLatitudeRef: ex.gps.lat >= 0 ? "N" : "S", GPSLatitude: dms(ex.gps.lat), GPSLongitudeRef: ex.gps.lon >= 0 ? "E" : "W", GPSLongitude: dms(ex.gps.lon) };
  }
  return out;
}

export function cleanExportOptions(q = {}) {
  const format = ["jpeg", "webp", "png"].includes(q.format) ? q.format : "jpeg";
  const quality = Math.max(40, Math.min(100, Math.round(Number(q.quality) || 90)));
  const le = Math.round(Number(q.longEdge) || 0);
  const longEdge = le > 0 ? Math.max(64, Math.min(16384, le)) : 0;
  const flag = (v, d) => (v === undefined ? d : v === true || v === "1" || v === "true");
  return { format, quality, longEdge, keepExif: flag(q.exif, true), keepLocation: flag(q.location, false) };
}

export { imageFormatOf };
