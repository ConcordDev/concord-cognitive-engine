// server/domains/whiteboard-mint.js
//
// Whiteboard Sprint A Item #7 — DTU export of a whole board.
//
// Mints kind='whiteboard_board' DTU with the full scene JSON + a
// rendered SVG snapshot in meta_json. Citable, publishable, royalty-
// bearing via the existing cascade. The author earns when other users
// reference the board in their own work (templates, citations).

import { randomUUID } from "node:crypto";
import { getBoard } from "../lib/whiteboard/persistence.js";

const SVG_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _escapeXml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

/**
 * Render the scene as a minimal SVG string. Real geometry, not a
 * thumbnail placeholder. Handles rectangle, ellipse, line, arrow,
 * text, notecard, frame, freehand (polyline).
 */
export function renderSceneToSvg(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  if (elements.length === 0) {
    return `${SVG_HEADER}<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#0a0a0a"/><text x="400" y="300" fill="#666" text-anchor="middle">Empty board</text></svg>`;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    const w = Number(el.width || el.w) || 50;
    const h = Number(el.height || el.h) || 50;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  const pad = 40;
  const vbX = Math.floor(minX - pad);
  const vbY = Math.floor(minY - pad);
  const vbW = Math.ceil(maxX - minX + pad * 2);
  const vbH = Math.ceil(maxY - minY + pad * 2);
  const parts = [
    `${SVG_HEADER}<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${Math.min(1600, vbW)}" height="${Math.min(1200, vbH)}">`,
    `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#0a0a0a"/>`,
  ];
  for (const el of elements) {
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    const w = Number(el.width || el.w) || 50;
    const h = Number(el.height || el.h) || 50;
    const stroke = _escapeXml(el.stroke || "#9ca3af");
    const fill = _escapeXml(el.fill || "transparent");
    const text = _escapeXml(el.text || el.label || "");
    const kind = String(el.kind || el.type || "rectangle");
    if (kind === "rectangle" || kind === "notecard" || kind === "frame" || kind === "sticky") {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" stroke="${stroke}" fill="${fill}" stroke-width="2"/>`);
      if (text) parts.push(`<text x="${x + 8}" y="${y + 20}" fill="${stroke}" font-size="13" font-family="sans-serif">${text}</text>`);
    } else if (kind === "ellipse") {
      const cx = x + w / 2, cy = y + h / 2;
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" stroke="${stroke}" fill="${fill}" stroke-width="2"/>`);
      if (text) parts.push(`<text x="${cx}" y="${cy}" fill="${stroke}" font-size="13" font-family="sans-serif" text-anchor="middle">${text}</text>`);
    } else if (kind === "line" || kind === "arrow") {
      const x2 = Number(el.x2) || x + w, y2 = Number(el.y2) || y + h;
      parts.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2"/>`);
      if (kind === "arrow") parts.push(`<polygon points="${x2},${y2} ${x2 - 8},${y2 - 4} ${x2 - 8},${y2 + 4}" fill="${stroke}"/>`);
    } else if (kind === "freehand" && Array.isArray(el.points)) {
      const d = el.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
      parts.push(`<path d="${d}" stroke="${stroke}" fill="none" stroke-width="2"/>`);
    } else if (kind === "text") {
      parts.push(`<text x="${x}" y="${y}" fill="${stroke}" font-size="14" font-family="sans-serif">${text}</text>`);
    }
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

export default function registerWhiteboardMintMacros(register) {
  register("whiteboard", "export_as_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    if (row.owner_id !== userId) return { ok: false, reason: "forbidden", hint: "Only the owner can export the board as a DTU" };
    const scope = String(input.scope || "personal");
    const license = String(input.license || "proprietary");
    const priceCents = Math.max(0, Math.min(100_000, Number(input.priceCents) || 0));
    const visibility = scope === "public" ? "public" : "personal";
    const svg = renderSceneToSvg(row.scene);
    if (svg.length > MAX_EXPORT_BYTES) return { ok: false, reason: "svg_too_large", bytes: svg.length };

    const id = `whiteboard_board:${randomUUID()}`;
    const meta = {
      type: "whiteboard_board",
      title: row.title,
      sourceBoardId: row.id,
      sceneElementCount: Array.isArray(row.scene?.elements) ? row.scene.elements.length : 0,
      scene: row.scene,
      svg_preview: svg,
      visibility, license, price_cents: priceCents,
      consent: { allowCitations: scope === "public" },
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'whiteboard_board', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, String(row.title || "Untitled board").slice(0, 200), userId, JSON.stringify(meta));
    } catch (err) {
      return { ok: false, reason: "dtu_insert_failed", error: err?.message };
    }
    // Stamp the board's meta with the published DTU id (best-effort).
    try {
      const meta_json = JSON.stringify({ ...(row.meta || {}), publishedDtuId: id });
      db.prepare(`UPDATE whiteboard_boards SET meta_json = ?, kind = ? WHERE id = ?`)
        .run(meta_json, visibility === "public" ? "published" : row.kind, boardId);
    } catch { /* non-fatal */ }
    return { ok: true, dtuId: id, sourceBoardId: boardId, bytes: svg.length, visibility, license, priceCents };
  }, { destructive: true, note: "Mint a kind='whiteboard_board' DTU with scene JSON + SVG preview; citable + royalty-bearing" });

  register("whiteboard", "export_as_svg", async (ctx, input = {}) => {
    // Cheap read path — no DTU mint, just render. Used by the embed
    // endpoint + the export button.
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    // Owner OR participant OR public/published board.
    const allowed = row.owner_id === userId
      || row.kind === "published"
      || db.prepare(`SELECT 1 FROM whiteboard_participants WHERE board_id = ? AND user_id = ?`).get(boardId, userId || "");
    if (!allowed) return { ok: false, reason: "forbidden" };
    const svg = renderSceneToSvg(row.scene);
    return { ok: true, svg, bytes: svg.length };
  }, { note: "Render a board's current scene to SVG (read-only)" });
}
