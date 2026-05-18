// server/domains/whiteboard-history.js
//
// Whiteboard Sprint B Item #11 — version history / time travel.
//
// Backed by whiteboard_scene_deltas (migration 208). Real append-only
// log; restore writes a `restore` delta + updates the board's scene
// snapshot in a single transaction. Versions are derived from the
// delta log — each scene_replace / snapshot / restore is a navigable
// version.

import { listDeltas, getBoard, hasRole, appendDelta } from "../lib/whiteboard/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerWhiteboardHistoryMacros(register) {
  register("whiteboard", "history_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!hasRole(db, boardId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const limit = Math.min(2000, Math.max(1, Number(input.limit) || 200));
    const deltas = listDeltas(db, { boardId, limit });
    // Surface only navigable versions (scene_replace / snapshot / restore).
    // Each becomes one history entry; element-level deltas accumulate
    // under their preceding navigable version.
    const versions = [];
    let nestedCount = 0;
    for (const d of deltas) {
      if (d.delta_kind === "scene_replace" || d.delta_kind === "snapshot" || d.delta_kind === "restore") {
        versions.push({
          id: d.id, server_ts: d.server_ts, client_ts: d.client_ts,
          user_id: d.user_id, kind: d.delta_kind,
          following_deltas: 0,
        });
        nestedCount = 0;
      } else {
        nestedCount++;
        if (versions.length > 0) versions[versions.length - 1].following_deltas = nestedCount;
      }
    }
    return { ok: true, versions: versions.reverse(), total: versions.length, totalDeltas: deltas.length };
  }, { note: "List navigable versions of a board (scene_replace / snapshot / restore deltas)" });

  register("whiteboard", "history_restore", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const deltaId = Number(input.deltaId);
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!Number.isInteger(deltaId)) return { ok: false, reason: "deltaId_required" };
    if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
    // Locate the target delta and verify it's a navigable kind.
    const row = db.prepare(`SELECT id, board_id, delta_kind, delta_json, server_ts FROM whiteboard_scene_deltas WHERE id = ? AND board_id = ?`).get(deltaId, boardId);
    if (!row) return { ok: false, reason: "delta_not_found" };
    if (!["scene_replace", "snapshot", "restore"].includes(row.delta_kind)) {
      return { ok: false, reason: "delta_not_navigable", deltaKind: row.delta_kind };
    }
    // Replay scene as it was at this delta. For scene_replace/snapshot/restore
    // we wrote the new scene into whiteboard_boards.scene_json at the time;
    // we can't recover that from delta_json alone. Instead replay element
    // deltas that came AFTER an older anchor — for now, we reconstruct by
    // walking the deltas up to (and including) this one and starting from
    // an empty scene.
    const deltas = db.prepare(`
      SELECT id, delta_kind, delta_json FROM whiteboard_scene_deltas
      WHERE board_id = ? AND id <= ?
      ORDER BY id ASC
    `).all(boardId, deltaId);
    let scene = { elements: [], appState: {} };
    for (const d of deltas) {
      let body; try { body = JSON.parse(d.delta_json); } catch { continue; }
      if (d.delta_kind === "scene_replace" || d.delta_kind === "snapshot" || d.delta_kind === "restore") {
        if (body.scene && typeof body.scene === "object") scene = body.scene;
        else if (Array.isArray(body.elements)) scene = { elements: body.elements, appState: scene.appState };
      } else if (d.delta_kind === "element_add" && body) {
        scene.elements.push(body);
      } else if (d.delta_kind === "element_update" && body?.id) {
        const i = scene.elements.findIndex((e) => e.id === body.id);
        if (i >= 0) scene.elements[i] = { ...scene.elements[i], ...body };
      } else if (d.delta_kind === "element_delete" && body?.id) {
        scene.elements = scene.elements.filter((e) => e.id !== body.id);
      }
    }
    const applied = appendDelta(db, {
      boardId, userId,
      deltaKind: "restore",
      delta: { restoredFromDeltaId: deltaId, scene },
      newScene: scene,
    });
    if (!applied.ok) return applied;
    return { ok: true, boardId, restoredFromDeltaId: deltaId, sceneElementCount: scene.elements.length };
  }, { destructive: true, note: "Restore a board to a specific historical version (editor+)" });
}
