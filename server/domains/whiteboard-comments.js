// server/domains/whiteboard-comments.js
//
// Whiteboard Sprint A Item #5 — comments + threads + reactions.
// Real DB (migration 208 `whiteboard_comments`). Roles enforced via
// persistence.hasRole — commenter+ can add, editor+ can resolve,
// anyone with viewer+ can list.

import { randomUUID } from "node:crypto";
import { hasRole as _dbHasRole } from "../lib/whiteboard/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`whiteboard:${payload.boardId}`).emit(event, payload); }
  catch { /* best effort */ }
}
function _now() { return Math.floor(Date.now() / 1000); }

export default function registerWhiteboardCommentMacros(register) {
  register("whiteboard", "comment_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const body = String(input.body || "").trim();
    if (!boardId || !body) return { ok: false, reason: "boardId_and_body_required" };
    if (body.length > 5000) return { ok: false, reason: "body_too_long" };
    if (!_dbHasRole(db, boardId, userId, "commenter")) return { ok: false, reason: "forbidden" };
    const id = `wb_cmt:${randomUUID()}`;
    const elementId = input.elementId ? String(input.elementId) : null;
    const threadId = input.threadId ? String(input.threadId) : id; // self = root
    try {
      db.prepare(`
        INSERT INTO whiteboard_comments (id, board_id, element_id, thread_id, author_id, body, reactions_json, resolved, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)
      `).run(id, boardId, elementId, threadId, userId, body, _now(), _now());
      _emit("whiteboard:comment-added", { boardId, id, elementId, threadId, authorId: userId, body, ts: Date.now() });
      return { ok: true, id, threadId, elementId };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Add a comment (or thread reply when threadId given)" });

  register("whiteboard", "comment_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!_dbHasRole(db, boardId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const onlyUnresolved = !!input.onlyUnresolved;
    const sql = onlyUnresolved
      ? `SELECT * FROM whiteboard_comments WHERE board_id = ? AND resolved = 0 ORDER BY created_at ASC LIMIT 500`
      : `SELECT * FROM whiteboard_comments WHERE board_id = ? ORDER BY created_at ASC LIMIT 500`;
    const rows = db.prepare(sql).all(boardId).map((r) => ({
      ...r, reactions: (() => { try { return JSON.parse(r.reactions_json || "{}"); } catch { return {}; } })(),
    }));
    return { ok: true, comments: rows, count: rows.length };
  }, { note: "List comments for a board (optionally unresolved-only)" });

  register("whiteboard", "comment_resolve", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT board_id FROM whiteboard_comments WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!_dbHasRole(db, row.board_id, userId, "editor")) return { ok: false, reason: "forbidden" };
    const r = db.prepare(`UPDATE whiteboard_comments SET resolved = 1, resolved_by = ?, updated_at = ? WHERE id = ?`)
      .run(userId, _now(), id);
    if (r.changes === 0) return { ok: false, reason: "update_failed" };
    _emit("whiteboard:comment-resolved", { boardId: row.board_id, id, resolvedBy: userId, ts: Date.now() });
    return { ok: true, id, resolvedBy: userId };
  }, { destructive: true, note: "Resolve a comment (editor+ only)" });

  register("whiteboard", "comment_react", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    const emoji = String(input.emoji || "").trim();
    if (!id || !emoji) return { ok: false, reason: "id_and_emoji_required" };
    if (emoji.length > 12) return { ok: false, reason: "emoji_too_long" };
    const row = db.prepare(`SELECT board_id, reactions_json FROM whiteboard_comments WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (!_dbHasRole(db, row.board_id, userId, "viewer")) return { ok: false, reason: "forbidden" };
    let reactions = {};
    try { reactions = JSON.parse(row.reactions_json || "{}"); } catch { /* keep empty */ }
    const users = new Set(reactions[emoji] || []);
    const action = users.has(userId) ? (users.delete(userId), "removed") : (users.add(userId), "added");
    reactions[emoji] = Array.from(users);
    if (reactions[emoji].length === 0) delete reactions[emoji];
    db.prepare(`UPDATE whiteboard_comments SET reactions_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(reactions), _now(), id);
    _emit("whiteboard:comment-reaction", { boardId: row.board_id, id, emoji, action, userId, ts: Date.now() });
    return { ok: true, id, emoji, action, totalForEmoji: reactions[emoji]?.length || 0 };
  }, { destructive: true, note: "Toggle an emoji reaction on a comment" });
}
