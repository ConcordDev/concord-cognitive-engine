// server/domains/whiteboard-cite-dtu.js
//
// Whiteboard Sprint C Item #19 — cross-lens DTU embed on canvas.
//
// Cite any concord DTU (chord progression, code spec, research paper,
// etc.) as a real interactive element on the whiteboard. The cascade
// pays the original author when the citing board is itself cited or
// purchased.
//
// Implementation: add a `dtu_embed` element to the scene + register a
// citation when the board has a published DTU id (else stash for the
// next export_as_dtu to register).

import { randomUUID } from "node:crypto";
import { getBoard, appendDelta, hasRole } from "../lib/whiteboard/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

async function _registerCascadeCitation(db, childId, parentId, childCreatorId) {
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
  } catch { return false; }
}

export default function registerWhiteboardCiteDtuMacros(register) {
  register("whiteboard", "embed_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const dtuId = String(input.dtuId || "");
    if (!boardId || !dtuId) return { ok: false, reason: "boardId_and_dtuId_required" };
    if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const cited = db.prepare(`SELECT id, kind, title, creator_id FROM dtus WHERE id = ?`).get(dtuId);
    if (!cited) return { ok: false, reason: "dtu_not_found" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    const x = Number(input.x) || Math.round(Math.random() * 400 + 100);
    const y = Number(input.y) || Math.round(Math.random() * 300 + 100);
    const w = Number(input.w) || 240;
    const h = Number(input.h) || 120;
    const el = {
      id: `dtu_embed_${randomUUID().slice(0, 8)}`,
      kind: "dtu_embed", type: "dtu_embed",
      x, y, width: w, height: h,
      text: `${cited.kind} · ${cited.title || cited.id.slice(0, 16)}`,
      dtuId, dtuKind: cited.kind, dtuTitle: cited.title,
      stroke: "#a855f7", fill: "rgba(168,85,247,0.08)", strokeWidth: 2,
      authoredBy: "cite",
    };
    const scene = row.scene || { elements: [] };
    const newScene = { ...scene, elements: [...(scene.elements || []), el] };
    appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    // Track pending citation in the board's meta_json so export_as_dtu
    // can fire it when the board is published.
    const meta = row.meta || {};
    const pending = Array.isArray(meta.pendingCitations) ? meta.pendingCitations : [];
    pending.push({ citedDtuId: dtuId, citedKind: cited.kind, ts: Date.now() });
    try {
      db.prepare(`UPDATE whiteboard_boards SET meta_json = ?, updated_at = unixepoch() WHERE id = ?`)
        .run(JSON.stringify({ ...meta, pendingCitations: pending }), boardId);
    } catch { /* non-fatal */ }
    // If the board is already published, register the citation now.
    let cascadeRegistered = false;
    if (meta.publishedDtuId) {
      cascadeRegistered = await _registerCascadeCitation(db, meta.publishedDtuId, dtuId, userId);
    }
    try {
      globalThis._concordREALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:dtu-embedded", {
        boardId, userId, element: el, ts: Date.now(),
      });
    } catch { /* best effort */ }
    return { ok: true, element: el, cascadeRegistered, pending: !cascadeRegistered };
  }, { destructive: true, note: "Embed a DTU on the canvas as an interactive element; registers a citation when the board is/becomes a published DTU" });

  register("whiteboard", "list_embedded_dtus", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!hasRole(db, boardId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    const embedded = (row.scene?.elements || []).filter((e) => e.kind === "dtu_embed");
    return { ok: true, count: embedded.length, embedded };
  }, { note: "List DTU embeds on a board" });
}
