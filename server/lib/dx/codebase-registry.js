// server/lib/dx/codebase-registry.js
//
// Per-customer codebase registry for the DX Platform Phase A2.
//
// A codebase is `(user_id, repo_root)` — typically a Git repo path on
// the user's machine. The plugin computes a stable id like
// `cb_${userId}_${sha1(repo_root)}` and POSTs to dx.registerCodebase
// on first activation. Subsequent file-open events upsert
// `last_seen_at` so we know which codebases are active.
//
// The id pattern keeps this stable across plugin restarts without
// requiring server-side identity beyond user_id + repo_root.

import crypto from "node:crypto";

/**
 * Compute the stable id for a (userId, repoRoot) pair.
 */
export function codebaseIdFor(userId, repoRoot) {
  if (!userId || !repoRoot) return null;
  const h = crypto.createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
  return `cb_${userId}_${h}`;
}

/**
 * Idempotent UPSERT — registers a codebase or refreshes last_seen_at.
 *
 * @returns {{ok: boolean, codebaseId?: string, created?: boolean, reason?: string}}
 */
export function ensureCodebase(db, userId, repoRoot, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !repoRoot) return { ok: false, reason: "missing_args" };
  const id = codebaseIdFor(userId, repoRoot);
  try {
    // SQLite's ON CONFLICT DO UPDATE reports `changes = 1` for both
    // initial inserts AND conflict-updates, and `lastInsertRowid` carries
    // over from prior inserts on the same connection. Probe for existence
    // before the upsert so callers that key off `created` for one-time
    // initialisation work correctly.
    const existsBefore = db.prepare(`SELECT 1 FROM codebases WHERE id = ?`).get(id);
    db.prepare(`
      INSERT INTO codebases (id, user_id, repo_root, detector_version, last_seen_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, repo_root) DO UPDATE
        SET last_seen_at = unixepoch(),
            detector_version = COALESCE(excluded.detector_version, detector_version)
    `).run(id, userId, repoRoot, opts.detectorVersion || null);
    return { ok: true, codebaseId: id, created: !existsBefore };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Bump last_seen_at on a known codebase. Cheaper than ensureCodebase
 * for hot-path file-open events when the codebase already exists.
 */
export function touchCodebase(db, codebaseId) {
  if (!db || !codebaseId) return { ok: false, reason: "missing_args" };
  try {
    const r = db.prepare(`UPDATE codebases SET last_seen_at = unixepoch() WHERE id = ?`).run(codebaseId);
    return { ok: true, found: r.changes > 0 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Look up a codebase by id.
 */
export function getCodebase(db, codebaseId) {
  if (!db || !codebaseId) return null;
  try {
    return db.prepare(`SELECT * FROM codebases WHERE id = ?`).get(codebaseId) || null;
  } catch {
    return null;
  }
}

/**
 * List all codebases for a user (recent-first).
 */
export function listCodebasesForUser(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, repo_root, shadow_dtu_id, detector_version, created_at, last_seen_at
      FROM codebases
      WHERE user_id = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(userId, Math.min(limit, 200));
  } catch {
    return [];
  }
}

/**
 * Attach a shadow DTU id to a codebase. Called from `dtu.upsert_shadow`
 * when the per-codebase context shadow is created on first activation.
 */
export function attachShadowDtu(db, codebaseId, shadowDtuId) {
  if (!db || !codebaseId || !shadowDtuId) return { ok: false, reason: "missing_args" };
  try {
    const r = db.prepare(`UPDATE codebases SET shadow_dtu_id = ? WHERE id = ?`).run(shadowDtuId, codebaseId);
    return { ok: true, updated: r.changes };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
