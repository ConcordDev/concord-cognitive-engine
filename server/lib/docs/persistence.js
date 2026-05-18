// server/lib/docs/persistence.js
//
// Docs Sprint A #1 — DB persistence layer.
//
// Wraps migration 211 tables with helpers used by domains/docs.js and
// routes/docs.js. Mirrors the whiteboard/persistence.js shape so role
// enforcement, version logging, and soft-delete semantics are
// consistent across lenses.

import { randomUUID } from "node:crypto";
import { htmlToMarkdown, computeWordCount, extractBackrefs } from "./markdown.js";

const TITLE_MAX = 240;
const HTML_MAX = 5_000_000; // 5 MB hard cap per doc
const SLUG_MAX = 80;

export const ROLE_RANK = { owner: 5, admin: 4, editor: 3, commenter: 2, viewer: 1 };

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function _normaliseTitle(t) {
  return String(t || "Untitled").trim().slice(0, TITLE_MAX) || "Untitled";
}

function _slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

/**
 * Create a new document. Owner is auto-registered as collaborator with
 * role='owner'. Returns the inserted row.
 */
export function createDocument(db, {
  ownerId, title, parentId = null, worldId = null,
  kind = "doc", visibility = "private", icon = null, contentHtml = "",
}) {
  if (!db || !ownerId) return { ok: false, reason: "missing_db_or_owner" };
  const id = `doc:${randomUUID()}`;
  const normTitle = _normaliseTitle(title);
  const html = String(contentHtml || "").slice(0, HTML_MAX);
  const md = htmlToMarkdown(html);
  const wordCount = computeWordCount(html);
  try {
    db.prepare(`
      INSERT INTO documents
        (id, owner_id, parent_id, world_id, title, content_html, content_md,
         kind, visibility, icon, word_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, parentId, worldId, normTitle, html, md, kind, visibility, icon, wordCount, _now(), _now());
    db.prepare(`
      INSERT INTO document_collaborators (document_id, user_id, role, invited_by, invited_at, accepted_at)
      VALUES (?, ?, 'owner', ?, ?, ?)
      ON CONFLICT(document_id, user_id) DO UPDATE SET role = 'owner'
    `).run(id, ownerId, ownerId, _now(), _now());
    return { ok: true, id, row: getDocument(db, id) };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getDocument(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!row) return null;
  return { ...row, meta: _safeJson(row.meta_json, {}) };
}

export function getDocumentBySlug(db, slug) {
  if (!db || !slug) return null;
  const row = db.prepare(`SELECT * FROM documents WHERE slug = ? AND deleted_at IS NULL`).get(slug);
  if (!row) return null;
  return { ...row, meta: _safeJson(row.meta_json, {}) };
}

export function listForOwner(db, ownerId, { kind, parentId, includeArchived = false, limit = 200 } = {}) {
  if (!db || !ownerId) return [];
  const conds = ["owner_id = ?", "deleted_at IS NULL"];
  const args = [ownerId];
  if (kind) { conds.push("kind = ?"); args.push(kind); }
  if (parentId === null || parentId === undefined) {
    // no filter
  } else if (parentId === "ROOT") {
    conds.push("parent_id IS NULL");
  } else {
    conds.push("parent_id = ?"); args.push(parentId);
  }
  const rows = db.prepare(`
    SELECT id, owner_id, parent_id, world_id, title, kind, visibility, icon, slug,
           word_count, citation_count, created_at, updated_at, meta_json
    FROM documents
    WHERE ${conds.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...args, limit);
  return rows.map((r) => ({ ...r, meta: _safeJson(r.meta_json, {}) }));
}

export function listForCollaborator(db, userId, { limit = 200 } = {}) {
  if (!db || !userId) return [];
  const rows = db.prepare(`
    SELECT d.id, d.owner_id, d.parent_id, d.world_id, d.title, d.kind, d.visibility,
           d.icon, d.slug, d.word_count, d.citation_count, d.created_at, d.updated_at,
           dc.role
    FROM documents d
    INNER JOIN document_collaborators dc ON dc.document_id = d.id
    WHERE dc.user_id = ? AND d.deleted_at IS NULL
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(userId, limit);
  return rows;
}

export function listChildren(db, parentId, { limit = 200 } = {}) {
  if (!db) return [];
  const rows = db.prepare(`
    SELECT id, owner_id, parent_id, title, kind, icon, slug, word_count, updated_at
    FROM documents
    WHERE parent_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(parentId, limit);
  return rows;
}

export function updateDocument(db, id, patch = {}) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!row) return { ok: false, reason: "not_found" };

  const next = { ...row };
  if (patch.title !== undefined) next.title = _normaliseTitle(patch.title);
  if (patch.contentHtml !== undefined) {
    next.content_html = String(patch.contentHtml || "").slice(0, HTML_MAX);
    next.content_md = htmlToMarkdown(next.content_html);
    next.word_count = computeWordCount(next.content_html);
  }
  if (patch.icon !== undefined) next.icon = patch.icon || null;
  if (patch.visibility && ["private","shared","workspace","public"].includes(patch.visibility)) {
    next.visibility = patch.visibility;
  }
  if (patch.parentId !== undefined) next.parent_id = patch.parentId || null;
  if (patch.worldId !== undefined) next.world_id = patch.worldId || null;
  if (patch.meta !== undefined) next.meta_json = JSON.stringify(patch.meta || {});
  if (patch.slug !== undefined) next.slug = patch.slug ? _slugify(patch.slug) || null : null;
  next.updated_at = _now();

  try {
    db.prepare(`
      UPDATE documents
      SET title = ?, content_html = ?, content_md = ?, icon = ?, visibility = ?,
          parent_id = ?, world_id = ?, meta_json = ?, slug = ?, word_count = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title, next.content_html, next.content_md, next.icon, next.visibility,
      next.parent_id, next.world_id, next.meta_json, next.slug, next.word_count, next.updated_at,
      id,
    );
    // Recompute backlinks if content changed.
    if (patch.contentHtml !== undefined) {
      _refreshBacklinks(db, id, next.content_html);
    }
    return { ok: true, row: getDocument(db, id) };
  } catch (err) {
    // UNIQUE slug collision → reject the publish gracefully.
    if (String(err?.message || "").includes("UNIQUE constraint failed: documents.slug")) {
      return { ok: false, reason: "slug_taken" };
    }
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function softDelete(db, id, actorId) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const role = getRole(db, id, actorId);
  if (role !== "owner" && role !== "admin") return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(_now(), _now(), id);
  return { ok: r.changes > 0, deleted: r.changes };
}

export function restore(db, id, actorId) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT owner_id FROM documents WHERE id = ?`).get(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.owner_id !== actorId) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?`).run(_now(), id);
  return { ok: r.changes > 0 };
}

// ---------- Versions ----------

export function snapshotVersion(db, { documentId, authorId, label = null, reason = "auto" }) {
  if (!db || !documentId || !authorId) return { ok: false, reason: "missing_args" };
  const doc = db.prepare(`SELECT content_html, content_md, word_count FROM documents WHERE id = ?`).get(documentId);
  if (!doc) return { ok: false, reason: "doc_not_found" };
  try {
    const r = db.prepare(`
      INSERT INTO document_versions (document_id, author_id, snapshot_html, snapshot_md, label, reason, word_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(documentId, authorId, doc.content_html, doc.content_md, label, reason, doc.word_count, _now());
    return { ok: true, versionId: r.lastInsertRowid };
  } catch (err) {
    return { ok: false, reason: "snapshot_failed", error: err?.message };
  }
}

export function listVersions(db, documentId, { limit = 50 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT id, document_id, author_id, label, reason, word_count, created_at
    FROM document_versions
    WHERE document_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(documentId, limit);
}

export function getVersion(db, versionId) {
  if (!db) return null;
  return db.prepare(`SELECT * FROM document_versions WHERE id = ?`).get(versionId);
}

export function restoreVersion(db, { documentId, versionId, actorId }) {
  if (!db || !documentId || !versionId || !actorId) return { ok: false, reason: "missing_args" };
  if (!hasRole(db, documentId, actorId, "editor")) return { ok: false, reason: "forbidden" };
  const v = db.prepare(`SELECT snapshot_html FROM document_versions WHERE id = ? AND document_id = ?`).get(versionId, documentId);
  if (!v) return { ok: false, reason: "version_not_found" };
  // Snapshot current state first so the restore is itself reversible.
  snapshotVersion(db, { documentId, authorId: actorId, reason: "restore", label: "Pre-restore snapshot" });
  return updateDocument(db, documentId, { contentHtml: v.snapshot_html });
}

// ---------- Comments ----------

export function addComment(db, {
  documentId, authorId, body, threadId = null,
  selectionAnchor = null, selectionFocus = null, selectionText = null,
}) {
  if (!db || !documentId || !authorId || !body) return { ok: false, reason: "missing_args" };
  if (!hasRole(db, documentId, authorId, "commenter")) return { ok: false, reason: "forbidden" };
  const id = `dcmt:${randomUUID()}`;
  const root = threadId || id;
  const trimmedBody = String(body).slice(0, 5000);
  try {
    db.prepare(`
      INSERT INTO document_comments
        (id, document_id, thread_id, author_id, body, selection_anchor, selection_focus, selection_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, documentId, root, authorId, trimmedBody, selectionAnchor, selectionFocus, selectionText, _now(), _now());
    return { ok: true, id, threadId: root };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listComments(db, documentId, { onlyUnresolved = false } = {}) {
  if (!db) return [];
  const sql = onlyUnresolved
    ? `SELECT * FROM document_comments WHERE document_id = ? AND resolved = 0 ORDER BY created_at ASC LIMIT 500`
    : `SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC LIMIT 500`;
  return db.prepare(sql).all(documentId).map((r) => ({
    ...r, reactions: _safeJson(r.reactions_json, {}),
  }));
}

export function resolveComment(db, { commentId, actorId }) {
  if (!db || !commentId) return { ok: false, reason: "missing_args" };
  const row = db.prepare(`SELECT document_id FROM document_comments WHERE id = ?`).get(commentId);
  if (!row) return { ok: false, reason: "not_found" };
  if (!hasRole(db, row.document_id, actorId, "editor")) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`UPDATE document_comments SET resolved = 1, resolved_by = ?, updated_at = ? WHERE id = ?`)
    .run(actorId, _now(), commentId);
  return { ok: r.changes > 0 };
}

// ---------- Collaborators / permissions ----------

export function getRole(db, documentId, userId) {
  if (!db || !documentId || !userId) return null;
  const row = db.prepare(`SELECT role FROM document_collaborators WHERE document_id = ? AND user_id = ?`)
    .get(documentId, userId);
  if (row) return row.role;
  // Public docs: anyone gets viewer.
  const doc = db.prepare(`SELECT visibility FROM documents WHERE id = ?`).get(documentId);
  if (doc?.visibility === "public") return "viewer";
  if (doc?.visibility === "workspace") return "viewer";
  return null;
}

export function hasRole(db, documentId, userId, minRole) {
  const r = getRole(db, documentId, userId);
  if (!r) return false;
  return (ROLE_RANK[r] || 0) >= (ROLE_RANK[minRole] || 0);
}

export function inviteCollaborator(db, { documentId, userId, role = "editor", invitedBy }) {
  if (!db || !documentId || !userId) return { ok: false, reason: "missing_args" };
  if (!ROLE_RANK[role]) return { ok: false, reason: "invalid_role" };
  if (!hasRole(db, documentId, invitedBy, "admin")) return { ok: false, reason: "forbidden" };
  try {
    db.prepare(`
      INSERT INTO document_collaborators (document_id, user_id, role, invited_by, invited_at, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role
    `).run(documentId, userId, role, invitedBy || null, _now(), _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function revokeCollaborator(db, { documentId, userId, actorId }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!hasRole(db, documentId, actorId, "admin")) return { ok: false, reason: "forbidden" };
  const r = db.prepare(`DELETE FROM document_collaborators WHERE document_id = ? AND user_id = ? AND role != 'owner'`)
    .run(documentId, userId);
  return { ok: true, revoked: r.changes };
}

export function listCollaborators(db, documentId) {
  if (!db) return [];
  return db.prepare(`
    SELECT user_id, role, invited_at, accepted_at
    FROM document_collaborators WHERE document_id = ?
    ORDER BY invited_at ASC
  `).all(documentId);
}

// ---------- Backlinks ----------

function _refreshBacklinks(db, sourceDocId, contentHtml) {
  try {
    db.prepare(`DELETE FROM document_backlinks WHERE source_doc_id = ?`).run(sourceDocId);
    const refs = extractBackrefs(contentHtml);
    if (!refs.length) return;
    const ins = db.prepare(`
      INSERT INTO document_backlinks
        (source_doc_id, target_doc_id, target_dtu_id, target_kind, target_label, target_uri, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((rows) => {
      for (const ref of rows) {
        ins.run(
          sourceDocId,
          ref.docId || null,
          ref.dtuId || null,
          ref.kind,
          ref.label || null,
          ref.uri || null,
          ref.position || 0,
          _now(),
        );
      }
    });
    tx(refs);
  } catch {
    // best-effort; backlinks are derived
  }
}

export function listOutgoingLinks(db, sourceDocId) {
  if (!db) return [];
  return db.prepare(`SELECT * FROM document_backlinks WHERE source_doc_id = ? ORDER BY position ASC`).all(sourceDocId);
}

export function listIncomingLinks(db, targetDocId) {
  if (!db) return [];
  return db.prepare(`
    SELECT bl.*, d.title AS source_title, d.icon AS source_icon
    FROM document_backlinks bl
    INNER JOIN documents d ON d.id = bl.source_doc_id AND d.deleted_at IS NULL
    WHERE bl.target_doc_id = ?
    ORDER BY bl.created_at DESC
    LIMIT 200
  `).all(targetDocId);
}

// ---------- Attachments ----------

export function recordAttachment(db, {
  documentId, uploaderId, kind = "image", url, alt = null,
  byteSize = null, mimeType = null, width = null, height = null,
}) {
  if (!db || !documentId || !uploaderId || !url) return { ok: false, reason: "missing_args" };
  if (!hasRole(db, documentId, uploaderId, "editor")) return { ok: false, reason: "forbidden" };
  const id = `att:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO document_attachments
        (id, document_id, uploader_id, kind, url, alt, byte_size, mime_type, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, documentId, uploaderId, kind, url, alt, byteSize, mimeType, width, height, _now());
    return { ok: true, id, url };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listAttachments(db, documentId) {
  if (!db) return [];
  return db.prepare(`SELECT * FROM document_attachments WHERE document_id = ? ORDER BY created_at DESC`).all(documentId);
}

// ---------- Search ----------

export function searchUserDocs(db, { ownerId, query, limit = 25 }) {
  if (!db || !ownerId || !query) return [];
  const q = `%${String(query).toLowerCase()}%`;
  return db.prepare(`
    SELECT id, title, kind, icon, word_count, updated_at,
           substr(content_md, 1, 240) AS preview
    FROM documents
    WHERE owner_id = ? AND deleted_at IS NULL
      AND (LOWER(title) LIKE ? OR LOWER(content_md) LIKE ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(ownerId, q, q, limit);
}
