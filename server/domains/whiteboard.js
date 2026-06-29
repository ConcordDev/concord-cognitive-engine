// server/domains/whiteboard.js
//
// Content-engine bridge: publish-as-blueprint registers a CRDT canvas
// board as a building-interior layout DTU. The board's elements (lines,
// shapes, sticky notes positioned with x/y/width/height) are translated
// into a building-prop manifest. procedural-buildings.ts#attachInteriorDecor
// queries evo_assets for the highest-quality blueprint per archetype +
// faction match. Marketplace canon picks winners.

import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";
import { registerAsset } from "../lib/evo-asset/registry.js";

const BLUEPRINT_ARCHETYPES = new Set(["tavern", "archive", "forge", "market", "tower"]);
const SNAPSHOT_FORMATS = new Set(["json-snap", "svg-raster"]);
const BLUEPRINT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync("/workspace/concord-data") ? "/workspace/concord-data" : path.join(process.cwd(), "data"));
const LENS_BLUEPRINT_ROOT = path.join(DATA_DIR, "lens-assets", "whiteboard-blueprints");

function decodeSvgDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    if (!buf.length || buf.length > BLUEPRINT_MAX_BYTES) return null;
    return { buf, ext: "svg", mimeType: "image/svg+xml" };
  } catch {
    return null;
  }
}

function serialiseBoardToBlueprintJson(scene, themeOverrides) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const decor = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width)  || Number(el.w) || 60;
    const h = Number(el.height) || Number(el.h) || 60;
    const kind = String(el.kind || el.type || "shape").toLowerCase();
    decor.push({
      kind,
      x, y, w, h,
      rotation: Number(el.rotation) || 0,
      color: typeof el.fillColor === "string" ? el.fillColor : null,
      label: typeof el.text === "string" ? el.text.slice(0, 80) : null,
    });
  }
  return {
    schemaVersion: 1,
    decor,
    themeOverrides: themeOverrides && typeof themeOverrides === "object" ? themeOverrides : null,
    elementCount: decor.length,
  };
}

