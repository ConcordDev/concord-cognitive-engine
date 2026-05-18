// server/domains/whiteboard-templates.js
//
// Whiteboard Sprint C Item #14 — template marketplace.
//
// Authors mint kind='whiteboard_template' DTUs from finished boards;
// other users browse + cite + reuse. Royalty cascade pays the author
// every time someone cites the template (kind-agnostic; visibility=
// public + consent.allowCitations=true unlock the cascade gate).

import { randomUUID } from "node:crypto";
import { getBoard, upsertBoard, hasRole } from "../lib/whiteboard/persistence.js";
import { renderSceneToSvg } from "./whiteboard-mint.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

async function _registerCascadeCitation(db, childId, parentId, childCreatorId) {
  if (!db || !childId || !parentId || !childCreatorId) return false;
  try {
    const { registerCitation } = await import("../economy/royalty-cascade.js");
    const parent = db.prepare("SELECT creator_id FROM dtus WHERE id = ?").get(parentId);
    if (!parent?.creator_id) return false;
    const r = registerCitation(db, {
      childId, parentId,
      creatorId: childCreatorId, parentCreatorId: parent.creator_id,
      parentDtu: { visibility: "public" },
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

export default function registerWhiteboardTemplateMacros(register) {
  register("whiteboard", "mint_template", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const title = String(input.title || "").trim();
    if (!boardId || !title) return { ok: false, reason: "boardId_and_title_required" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    if (row.owner_id !== userId) return { ok: false, reason: "forbidden", hint: "Only the owner can mint a template from this board" };
    const priceCents = Math.max(0, Math.min(100_000, Number(input.priceCents) || 0));
    const license = String(input.license || "CC-BY-SA");
    const description = String(input.description || "").slice(0, 1000);
    const tags = Array.isArray(input.tags) ? input.tags.slice(0, 8).map((t) => String(t).slice(0, 40)) : [];
    const id = `whiteboard_template:${randomUUID()}`;
    const meta = {
      type: "whiteboard_template",
      title, description, tags,
      sourceBoardId: row.id,
      scene: row.scene,
      svg_preview: renderSceneToSvg(row.scene),
      elementCount: Array.isArray(row.scene?.elements) ? row.scene.elements.length : 0,
      visibility: "public",
      consent: { allowCitations: true },
      license, price_cents: priceCents,
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'whiteboard_template', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, title.slice(0, 200), userId, JSON.stringify(meta));
      return { ok: true, templateDtuId: id, title, priceCents, license, tags };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a board as a public whiteboard_template DTU for the marketplace" });

  register("whiteboard", "list_marketplace", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
    const q = input.q ? String(input.q).slice(0, 100) : null;
    const sql = q
      ? `SELECT id, title, creator_id, created_at, meta_json FROM dtus WHERE kind = 'whiteboard_template' AND (title LIKE ?) ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, title, creator_id, created_at, meta_json FROM dtus WHERE kind = 'whiteboard_template' ORDER BY created_at DESC LIMIT ?`;
    const rows = (q
      ? db.prepare(sql).all(`%${q}%`, limit)
      : db.prepare(sql).all(limit)
    ).map((r) => {
      let meta = {}; try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* ok */ }
      return {
        id: r.id, title: r.title, creator_id: r.creator_id, created_at: r.created_at,
        description: meta.description, tags: meta.tags || [],
        price_cents: meta.price_cents || 0, license: meta.license || "proprietary",
        elementCount: meta.elementCount || 0,
        svg_preview: meta.svg_preview ? meta.svg_preview.slice(0, 50_000) : null,
      };
    });
    return { ok: true, templates: rows, count: rows.length };
  }, { note: "Browse whiteboard templates from the marketplace" });

  register("whiteboard", "use_template", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const templateDtuId = String(input.templateDtuId || "");
    const newTitle = String(input.newTitle || "Untitled board").slice(0, 200);
    if (!templateDtuId) return { ok: false, reason: "templateDtuId_required" };
    const row = db.prepare(`SELECT id, creator_id, meta_json FROM dtus WHERE id = ? AND kind = 'whiteboard_template'`).get(templateDtuId);
    if (!row) return { ok: false, reason: "template_not_found" };
    let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    if (!meta.scene) return { ok: false, reason: "template_missing_scene" };
    const newBoard = upsertBoard(db, {
      ownerId: userId,
      title: newTitle,
      kind: "private",
      scene: meta.scene,
      meta: { citedTemplateDtuId: templateDtuId },
    });
    if (!newBoard.ok) return newBoard;
    // Register the cascade so the template author earns from this use.
    await _registerCascadeCitation(db, newBoard.id, templateDtuId, userId);
    return { ok: true, newBoardId: newBoard.id, citedTemplateDtuId: templateDtuId };
  }, { destructive: true, note: "Clone a template into a new private board for the caller; cites the template via royalty cascade" });

  register("whiteboard", "cite_template", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const templateDtuId = String(input.templateDtuId || "");
    if (!boardId || !templateDtuId) return { ok: false, reason: "boardId_and_templateDtuId_required" };
    if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
    // The board itself isn't a DTU until export_as_dtu runs. Cite the
    // template against the board's published DTU when one exists; the
    // citation fires regardless to record intent.
    const row = getBoard(db, boardId);
    const publishedDtuId = row?.meta?.publishedDtuId;
    if (!publishedDtuId) return { ok: false, reason: "board_not_published_yet", hint: "Run export_as_dtu first" };
    const ok = await _registerCascadeCitation(db, publishedDtuId, templateDtuId, userId);
    return ok ? { ok: true, citingDtuId: publishedDtuId, citedDtuId: templateDtuId } : { ok: false, reason: "cite_failed" };
  }, { destructive: true, note: "Explicitly cite a template from a published board (editor+)" });
}
