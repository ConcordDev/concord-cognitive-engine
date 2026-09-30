/**
 * DTU Attachment Store
 *
 * Handles binary file attachments: detect MIME type, SHA256 dedup, store/retrieve/delete.
 * Supports any file format: PDF, PNG, MP3, MP4, ZIP, raw bytes, JSON, text, etc.
 */

import crypto from 'crypto';

// Magic-byte detection for common formats
const MAGIC_BYTES = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47], // \x89PNG
  jpg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46], // GIF
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF (check 8-12 for WEBP)
  mp3: [0xff, 0xfb], // MPEG
  mp4: [0x66, 0x74, 0x79, 0x70], // ftyp at offset 4
  wav: [0x52, 0x49, 0x46, 0x46], // RIFF (check 8-12 for WAVE)
  zip: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
  gzip: [0x1f, 0x8b],
};

/**
 * Detect content kind from bytes (magic-byte sniffing)
 * @param {Buffer|Uint8Array} bytes
 * @returns {string} 'pdf'|'png'|'jpg'|'gif'|'webp'|'mp3'|'mp4'|'wav'|'zip'|'gzip'|'json'|'text'|'binary'
 */
export function detectKind(bytes) {
  if (!bytes || bytes.length === 0) return 'binary';

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  // Check PDF
  if (buf.length >= 4 && matchesMagic(buf, MAGIC_BYTES.pdf)) return 'pdf';

  // Check PNG
  if (buf.length >= 4 && matchesMagic(buf, MAGIC_BYTES.png)) return 'png';

  // Check JPEG
  if (buf.length >= 3 && matchesMagic(buf, MAGIC_BYTES.jpg)) return 'jpg';

  // Check GIF
  if (buf.length >= 3 && matchesMagic(buf, MAGIC_BYTES.gif)) return 'gif';

  // Check WebP (RIFF at 0, WEBP at 8)
  if (buf.length >= 12 && matchesMagic(buf, MAGIC_BYTES.webp) && buf.toString('utf8', 8, 12) === 'WEBP') {
    return 'webp';
  }

  // Check MP3
  if (buf.length >= 2 && matchesMagic(buf, MAGIC_BYTES.mp3)) return 'mp3';

  // Check MP4 (ftyp at offset 4)
  if (buf.length >= 12 && buf.toString('utf8', 4, 8) === 'ftyp') return 'mp4';

  // Check WAV (RIFF at 0, WAVE at 8)
  if (buf.length >= 12 && matchesMagic(buf, MAGIC_BYTES.wav) && buf.toString('utf8', 8, 12) === 'WAVE') {
    return 'wav';
  }

  // Check ZIP
  if (buf.length >= 4 && matchesMagic(buf, MAGIC_BYTES.zip)) return 'zip';

  // Check gzip
  if (buf.length >= 2 && matchesMagic(buf, MAGIC_BYTES.gzip)) return 'gzip';

  // Check JSON (starts with { or [)
  if (buf[0] === 0x7b || buf[0] === 0x5b) {
    try {
      const text = buf.toString('utf8');
      JSON.parse(text);
      return 'json';
    } catch (e) {
      // Not valid JSON, continue
    }
  }

  // Check UTF-8 text
  try {
    const text = buf.toString('utf8');
    if (buf.equals(Buffer.from(text, 'utf8'))) {
      return 'text';
    }
  } catch (e) {
    // Not valid UTF-8
  }

  return 'binary';
}

/**
 * Check if buffer starts with magic bytes
 */
function matchesMagic(buf, magic) {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * SHA256 hash of buffer (canonical dedup key)
 * @param {Buffer|Uint8Array} bytes
 * @returns {string} hex hash (64 chars)
 */
export function sha256(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Store attachment (deduped by SHA256)
 * @param {object} db - database handle
 * @param {object} opts - { dtu_id, filename, bytes, source }
 * @returns {Promise<{ sha256, size, kind }>}
 */
export async function putAttachment(db, opts = {}) {
  const { dtu_id, filename, bytes, source = 'upload' } = opts;

  if (!dtu_id || !bytes) {
    throw new Error('[dtu-attachment] Missing dtu_id or bytes');
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const hash = sha256(buf);
  const kind = detectKind(buf);
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO dtu_attachments
      (dtu_id, sha256, filename, mime_type, size_bytes, bytes, kind, encoding, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(dtu_id, hash, filename || `attachment-${hash.slice(0, 8)}`, kindToMime(kind), buf.length, buf, kind, 'binary', source, now);

  return { sha256: hash, size: buf.length, kind };
}

/**
 * Get attachment by SHA256 (returns Buffer, never null)
 * @param {object} db
 * @param {object} opts - { dtu_id, sha256 }
 * @returns {Promise<{ filename, bytes, kind, mime }>}
 */
export async function getAttachment(db, opts = {}) {
  const { dtu_id, sha256: hash } = opts;

  if (!dtu_id || !hash) {
    throw new Error('[dtu-attachment] Missing dtu_id or sha256');
  }

  const stmt = db.prepare(`
    SELECT filename, bytes, kind, mime_type FROM dtu_attachments
    WHERE dtu_id = ? AND sha256 = ?
  `);

  const row = stmt.get(dtu_id, hash);
  if (!row) {
    throw new Error(`[dtu-attachment] Attachment not found: ${dtu_id}/${hash}`);
  }

  return {
    filename: row.filename,
    bytes: row.bytes,
    kind: row.kind,
    mime: row.mime_type,
  };
}

/**
 * Delete attachment (only if no other DTU references it)
 * @param {object} db
 * @param {object} opts - { dtu_id, sha256 }
 * @returns {Promise<{ ok, removed }>}
 */
export async function deleteAttachment(db, opts = {}) {
  const { dtu_id, sha256: hash } = opts;

  if (!dtu_id || !hash) {
    throw new Error('[dtu-attachment] Missing dtu_id or sha256');
  }

  // Check if other DTUs reference this attachment
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM dtu_attachments WHERE sha256 = ? AND dtu_id != ?');
  const { cnt } = countStmt.get(hash, dtu_id);

  const delStmt = db.prepare('DELETE FROM dtu_attachments WHERE dtu_id = ? AND sha256 = ?');
  delStmt.run(dtu_id, hash);

  return { ok: true, removed: cnt === 0 };
}

/**
 * List attachments for DTU (metadata only, no bytes)
 * @param {object} db
 * @param {string} dtu_id
 * @returns {Promise<Array<{ sha256, filename, kind, size }>>}
 */
export async function listAttachments(db, dtu_id) {
  if (!dtu_id) {
    throw new Error('[dtu-attachment] Missing dtu_id');
  }

  const stmt = db.prepare(`
    SELECT sha256, filename, kind, size_bytes as size
    FROM dtu_attachments
    WHERE dtu_id = ?
    ORDER BY created_at ASC
  `);

  return stmt.all(dtu_id) || [];
}

/**
 * Map kind to MIME type
 */
function kindToMime(kind) {
  const mimes = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    zip: 'application/zip',
    gzip: 'application/gzip',
    json: 'application/json',
    text: 'text/plain',
    binary: 'application/octet-stream',
  };
  return mimes[kind] || 'application/octet-stream';
}
