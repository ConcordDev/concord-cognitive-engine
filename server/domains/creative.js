export default function registerCreativeActions(registerLensAction) {
  // Fail-CLOSED numeric coercion: poisoned ("1e999"/"Infinity"/"NaN"/objects)
  // collapse to the default so every computed field stays Number.isFinite.
  const cvNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  // ── Producer bench: shot list ──────────────────────────────────────
  // CreativeActionPanel "Scenes JSON" → shotListGenerate. The panel renders
  // r.result.{totalShots, estimatedRuntime, equipmentList} and each shot's
  // {shotNumber, type, duration}. Drive from a `scenes[]` array when present
  // (each scene → one or more shots), else fall back to a type-based template.
  registerLensAction("creative", "shotListGenerate", (_ctx, artifact, _params) => {
    const d = (artifact && artifact.data) || {};
    const projType = String(d.type || 'photo');
    const scenes = Array.isArray(d.scenes) ? d.scenes : [];
    const shots = [];
    if (scenes.length) {
      scenes.forEach((scene, i) => {
        const sObj = (scene && typeof scene === 'object') ? scene : {};
        shots.push({
          shotNumber: i + 1,
          type: String(sObj.type || sObj.shotType || (projType === 'video' ? 'medium' : 'hero')),
          duration: Math.max(0, Math.round(cvNum(sObj.duration ?? sObj.durationSec, projType === 'video' ? 8 : 3))),
          description: String(sObj.description || sObj.name || `Scene ${i + 1}`),
          equipment: String(sObj.equipment || 'standard'),
          status: 'planned',
        });
      });
    } else {
      const defaults = projType === 'video'
        ? [['wide', 12, 'Wide establishing shot', 'tripod'], ['medium', 8, 'Medium two-shot', 'tripod'], ['close', 5, 'Close-up detail', 'gimbal'], ['ots', 6, 'Over-the-shoulder', 'gimbal'], ['broll', 10, 'B-roll cutaway', 'gimbal'], ['tracking', 9, 'Tracking shot', 'dolly']]
        : [['hero', 3, 'Hero shot', 'prime lens'], ['detail', 3, 'Detail close-up', 'macro'], ['wide', 3, 'Environmental wide', 'wide lens'], ['portrait', 3, 'Portrait', 'prime lens'], ['action', 3, 'Action shot', 'zoom'], ['flatlay', 3, 'Flat lay', 'overhead rig']];
      defaults.forEach(([type, duration, description, equipment], i) => {
        shots.push({ shotNumber: i + 1, type, duration, description, equipment, status: 'planned' });
      });
    }
    const estimatedRuntime = Math.round(shots.reduce((s, sh) => s + cvNum(sh.duration), 0) / 60);
    const equipmentList = [...new Set(shots.map((s) => s.equipment).filter(Boolean))];
    return {
      ok: true,
      result: { shots, totalShots: shots.length, estimatedRuntime, equipmentList },
    };
  });

  // ── Producer bench: asset organizer ────────────────────────────────
  // Panel renders r.result.{ready, totalAssets, byType (Record), missing[].name}.
  registerLensAction("creative", "assetOrganize", (_ctx, artifact, _params) => {
    const d = (artifact && artifact.data) || {};
    const assets = Array.isArray(d.assets) ? d.assets : [];
    const byType = {};
    const byStatus = {};
    const missing = [];
    let ready = 0;
    for (const raw of assets) {
      const a = (raw && typeof raw === 'object') ? raw : {};
      const t = String(a.type || 'uncategorized');
      byType[t] = (byType[t] || 0) + 1;
      const st = String(a.status || 'pending');
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (st === 'ready' || st === 'delivered' || st === 'final') ready += 1;
      else missing.push({ name: String(a.name || a.id || 'unnamed'), type: t, status: st });
    }
    return {
      ok: true,
      result: { totalAssets: assets.length, ready, byType, byStatus, missing },
    };
  });

  // ── Producer bench: budget tracker ─────────────────────────────────
  // Panel renders r.result.{totalBudgeted, totalActual, totalVariance, overBudget,
  // lines[].{category, budgeted, actual, variance, status}}. Accepts either a
  // line-item `lines[]` array (each with budgeted/actual) or a top-level
  // `budget` + `expenses[]` (amount/category) shape.
  registerLensAction("creative", "budgetTrack", (_ctx, artifact, _params) => {
    const d = (artifact && artifact.data) || {};
    // FAIL-CLOSED: a provided top-level budget must be a finite, non-negative
    // number — a poisoned value (NaN/Infinity/1e308/-1) must reject.
    if (d.budget !== undefined && d.budget !== null && d.budget !== "") {
      const b = Number(d.budget);
      if (!Number.isFinite(b) || b < 0) return { ok: false, error: "invalid_budget" };
    }
    let lines = [];
    if (Array.isArray(d.lines)) {
      lines = d.lines.map((raw) => {
        const l = (raw && typeof raw === 'object') ? raw : {};
        const budgeted = cvNum(l.budgeted ?? l.estimated ?? l.planned);
        const actual = cvNum(l.actual ?? l.spent ?? l.amount);
        const variance = budgeted - actual;
        return { category: String(l.category || 'Other'), budgeted, actual, variance, status: variance < 0 ? 'over' : 'ok' };
      });
    } else {
      // budget + expenses[] → roll up per-category lines.
      const totalBudget = cvNum(d.budget);
      const expenses = Array.isArray(d.expenses) ? d.expenses : [];
      const byCat = {};
      for (const raw of expenses) {
        const e = (raw && typeof raw === 'object') ? raw : {};
        const cat = String(e.category || 'Other');
        byCat[cat] = (byCat[cat] || 0) + cvNum(e.amount);
      }
      const cats = Object.keys(byCat);
      const perCatBudget = cats.length ? totalBudget / cats.length : 0;
      lines = cats.map((cat) => {
        const actual = byCat[cat];
        const budgeted = perCatBudget;
        const variance = budgeted - actual;
        return { category: cat, budgeted, actual, variance, status: variance < 0 ? 'over' : 'ok' };
      });
      if (!lines.length && totalBudget > 0) {
        lines = [{ category: 'Total', budgeted: totalBudget, actual: 0, variance: totalBudget, status: 'ok' }];
      }
    }
    const totalBudgeted = lines.reduce((s, l) => s + l.budgeted, 0);
    const totalActual = lines.reduce((s, l) => s + l.actual, 0);
    const totalVariance = totalBudgeted - totalActual;
    return {
      ok: true,
      result: { totalBudgeted, totalActual, totalVariance, overBudget: totalVariance < 0, lines },
    };
  });

  // ── Producer bench: distribution checklist ─────────────────────────
  // Panel renders r.result.{platform, percent, readyCount, total, deliveryDate,
  // checklist[].{item, ready, notes}}. Accepts a `checklist`/`items` array
  // (each item with a `ready` flag) or derives a default checklist by `type`.
  registerLensAction("creative", "distributionChecklist", (_ctx, artifact, params = {}) => {
    const d = (artifact && artifact.data) || {};
    const platform = String(d.platform || params.platform || 'General');
    const deliveryDate = String(d.deliveryDate || d.deadline || 'TBD');
    let checklist;
    const provided = Array.isArray(d.checklist) ? d.checklist : Array.isArray(d.items) ? d.items : null;
    if (provided) {
      checklist = provided.map((raw) => {
        const c = (raw && typeof raw === 'object') ? raw : {};
        return { item: String(c.item || c.name || c.label || 'item'), ready: !!(c.ready ?? c.done ?? c.completed), notes: String(c.notes || '') };
      });
    } else {
      const type = String(d.type || params.type || 'general');
      const labelsByType = {
        podcast: ['Apple Podcasts', 'Spotify', 'RSS Feed', 'Show Notes Published', 'Social Media Promo'],
        fashion: ['Lookbook Published', 'Buyer Outreach', 'Press Release', 'Social Media', 'E-commerce Upload'],
        general: ['Client Delivery', 'Portfolio Update', 'Social Media', 'Website Gallery'],
      };
      const labels = labelsByType[type] || labelsByType.general;
      checklist = labels.map((item) => ({ item, ready: false, notes: '' }));
    }
    const total = checklist.length;
    const readyCount = checklist.filter((c) => c.ready).length;
    const percent = total > 0 ? Math.round((readyCount / total) * 100) : 0;
    return {
      ok: true,
      result: { platform, checklist, readyCount, total, percent, deliveryDate },
    };
  });

  // ─── Milanote 2026 parity — visual boards for creative work ─────────
  // Freeform boards of positioned cards (notes, tasks, links, images,
  // headers), connections between cards, and starter templates.

  function getCrState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.creativeLens) STATE.creativeLens = {};
    const s = STATE.creativeLens;
    for (const k of ["boards", "cards", "connections"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveCrState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const crId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const crNow = () => new Date().toISOString();
  const crAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const crListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const crNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const crClamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, crNum(v, d)));
  const crClean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);

  const CR_CARD_TYPES = ["note", "task", "link", "header", "image"];
  const CR_COLORS = ["amber", "rose", "sky", "emerald", "violet", "zinc"];

  function crBoard(s, userId, boardId) {
    return (s.boards.get(userId) || []).find((b) => b.id === boardId) || null;
  }
  function crMaxZ(cards) {
    return cards.reduce((m, c) => Math.max(m, c.z || 0), 0);
  }

  // Built-in creative board templates (relative card layouts).
  const CR_TEMPLATES = [
    {
      id: "moodboard", name: "Moodboard", description: "Collect visual references and a direction.",
      cards: [
        { type: "header", content: "Direction", x: 40, y: 30, color: "violet" },
        { type: "note", content: "What feeling should this evoke?", x: 40, y: 90, color: "zinc" },
        { type: "header", content: "References", x: 40, y: 220, color: "violet" },
        { type: "note", content: "Drop image links here", x: 40, y: 280, color: "sky" },
      ],
    },
    {
      id: "project-plan", name: "Project Plan", description: "Goal, milestones and next actions.",
      cards: [
        { type: "header", content: "Goal", x: 40, y: 30, color: "emerald" },
        { type: "note", content: "Define the outcome", x: 40, y: 90, color: "zinc" },
        { type: "header", content: "Milestones", x: 320, y: 30, color: "emerald" },
        { type: "task", content: "First milestone", x: 320, y: 90, color: "amber" },
        { type: "task", content: "Second milestone", x: 320, y: 160, color: "amber" },
      ],
    },
    {
      id: "story-outline", name: "Story Outline", description: "Three-act structure scaffold.",
      cards: [
        { type: "header", content: "Act I — Setup", x: 40, y: 30, color: "sky" },
        { type: "note", content: "Inciting incident", x: 40, y: 90, color: "zinc" },
        { type: "header", content: "Act II — Confrontation", x: 320, y: 30, color: "amber" },
        { type: "note", content: "Midpoint turn", x: 320, y: 90, color: "zinc" },
        { type: "header", content: "Act III — Resolution", x: 600, y: 30, color: "rose" },
        { type: "note", content: "Climax", x: 600, y: 90, color: "zinc" },
      ],
    },
    {
      id: "brainstorm", name: "Brainstorm", description: "A central idea with branches.",
      cards: [
        { type: "header", content: "Central idea", x: 320, y: 140, color: "violet" },
        { type: "note", content: "Branch one", x: 60, y: 40, color: "sky" },
        { type: "note", content: "Branch two", x: 600, y: 40, color: "emerald" },
        { type: "note", content: "Branch three", x: 60, y: 260, color: "amber" },
        { type: "note", content: "Branch four", x: 600, y: 260, color: "rose" },
      ],
    },
    {
      id: "content-calendar", name: "Content Calendar", description: "Plan a week of content.",
      cards: [
        { type: "header", content: "This week", x: 40, y: 30, color: "amber" },
        { type: "task", content: "Mon — ", x: 40, y: 90, color: "sky" },
        { type: "task", content: "Wed — ", x: 40, y: 160, color: "sky" },
        { type: "task", content: "Fri — ", x: 40, y: 230, color: "sky" },
      ],
    },
  ];

  function crSeedCard(boardId, def, z) {
    return {
      id: crId("crd"), boardId,
      type: CR_CARD_TYPES.includes(def.type) ? def.type : "note",
      content: crClean(def.content, 2000),
      label: null,
      x: Math.round(crNum(def.x)), y: Math.round(crNum(def.y)),
      w: 220, h: def.type === "header" ? 48 : 120,
      color: CR_COLORS.includes(def.color) ? def.color : "zinc",
      done: false, z, createdAt: crNow(),
    };
  }

  // ── Boards ──────────────────────────────────────────────────────────
  registerLensAction("creative", "board-create", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = crClean(params.title, 120);
    if (!title) return { ok: false, error: "board title required" };
    const board = { id: crId("brd"), title, createdAt: crNow(), updatedAt: crNow() };
    crListB(s.boards, crAid(ctx)).push(board);
    saveCrState();
    return { ok: true, result: { board } };
  });

  registerLensAction("creative", "board-list", (ctx, _a, _params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const cards = s.cards.get(userId) || [];
    const boards = (s.boards.get(userId) || [])
      .map((b) => ({ ...b, cardCount: cards.filter((c) => c.boardId === b.id).length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { boards, count: boards.length } };
  });

  registerLensAction("creative", "board-get", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const board = crBoard(s, userId, params.id);
    if (!board) return { ok: false, error: "board not found" };
    return {
      ok: true,
      result: {
        board,
        cards: (s.cards.get(userId) || []).filter((c) => c.boardId === board.id).sort((a, b) => a.z - b.z),
        connections: (s.connections.get(userId) || []).filter((c) => c.boardId === board.id),
      },
    };
  });

  registerLensAction("creative", "board-rename", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = crBoard(s, crAid(ctx), params.id);
    if (!board) return { ok: false, error: "board not found" };
    const title = crClean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    board.title = title;
    board.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { board } };
  });

  registerLensAction("creative", "board-delete", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const arr = s.boards.get(userId) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "board not found" };
    arr.splice(i, 1);
    s.cards.set(userId, (s.cards.get(userId) || []).filter((c) => c.boardId !== params.id));
    s.connections.set(userId, (s.connections.get(userId) || []).filter((c) => c.boardId !== params.id));
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("creative", "board-duplicate", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const board = crBoard(s, userId, params.id);
    if (!board) return { ok: false, error: "board not found" };
    const copy = { id: crId("brd"), title: `${board.title} (copy)`, createdAt: crNow(), updatedAt: crNow() };
    crListB(s.boards, userId).push(copy);
    const idMap = new Map();
    for (const c of (s.cards.get(userId) || []).filter((x) => x.boardId === board.id)) {
      const nc = { ...c, id: crId("crd"), boardId: copy.id };
      idMap.set(c.id, nc.id);
      crListB(s.cards, userId).push(nc);
    }
    for (const cn of (s.connections.get(userId) || []).filter((x) => x.boardId === board.id)) {
      crListB(s.connections, userId).push({
        id: crId("cnx"), boardId: copy.id,
        fromCardId: idMap.get(cn.fromCardId), toCardId: idMap.get(cn.toCardId),
      });
    }
    saveCrState();
    return { ok: true, result: { board: copy } };
  });

  // ── Cards ───────────────────────────────────────────────────────────
  registerLensAction("creative", "card-add", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const board = crBoard(s, userId, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const cards = (s.cards.get(userId) || []).filter((c) => c.boardId === board.id);
    const type = CR_CARD_TYPES.includes(String(params.type)) ? String(params.type) : "note";
    const card = {
      id: crId("crd"), boardId: board.id, type,
      content: crClean(params.content, 2000),
      label: crClean(params.label, 160) || null,
      x: Math.round(crClamp(params.x, -2000, 8000, 60)),
      y: Math.round(crClamp(params.y, -2000, 8000, 60)),
      w: Math.round(crClamp(params.w, 80, 600, 220)),
      h: Math.round(crClamp(params.h, 32, 600, type === "header" ? 48 : 120)),
      color: CR_COLORS.includes(String(params.color)) ? String(params.color) : "zinc",
      done: false, z: crMaxZ(cards) + 1, createdAt: crNow(),
    };
    crListB(s.cards, userId).push(card);
    board.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { card } };
  });

  registerLensAction("creative", "card-update", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const card = (s.cards.get(userId) || []).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (params.content != null) card.content = crClean(params.content, 2000);
    if (params.label != null) card.label = crClean(params.label, 160) || null;
    if (params.x != null) card.x = Math.round(crClamp(params.x, -2000, 8000, card.x));
    if (params.y != null) card.y = Math.round(crClamp(params.y, -2000, 8000, card.y));
    if (params.w != null) card.w = Math.round(crClamp(params.w, 80, 600, card.w));
    if (params.h != null) card.h = Math.round(crClamp(params.h, 32, 600, card.h));
    if (params.color != null && CR_COLORS.includes(String(params.color))) card.color = String(params.color);
    if (params.done != null) card.done = !!params.done;
    const board = crBoard(s, userId, card.boardId);
    if (board) board.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { card } };
  });

  registerLensAction("creative", "card-move", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const card = (s.cards.get(crAid(ctx)) || []).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    card.x = Math.round(crClamp(params.x, -2000, 8000, card.x));
    card.y = Math.round(crClamp(params.y, -2000, 8000, card.y));
    saveCrState();
    return { ok: true, result: { cardId: card.id, x: card.x, y: card.y } };
  });

  registerLensAction("creative", "card-raise", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const card = (s.cards.get(userId) || []).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    card.z = crMaxZ((s.cards.get(userId) || []).filter((c) => c.boardId === card.boardId)) + 1;
    saveCrState();
    return { ok: true, result: { cardId: card.id, z: card.z } };
  });

  registerLensAction("creative", "card-delete", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const arr = s.cards.get(userId) || [];
    const i = arr.findIndex((c) => c.id === params.cardId);
    if (i < 0) return { ok: false, error: "card not found" };
    arr.splice(i, 1);
    s.connections.set(userId, (s.connections.get(userId) || [])
      .filter((c) => c.fromCardId !== params.cardId && c.toCardId !== params.cardId));
    saveCrState();
    return { ok: true, result: { deleted: params.cardId } };
  });

  // ── Connections ─────────────────────────────────────────────────────
  registerLensAction("creative", "connection-add", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const cards = s.cards.get(userId) || [];
    const from = cards.find((c) => c.id === params.fromCardId);
    const to = cards.find((c) => c.id === params.toCardId);
    if (!from || !to) return { ok: false, error: "both cards must exist" };
    if (from.id === to.id) return { ok: false, error: "cannot connect a card to itself" };
    if (from.boardId !== to.boardId) return { ok: false, error: "cards must be on the same board" };
    const exists = (s.connections.get(userId) || []).some(
      (c) => c.fromCardId === from.id && c.toCardId === to.id);
    if (exists) return { ok: false, error: "connection already exists" };
    const connection = { id: crId("cnx"), boardId: from.boardId, fromCardId: from.id, toCardId: to.id };
    crListB(s.connections, userId).push(connection);
    saveCrState();
    return { ok: true, result: { connection } };
  });

  registerLensAction("creative", "connection-delete", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.connections.get(crAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "connection not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Templates ───────────────────────────────────────────────────────
  registerLensAction("creative", "board-templates", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        templates: CR_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      },
    };
  });

  registerLensAction("creative", "board-from-template", (ctx, _a, params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tpl = CR_TEMPLATES.find((t) => t.id === String(params.templateId));
    if (!tpl) return { ok: false, error: "unknown template" };
    const userId = crAid(ctx);
    const board = {
      id: crId("brd"),
      title: crClean(params.title, 120) || tpl.name,
      createdAt: crNow(), updatedAt: crNow(),
    };
    crListB(s.boards, userId).push(board);
    tpl.cards.forEach((def, i) => crListB(s.cards, userId).push(crSeedCard(board.id, def, i + 1)));
    saveCrState();
    return { ok: true, result: { board, cardsSeeded: tpl.cards.length } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("creative", "creative-dashboard", (ctx, _a, _params = {}) => {
    const s = getCrState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const cards = s.cards.get(userId) || [];
    const tasks = cards.filter((c) => c.type === "task");
    return {
      ok: true,
      result: {
        boards: (s.boards.get(userId) || []).length,
        cards: cards.length,
        openTasks: tasks.filter((c) => !c.done).length,
        doneTasks: tasks.filter((c) => c.done).length,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  // StudioBinder / Frame.io parity — production management substrate.
  // Per-user Maps on globalThis._concordSTATE.creativeLens; every handler
  // is try/catch-free pure logic but returns { ok, error } never throws.
  // ═══════════════════════════════════════════════════════════════════

  function getProdState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.creativeLens) STATE.creativeLens = {};
    const s = STATE.creativeLens;
    for (const k of [
      "reviewAssets", "reviewComments", "callSheets", "breakdowns",
      "approvals", "calendarEvents", "proofLinks", "proofExtComments",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  const prList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };

  // ── Feature 1: Frame-accurate review comments ───────────────────────
  // A "review asset" is an uploaded video/image (by URL or DTU ref) that
  // collaborators annotate at a precise timestamp (video) or x/y point.

  registerLensAction("creative", "review-asset-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = crClean(params.name, 160);
    if (!name) return { ok: false, error: "asset name required" };
    const kind = ["video", "image"].includes(String(params.kind)) ? String(params.kind) : "video";
    const asset = {
      id: crId("rva"), name, kind,
      src: crClean(params.src, 600) || null,
      durationSec: kind === "video" ? Math.max(0, crNum(params.durationSec, 0)) : 0,
      project: crClean(params.project, 160) || null,
      createdAt: crNow(),
    };
    prList(s.reviewAssets, crAid(ctx)).push(asset);
    saveCrState();
    return { ok: true, result: { asset } };
  });

  registerLensAction("creative", "review-asset-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const comments = s.reviewComments.get(userId) || [];
    const assets = (s.reviewAssets.get(userId) || [])
      .map((a) => ({
        ...a,
        commentCount: comments.filter((c) => c.assetId === a.id).length,
        openCount: comments.filter((c) => c.assetId === a.id && !c.resolved).length,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { assets, count: assets.length } };
  });

  registerLensAction("creative", "review-asset-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const arr = s.reviewAssets.get(userId) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "asset not found" };
    arr.splice(i, 1);
    s.reviewComments.set(userId, (s.reviewComments.get(userId) || []).filter((c) => c.assetId !== params.id));
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("creative", "review-comment-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const asset = (s.reviewAssets.get(userId) || []).find((a) => a.id === params.assetId);
    if (!asset) return { ok: false, error: "review asset not found" };
    const body = crClean(params.body, 1200);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = {
      id: crId("rvc"), assetId: asset.id,
      author: crClean(params.author, 80) || "You",
      body,
      timestampSec: asset.kind === "video"
        ? crClamp(params.timestampSec, 0, asset.durationSec || 86400, 0) : null,
      x: params.x != null ? crClamp(params.x, 0, 1, 0.5) : null,
      y: params.y != null ? crClamp(params.y, 0, 1, 0.5) : null,
      resolved: false,
      createdAt: crNow(),
    };
    prList(s.reviewComments, userId).push(comment);
    saveCrState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("creative", "review-comment-list", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comments = (s.reviewComments.get(crAid(ctx)) || [])
      .filter((c) => c.assetId === params.assetId)
      .sort((a, b) => {
        const at = a.timestampSec ?? -1, bt = b.timestampSec ?? -1;
        return at - bt || a.createdAt.localeCompare(b.createdAt);
      });
    return { ok: true, result: { comments, count: comments.length } };
  });

  registerLensAction("creative", "review-comment-resolve", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const comment = (s.reviewComments.get(crAid(ctx)) || []).find((c) => c.id === params.id);
    if (!comment) return { ok: false, error: "comment not found" };
    comment.resolved = params.resolved != null ? !!params.resolved : !comment.resolved;
    saveCrState();
    return { ok: true, result: { comment } };
  });

  registerLensAction("creative", "review-comment-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.reviewComments.get(crAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "comment not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 2: Call sheet generator ─────────────────────────────────
  // One call sheet per shoot day: cast/crew with call times, locations,
  // a per-row schedule. Computes a general crew call from the earliest row.

  registerLensAction("creative", "callsheet-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const project = crClean(params.project, 160);
    if (!project) return { ok: false, error: "project required" };
    const sheet = {
      id: crId("cs"), project,
      shootDate: crClean(params.shootDate, 40) || crNow().slice(0, 10),
      dayNumber: Math.max(1, Math.round(crNum(params.dayNumber, 1))),
      generalCall: crClean(params.generalCall, 20) || "08:00",
      cast: [], crew: [], locations: [], schedule: [],
      notes: crClean(params.notes, 1000) || "",
      createdAt: crNow(), updatedAt: crNow(),
    };
    prList(s.callSheets, crAid(ctx)).push(sheet);
    saveCrState();
    return { ok: true, result: { sheet } };
  });

  registerLensAction("creative", "callsheet-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sheets = (s.callSheets.get(crAid(ctx)) || [])
      .map((cs) => ({
        ...cs,
        castCount: cs.cast.length, crewCount: cs.crew.length,
        locationCount: cs.locations.length, sceneCount: cs.schedule.length,
      }))
      .sort((a, b) => (b.shootDate || "").localeCompare(a.shootDate || ""));
    return { ok: true, result: { sheets, count: sheets.length } };
  });

  registerLensAction("creative", "callsheet-get", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sheet = (s.callSheets.get(crAid(ctx)) || []).find((c) => c.id === params.id);
    if (!sheet) return { ok: false, error: "call sheet not found" };
    return { ok: true, result: { sheet } };
  });

  registerLensAction("creative", "callsheet-add-row", (ctx, _a, params = {}) => {
  try {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sheet = (s.callSheets.get(crAid(ctx)) || []).find((c) => c.id === params.id);
    if (!sheet) return { ok: false, error: "call sheet not found" };
    const section = String(params.section);
    if (!["cast", "crew", "locations", "schedule"].includes(section)) {
      return { ok: false, error: "section must be cast|crew|locations|schedule" };
    }
    let row;
    if (section === "cast") {
      row = {
        id: crId("row"),
        name: crClean(params.name, 120),
        role: crClean(params.role, 120),
        callTime: crClean(params.callTime, 20) || sheet.generalCall,
      };
      if (!row.name) return { ok: false, error: "cast name required" };
    } else if (section === "crew") {
      row = {
        id: crId("row"),
        name: crClean(params.name, 120),
        department: crClean(params.department, 120),
        callTime: crClean(params.callTime, 20) || sheet.generalCall,
      };
      if (!row.name) return { ok: false, error: "crew name required" };
    } else if (section === "locations") {
      row = {
        id: crId("row"),
        name: crClean(params.name, 160),
        address: crClean(params.address, 300),
      };
      if (!row.name) return { ok: false, error: "location name required" };
    } else {
      row = {
        id: crId("row"),
        time: crClean(params.time, 20),
        scene: crClean(params.scene, 200),
      };
      if (!row.scene) return { ok: false, error: "scene required" };
    }
    sheet[section].push(row);
    // Recompute general call as the earliest cast/crew call time.
    const allCalls = [...sheet.cast, ...sheet.crew]
      .map((r) => r.callTime).filter((t) => /^\d{1,2}:\d{2}$/.test(t || "")).sort();
    if (allCalls.length) sheet.generalCall = allCalls[0];
    sheet.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { sheet } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("creative", "callsheet-remove-row", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sheet = (s.callSheets.get(crAid(ctx)) || []).find((c) => c.id === params.id);
    if (!sheet) return { ok: false, error: "call sheet not found" };
    const section = String(params.section);
    if (!Array.isArray(sheet[section])) return { ok: false, error: "invalid section" };
    const before = sheet[section].length;
    sheet[section] = sheet[section].filter((r) => r.id !== params.rowId);
    if (sheet[section].length === before) return { ok: false, error: "row not found" };
    sheet.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { sheet } };
  });

  registerLensAction("creative", "callsheet-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.callSheets.get(crAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "call sheet not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 3: Script breakdown ─────────────────────────────────────
  // Paste a script; tag props / cast / locations / wardrobe / SFX.
  // Auto-extract pass: heuristically detect ALL-CAPS character cues and
  // INT./EXT. scene headings, surfaced as suggestions the user confirms.

  const BD_CATEGORIES = ["cast", "props", "locations", "wardrobe", "sfx", "vehicles"];

  function autoExtract(script) {
    const lines = String(script || "").split(/\r?\n/);
    const cast = new Set(), locations = new Set();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const slug = line.match(/^(INT\.|EXT\.|INT\/EXT\.)\s*(.+?)(?:\s+-\s+.*)?$/i);
      if (slug) { locations.add(slug[2].trim()); continue; }
      // Character cue: short, mostly uppercase, no sentence punctuation.
      if (line.length <= 40 && /^[A-Z][A-Z0-9 .'()-]+$/.test(line)
        && !/^(INT|EXT|FADE|CUT|THE END|CONTINUED)/i.test(line)) {
        cast.add(line.replace(/\s*\(.*\)\s*$/, "").trim());
      }
    }
    return {
      cast: [...cast].slice(0, 60),
      locations: [...locations].slice(0, 60),
    };
  }

  registerLensAction("creative", "breakdown-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = crClean(params.title, 160);
    if (!title) return { ok: false, error: "title required" };
    const script = crClean(params.script, 60000);
    const bd = {
      id: crId("bd"), title,
      project: crClean(params.project, 160) || null,
      script,
      tags: { cast: [], props: [], locations: [], wardrobe: [], sfx: [], vehicles: [] },
      createdAt: crNow(), updatedAt: crNow(),
    };
    prList(s.breakdowns, crAid(ctx)).push(bd);
    saveCrState();
    return { ok: true, result: { breakdown: bd, suggestions: autoExtract(script) } };
  });

  registerLensAction("creative", "breakdown-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const breakdowns = (s.breakdowns.get(crAid(ctx)) || [])
      .map((b) => ({
        id: b.id, title: b.title, project: b.project,
        scriptLength: b.script.length,
        tagCount: BD_CATEGORIES.reduce((n, c) => n + b.tags[c].length, 0),
        createdAt: b.createdAt, updatedAt: b.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { breakdowns, count: breakdowns.length } };
  });

  registerLensAction("creative", "breakdown-get", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bd = (s.breakdowns.get(crAid(ctx)) || []).find((b) => b.id === params.id);
    if (!bd) return { ok: false, error: "breakdown not found" };
    return { ok: true, result: { breakdown: bd, suggestions: autoExtract(bd.script) } };
  });

  registerLensAction("creative", "breakdown-rescan", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bd = (s.breakdowns.get(crAid(ctx)) || []).find((b) => b.id === params.id);
    if (!bd) return { ok: false, error: "breakdown not found" };
    if (params.script != null) {
      bd.script = crClean(params.script, 60000);
      bd.updatedAt = crNow();
      saveCrState();
    }
    return { ok: true, result: { breakdown: bd, suggestions: autoExtract(bd.script) } };
  });

  registerLensAction("creative", "breakdown-tag", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bd = (s.breakdowns.get(crAid(ctx)) || []).find((b) => b.id === params.id);
    if (!bd) return { ok: false, error: "breakdown not found" };
    const category = String(params.category);
    if (!BD_CATEGORIES.includes(category)) {
      return { ok: false, error: `category must be one of ${BD_CATEGORIES.join("|")}` };
    }
    const value = crClean(params.value, 160);
    if (!value) return { ok: false, error: "tag value required" };
    if (!bd.tags[category].some((t) => t.value.toLowerCase() === value.toLowerCase())) {
      bd.tags[category].push({ id: crId("tg"), value });
      bd.updatedAt = crNow();
      saveCrState();
    }
    return { ok: true, result: { breakdown: bd } };
  });

  registerLensAction("creative", "breakdown-untag", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bd = (s.breakdowns.get(crAid(ctx)) || []).find((b) => b.id === params.id);
    if (!bd) return { ok: false, error: "breakdown not found" };
    const category = String(params.category);
    if (!BD_CATEGORIES.includes(category)) return { ok: false, error: "invalid category" };
    bd.tags[category] = bd.tags[category].filter((t) => t.id !== params.tagId);
    bd.updatedAt = crNow();
    saveCrState();
    return { ok: true, result: { breakdown: bd } };
  });

  registerLensAction("creative", "breakdown-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.breakdowns.get(crAid(ctx)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "breakdown not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 4: Version stacking on deliverables ─────────────────────
  // An "approval item" is a deliverable with an explicit revision chain.
  // Each version is appended; currentVersion always points at the latest.
  // Feature 5 (approval workflow) is folded into the same record.

  const APPROVAL_STATES = ["draft", "in_review", "approved", "rejected", "changes_requested"];

  registerLensAction("creative", "deliverable-create", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = crClean(params.name, 160);
    if (!name) return { ok: false, error: "deliverable name required" };
    const first = {
      version: 1,
      src: crClean(params.src, 600) || null,
      note: crClean(params.note, 600) || "Initial version",
      uploadedBy: crClean(params.uploadedBy, 80) || "You",
      uploadedAt: crNow(),
    };
    const item = {
      id: crId("dlv"), name,
      project: crClean(params.project, 160) || null,
      versions: [first],
      currentVersion: 1,
      status: "draft",
      reviewer: null,
      decisionNote: null,
      decidedAt: null,
      submittedAt: null,
      createdAt: crNow(),
    };
    prList(s.approvals, crAid(ctx)).push(item);
    saveCrState();
    return { ok: true, result: { deliverable: item } };
  });

  registerLensAction("creative", "deliverable-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const deliverables = (s.approvals.get(crAid(ctx)) || [])
      .map((d) => ({
        id: d.id, name: d.name, project: d.project,
        currentVersion: d.currentVersion, versionCount: d.versions.length,
        status: d.status, reviewer: d.reviewer, createdAt: d.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { deliverables, count: deliverables.length } };
  });

  registerLensAction("creative", "deliverable-get", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = (s.approvals.get(crAid(ctx)) || []).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "deliverable not found" };
    return { ok: true, result: { deliverable: d } };
  });

  registerLensAction("creative", "deliverable-add-version", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = (s.approvals.get(crAid(ctx)) || []).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "deliverable not found" };
    const nextV = d.versions[d.versions.length - 1].version + 1;
    const ver = {
      version: nextV,
      src: crClean(params.src, 600) || null,
      note: crClean(params.note, 600) || `Version ${nextV}`,
      uploadedBy: crClean(params.uploadedBy, 80) || "You",
      uploadedAt: crNow(),
    };
    d.versions.push(ver);
    d.currentVersion = nextV;
    // A new version reopens the deliverable for review.
    d.status = "draft";
    d.decisionNote = null;
    d.decidedAt = null;
    saveCrState();
    return { ok: true, result: { deliverable: d, version: ver } };
  });

  registerLensAction("creative", "deliverable-set-current", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = (s.approvals.get(crAid(ctx)) || []).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "deliverable not found" };
    const v = Math.round(crNum(params.version, 0));
    if (!d.versions.some((x) => x.version === v)) return { ok: false, error: "version not found" };
    d.currentVersion = v;
    saveCrState();
    return { ok: true, result: { deliverable: d } };
  });

  // ── Feature 5: Approval workflow ────────────────────────────────────
  registerLensAction("creative", "deliverable-submit", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = (s.approvals.get(crAid(ctx)) || []).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "deliverable not found" };
    if (d.status === "approved") return { ok: false, error: "already approved" };
    d.status = "in_review";
    d.reviewer = crClean(params.reviewer, 80) || d.reviewer || "Client";
    d.submittedAt = crNow();
    d.decisionNote = null;
    d.decidedAt = null;
    saveCrState();
    return { ok: true, result: { deliverable: d } };
  });

  registerLensAction("creative", "deliverable-decide", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const d = (s.approvals.get(crAid(ctx)) || []).find((x) => x.id === params.id);
    if (!d) return { ok: false, error: "deliverable not found" };
    const decision = String(params.decision);
    if (!["approved", "rejected", "changes_requested"].includes(decision)) {
      return { ok: false, error: "decision must be approved|rejected|changes_requested" };
    }
    if (d.status !== "in_review") return { ok: false, error: "deliverable is not in review" };
    d.status = decision;
    d.decisionNote = crClean(params.note, 600) || null;
    d.decidedAt = crNow();
    saveCrState();
    return { ok: true, result: { deliverable: d } };
  });

  registerLensAction("creative", "deliverable-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.approvals.get(crAid(ctx)) || [];
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "deliverable not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 6: Production calendar ──────────────────────────────────
  // Shoot days, milestones, deliverable due dates on a single timeline.

  const CAL_KINDS = ["shoot_day", "milestone", "deliverable_due", "meeting", "review"];

  registerLensAction("creative", "calendar-add", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = crClean(params.title, 160);
    if (!title) return { ok: false, error: "event title required" };
    const date = crClean(params.date, 40);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "date must be YYYY-MM-DD" };
    const kind = CAL_KINDS.includes(String(params.kind)) ? String(params.kind) : "milestone";
    const ev = {
      id: crId("cal"), title, date, kind,
      project: crClean(params.project, 160) || null,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(crClean(params.endDate, 40)) ? crClean(params.endDate, 40) : null,
      notes: crClean(params.notes, 600) || "",
      done: false,
      createdAt: crNow(),
    };
    prList(s.calendarEvents, crAid(ctx)).push(ev);
    saveCrState();
    return { ok: true, result: { event: ev } };
  });

  registerLensAction("creative", "calendar-list", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let events = (s.calendarEvents.get(crAid(ctx)) || []).slice();
    if (params.kind && CAL_KINDS.includes(String(params.kind))) {
      events = events.filter((e) => e.kind === params.kind);
    }
    if (params.from) events = events.filter((e) => e.date >= String(params.from));
    if (params.to) events = events.filter((e) => e.date <= String(params.to));
    events.sort((a, b) => a.date.localeCompare(b.date));
    const today = crNow().slice(0, 10);
    return {
      ok: true,
      result: {
        events, count: events.length,
        upcoming: events.filter((e) => e.date >= today && !e.done).length,
        overdue: events.filter((e) => e.date < today && !e.done).length,
      },
    };
  });

  registerLensAction("creative", "calendar-update", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ev = (s.calendarEvents.get(crAid(ctx)) || []).find((e) => e.id === params.id);
    if (!ev) return { ok: false, error: "event not found" };
    if (params.title != null) {
      const t = crClean(params.title, 160);
      if (t) ev.title = t;
    }
    if (params.date != null && /^\d{4}-\d{2}-\d{2}$/.test(String(params.date))) ev.date = String(params.date);
    if (params.kind != null && CAL_KINDS.includes(String(params.kind))) ev.kind = String(params.kind);
    if (params.notes != null) ev.notes = crClean(params.notes, 600);
    if (params.done != null) ev.done = !!params.done;
    saveCrState();
    return { ok: true, result: { event: ev } };
  });

  registerLensAction("creative", "calendar-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.calendarEvents.get(crAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "event not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feature 7: Shareable client-proof links + external comments ─────
  // A proof link wraps a review asset with a public token. External
  // (unauthenticated) reviewers fetch by token and leave comments that
  // land back in the owner's inbox without needing an account.

  registerLensAction("creative", "prooflink-create", (ctx, _a, params = {}) => {
  try {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const asset = (s.reviewAssets.get(userId) || []).find((a) => a.id === params.assetId);
    if (!asset) return { ok: false, error: "review asset not found" };
    const token = `pl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const link = {
      id: crId("pln"), token, assetId: asset.id, ownerId: userId,
      label: crClean(params.label, 160) || asset.name,
      allowComments: params.allowComments !== false,
      active: true,
      createdAt: crNow(),
    };
    prList(s.proofLinks, userId).push(link);
    saveCrState();
    return {
      ok: true,
      result: { link, shareUrl: `/proof/${token}` },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("creative", "prooflink-list", (ctx, _a, _params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = crAid(ctx);
    const ext = s.proofExtComments.get(userId) || [];
    const links = (s.proofLinks.get(userId) || [])
      .map((l) => ({
        ...l,
        shareUrl: `/proof/${l.token}`,
        externalCommentCount: ext.filter((c) => c.token === l.token).length,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { links, count: links.length } };
  });

  registerLensAction("creative", "prooflink-toggle", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const link = (s.proofLinks.get(crAid(ctx)) || []).find((l) => l.id === params.id);
    if (!link) return { ok: false, error: "proof link not found" };
    link.active = params.active != null ? !!params.active : !link.active;
    saveCrState();
    return { ok: true, result: { link } };
  });

  registerLensAction("creative", "prooflink-delete", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.proofLinks.get(crAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "proof link not found" };
    arr.splice(i, 1);
    saveCrState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Owner-side inbox of external comments captured across all proof links.
  registerLensAction("creative", "prooflink-inbox", (ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let comments = (s.proofExtComments.get(crAid(ctx)) || []).slice();
    if (params.token) comments = comments.filter((c) => c.token === params.token);
    comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      ok: true,
      result: { comments, count: comments.length },
    };
  });

  // Public read by token — resolves the wrapped asset + its external thread.
  // Looks across all users' proof links since reviewers are unauthenticated.
  registerLensAction("creative", "prooflink-public-get", (_ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const token = String(params.token || "");
    let found = null;
    for (const [ownerId, links] of s.proofLinks.entries()) {
      const link = (links || []).find((l) => l.token === token);
      if (link) { found = { link, ownerId }; break; }
    }
    if (!found) return { ok: false, error: "proof link not found" };
    if (!found.link.active) return { ok: false, error: "proof link is inactive" };
    const asset = (s.reviewAssets.get(found.ownerId) || []).find((a) => a.id === found.link.assetId);
    if (!asset) return { ok: false, error: "proof asset unavailable" };
    const comments = (s.proofExtComments.get(found.ownerId) || [])
      .filter((c) => c.token === token)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      ok: true,
      result: {
        label: found.link.label,
        allowComments: found.link.allowComments,
        asset: { id: asset.id, name: asset.name, kind: asset.kind, src: asset.src, durationSec: asset.durationSec },
        comments,
      },
    };
  });

  // External (unauthenticated) reviewer leaves a frame-accurate comment.
  registerLensAction("creative", "prooflink-public-comment", (_ctx, _a, params = {}) => {
    const s = getProdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const token = String(params.token || "");
    let found = null;
    for (const [ownerId, links] of s.proofLinks.entries()) {
      const link = (links || []).find((l) => l.token === token);
      if (link) { found = { link, ownerId }; break; }
    }
    if (!found) return { ok: false, error: "proof link not found" };
    if (!found.link.active) return { ok: false, error: "proof link is inactive" };
    if (!found.link.allowComments) return { ok: false, error: "commenting disabled for this link" };
    const asset = (s.reviewAssets.get(found.ownerId) || []).find((a) => a.id === found.link.assetId);
    if (!asset) return { ok: false, error: "proof asset unavailable" };
    const body = crClean(params.body, 1200);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = {
      id: crId("xcm"), token,
      authorName: crClean(params.authorName, 80) || "Guest reviewer",
      body,
      timestampSec: asset.kind === "video"
        ? crClamp(params.timestampSec, 0, asset.durationSec || 86400, 0) : null,
      createdAt: crNow(),
    };
    prList(s.proofExtComments, found.ownerId).push(comment);
    saveCrState();
    return { ok: true, result: { comment } };
  });

  // ── Project + revision summaries (deterministic; artifact-based) ──
  // Surface the creative-lens "Project Summary" / "Revision Summary" buttons that
  // previously hit no macro. Defensive over whatever the project artifact carries.
  registerLensAction("creative", "project_summary", (ctx, artifact, _params = {}) => {
    const d = artifact.data || {};
    const arrays = {};
    for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) arrays[k] = v.length;
    const status = d.status || d.stage || (d.deliverables ? "in_production" : "planning");
    return {
      ok: true,
      result: {
        title: artifact.title || d.title || "Untitled project",
        status,
        type: d.type || artifact.type || "project",
        counts: arrays,
        totalItems: Object.values(arrays).reduce((s2, n) => s2 + n, 0),
        budget: d.budget != null ? d.budget : null,
        lastUpdated: d.updatedAt || d.createdAt || null,
        summary: `${artifact.title || "Project"} — ${status}, ${Object.entries(arrays).map(([k, n]) => `${n} ${k}`).join(", ") || "no items yet"}.`,
      },
    };
  });

  registerLensAction("creative", "revision_summary", (ctx, artifact, _params = {}) => {
    const d = artifact.data || {};
    const versions = Array.isArray(d.versions) ? d.versions
      : Array.isArray(d.revisions) ? d.revisions
      : Array.isArray(d.deliverables) ? d.deliverables : [];
    const latest = versions[versions.length - 1] || null;
    const statusCounts = {};
    for (const v of versions) { const st = String(v?.status || v?.decision || "draft"); statusCounts[st] = (statusCounts[st] || 0) + 1; }
    return {
      ok: true,
      result: {
        title: artifact.title || "Untitled",
        revisionCount: versions.length,
        latestStatus: latest?.status || latest?.decision || (versions.length ? "draft" : "none"),
        latestVersion: latest?.version || latest?.name || (versions.length || null),
        statusCounts,
        summary: versions.length
          ? `${versions.length} revision(s); latest is ${latest?.status || latest?.decision || "a draft"}.`
          : "No revisions recorded yet.",
      },
    };
  });
};
