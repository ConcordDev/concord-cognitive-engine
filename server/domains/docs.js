// server/domains/docs.js
//
// Docs lens Sprint A — real document substrate (migration 211).
//
// Replaces the legacy registerLensAction-style readability-only
// scaffold (never imported into server.js, 5/5 smoking-gun streak).
// Now exposes ~30 macros covering CRUD, page tree, version history,
// comments, collaborators, sharing, backlinks, attachments, search,
// markdown import/export, presence, outline, plus the legacy
// readability analyser preserved as `docs.readability`.

import { randomUUID } from "node:crypto";
import {
  createDocument, getDocument, getDocumentBySlug, updateDocument,
  softDelete, restore, listForOwner, listForCollaborator, listChildren,
  snapshotVersion, listVersions, getVersion, restoreVersion,
  addComment, listComments, resolveComment,
  hasRole, inviteCollaborator, revokeCollaborator, listCollaborators,
  listOutgoingLinks, listIncomingLinks, listAttachments, searchUserDocs,
} from "../lib/docs/persistence.js";
import { htmlToMarkdown, markdownToHtml, extractOutline } from "../lib/docs/markdown.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`doc:${payload.documentId}`).emit(event, payload); }
  catch { /* best effort */ }
}

export default function registerDocsMacros(register) {

  // ---------- CRUD ----------

  register("docs", "create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = createDocument(db, {
      ownerId: userId,
      title: input.title,
      parentId: input.parentId || null,
      worldId: input.worldId || null,
      kind: input.kind || "doc",
      visibility: input.visibility || "private",
      icon: input.icon || null,
      contentHtml: input.contentHtml || "",
    });
    if (r.ok) _emit("doc:created", { documentId: r.id, ownerId: userId });
    return r;
  }, { destructive: true, note: "Create a new document (auto-owner)" });

  register("docs", "get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const doc = getDocument(db, id);
    if (!doc) return { ok: false, reason: "not_found" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, document: doc };
  }, { note: "Get a single document by id" });

  register("docs", "get_by_slug", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const slug = String(input.slug || "");
    if (!slug) return { ok: false, reason: "slug_required" };
    const doc = getDocumentBySlug(db, slug);
    if (!doc) return { ok: false, reason: "not_found" };
    if (doc.visibility !== "public") {
      const userId = _actor(ctx);
      if (!hasRole(db, doc.id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    }
    return { ok: true, document: doc };
  }, { note: "Get a published document by slug (public)" });

  register("docs", "update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "editor")) return { ok: false, reason: "forbidden" };
    const r = updateDocument(db, id, input);
    if (r.ok) {
      _emit("doc:updated", {
        documentId: id, by: userId, ts: Date.now(),
        title: r.row?.title, wordCount: r.row?.word_count,
      });
      if (input.contentHtml !== undefined && input.snapshot !== false) {
        snapshotVersion(db, { documentId: id, authorId: userId, reason: "auto" });
      }
    }
    return r;
  }, { destructive: true, note: "Update title/content/icon/visibility/parent (editor+)" });

  register("docs", "delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = softDelete(db, id, userId);
    if (r.ok) _emit("doc:deleted", { documentId: id });
    return r;
  }, { destructive: true, note: "Soft-delete a document (owner/admin)" });

  register("docs", "restore", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return restore(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Restore a soft-deleted document (owner)" });

  register("docs", "list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const docs = listForOwner(db, userId, {
      kind: input.kind,
      parentId: input.parentId === null ? "ROOT" : input.parentId,
      limit: Math.min(Number(input.limit) || 200, 500),
    });
    return { ok: true, documents: docs, count: docs.length };
  }, { note: "List my documents (owner) with optional kind/parent filters" });

  register("docs", "list_collaborated", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const docs = listForCollaborator(db, userId, { limit: Math.min(Number(input.limit) || 100, 200) });
    return { ok: true, documents: docs, count: docs.length };
  }, { note: "List documents I'm a collaborator on (any role)" });

  register("docs", "list_children", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const parentId = String(input.parentId || "");
    if (!parentId) return { ok: false, reason: "parentId_required" };
    if (!hasRole(db, parentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, children: listChildren(db, parentId, { limit: Math.min(Number(input.limit) || 200, 500) }) };
  }, { note: "List child pages under a parent (page tree)" });

  register("docs", "move", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "editor")) return { ok: false, reason: "forbidden" };
    let cursor = input.parentId;
    while (cursor) {
      if (cursor === id) return { ok: false, reason: "cycle_detected" };
      const p = db.prepare(`SELECT parent_id FROM documents WHERE id = ?`).get(cursor);
      cursor = p?.parent_id;
    }
    return updateDocument(db, id, { parentId: input.parentId || null });
  }, { destructive: true, note: "Reparent a document (with cycle check)" });

  // ---------- Versions ----------

  register("docs", "snapshot", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "editor")) return { ok: false, reason: "forbidden" };
    return snapshotVersion(db, {
      documentId: id, authorId: userId,
      label: input.label || null, reason: "manual",
    });
  }, { destructive: true, note: "Create a manual version snapshot (editor+)" });

  register("docs", "versions", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, versions: listVersions(db, id, { limit: Math.min(Number(input.limit) || 50, 200) }) };
  }, { note: "List version snapshots for a doc" });

  register("docs", "get_version", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const versionId = Number(input.versionId);
    if (!versionId) return { ok: false, reason: "versionId_required" };
    const v = getVersion(db, versionId);
    if (!v) return { ok: false, reason: "not_found" };
    if (!hasRole(db, v.document_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, version: v };
  }, { note: "Get a specific version snapshot" });

  register("docs", "restore_version", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = restoreVersion(db, {
      documentId: String(input.id || ""),
      versionId: Number(input.versionId),
      actorId: userId,
    });
    if (r.ok) _emit("doc:version-restored", { documentId: input.id, by: userId, versionId: input.versionId });
    return r;
  }, { destructive: true, note: "Restore a previous version (creates a pre-restore snapshot first)" });

  // ---------- Comments ----------

  register("docs", "comment_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = addComment(db, {
      documentId: String(input.documentId || ""),
      authorId: userId,
      body: input.body,
      threadId: input.threadId || null,
      selectionAnchor: input.selectionAnchor ?? null,
      selectionFocus: input.selectionFocus ?? null,
      selectionText: input.selectionText || null,
    });
    if (r.ok) _emit("doc:comment-added", {
      documentId: input.documentId, commentId: r.id, threadId: r.threadId,
      authorId: userId, body: input.body, ts: Date.now(),
    });
    return r;
  }, { destructive: true, note: "Add a comment (or thread reply via threadId)" });

  register("docs", "comments_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, comments: listComments(db, id, { onlyUnresolved: !!input.onlyUnresolved }) };
  }, { note: "List comments for a doc (optionally unresolved-only)" });

  register("docs", "comment_resolve", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = resolveComment(db, { commentId: String(input.commentId || ""), actorId: userId });
    if (r.ok) _emit("doc:comment-resolved", { commentId: input.commentId, by: userId });
    return r;
  }, { destructive: true, note: "Resolve a comment (editor+)" });

  // ---------- Collaborators / permissions ----------

  register("docs", "invite", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = inviteCollaborator(db, {
      documentId: String(input.documentId || ""),
      userId: String(input.userId || ""),
      role: input.role || "editor",
      invitedBy: userId,
    });
    if (r.ok) _emit("doc:collaborator-added", { documentId: input.documentId, userId: input.userId, role: input.role });
    return r;
  }, { destructive: true, note: "Invite a user (admin+)" });

  register("docs", "revoke", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = revokeCollaborator(db, {
      documentId: String(input.documentId || ""),
      userId: String(input.userId || ""),
      actorId: userId,
    });
    if (r.ok) _emit("doc:collaborator-revoked", { documentId: input.documentId, userId: input.userId });
    return r;
  }, { destructive: true, note: "Revoke a collaborator (admin+, cannot revoke owner)" });

  register("docs", "collaborators", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, collaborators: listCollaborators(db, id) };
  }, { note: "List collaborators for a doc" });

  register("docs", "publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "admin")) return { ok: false, reason: "forbidden" };
    const slug = input.slug ? String(input.slug) : `pub-${randomUUID().slice(0, 12)}`;
    const r = updateDocument(db, id, { visibility: "public", slug });
    if (r.ok) _emit("doc:published", { documentId: id, slug: r.row?.slug });
    return r;
  }, { destructive: true, note: "Make a doc public via slug (admin+)" });

  register("docs", "unpublish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "admin")) return { ok: false, reason: "forbidden" };
    const r = updateDocument(db, id, { visibility: "private", slug: null });
    if (r.ok) _emit("doc:unpublished", { documentId: id });
    return r;
  }, { destructive: true, note: "Unpublish a doc (admin+)" });

  // ---------- Backlinks ----------

  register("docs", "backlinks_in", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, incoming: listIncomingLinks(db, id) };
  }, { note: "List incoming backlinks (which docs reference this one)" });

  register("docs", "backlinks_out", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, outgoing: listOutgoingLinks(db, id) };
  }, { note: "List outgoing links (which docs/DTUs this one references)" });

  // ---------- Attachments ----------

  register("docs", "attachments_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, attachments: listAttachments(db, id) };
  }, { note: "List attachments for a doc" });

  // ---------- Search ----------

  register("docs", "search", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const q = String(input.query || "").trim();
    if (q.length < 2) return { ok: true, results: [] };
    return { ok: true, results: searchUserDocs(db, { ownerId: userId, query: q, limit: Math.min(Number(input.limit) || 25, 100) }) };
  }, { note: "Search my docs by title or markdown body (substring)" });

  // ---------- Markdown import / export ----------

  register("docs", "export_md", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const doc = getDocument(db, id);
    if (!doc) return { ok: false, reason: "not_found" };
    const md = `# ${doc.title}\n\n${doc.content_md || htmlToMarkdown(doc.content_html)}`;
    return { ok: true, markdown: md, filename: `${(doc.title || "untitled").replace(/[^a-z0-9-]+/gi, "-")}.md` };
  }, { note: "Export a document as Markdown" });

  register("docs", "export_html", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const doc = getDocument(db, id);
    if (!doc) return { ok: false, reason: "not_found" };
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6;}h1,h2,h3{margin-top:1.5em}pre{background:#f5f5f5;padding:1em;border-radius:6px;overflow-x:auto}code{font-family:ui-monospace,monospace}blockquote{border-left:4px solid #ddd;margin:0;padding-left:1em;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:0.4em 0.8em}</style>
</head><body><h1>${doc.title}</h1>${doc.content_html}</body></html>`;
    return { ok: true, html, filename: `${(doc.title || "untitled").replace(/[^a-z0-9-]+/gi, "-")}.html` };
  }, { note: "Export a document as standalone HTML" });

  register("docs", "import_md", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const md = String(input.markdown || "");
    if (!md.trim()) return { ok: false, reason: "markdown_required" };
    let title = input.title || "Imported";
    let body = md;
    const h1 = md.match(/^#\s+(.+)$/m);
    if (h1) {
      title = h1[1].trim();
      body = md.replace(h1[0], "").trim();
    }
    const html = markdownToHtml(body);
    const r = createDocument(db, {
      ownerId: userId, title, kind: "doc", visibility: "private", contentHtml: html,
    });
    if (r.ok) {
      snapshotVersion(db, { documentId: r.id, authorId: userId, reason: "import", label: "Imported from Markdown" });
      _emit("doc:imported", { documentId: r.id, kind: "md" });
    }
    return r;
  }, { destructive: true, note: "Import a Markdown file as a new document" });

  // ---------- Presence (transient in STATE) ----------

  register("docs", "presence_update", async (ctx, input = {}) => {
    const userId = _actor(ctx);
    if (!userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    if (!id) return { ok: false, reason: "documentId_required" };
    const state = ctx?.STATE || globalThis._concordSTATE || {};
    if (!state.docPresence) state.docPresence = new Map();
    if (!state.docPresence.has(id)) state.docPresence.set(id, new Map());
    const docMap = state.docPresence.get(id);
    docMap.set(userId, {
      userId,
      cursorPos: Number(input.cursorPos || 0),
      selectionAnchor: input.selectionAnchor ?? null,
      selectionFocus: input.selectionFocus ?? null,
      color: input.color || null,
      label: input.label || null,
      lastSeen: Date.now(),
    });
    _emit("doc:presence", { documentId: id, userId, ...docMap.get(userId) });
    return { ok: true };
  }, { note: "Update my cursor + selection presence (broadcast to others)" });

  register("docs", "presence_list", async (ctx, input = {}) => {
    const userId = _actor(ctx);
    if (!userId) return { ok: false, reason: "auth_required" };
    const id = String(input.documentId || "");
    const state = ctx?.STATE || globalThis._concordSTATE || {};
    const docMap = state?.docPresence?.get(id);
    if (!docMap) return { ok: true, presence: [] };
    const cutoff = Date.now() - 60_000;
    const present = [];
    for (const [uid, info] of docMap) {
      if (info.lastSeen < cutoff) docMap.delete(uid);
      else present.push(info);
    }
    return { ok: true, presence: present };
  }, { note: "List currently-present users on a doc (60s window)" });

  // ---------- Outline ----------

  register("docs", "outline", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    if (!hasRole(db, id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const doc = getDocument(db, id);
    if (!doc) return { ok: false, reason: "not_found" };
    return { ok: true, outline: extractOutline(doc.content_html) };
  }, { note: "Extract h1/h2/h3 outline from a doc" });

  // ---------- Legacy readability score (preserved from old domain) ----------

  register("docs", "readability", async (_ctx, input = {}) => {
    const text = String(input.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return { ok: true, result: { message: "No text provided." } };

    function countSyllables(w) {
      w = w.toLowerCase().replace(/[^a-z]/g, "");
      if (w.length <= 2) return 1;
      w = w.replace(/e$/, "");
      const g = w.match(/[aeiouy]+/g);
      return Math.max(1, g ? g.length : 1);
    }
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
    const sentenceCount = Math.max(1, sentences.length);
    const wordCount = Math.max(1, words.length);
    const syllableCounts = words.map(countSyllables);
    const totalSyllables = syllableCounts.reduce((s, c) => s + c, 0);
    const complexWords = syllableCounts.filter((c) => c >= 3).length;
    const avgWordsPerSentence = wordCount / sentenceCount;
    const avgSyllablesPerWord = totalSyllables / wordCount;
    const fleschReadingEase = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
    const fleschKincaidGrade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
    const gunningFog = 0.4 * (avgWordsPerSentence + 100 * (complexWords / wordCount));
    const colemanLiau = 0.0588 * ((text.replace(/[^a-z]/gi, "").length / wordCount) * 100)
      - 0.296 * ((sentenceCount / wordCount) * 100) - 15.8;
    const smog = 1.0430 * Math.sqrt(complexWords * (30 / sentenceCount)) + 3.1291;
    return {
      ok: true,
      result: {
        wordCount, sentenceCount,
        avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
        avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
        complexWords,
        fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
        fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
        gunningFog: Math.round(gunningFog * 10) / 10,
        colemanLiau: Math.round(colemanLiau * 10) / 10,
        smog: Math.round(smog * 10) / 10,
      },
    };
  }, { note: "Readability scoring (Flesch-Kincaid, Gunning Fog, Coleman-Liau, SMOG)" });
}