export default function registerWhiteboardActions(registerLensAction) {
  registerLensAction("whiteboard", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("whiteboard");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  registerLensAction("whiteboard", "shapeDetect", (ctx, artifact, _params) => {
    const elements = artifact.data?.elements || [];
    if (elements.length === 0) return { ok: true, result: { message: "Add whiteboard elements to analyze shapes." } };
    const classified = elements.map((el, i) => {
      const x = parseFloat(el.x) || 0, y = parseFloat(el.y) || 0;
      const w = parseFloat(el.width) || parseFloat(el.w) || 0;
      const h = parseFloat(el.height) || parseFloat(el.h) || 0;
      const type = el.type || (w === h && w > 0 ? "square" : w > 0 && h > 0 ? "rectangle" : el.radius ? "circle" : el.points ? "polygon" : "unknown");
      const area = type === "circle" ? Math.round(Math.PI * Math.pow(parseFloat(el.radius) || w / 2, 2)) : Math.round(w * h);
      return { id: el.id || `el-${i}`, type, x, y, width: w, height: h, area, boundingBox: { minX: x, minY: y, maxX: x + w, maxY: y + h } };
    });
    const byType = {};
    classified.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });
    const totalArea = classified.reduce((s, c) => s + c.area, 0);
    return { ok: true, result: { totalElements: elements.length, shapeDistribution: byType, elements: classified, totalArea, avgArea: Math.round(totalArea / elements.length), canvasBounds: { minX: Math.min(...classified.map(c => c.boundingBox.minX)), minY: Math.min(...classified.map(c => c.boundingBox.minY)), maxX: Math.max(...classified.map(c => c.boundingBox.maxX)), maxY: Math.max(...classified.map(c => c.boundingBox.maxY)) } } };
  });

  registerLensAction("whiteboard", "layoutOptimize", (ctx, artifact, _params) => {
    const elements = artifact.data?.elements || [];
    const gridSize = parseInt(artifact.data?.gridSize) || 20;
    if (elements.length === 0) return { ok: true, result: { message: "Add elements to optimize layout." } };
    const overlaps = [];
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i], b = elements[j];
        const ax = parseFloat(a.x) || 0, ay = parseFloat(a.y) || 0, aw = parseFloat(a.width || a.w) || 50, ah = parseFloat(a.height || a.h) || 50;
        const bx = parseFloat(b.x) || 0, by = parseFloat(b.y) || 0, bw = parseFloat(b.width || b.w) || 50, bh = parseFloat(b.height || b.h) || 50;
        if (ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by) {
          overlaps.push({ element1: a.id || `el-${i}`, element2: b.id || `el-${j}` });
        }
      }
    }
    const snapped = elements.map((el, i) => {
      const x = parseFloat(el.x) || 0;
      const y = parseFloat(el.y) || 0;
      return { id: el.id || `el-${i}`, originalX: x, originalY: y, snappedX: Math.round(x / gridSize) * gridSize, snappedY: Math.round(y / gridSize) * gridSize, moved: Math.round(x / gridSize) * gridSize !== x || Math.round(y / gridSize) * gridSize !== y };
    });
    const movedCount = snapped.filter(s => s.moved).length;
    return { ok: true, result: { totalElements: elements.length, overlaps: overlaps.length, overlapPairs: overlaps.slice(0, 20), gridSize, elementsSnapped: movedCount, suggestions: snapped.filter(s => s.moved), alignmentScore: Math.round(((elements.length - movedCount) / elements.length) * 100) } };
  });

  registerLensAction("whiteboard", "clusterGroup", (ctx, artifact, _params) => {
    const elements = artifact.data?.elements || [];
    const threshold = parseFloat(artifact.data?.threshold) || 100;
    if (elements.length === 0) return { ok: true, result: { message: "Add elements to detect clusters." } };
    const positions = elements.map((el, i) => ({
      id: el.id || `el-${i}`, x: parseFloat(el.x) || 0, y: parseFloat(el.y) || 0, cluster: -1,
    }));
    // Simple proximity-based clustering
    let clusterId = 0;
    positions.forEach(p => {
      if (p.cluster >= 0) return;
      p.cluster = clusterId;
      const queue = [p];
      while (queue.length > 0) {
        const current = queue.shift();
        positions.forEach(other => {
          if (other.cluster >= 0) return;
          const dist = Math.sqrt(Math.pow(current.x - other.x, 2) + Math.pow(current.y - other.y, 2));
          if (dist <= threshold) { other.cluster = clusterId; queue.push(other); }
        });
      }
      clusterId++;
    });
    const clusters = {};
    positions.forEach(p => {
      if (!clusters[p.cluster]) clusters[p.cluster] = { elements: [], centerX: 0, centerY: 0 };
      clusters[p.cluster].elements.push(p.id);
    });
    Object.values(clusters).forEach(c => {
      const els = positions.filter(p => c.elements.includes(p.id));
      c.centerX = Math.round(els.reduce((s, e) => s + e.x, 0) / els.length);
      c.centerY = Math.round(els.reduce((s, e) => s + e.y, 0) / els.length);
    });
    const clusterList = Object.entries(clusters).map(([id, data]) => ({
      clusterId: parseInt(id), elementCount: data.elements.length, center: { x: data.centerX, y: data.centerY }, elements: data.elements,
    })).sort((a, b) => b.elementCount - a.elementCount);
    return { ok: true, result: { totalElements: elements.length, clusterCount: clusterList.length, threshold, clusters: clusterList, singletons: clusterList.filter(c => c.elementCount === 1).length } };
  });

  registerLensAction("whiteboard", "exportPrep", (ctx, artifact, _params) => {
    const elements = artifact.data?.elements || [];
    const layers = artifact.data?.layers || [{ name: "default", elements: elements.map((_, i) => `el-${i}`) }];
    if (elements.length === 0) return { ok: true, result: { message: "Add elements to prepare for export." } };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const manifest = elements.map((el, i) => {
      const x = parseFloat(el.x) || 0, y = parseFloat(el.y) || 0;
      const w = parseFloat(el.width || el.w) || 50, h = parseFloat(el.height || el.h) || 50;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      return { id: el.id || `el-${i}`, type: el.type || "shape", layer: el.layer || "default", position: { x, y }, size: { w, h } };
    });
    const canvasWidth = maxX - minX;
    const canvasHeight = maxY - minY;
    const byLayer = {};
    manifest.forEach(m => { byLayer[m.layer] = (byLayer[m.layer] || 0) + 1; });
    return { ok: true, result: { totalElements: elements.length, canvas: { x: minX, y: minY, width: Math.round(canvasWidth), height: Math.round(canvasHeight), aspectRatio: canvasHeight > 0 ? `${Math.round(canvasWidth / canvasHeight * 100) / 100}:1` : "N/A" }, layers: Object.entries(byLayer).map(([name, count]) => ({ name, elementCount: count })), exportFormats: ["PNG", "SVG", "PDF", "JSON"], manifest: manifest.slice(0, 50), recommendations: [canvasWidth > 4000 || canvasHeight > 4000 ? "Large canvas — consider splitting for high-res export" : null, elements.length > 200 ? "Many elements — SVG export recommended over raster" : null].filter(Boolean) } };
  });

  // ─── 2026 parity — Miro/FigJam/Excalidraw/Mural ──

  function getWhiteboardState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.whiteboardLens) STATE.whiteboardLens = {};
    if (!STATE.whiteboardLens.boards)        STATE.whiteboardLens.boards        = new Map(); // userId -> Map<id, board>
    if (!STATE.whiteboardLens.votes)         STATE.whiteboardLens.votes         = new Map(); // userId -> Map<boardId, Map<elementId, Set<voterId>>>
    if (!STATE.whiteboardLens.sharedBoards)  STATE.whiteboardLens.sharedBoards  = new Map(); // boardId -> { id, title, scene, ownerId, participants: Set<userId>, createdAt, updatedAt }
    if (!STATE.whiteboardLens.sharedVotes)   STATE.whiteboardLens.sharedVotes   = new Map(); // boardId -> Map<elementId, Set<voterId>>
    if (!STATE.whiteboardLens.timers)        STATE.whiteboardLens.timers        = new Map(); // boardId -> { endsAt, durationSec, label, startedBy, startedAt }
    return STATE.whiteboardLens;
  }
  function saveWhiteboardState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function wbActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextWbId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoWb() { return new Date().toISOString(); }

  // ── Templates (6 starters) ──

  const TEMPLATES = {
    swot: {
      name: "SWOT analysis",
      elements: [
        { kind: "frame", label: "Strengths",     x: 0,   y: 0,   w: 400, h: 300 },
        { kind: "frame", label: "Weaknesses",    x: 400, y: 0,   w: 400, h: 300 },
        { kind: "frame", label: "Opportunities", x: 0,   y: 300, w: 400, h: 300 },
        { kind: "frame", label: "Threats",       x: 400, y: 300, w: 400, h: 300 },
      ],
    },
    retro: {
      name: "Sprint retrospective",
      elements: [
        { kind: "frame", label: "Start",    x: 0,   y: 0, w: 300, h: 500 },
        { kind: "frame", label: "Stop",     x: 300, y: 0, w: 300, h: 500 },
        { kind: "frame", label: "Continue", x: 600, y: 0, w: 300, h: 500 },
      ],
    },
    journey: {
      name: "Customer journey map",
      elements: [
        { kind: "frame", label: "Awareness",     x: 0,   y: 0, w: 240, h: 400 },
        { kind: "frame", label: "Consideration", x: 240, y: 0, w: 240, h: 400 },
        { kind: "frame", label: "Purchase",      x: 480, y: 0, w: 240, h: 400 },
        { kind: "frame", label: "Retention",     x: 720, y: 0, w: 240, h: 400 },
        { kind: "frame", label: "Advocacy",      x: 960, y: 0, w: 240, h: 400 },
      ],
    },
    mindmap: {
      name: "Mind map",
      elements: [
        { kind: "ellipse", label: "Central topic", x: 400, y: 200, w: 200, h: 100 },
      ],
    },
    crazy8s: {
      name: "Crazy 8s (8-cell sketch grid)",
      elements: Array.from({ length: 8 }, (_, i) => ({
        kind: "rectangle",
        label: `Idea ${i + 1}`,
        x: (i % 4) * 250,
        y: Math.floor(i / 4) * 200,
        w: 240,
        h: 190,
      })),
    },
    brainstorm: {
      name: "Brainstorm cluster",
      elements: [
        { kind: "frame", label: "Ideas",     x: 0,   y: 0, w: 400, h: 600 },
        { kind: "frame", label: "Themes",    x: 400, y: 0, w: 400, h: 600 },
        { kind: "frame", label: "Next steps", x: 800, y: 0, w: 400, h: 600 },
      ],
    },
  };

  registerLensAction("whiteboard", "templates-list", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, elementCount: t.elements.length })) } };
  });

  registerLensAction("whiteboard", "template-load", (_ctx, _artifact, params = {}) => {
    const id = String(params.id || "");
    const t = TEMPLATES[id];
    if (!t) return { ok: false, error: `unknown template: ${id}` };
    return { ok: true, result: { template: { id, ...t } } };
  });

  // ── Board snapshots (per-user persistence) ──

  registerLensAction("whiteboard", "board-list", (ctx, _artifact, _params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const map = s.boards.get(userId);
    if (!map) return { ok: true, result: { boards: [] } };
    const boards = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(({ scene, ...meta }) => ({ ...meta, elementCount: Array.isArray(scene?.elements) ? scene.elements.length : 0 }));
    return { ok: true, result: { boards } };
  });

  registerLensAction("whiteboard", "board-save", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = params.id ? String(params.id) : nextWbId("board");
    const title = String(params.title || "Untitled board").slice(0, 80);
    const scene = params.scene && typeof params.scene === "object" ? params.scene : { elements: [], appState: {} };
    if (!s.boards.has(userId)) s.boards.set(userId, new Map());
    const existing = s.boards.get(userId).get(id);
    const board = {
      id, title, scene,
      createdAt: existing?.createdAt || nowIsoWb(),
      updatedAt: nowIsoWb(),
    };
    s.boards.get(userId).set(id, board);
    saveWhiteboardState();
    return { ok: true, result: { board } };
  });

  registerLensAction("whiteboard", "board-load", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const map = s.boards.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { board: map.get(id) } };
  });

  registerLensAction("whiteboard", "board-delete", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const map = s.boards.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveWhiteboardState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("whiteboard", "board-duplicate", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const srcId = String(params.id || "");
    const map = s.boards.get(userId);
    if (!map || !map.has(srcId)) return { ok: false, error: "not found" };
    const src = map.get(srcId);
    const id = nextWbId("board");
    const board = {
      id,
      title: String(params.title || `${src.title} (copy)`).slice(0, 80),
      scene: JSON.parse(JSON.stringify(src.scene || { elements: [], appState: {} })),
      createdAt: nowIsoWb(),
      updatedAt: nowIsoWb(),
    };
    map.set(id, board);
    saveWhiteboardState();
    return { ok: true, result: { board } };
  });

  // ── Meeting timer (Miro-shape, board-scoped) ──

  registerLensAction("whiteboard", "timer-start", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const boardId = String(params.boardId || "");
    if (!boardId) return { ok: false, error: "boardId required" };
    const minutes = Math.max(0.25, Math.min(120, Number(params.minutes) || 5));
    const durationSec = Math.round(minutes * 60);
    const timer = {
      endsAt: new Date(Date.now() + durationSec * 1000).toISOString(),
      durationSec,
      label: String(params.label || "Meeting timer").slice(0, 60),
      startedBy: wbActor(ctx),
      startedAt: nowIsoWb(),
    };
    s.timers.set(boardId, timer);
    saveWhiteboardState();
    return { ok: true, result: { boardId, timer } };
  });

  registerLensAction("whiteboard", "timer-get", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const boardId = String(params.boardId || "");
    const timer = s.timers.get(boardId);
    if (!timer) return { ok: true, result: { active: false } };
    const remainingMs = new Date(timer.endsAt).getTime() - Date.now();
    if (remainingMs <= 0) {
      return { ok: true, result: { active: false, expired: true, label: timer.label } };
    }
    return {
      ok: true,
      result: {
        active: true,
        label: timer.label,
        endsAt: timer.endsAt,
        durationSec: timer.durationSec,
        remainingSec: Math.round(remainingMs / 1000),
      },
    };
  });

  registerLensAction("whiteboard", "timer-stop", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const boardId = String(params.boardId || "");
    s.timers.delete(boardId);
    saveWhiteboardState();
    return { ok: true, result: { active: false } };
  });

  // ── Voting sessions ──

  registerLensAction("whiteboard", "vote-cast", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const elementId = String(params.elementId || "");
    if (!boardId || !elementId) return { ok: false, error: "boardId and elementId required" };
    if (!s.votes.has(userId)) s.votes.set(userId, new Map());
    const boardVotes = s.votes.get(userId);
    if (!boardVotes.has(boardId)) boardVotes.set(boardId, new Map());
    const elementVotes = boardVotes.get(boardId);
    if (!elementVotes.has(elementId)) elementVotes.set(elementId, new Set());
    elementVotes.get(elementId).add(userId);
    saveWhiteboardState();
    return { ok: true, result: { boardId, elementId, voteCount: elementVotes.get(elementId).size } };
  });

  registerLensAction("whiteboard", "vote-tally", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const boardVotes = s.votes.get(userId)?.get(boardId);
    if (!boardVotes) return { ok: true, result: { tally: [], total: 0 } };
    const tally = Array.from(boardVotes.entries())
      .map(([elementId, voters]) => ({ elementId, count: voters.size }))
      .sort((a, b) => b.count - a.count);
    const total = tally.reduce((s2, t) => s2 + t.count, 0);
    return { ok: true, result: { tally, total } };
  });

  // ── Shared boards (real-time multiplayer collab) ──
  //
  // Per-user boards above (board-save/load/list/delete) remain the
  // private workspace. A shared board lives in STATE.whiteboardLens
  // .sharedBoards and is identified by its `id` — any participant
  // can read/write its scene, with last-write-wins semantics and
  // realtime broadcast via socket.io to room `whiteboard:${id}`.
  // Votes on shared boards are aggregated across all participants
  // (not per-user as on private boards).

  function sharedBoardSummary(b) {
    return {
      id: b.id, title: b.title, ownerId: b.ownerId,
      participants: Array.from(b.participants || []),
      participantCount: (b.participants && b.participants.size) || 0,
      elementCount: Array.isArray(b.scene?.elements) ? b.scene.elements.length : 0,
      createdAt: b.createdAt, updatedAt: b.updatedAt,
    };
  }

  registerLensAction("whiteboard", "share-board", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    // Either promote an existing private board, or create a new
    // shared board outright (params.scene + params.title).
    let scene, title, sourcePrivateId;
    if (params.id) {
      sourcePrivateId = String(params.id);
      const ownerMap = s.boards.get(userId);
      const priv = ownerMap?.get(sourcePrivateId);
      if (!priv) return { ok: false, error: "private board not found" };
      scene = priv.scene; title = priv.title;
    } else {
      scene = params.scene && typeof params.scene === "object" ? params.scene : { elements: [], appState: {} };
      title = String(params.title || "Untitled shared board").slice(0, 80);
    }
    const sharedId = String(params.sharedId || `shared_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    const board = {
      id: sharedId, title, scene, ownerId: userId,
      participants: new Set([userId]),
      createdAt: nowIsoWb(), updatedAt: nowIsoWb(),
      sourcePrivateId,
    };
    s.sharedBoards.set(sharedId, board);
    saveWhiteboardState();
    return { ok: true, result: { board: sharedBoardSummary(board) } };
  });

  registerLensAction("whiteboard", "shared-list", (ctx, _artifact, _params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boards = [];
    for (const b of s.sharedBoards.values()) {
      if (b.participants?.has(userId)) boards.push(sharedBoardSummary(b));
    }
    boards.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { boards } };
  });

  registerLensAction("whiteboard", "join-shared", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    if (!b.participants) b.participants = new Set();
    b.participants.add(userId);
    saveWhiteboardState();
    return { ok: true, result: { board: { ...sharedBoardSummary(b), scene: b.scene } } };
  });

  registerLensAction("whiteboard", "leave-shared", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    b.participants?.delete(userId);
    saveWhiteboardState();
    return { ok: true, result: { id, remainingParticipants: b.participants?.size || 0 } };
  });

  // broadcast-scene — persist + realtime fan-out via the io that
  // server.js stashes on globalThis._concordREALTIME (best-effort;
  // no realtime in tests means the macro still updates STATE).
  registerLensAction("whiteboard", "broadcast-scene", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    if (!b.participants?.has(userId)) return { ok: false, error: "not a participant" };
    if (!params.scene || typeof params.scene !== "object") return { ok: false, error: "scene required" };
    b.scene = params.scene;
    b.updatedAt = nowIsoWb();
    saveWhiteboardState();
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${id}`).emit("whiteboard:scene-update", {
        boardId: id, userId, elementCount: Array.isArray(params.scene.elements) ? params.scene.elements.length : 0,
        ts: Date.now(),
      });
    } catch (_e) { /* realtime is best-effort */ }
    return { ok: true, result: { id, updatedAt: b.updatedAt } };
  });

  // broadcast-cursor — ephemeral, not persisted; pure realtime ping
  // so other participants see a live cursor. Position is { x, y } in
  // board coordinates.
  registerLensAction("whiteboard", "broadcast-cursor", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    if (!b.participants?.has(userId)) return { ok: false, error: "not a participant" };
    const x = Number(params.x);
    const y = Number(params.y);
    if (!isFinite(x) || !isFinite(y)) return { ok: false, error: "x, y required" };
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${id}`).emit("whiteboard:cursor", {
        boardId: id, userId, x, y, ts: Date.now(),
      });
    } catch (_e) { /* best effort */ }
    return { ok: true, result: { id, userId, x, y } };
  });

  // ── Shared-board voting (aggregated across all participants) ──

  registerLensAction("whiteboard", "shared-vote-cast", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || params.boardId || "");
    const elementId = String(params.elementId || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    if (!b.participants?.has(userId)) return { ok: false, error: "not a participant" };
    if (!elementId) return { ok: false, error: "elementId required" };
    if (!s.sharedVotes.has(id)) s.sharedVotes.set(id, new Map());
    const boardVotes = s.sharedVotes.get(id);
    if (!boardVotes.has(elementId)) boardVotes.set(elementId, new Set());
    boardVotes.get(elementId).add(userId);
    saveWhiteboardState();
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${id}`).emit("whiteboard:vote-cast", {
        boardId: id, elementId, voterId: userId,
        voteCount: boardVotes.get(elementId).size,
        ts: Date.now(),
      });
    } catch (_e) { /* best effort */ }
    return { ok: true, result: { boardId: id, elementId, voteCount: boardVotes.get(elementId).size } };
  });

  registerLensAction("whiteboard", "shared-vote-tally", (ctx, _artifact, params = {}) => {
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const id = String(params.id || params.boardId || "");
    const b = s.sharedBoards.get(id);
    if (!b) return { ok: false, error: "shared board not found" };
    if (!b.participants?.has(userId)) return { ok: false, error: "not a participant" };
    const boardVotes = s.sharedVotes.get(id);
    if (!boardVotes) return { ok: true, result: { tally: [], total: 0 } };
    const tally = Array.from(boardVotes.entries())
      .map(([elementId, voters]) => ({ elementId, count: voters.size }))
      .sort((a, b) => b.count - a.count);
    const total = tally.reduce((s2, t) => s2 + t.count, 0);
    return { ok: true, result: { tally, total } };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Miro + FigJam 2026 parity — AI cluster, AI summarize+action items,
  //  AI generate board from prompt, comments per element, expanded templates.
  // ═══════════════════════════════════════════════════════════════

  function ensureCommentsBucket(s) {
    if (!s.comments) s.comments = new Map(); // userId -> Map<boardId, Map<elementId, Array<Comment>>>
    return s.comments;
  }

  // Look up a board the caller owns OR is a participant in (so shared boards work too).
  function findBoardForUser(s, userId, boardId) {
    const own = s.boards.get(userId)?.get(boardId);
    if (own) return { board: own, scope: 'own' };
    const shared = s.sharedBoards.get(boardId);
    if (shared && (shared.ownerId === userId || (shared.participants && shared.participants.has(userId)))) {
      return { board: shared, scope: 'shared' };
    }
    return null;
  }

  // Tiny BFS clusterer over text similarity (token overlap). Deterministic without brain.
  function clusterShapesByText(shapes, maxThemes = 6) {
    const stickies = shapes.filter(sh => sh.kind === 'sticky' && (sh.text || '').trim());
    if (stickies.length < 2) return [];
    function tokens(t) { return new Set(String(t || '').toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length >= 3)); }
    const tokSets = new Map(stickies.map(sh => [sh.id, tokens(sh.text)]));
    function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; const union = a.size + b.size - inter; return inter / union; }
    const visited = new Set();
    const clusters = [];
    const THRESHOLD = 0.2;
    for (const sh of stickies) {
      if (visited.has(sh.id)) continue;
      const queue = [sh.id];
      const members = [];
      while (queue.length) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        members.push(cur);
        const curTok = tokSets.get(cur);
        for (const other of stickies) {
          if (visited.has(other.id)) continue;
          if (jaccard(curTok, tokSets.get(other.id)) >= THRESHOLD) queue.push(other.id);
        }
      }
      // Top-3 most common tokens form the theme label.
      const wordCounts = new Map();
      for (const id of members) for (const t of tokSets.get(id)) wordCounts.set(t, (wordCounts.get(t) || 0) + 1);
      const themeWords = Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
      clusters.push({ theme: themeWords.join(' / ') || 'untitled cluster', memberIds: members, size: members.length });
    }
    clusters.sort((a, b) => b.size - a.size);
    return clusters.slice(0, maxThemes);
  }

  registerLensAction("whiteboard", "ai-cluster-stickies", async (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const shapes = Array.isArray(lookup.board.scene?.elements) ? lookup.board.scene.elements : [];
    const stickies = shapes.filter(sh => sh.kind === 'sticky');
    if (stickies.length < 2) return { ok: true, result: { clusters: [], source: 'deterministic', message: "Need at least 2 sticky notes to cluster." } };

    const deterministic = clusterShapesByText(shapes);
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') return { ok: true, result: { clusters: deterministic, source: 'deterministic' } };

    // Brain enhancement: ask for theme labels for the deterministic groupings (don't let the brain invent new shapes).
    try {
      const stickyMap = new Map(stickies.map(sh => [sh.id, sh.text || '']));
      const groupsText = deterministic.map((c, i) => `Group ${i + 1}: ${c.memberIds.map(id => `"${(stickyMap.get(id) || '').slice(0, 80)}"`).join(', ')}`).join('\n');
      const r = await brain({
        messages: [
          { role: 'system', content: "You name brainstorming sticky-note clusters. Output ONLY JSON: {\"themes\":[\"label1\",\"label2\",...]} with one label per group, ≤ 4 words each. Use only the sticky note text provided — do not invent items." },
          { role: 'user', content: groupsText },
        ],
        temperature: 0.3, maxTokens: 400,
      });
      const text = String(r?.content || r?.text || '').trim();
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      if (Array.isArray(parsed.themes)) {
        for (let i = 0; i < deterministic.length && i < parsed.themes.length; i++) {
          deterministic[i].theme = String(parsed.themes[i] || deterministic[i].theme).slice(0, 60);
        }
        return { ok: true, result: { clusters: deterministic, source: 'brain' } };
      }
    } catch (_e) { /* best-effort: ignore */ }
    return { ok: true, result: { clusters: deterministic, source: 'deterministic_after_brain_error' } };
  });

  registerLensAction("whiteboard", "ai-summarize-board", async (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const shapes = Array.isArray(lookup.board.scene?.elements) ? lookup.board.scene.elements : [];
    if (shapes.length === 0) return { ok: true, result: { summary: "(board is empty)", actionItems: [], source: 'deterministic' } };
    const stickies = shapes.filter(sh => sh.kind === 'sticky' && sh.text);
    const frames = shapes.filter(sh => sh.kind === 'rect' || sh.kind === 'frame');
    const transcript = stickies.map(sh => `· ${sh.text}`).join('\n');

    function deterministic() {
      const summary = `Board "${lookup.board.title || 'untitled'}" has ${shapes.length} element(s) (${stickies.length} sticky notes${frames.length ? `, ${frames.length} frame${frames.length === 1 ? '' : 's'}` : ''}).`;
      // Extract any imperative-looking sticky as a candidate action item.
      const items = stickies
        .filter(sh => /\b(do|build|ship|fix|need|should|must|todo|to do|next step|action)\b/i.test(sh.text))
        .slice(0, 10)
        .map(sh => ({ text: sh.text.trim().slice(0, 200), owner: ((sh.text.match(/@(\w+)/) || [])[1]) || null, sourceShapeId: sh.id }));
      return { summary, actionItems: items };
    }

    const brain = ctx?.llm?.chat;
    const base = deterministic();
    if (typeof brain !== 'function') return { ok: true, result: { ...base, source: 'deterministic' } };
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: "Summarize this brainstorming board in 2-3 short sentences and extract action items. Output ONLY JSON: {\"summary\":\"...\",\"actionItems\":[{\"text\":\"...\",\"owner\":\"@name or null\"}]}. Use only the sticky note text provided." },
          { role: 'user', content: transcript.slice(0, 8000) },
        ],
        temperature: 0.2, maxTokens: 1000,
      });
      const text = String(r?.content || r?.text || '').trim();
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      return {
        ok: true,
        result: {
          summary: String(parsed.summary || base.summary).slice(0, 2000),
          actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 10).map(x => ({ text: String(x.text || ''), owner: x.owner || null })) : base.actionItems,
          source: 'brain',
        },
      };
    } catch (_e) {
      return { ok: true, result: { ...base, source: 'deterministic_after_brain_error' } };
    }
  });

  // AI generate a starter board from a prompt — Miro/FigJam 2026 hero.
  registerLensAction("whiteboard", "ai-generate-board", async (ctx, _a, params = {}) => {
    const prompt = String(params.prompt || "").trim();
    if (!prompt) return { ok: false, error: "prompt required" };
    const kind = ['brainstorm','retro','okr','user_journey','flowchart','swot'].includes(params.kind) ? params.kind : 'brainstorm';

    function deterministicScaffold() {
      // Build a real scene of sticky notes / frames based on kind.
      const elements = [];
      let id = 0;
      const next = () => `gen_${Date.now().toString(36)}_${id++}`;
      const stickyAt = (x, y, color, text) => ({ id: next(), kind: 'sticky', x, y, w: 180, h: 120, color, text });
      const frameAt = (x, y, w, h, label) => ({ id: next(), kind: 'rect', x, y, w, h, color: '#0d1117', text: label });
      if (kind === 'retro') {
        elements.push(frameAt(0, 0, 360, 600, 'Went well'));
        elements.push(frameAt(360, 0, 360, 600, 'Could improve'));
        elements.push(frameAt(720, 0, 360, 600, 'Action items'));
        elements.push(stickyAt(20, 60, '#bbf7d0', `Re: ${prompt} — what worked`));
        elements.push(stickyAt(380, 60, '#fef08a', `Re: ${prompt} — what got in the way`));
        elements.push(stickyAt(740, 60, '#fbcfe8', `Re: ${prompt} — next step`));
      } else if (kind === 'okr') {
        elements.push(frameAt(0, 0, 720, 200, 'Objective'));
        elements.push(stickyAt(20, 60, '#bae6fd', prompt));
        elements.push(frameAt(0, 220, 360, 380, 'Key result 1'));
        elements.push(frameAt(360, 220, 360, 380, 'Key result 2'));
      } else if (kind === 'user_journey') {
        const stages = ['Awareness','Consideration','Decision','Onboarding','Use','Retention'];
        stages.forEach((label, i) => {
          elements.push(frameAt(i * 220, 0, 200, 360, label));
          elements.push(stickyAt(i * 220 + 10, 60, '#fed7aa', `${label}: re ${prompt}`));
        });
      } else if (kind === 'flowchart') {
        ['Start','Step 1','Step 2','Decision','End'].forEach((label, i) => {
          elements.push(stickyAt(i * 200, 100, '#bae6fd', `${label} — ${prompt}`));
        });
      } else if (kind === 'swot') {
        elements.push(frameAt(0, 0, 360, 300, 'Strengths'));
        elements.push(frameAt(360, 0, 360, 300, 'Weaknesses'));
        elements.push(frameAt(0, 300, 360, 300, 'Opportunities'));
        elements.push(frameAt(360, 300, 360, 300, 'Threats'));
        elements.push(stickyAt(20, 60, '#bbf7d0', prompt));
      } else {
        // brainstorm fallback — 6 sticky notes in a grid
        const colors = ['#fef08a', '#fbcfe8', '#bae6fd', '#bbf7d0', '#fed7aa', '#d1d5db'];
        for (let i = 0; i < 6; i++) {
          elements.push(stickyAt((i % 3) * 200, Math.floor(i / 3) * 160, colors[i % colors.length], i === 0 ? prompt : `Idea ${i + 1}`));
        }
      }
      return { elements, appState: { kind, generatedFrom: prompt } };
    }

    const base = deterministicScaffold();
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') return { ok: true, result: { scene: base, kind, source: 'deterministic' } };
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: `You are a workshop facilitator. Given a topic, suggest 6-10 brainstorm sticky-note bullet points. Output ONLY JSON: {"stickies":["text1","text2","..."]}. Each text ≤ 120 chars. Use only the topic provided.` },
          { role: 'user', content: `Topic: ${prompt}\nFormat: ${kind}` },
        ],
        temperature: 0.5, maxTokens: 800,
      });
      const text = String(r?.content || r?.text || '').trim();
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      if (Array.isArray(parsed.stickies)) {
        const colors = ['#fef08a', '#fbcfe8', '#bae6fd', '#bbf7d0', '#fed7aa', '#d1d5db'];
        const enhanced = parsed.stickies.slice(0, 12).map((t, i) => ({
          id: `gen_${Date.now().toString(36)}_${i}`,
          kind: 'sticky',
          x: (i % 4) * 200,
          y: Math.floor(i / 4) * 160,
          w: 180, h: 120,
          color: colors[i % colors.length],
          text: String(t).slice(0, 120),
        }));
        // Replace deterministic stickies with brain output; keep any frames from deterministic.
        const frames = base.elements.filter(e => e.kind === 'rect');
        return { ok: true, result: { scene: { elements: [...frames, ...enhanced], appState: { kind, generatedFrom: prompt } }, kind, source: 'brain' } };
      }
    } catch (_e) { /* best-effort: ignore */ }
    return { ok: true, result: { scene: base, kind, source: 'deterministic_after_brain_error' } };
  });

  // ── Comments per element ─────────────────────────────────────

  registerLensAction("whiteboard", "comments-list", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const elementId = params.elementId ? String(params.elementId) : null;
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cBucket = ensureCommentsBucket(s);
    // Comments are stored per-board (not per-viewer) so they're shared.
    if (!cBucket.has(boardId)) cBucket.set(boardId, new Map());
    const elementMap = cBucket.get(boardId);
    if (elementId) {
      return { ok: true, result: { comments: elementMap.get(elementId) || [] } };
    }
    const all = {};
    for (const [eid, list] of elementMap) all[eid] = list;
    return { ok: true, result: { comments: all } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("whiteboard", "comments-add", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const elementId = String(params.elementId || "");
    const body = String(params.body || "").trim();
    if (!boardId || !elementId || !body) return { ok: false, error: "boardId + elementId + body required" };
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cBucket = ensureCommentsBucket(s);
    if (!cBucket.has(boardId)) cBucket.set(boardId, new Map());
    const elementMap = cBucket.get(boardId);
    if (!elementMap.has(elementId)) elementMap.set(elementId, []);
    const comment = {
      id: nextWbId('cmt'),
      boardId, elementId,
      authorId: userId,
      authorName: String(params.authorName || ctx?.actor?.displayName || userId),
      body,
      createdAt: nowIsoWb(),
      resolved: false,
    };
    elementMap.get(elementId).push(comment);
    saveWhiteboardState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("whiteboard", "comments-resolve", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const id = String(params.id || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cBucket = ensureCommentsBucket(s);
    const elementMap = cBucket.get(boardId);
    if (!elementMap) return { ok: false, error: "comment not found" };
    for (const list of elementMap.values()) {
      const c = list.find(x => x.id === id);
      if (c) { c.resolved = true; c.resolvedAt = nowIsoWb(); saveWhiteboardState(); return { ok: true, result: { comment: c } }; }
    }
    return { ok: false, error: "comment not found" };
  });

  registerLensAction("whiteboard", "comments-delete", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const id = String(params.id || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cBucket = ensureCommentsBucket(s);
    const elementMap = cBucket.get(boardId);
    if (!elementMap) return { ok: false, error: "comment not found" };
    for (const list of elementMap.values()) {
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) {
        if (list[i].authorId !== userId) return { ok: false, error: "only author can delete" };
        list.splice(i, 1);
        saveWhiteboardState();
        return { ok: true, result: { deleted: true } };
      }
    }
    return { ok: false, error: "comment not found" };
  });

  // ── Export ────────────────────────────────────────────────────

  registerLensAction("whiteboard", "board-export-json", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cBucket = ensureCommentsBucket(s);
    const elementMap = cBucket.get(boardId) || new Map();
    const commentsObj = {};
    for (const [eid, list] of elementMap) commentsObj[eid] = list;
    return {
      ok: true,
      result: {
        export: {
          format: 'concord-whiteboard/v1',
          board: {
            id: lookup.board.id,
            title: lookup.board.title,
            scene: lookup.board.scene,
            createdAt: lookup.board.createdAt,
            updatedAt: lookup.board.updatedAt,
          },
          comments: commentsObj,
          exportedAt: nowIsoWb(),
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  //  2026 parity backlog — CRDT ops, raster export, frames,
  //  connectors, embeds, presentation mode, reactions / live cursors.
  // ═══════════════════════════════════════════════════════════════

  // ── [M] Live CRDT/OT multiplayer — operation log ──────────────
  //
  // Instead of clobbering with full-scene snapshots, every edit is an
  // append-only operation against a board. Each op carries a Lamport
  // clock (monotonically increasing per board, bumped past any
  // remote clock the client has seen). `ops-since` lets a client pull
  // only what it is missing; `ops-apply` folds an op into the
  // authoritative scene with last-writer-wins-per-element semantics
  // keyed on (elementId, clock) so concurrent edits to *different*
  // elements never conflict and edits to the *same* element resolve
  // deterministically by the higher clock. This is a real OT/CRDT
  // substrate, not a snapshot broadcast.

  function ensureOpsBucket(s) {
    if (!s.opLog) s.opLog = new Map();   // boardId -> { clock, ops: [] }
    return s.opLog;
  }

  // Fold an op array onto a starting element array, LWW per element.
  function foldOps(elements, ops) {
    const byId = new Map(elements.map(e => [e.id, { el: e, clock: 0 }]));
    for (const op of ops) {
      if (op.type === 'add' || op.type === 'update') {
        if (!op.element || !op.element.id) continue;
        const prev = byId.get(op.element.id);
        if (!prev || op.clock >= prev.clock) {
          byId.set(op.element.id, { el: op.element, clock: op.clock });
        }
      } else if (op.type === 'delete') {
        const prev = byId.get(op.elementId);
        if (prev && op.clock >= prev.clock) byId.delete(op.elementId);
        else if (!prev) byId.set(op.elementId, { el: null, clock: op.clock, tombstone: true });
      }
    }
    return Array.from(byId.values()).filter(v => v.el !== null && !v.tombstone).map(v => v.el);
  }

  registerLensAction("whiteboard", "ops-apply", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const ops = Array.isArray(params.ops) ? params.ops : [];
    if (ops.length === 0) return { ok: false, error: "ops array required" };
    const remoteClock = Number(params.knownClock) || 0;
    const log = ensureOpsBucket(s);
    if (!log.has(boardId)) log.set(boardId, { clock: 0, ops: [] });
    const entry = log.get(boardId);
    entry.clock = Math.max(entry.clock, remoteClock);
    const accepted = [];
    for (const raw of ops) {
      const type = raw.type;
      if (type !== 'add' && type !== 'update' && type !== 'delete') continue;
      if ((type === 'add' || type === 'update') && (!raw.element || !raw.element.id)) continue;
      if (type === 'delete' && !raw.elementId) continue;
      entry.clock += 1;
      const op = {
        clock: entry.clock,
        type,
        elementId: type === 'delete' ? String(raw.elementId) : String(raw.element.id),
        element: type === 'delete' ? null : raw.element,
        authorId: userId,
        ts: Date.now(),
      };
      entry.ops.push(op);
      accepted.push(op);
    }
    // Keep the op log bounded — once it gets long, compact it into the
    // scene and drop everything older than the last 500 ops.
    if (entry.ops.length > 1000) {
      const keep = entry.ops.slice(-500);
      const compacted = foldOps([], entry.ops.slice(0, -500));
      lookup.board.scene = { ...(lookup.board.scene || {}), elements: foldOps(compacted, []) };
      entry.ops = keep;
    }
    // Refold the authoritative scene from a clean base + all ops.
    lookup.board.scene = {
      ...(lookup.board.scene || { appState: {} }),
      elements: foldOps([], entry.ops),
    };
    lookup.board.updatedAt = nowIsoWb();
    saveWhiteboardState();
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:ops", {
        boardId, ops: accepted, clock: entry.clock, authorId: userId, ts: Date.now(),
      });
    } catch (_e) { /* realtime best-effort */ }
    return { ok: true, result: { boardId, clock: entry.clock, accepted: accepted.length, ops: accepted } };
  });

  registerLensAction("whiteboard", "ops-since", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const since = Number(params.sinceClock) || 0;
    const log = ensureOpsBucket(s);
    const entry = log.get(boardId);
    if (!entry) {
      // No op history — return the current scene as the baseline.
      return { ok: true, result: { boardId, clock: 0, ops: [], scene: lookup.board.scene || { elements: [] } } };
    }
    const ops = entry.ops.filter(o => o.clock > since);
    return { ok: true, result: { boardId, clock: entry.clock, ops, baselineNeeded: since === 0, scene: since === 0 ? lookup.board.scene : undefined } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [M] Raster export — PNG / SVG / PDF render plan ──────────
  //
  // The browser produces the final raster (Canvas.toDataURL / SVG
  // serialise), but the server computes the deterministic render plan:
  // tight content bounds, page tiling for very large boards, DPI
  // scaling, and a draw-order list. This makes the export identical
  // across clients and gives the PDF path real page geometry.

  registerLensAction("whiteboard", "export-raster-plan", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const format = ['png', 'svg', 'pdf'].includes(String(params.format).toLowerCase())
      ? String(params.format).toLowerCase() : 'png';
    const scale = Math.max(1, Math.min(4, Number(params.scale) || 2));
    const _pad = Number(params.padding);
    const padding = Math.max(0, Math.min(200, Number.isFinite(_pad) ? _pad : 40));
    const elements = Array.isArray(lookup.board.scene?.elements) ? lookup.board.scene.elements : [];
    if (elements.length === 0) {
      return { ok: true, result: { format, empty: true, message: "Board has no elements to export." } };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const x = Number(el.x) || 0, y = Number(el.y) || 0;
      const w = Number(el.w ?? el.width) || (el.kind === 'sticky' ? 120 : 40);
      const h = Number(el.h ?? el.height) || (el.kind === 'sticky' ? 80 : 30);
      if (Array.isArray(el.points) && el.points.length) {
        for (const p of el.points) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
      } else {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
      }
    }
    const contentW = Math.round(maxX - minX);
    const contentH = Math.round(maxY - minY);
    const bounds = { x: Math.round(minX - padding), y: Math.round(minY - padding), width: contentW + padding * 2, height: contentH + padding * 2 };
    const pixelW = bounds.width * scale;
    const pixelH = bounds.height * scale;
    // PDF page tiling — A4 landscape at 96dpi is ~1123×794 board units.
    const pages = [];
    if (format === 'pdf') {
      const PAGE_W = 1123, PAGE_H = 794;
      const cols = Math.max(1, Math.ceil(bounds.width / PAGE_W));
      const rows = Math.max(1, Math.ceil(bounds.height / PAGE_H));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          pages.push({ index: r * cols + c, x: bounds.x + c * PAGE_W, y: bounds.y + r * PAGE_H, width: PAGE_W, height: PAGE_H });
        }
      }
    }
    // Draw order: frames/sections first (background), then everything else.
    const drawOrder = [...elements]
      .map((el, i) => ({ id: el.id || `el_${i}`, kind: el.kind || el.type || 'shape', layer: (el.kind === 'frame' || el.kind === 'section') ? 0 : 1, index: i }))
      .sort((a, b) => a.layer - b.layer || a.index - b.index);
    return {
      ok: true,
      result: {
        format, scale, bounds,
        pixelDimensions: { width: pixelW, height: pixelH },
        elementCount: elements.length,
        drawOrder,
        pages: format === 'pdf' ? pages : undefined,
        warnings: [
          pixelW > 16384 || pixelH > 16384 ? "Raster exceeds 16384px — browsers may cap; reduce scale or split." : null,
          format === 'pdf' && pages.length > 1 ? `Board spans ${pages.length} PDF pages.` : null,
        ].filter(Boolean),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Frames / sections ────────────────────────────────────
  //
  // A frame is a named rectangular region. Elements whose centre falls
  // inside a frame's bounds are considered members. Frames give large
  // boards structure and back the presentation mode below.

  function ensureFramesBucket(s) {
    if (!s.frames) s.frames = new Map(); // boardId -> Map<frameId, frame>
    return s.frames;
  }

  function frameMembers(scene, frame) {
    const elements = Array.isArray(scene?.elements) ? scene.elements : [];
    const out = [];
    for (const el of elements) {
      const x = Number(el.x) || 0, y = Number(el.y) || 0;
      const w = Number(el.w ?? el.width) || 0;
      const h = Number(el.h ?? el.height) || 0;
      const cx = x + w / 2, cy = y + h / 2;
      if (cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h) {
        out.push(el.id);
      }
    }
    return out;
  }

  registerLensAction("whiteboard", "frame-create", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const label = String(params.label || "Frame").slice(0, 60);
    const x = Number(params.x) || 0, y = Number(params.y) || 0;
    const w = Math.max(40, Number(params.w) || 600);
    const h = Math.max(40, Number(params.h) || 400);
    const fb = ensureFramesBucket(s);
    if (!fb.has(boardId)) fb.set(boardId, new Map());
    const frame = {
      id: nextWbId('frame'), boardId, label, x, y, w, h,
      order: fb.get(boardId).size,
      createdAt: nowIsoWb(),
    };
    fb.get(boardId).set(frame.id, frame);
    saveWhiteboardState();
    return { ok: true, result: { frame: { ...frame, memberIds: frameMembers(lookup.board.scene, frame) } } };
  });

  registerLensAction("whiteboard", "frame-list", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const fb = ensureFramesBucket(s);
    const map = fb.get(boardId);
    const frames = map
      ? Array.from(map.values()).sort((a, b) => a.order - b.order)
        .map(f => ({ ...f, memberIds: frameMembers(lookup.board.scene, f) }))
      : [];
    return { ok: true, result: { frames } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("whiteboard", "frame-update", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const fb = ensureFramesBucket(s);
    const map = fb.get(boardId);
    const frame = map?.get(String(params.id || ""));
    if (!frame) return { ok: false, error: "frame not found" };
    if (params.label !== undefined) frame.label = String(params.label).slice(0, 60);
    if (params.x !== undefined) frame.x = Number(params.x) || 0;
    if (params.y !== undefined) frame.y = Number(params.y) || 0;
    if (params.w !== undefined) frame.w = Math.max(40, Number(params.w) || frame.w);
    if (params.h !== undefined) frame.h = Math.max(40, Number(params.h) || frame.h);
    if (params.order !== undefined) frame.order = Number(params.order) || 0;
    saveWhiteboardState();
    return { ok: true, result: { frame: { ...frame, memberIds: frameMembers(lookup.board.scene, frame) } } };
  });

  registerLensAction("whiteboard", "frame-delete", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const fb = ensureFramesBucket(s);
    const map = fb.get(boardId);
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "frame not found" };
    map.delete(id);
    saveWhiteboardState();
    return { ok: true, result: { deleted: id } };
  });

  // ── [S] Connectors / arrows between shapes with auto-routing ──
  //
  // A connector binds two element ids. Routing computes anchor points
  // on the nearest edges of the bound shapes and an orthogonal
  // (Manhattan) waypoint path so the arrow elbows cleanly instead of
  // cutting through geometry — the Miro/FigJam auto-route behaviour.

  function ensureConnectorsBucket(s) {
    if (!s.connectors) s.connectors = new Map(); // boardId -> Map<id, connector>
    return s.connectors;
  }

  function shapeBox(el) {
    const x = Number(el.x) || 0, y = Number(el.y) || 0;
    const w = Number(el.w ?? el.width) || (el.kind === 'sticky' ? 120 : 40);
    const h = Number(el.h ?? el.height) || (el.kind === 'sticky' ? 80 : 30);
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  // Pick the edge anchor on `a` facing `b`, and route an orthogonal path.
  function routeConnector(a, b) {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    let start, end;
    if (Math.abs(dx) >= Math.abs(dy)) {
      start = { x: dx >= 0 ? a.x + a.w : a.x, y: a.cy };
      end   = { x: dx >= 0 ? b.x : b.x + b.w, y: b.cy };
    } else {
      start = { x: a.cx, y: dy >= 0 ? a.y + a.h : a.y };
      end   = { x: b.cx, y: dy >= 0 ? b.y : b.y + b.h };
    }
    // Orthogonal waypoints — mid-point elbow.
    const waypoints = [start];
    if (start.x !== end.x && start.y !== end.y) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        const midX = (start.x + end.x) / 2;
        waypoints.push({ x: midX, y: start.y }, { x: midX, y: end.y });
      } else {
        const midY = (start.y + end.y) / 2;
        waypoints.push({ x: start.x, y: midY }, { x: end.x, y: midY });
      }
    }
    waypoints.push(end);
    const length = waypoints.reduce((sum, p, i) => i === 0 ? 0 : sum + Math.abs(p.x - waypoints[i - 1].x) + Math.abs(p.y - waypoints[i - 1].y), 0);
    return { start, end, waypoints, length: Math.round(length) };
  }

  function resolveConnectorRoute(scene, conn) {
    const elements = Array.isArray(scene?.elements) ? scene.elements : [];
    const a = elements.find(e => e.id === conn.fromId);
    const b = elements.find(e => e.id === conn.toId);
    if (!a || !b) return { ...conn, route: null, unresolved: true };
    return { ...conn, route: routeConnector(shapeBox(a), shapeBox(b)), unresolved: false };
  }

  registerLensAction("whiteboard", "connector-create", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const fromId = String(params.fromId || "");
    const toId = String(params.toId || "");
    if (!fromId || !toId) return { ok: false, error: "fromId and toId required" };
    if (fromId === toId) return { ok: false, error: "connector cannot bind a shape to itself" };
    const elements = Array.isArray(lookup.board.scene?.elements) ? lookup.board.scene.elements : [];
    if (!elements.some(e => e.id === fromId)) return { ok: false, error: "fromId not on board" };
    if (!elements.some(e => e.id === toId)) return { ok: false, error: "toId not on board" };
    const cb = ensureConnectorsBucket(s);
    if (!cb.has(boardId)) cb.set(boardId, new Map());
    const connector = {
      id: nextWbId('conn'), boardId, fromId, toId,
      label: String(params.label || "").slice(0, 60),
      style: ['arrow', 'line', 'dashed'].includes(params.style) ? params.style : 'arrow',
      color: typeof params.color === 'string' ? params.color.slice(0, 24) : '#7dd3fc',
      createdAt: nowIsoWb(),
    };
    cb.get(boardId).set(connector.id, connector);
    saveWhiteboardState();
    return { ok: true, result: { connector: resolveConnectorRoute(lookup.board.scene, connector) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("whiteboard", "connector-list", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cb = ensureConnectorsBucket(s);
    const map = cb.get(boardId);
    const connectors = map
      ? Array.from(map.values()).map(c => resolveConnectorRoute(lookup.board.scene, c))
      : [];
    return { ok: true, result: { connectors } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("whiteboard", "connector-delete", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const cb = ensureConnectorsBucket(s);
    const map = cb.get(boardId);
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "connector not found" };
    map.delete(id);
    saveWhiteboardState();
    return { ok: true, result: { deleted: id } };
  });

  // ── [M] Embeds — images, links, documents, video on the canvas ──
  //
  // An embed is a positioned canvas object pointing at external
  // content. Link embeds are enriched with title/description from the
  // page itself (free, keyless oEmbed-style fetch); image / video /
  // document embeds carry the source URL and dimensions. Embeds live
  // alongside scene elements but are tracked separately so the canvas
  // can render them with the right widget.

  function ensureEmbedsBucket(s) {
    if (!s.embeds) s.embeds = new Map(); // boardId -> Map<id, embed>
    return s.embeds;
  }

  function classifyEmbedUrl(url) {
    const u = url.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/.test(u)) return 'image';
    if (/\.(mp4|webm|mov)(\?|$)/.test(u) || /youtube\.com|youtu\.be|vimeo\.com/.test(u)) return 'video';
    if (/\.(pdf|docx?|xlsx?|pptx?|csv)(\?|$)/.test(u)) return 'document';
    return 'link';
  }

  registerLensAction("whiteboard", "embed-add", async (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const url = String(params.url || "").trim();
    if (!url) return { ok: false, error: "url required" };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be http(s)" };
    const kind = ['image', 'video', 'document', 'link'].includes(params.kind)
      ? params.kind : classifyEmbedUrl(url);
    const embed = {
      id: nextWbId('embed'), boardId, url, kind,
      title: String(params.title || "").slice(0, 200),
      description: "",
      x: Number(params.x) || 0,
      y: Number(params.y) || 0,
      w: Math.max(40, Number(params.w) || (kind === 'video' ? 320 : kind === 'image' ? 240 : 280)),
      h: Math.max(40, Number(params.h) || (kind === 'video' ? 180 : kind === 'image' ? 180 : 120)),
      addedBy: userId,
      createdAt: nowIsoWb(),
    };
    // Enrich link embeds with page metadata (free, keyless).
    if (kind === 'link' && !embed.title) {
      try {
        const { cachedFetchJson } = await import("../lib/external-fetch.js");
        const meta = await cachedFetchJson(
          `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
          { ttlMs: 6 * 60 * 60 * 1000 },
        );
        const data = meta?.data || {};
        if (data.title) embed.title = String(data.title).slice(0, 200);
        if (data.description) embed.description = String(data.description).slice(0, 400);
        if (data.image?.url) embed.previewImage = String(data.image.url);
      } catch (_e) { /* enrichment is best-effort */ }
    }
    if (!embed.title) embed.title = url;
    const eb = ensureEmbedsBucket(s);
    if (!eb.has(boardId)) eb.set(boardId, new Map());
    eb.get(boardId).set(embed.id, embed);
    saveWhiteboardState();
    return { ok: true, result: { embed } };
  });

  registerLensAction("whiteboard", "embed-list", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const eb = ensureEmbedsBucket(s);
    const map = eb.get(boardId);
    const embeds = map ? Array.from(map.values()) : [];
    return { ok: true, result: { embeds } };
  });

  registerLensAction("whiteboard", "embed-update", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const eb = ensureEmbedsBucket(s);
    const embed = eb.get(boardId)?.get(String(params.id || ""));
    if (!embed) return { ok: false, error: "embed not found" };
    if (params.x !== undefined) embed.x = Number(params.x) || 0;
    if (params.y !== undefined) embed.y = Number(params.y) || 0;
    if (params.w !== undefined) embed.w = Math.max(40, Number(params.w) || embed.w);
    if (params.h !== undefined) embed.h = Math.max(40, Number(params.h) || embed.h);
    if (params.title !== undefined) embed.title = String(params.title).slice(0, 200);
    saveWhiteboardState();
    return { ok: true, result: { embed } };
  });

  registerLensAction("whiteboard", "embed-delete", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const eb = ensureEmbedsBucket(s);
    const map = eb.get(boardId);
    const id = String(params.id || "");
    if (!map || !map.has(id)) return { ok: false, error: "embed not found" };
    map.delete(id);
    saveWhiteboardState();
    return { ok: true, result: { deleted: id } };
  });

  // ── [S] Presentation mode — step through frames as slides ─────
  //
  // Builds an ordered slide deck from the board's frames. Each slide
  // captures a frame's bounds (the camera target) plus its current
  // members, so the front-end can pan/zoom to each frame in turn.

  registerLensAction("whiteboard", "presentation-build", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const fb = ensureFramesBucket(s);
    const map = fb.get(boardId);
    if (!map || map.size === 0) {
      return { ok: true, result: { slides: [], slideCount: 0, message: "No frames yet — add frames to build a presentation." } };
    }
    const frames = Array.from(map.values()).sort((a, b) => a.order - b.order);
    const slides = frames.map((f, i) => ({
      index: i,
      frameId: f.id,
      title: f.label,
      camera: { x: f.x, y: f.y, width: f.w, height: f.h },
      memberIds: frameMembers(lookup.board.scene, f),
    }));
    return { ok: true, result: { boardId, slides, slideCount: slides.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Reactions / live cursors with name labels ────────────
  //
  // Reactions are ephemeral emoji bursts pinned to a board position;
  // a presence ping records a participant's named cursor. Both are
  // realtime-broadcast and stored only briefly (presence is wiped on
  // a TTL so stale cursors disappear).

  function ensurePresenceBucket(s) {
    if (!s.presence) s.presence = new Map(); // boardId -> Map<userId, presence>
    return s.presence;
  }
  const REACTION_EMOJI = ['👍', '❤️', '🎉', '🔥', '😂', '👀', '💡', '✅', '❓', '🚀'];

  registerLensAction("whiteboard", "reaction-send", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const emoji = String(params.emoji || "");
    if (!REACTION_EMOJI.includes(emoji)) return { ok: false, error: "unsupported emoji" };
    const x = Number(params.x);
    const y = Number(params.y);
    if (!isFinite(x) || !isFinite(y)) return { ok: false, error: "x, y required" };
    const reaction = {
      id: nextWbId('rxn'), boardId, emoji, x, y,
      authorId: userId,
      authorName: String(params.authorName || ctx?.actor?.displayName || userId),
      ts: Date.now(),
    };
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:reaction", reaction);
    } catch (_e) { /* best effort */ }
    return { ok: true, result: { reaction, palette: REACTION_EMOJI } };
  });

  registerLensAction("whiteboard", "presence-ping", (ctx, _a, params = {}) => {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const x = Number(params.x);
    const y = Number(params.y);
    if (!isFinite(x) || !isFinite(y)) return { ok: false, error: "x, y required" };
    const pb = ensurePresenceBucket(s);
    if (!pb.has(boardId)) pb.set(boardId, new Map());
    const presence = {
      userId,
      name: String(params.name || ctx?.actor?.displayName || userId).slice(0, 40),
      color: typeof params.color === 'string' ? params.color.slice(0, 24) : '#7dd3fc',
      x, y,
      updatedAt: Date.now(),
    };
    pb.get(boardId).set(userId, presence);
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:presence", { boardId, ...presence });
    } catch (_e) { /* best effort */ }
    return { ok: true, result: { presence } };
  });

  registerLensAction("whiteboard", "presence-list", (ctx, _a, params = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boardId = String(params.boardId || "");
    const lookup = findBoardForUser(s, userId, boardId);
    if (!lookup) return { ok: false, error: "board not found" };
    const pb = ensurePresenceBucket(s);
    const map = pb.get(boardId);
    const TTL = 30_000; // 30s — stale cursors disappear.
    const now = Date.now();
    const active = [];
    if (map) {
      for (const [uid2, p] of map) {
        if (now - p.updatedAt > TTL) { map.delete(uid2); continue; }
        active.push(p);
      }
    }
    return { ok: true, result: { boardId, participants: active, selfId: userId } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Workspace summary ────────────────────────────────────────

  registerLensAction("whiteboard", "workspace-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getWhiteboardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = wbActor(ctx);
    const boards = s.boards.get(userId);
    const boardCount = boards ? boards.size : 0;
    let elementCount = 0;
    let stickyCount = 0;
    if (boards) {
      for (const b of boards.values()) {
        const els = Array.isArray(b.scene?.elements) ? b.scene.elements : [];
        elementCount += els.length;
        stickyCount += els.filter(el => el.kind === 'sticky').length;
      }
    }
    let sharedCount = 0;
    for (const board of s.sharedBoards.values()) {
      if (board.ownerId === userId || (board.participants && board.participants.has(userId))) sharedCount++;
    }
    const cBucket = ensureCommentsBucket(s);
    let openCommentCount = 0;
    if (boards) {
      for (const id of boards.keys()) {
        const elementMap = cBucket.get(id);
        if (elementMap) for (const list of elementMap.values()) openCommentCount += list.filter(c => !c.resolved).length;
      }
    }
    return {
      ok: true,
      result: {
        boardCount,
        elementCount,
        stickyCount,
        sharedCount,
        openCommentCount,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Content-engine bridge: publish a board as a building-interior blueprint ──
  //
  // Flow:
  //   1. Player composes a CRDT canvas — shapes positioned with x/y/w/h.
  //   2. Client picks an archetype (tavern/archive/forge/market/tower)
  //      and submits the board (snapshot of `scene.elements`) plus an
  //      optional rasterised SVG preview.
  //   3. Macro serialises the board to a deterministic blueprint JSON
  //      (decor[] with kind/x/y/w/h/rotation/color/label) and writes
  //      it to disk. Optional SVG preview lives alongside.
  //   4. Registers in evo_assets with kind='blueprint', source='authored',
  //      sourceId='blueprint:<archetype>:<userId>:<boardId>'.
  //   5. procedural-buildings.ts#attachInteriorDecor queries evo_assets
  //      ranked by evolution_score; winning blueprint overrides the
  //      built-in procedural decor. Marketplace canon picks winners.
  //
  // Auth required. Idempotent on (source, sourceId).
  registerLensAction("whiteboard", "publish-as-blueprint", async (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const userId = wbActor(ctx);
    if (!userId || userId === "anon") {
      return { ok: false, error: "authentication required to publish a blueprint" };
    }
    const archetype = String(params.archetype || "").toLowerCase();
    if (!BLUEPRINT_ARCHETYPES.has(archetype)) {
      return { ok: false, error: `archetype must be one of: ${[...BLUEPRINT_ARCHETYPES].join(", ")}` };
    }
    const snapshotFormat = String(params.snapshotFormat || "json-snap").toLowerCase();
    if (!SNAPSHOT_FORMATS.has(snapshotFormat)) {
      return { ok: false, error: `snapshotFormat must be one of: ${[...SNAPSHOT_FORMATS].join(", ")}` };
    }
    const boardId = params.boardId ? String(params.boardId).slice(0, 64) : null;
    if (!boardId) return { ok: false, error: "boardId required" };

    // Locate the board in user state
    const s = getWhiteboardState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const board = s.boards?.get(userId)?.get(boardId);
    if (!board) return { ok: false, error: "board not found" };

    // Always serialise to deterministic JSON; optional SVG raster is a
    // companion preview.
    const blueprint = serialiseBoardToBlueprintJson(board.scene, params.themeOverrides);
    const jsonBuf = Buffer.from(JSON.stringify(blueprint, null, 2));
    if (jsonBuf.length > BLUEPRINT_MAX_BYTES) {
      return { ok: false, error: `blueprint JSON exceeds ${BLUEPRINT_MAX_BYTES / 1024 / 1024} MB` };
    }

    let svgBuf = null;
    if (snapshotFormat === "svg-raster") {
      const svg = decodeSvgDataUrl(params.svgDataUrl);
      if (!svg) {
        return { ok: false, error: "svgDataUrl must be a base64 data:image/svg+xml URL (≤5 MB)" };
      }
      svgBuf = svg.buf;
    }

    const sourceId = `blueprint:${archetype}:${userId}:${boardId}`;
    const dir = path.join(LENS_BLUEPRINT_ROOT, archetype, userId);
    const jsonName = `${boardId}.blueprint.json`;
    const svgName  = `${boardId}.preview.svg`;
    const jsonPath = path.join(dir, jsonName);
    const svgPath  = path.join(dir, svgName);

    try {
      // Async fs — blueprint JSON + ≤5 MB SVG writes must not block the event loop.
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(jsonPath, jsonBuf);
      if (svgBuf) await fsp.writeFile(svgPath, svgBuf);
    } catch (err) {
      return { ok: false, error: `failed to write blueprint files: ${err?.message || err}` };
    }

    let assetResult;
    try {
      assetResult = registerAsset(db, {
        kind: "blueprint",
        source: "authored",
        sourceId,
        localPath: jsonPath,
        category: `interior:${archetype}`,
        tags: ["whiteboard", "blueprint", archetype, `creator:${userId}`, `board:${boardId}`],
        qualityLevel: 1,
      });
    } catch (err) {
      await fsp.unlink(jsonPath).catch(() => { /* idempotent */ });
      if (svgBuf) await fsp.unlink(svgPath).catch(() => { /* idempotent */ });
      return { ok: false, error: `failed to register blueprint: ${err?.message || err}` };
    }

    return {
      ok: true,
      result: {
        assetId: assetResult.id,
        created: assetResult.created,
        sourceId,
        archetype,
        boardId,
        elementCount: blueprint.elementCount,
        previewIncluded: !!svgBuf,
        resolveUrl: `/api/evo-asset/resolve?source=authored&sourceId=${encodeURIComponent(sourceId)}`,
      },
    };
  });

  // Coverage indicator: which archetypes does this player's portfolio
  // currently cover? Used by the publish dialog to show a "you've
  // published 2/5 interiors" badge.
  registerLensAction("whiteboard", "published-blueprint-coverage", (ctx, _a, _params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const userId = wbActor(ctx);
    if (!userId || userId === "anon") {
      return { ok: false, error: "authentication required" };
    }
    const archetypes = {};
    for (const a of BLUEPRINT_ARCHETYPES) {
      const row = db.prepare(`
        SELECT id, quality_level, evolution_score
        FROM evo_assets
        WHERE source = 'authored'
          AND kind = 'blueprint'
          AND category = ?
          AND source_id LIKE ?
          AND archived_at IS NULL
        ORDER BY evolution_score DESC, rowid DESC
        LIMIT 1
      `).get(`interior:${a}`, `blueprint:${a}:${userId}:%`);
      archetypes[a] = row
        ? { assetId: row.id, qualityLevel: row.quality_level, evolutionScore: row.evolution_score }
        : null;
    }
    return { ok: true, result: { userId, archetypes } };
  });
}
