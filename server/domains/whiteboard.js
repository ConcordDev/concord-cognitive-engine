// server/domains/whiteboard.js
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

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
}
