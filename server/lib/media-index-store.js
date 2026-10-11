// SQLite write-through for the in-memory media map. The artifact bytes
// stay on disk; this row is what /api/media/:id/stream needs after a
// process restart: who owns it, who may see it, and where the file is.

const UPSERT = `
  INSERT INTO media_index (
    id, owner_id, privacy, mime_type, media_type, title,
    path, disk_path, size_bytes, duration,
    price_cc, price_currency, preview_url, preview_start_ms, preview_seconds,
    thumbnail, artifact_json, row_json, created_at, updated_at
  ) VALUES (
    @id, @owner_id, @privacy, @mime_type, @media_type, @title,
    @path, @disk_path, @size_bytes, @duration,
    @price_cc, @price_currency, @preview_url, @preview_start_ms, @preview_seconds,
    @thumbnail, @artifact_json, @row_json, @created_at, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    owner_id = excluded.owner_id,
    privacy = excluded.privacy,
    mime_type = excluded.mime_type,
    media_type = excluded.media_type,
    title = excluded.title,
    path = excluded.path,
    disk_path = excluded.disk_path,
    size_bytes = excluded.size_bytes,
    duration = excluded.duration,
    price_cc = excluded.price_cc,
    price_currency = excluded.price_currency,
    preview_url = excluded.preview_url,
    preview_start_ms = excluded.preview_start_ms,
    preview_seconds = excluded.preview_seconds,
    thumbnail = excluded.thumbnail,
    artifact_json = excluded.artifact_json,
    row_json = excluded.row_json,
    updated_at = excluded.updated_at
`;

const stmts = new WeakMap();

function numOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mediaDatabase(STATE) {
  const db = STATE?.db;
  if (!db || typeof db.prepare !== "function") return null;
  try {
    const hit = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_index'").get();
    return hit ? db : null;
  } catch {
    return null;
  }
}

function statement(db) {
  let cached = stmts.get(db);
  if (!cached) {
    cached = {
      upsert: db.prepare(UPSERT),
      remove: db.prepare("DELETE FROM media_index WHERE id = ?"),
      one: db.prepare("SELECT * FROM media_index WHERE id = ?"),
      all: db.prepare("SELECT * FROM media_index"),
    };
    stmts.set(db, cached);
  }
  return cached;
}

function rowFromDtu(dtu) {
  const artifact = dtu.storageRef?.artifactRef || null;
  return {
    id: dtu.id,
    owner_id: String(dtu.author),
    privacy: dtu.privacy || "public",
    mime_type: dtu.mimeType || "application/octet-stream",
    media_type: dtu.mediaType,
    title: dtu.title,
    path: dtu.storageRef?.path || null,
    disk_path: artifact?.diskPath || null,
    size_bytes: Number(dtu.fileSize) || 0,
    duration: numOrNull(dtu.duration),
    price_cc: numOrNull(dtu.priceCc),
    price_currency: dtu.currency || null,
    preview_url: dtu.previewUrl || null,
    preview_start_ms: numOrNull(dtu.previewStartMs),
    preview_seconds: numOrNull(dtu.previewSeconds),
    thumbnail: dtu.thumbnail || null,
    artifact_json: artifact ? JSON.stringify(artifact) : null,
    row_json: JSON.stringify(dtu),
    created_at: dtu.createdAt,
    updated_at: dtu.updatedAt,
  };
}

export function reviveMediaRow(row) {
  if (!row) return null;
  let dtu;
  try {
    dtu = JSON.parse(row.row_json);
  } catch {
    return null;
  }
  if (!dtu || typeof dtu !== "object") return null;
  dtu.id = row.id;
  dtu.author = row.owner_id;
  dtu.privacy = row.privacy;
  dtu.mimeType = row.mime_type;
  dtu.mediaType = row.media_type;
  dtu.title = row.title;
  dtu.fileSize = row.size_bytes;
  dtu.duration = row.duration;
  dtu.priceCc = row.price_cc;
  dtu.currency = row.price_currency;
  dtu.previewUrl = row.preview_url;
  dtu.previewStartMs = row.preview_start_ms;
  dtu.previewSeconds = row.preview_seconds;
  dtu.thumbnail = row.thumbnail;
  // Same rule create/update already use. A private row is never global.
  dtu.scope = dtu.privacy === "public" ? "global" : "user";
  if (!dtu.storageRef || typeof dtu.storageRef !== "object") {
    dtu.storageRef = { tier: "hot", path: row.path, size: row.size_bytes, artifactRef: null };
  }
  dtu.storageRef.path = row.path || dtu.storageRef.path;
  dtu.storageRef.size = row.size_bytes;
  if (row.artifact_json) {
    try {
      dtu.storageRef.artifactRef = JSON.parse(row.artifact_json);
    } catch { /* row_json copy stands */ }
  }
  if (row.disk_path && dtu.storageRef.artifactRef && typeof dtu.storageRef.artifactRef === "object") {
    dtu.storageRef.artifactRef.diskPath = row.disk_path;
  }
  return dtu;
}

export function persistMediaIndex(db, dtu) {
  if (!db || !dtu?.id || !dtu.author) return;
  statement(db).upsert.run(rowFromDtu(dtu));
}

export function deleteMediaIndex(db, mediaId) {
  if (!db || !mediaId) return;
  statement(db).remove.run(mediaId);
}

export function loadMediaIndex(db, mediaId) {
  if (!db || !mediaId) return null;
  return reviveMediaRow(statement(db).one.get(mediaId));
}

export function loadAllMediaIndex(db) {
  if (!db) return [];
  return statement(db).all.all().map(reviveMediaRow).filter(Boolean);
}
