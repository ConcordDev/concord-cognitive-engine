export default function registerCreativeActions(registerLensAction) {
  registerLensAction("creative", "shotListGenerate", (_ctx, artifact, _params) => {
    const type = artifact.data?.type || 'photo';
    const shots = [];
    const defaultShots = type === 'video'
      ? ['Wide establishing shot', 'Medium two-shot', 'Close-up detail', 'Over-the-shoulder', 'B-roll cutaway', 'Tracking shot']
      : ['Hero shot', 'Detail close-up', 'Environmental wide', 'Portrait', 'Action shot', 'Flat lay'];
    defaultShots.forEach((desc, i) => {
      shots.push({ number: i + 1, description: desc, setup: 'TBD', lens: 'TBD', notes: '', status: 'planned' });
    });
    artifact.data = { ...artifact.data, shotList: shots };
    artifact.updatedAt = new Date().toISOString();
    return { ok: true, result: { shots, count: shots.length } };
  });

  registerLensAction("creative", "assetOrganize", (_ctx, artifact, _params) => {
    const assets = artifact.data?.assets || [];
    const organized = {};
    for (const asset of assets) {
      const cat = asset.type || 'uncategorized';
      if (!organized[cat]) organized[cat] = [];
      organized[cat].push(asset);
    }
    const summary = Object.entries(organized).map(([type, items]) => ({ type, count: items.length }));
    return { ok: true, result: { categories: summary, totalAssets: assets.length } };
  });

  registerLensAction("creative", "budgetTrack", (_ctx, artifact, _params) => {
    const budget = artifact.data?.budget || 0;
    const expenses = artifact.data?.expenses || [];
    const totalSpent = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const remaining = budget - totalSpent;
    const percentUsed = budget > 0 ? Math.round((totalSpent / budget) * 100) : 0;
    const byCategory = {};
    expenses.forEach(e => {
      const cat = e.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
    });
    return { ok: true, result: { budget, totalSpent, remaining, percentUsed, byCategory, overBudget: remaining < 0 } };
  });

  registerLensAction("creative", "distributionChecklist", (ctx, artifact, params) => {
    const type = artifact.data?.type || params.type || 'general';
    let checklist;
    if (type === 'podcast') {
      checklist = [
        { platform: 'Apple Podcasts', status: 'pending' }, { platform: 'Spotify', status: 'pending' },
        { platform: 'Google Podcasts', status: 'pending' }, { platform: 'Amazon Music', status: 'pending' },
        { platform: 'RSS Feed', status: 'pending' }, { platform: 'Show Notes Published', status: 'pending' },
        { platform: 'Social Media Promo', status: 'pending' },
      ];
    } else if (type === 'fashion') {
      checklist = [
        { platform: 'Lookbook Published', status: 'pending' }, { platform: 'Buyer Outreach', status: 'pending' },
        { platform: 'Press Release', status: 'pending' }, { platform: 'Social Media', status: 'pending' },
        { platform: 'E-commerce Upload', status: 'pending' },
      ];
    } else {
      checklist = [
        { platform: 'Client Delivery', status: 'pending' }, { platform: 'Portfolio Update', status: 'pending' },
        { platform: 'Social Media', status: 'pending' }, { platform: 'Website Gallery', status: 'pending' },
      ];
    }
    return { ok: true, result: { checklist, type, total: checklist.length } };
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
};
