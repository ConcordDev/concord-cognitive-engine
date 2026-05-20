// server/domains/gamedesign.js
export default function registerGameDesignActions(registerLensAction) {
  registerLensAction("game-design", "mechanicsAnalysis", (ctx, artifact, _params) => {
    const mechanics = artifact.data?.mechanics || [];
    if (mechanics.length === 0) return { ok: true, result: { message: "Add game mechanics to analyze design." } };
    const categories = { core: [], progression: [], social: [], economy: [], combat: [] };
    for (const m of mechanics) { const cat = (m.category || "core").toLowerCase(); if (categories[cat]) categories[cat].push(m); else categories.core.push(m); }
    const depth = Math.min(100, mechanics.length * 8 + Object.values(categories).filter(c => c.length > 0).length * 15);
    return { ok: true, result: { totalMechanics: mechanics.length, categories: Object.entries(categories).map(([k, v]) => ({ category: k, count: v.length })), depthScore: depth, loopCount: mechanics.filter(m => m.loop || m.isLoop).length, emergentPotential: mechanics.length > 5 && Object.values(categories).filter(c => c.length > 0).length >= 3 ? "high" : "moderate", pillars: Object.entries(categories).filter(([, v]) => v.length > 0).map(([k]) => k) } };
  });
  registerLensAction("game-design", "playerFlow", (ctx, artifact, _params) => {
    const states = artifact.data?.states || [];
    if (states.length === 0) return { ok: true, result: { message: "Define player states to analyze flow." } };
    const analyzed = states.map(s => ({ state: s.name, challenge: parseFloat(s.challenge) || 50, skill: parseFloat(s.skillRequired) || 50, duration: parseFloat(s.durationMinutes) || 10, flowZone: Math.abs((parseFloat(s.challenge) || 50) - (parseFloat(s.skillRequired) || 50)) < 15 }));
    const inFlow = analyzed.filter(s => s.flowZone).length;
    return { ok: true, result: { states: analyzed, totalStates: states.length, inFlowZone: inFlow, flowPercent: Math.round((inFlow / states.length) * 100), totalDuration: analyzed.reduce((s, a) => s + a.duration, 0), pacing: inFlow / states.length > 0.6 ? "well-paced" : "needs-tension-relief-balance" } };
  });
  registerLensAction("game-design", "narrativeBranch", (ctx, artifact, _params) => {
    const nodes = artifact.data?.nodes || [];
    if (nodes.length === 0) return { ok: true, result: { message: "Add narrative nodes with choices to map branching." } };
    const totalChoices = nodes.reduce((s, n) => s + ((n.choices || []).length), 0);
    const endings = nodes.filter(n => n.isEnding || (n.choices || []).length === 0);
    const avgChoices = nodes.length > 0 ? Math.round(totalChoices / nodes.length * 10) / 10 : 0;
    const maxDepth = Math.ceil(Math.log2(nodes.length + 1));
    return { ok: true, result: { totalNodes: nodes.length, totalChoices, avgChoicesPerNode: avgChoices, endings: endings.length, maxBranchDepth: maxDepth, complexity: nodes.length > 20 ? "highly-branching" : nodes.length > 8 ? "moderate-branching" : "linear-with-choices", replayValue: endings.length >= 3 ? "high" : endings.length >= 2 ? "moderate" : "low" } };
  });
  registerLensAction("game-design", "monetizationModel", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const model = (data.model || "premium").toLowerCase();
    const models = {
      premium: { revenue: "one-time", avgLTV: 30, retention: "lower", fairness: "high", development: "standard" },
      "free-to-play": { revenue: "ongoing", avgLTV: 5, retention: "higher", fairness: "variable", development: "live-service" },
      subscription: { revenue: "recurring", avgLTV: 60, retention: "medium", fairness: "high", development: "content-pipeline" },
      "battle-pass": { revenue: "seasonal", avgLTV: 40, retention: "higher", fairness: "moderate", development: "seasonal-content" },
    };
    const chosen = models[model] || models.premium;
    const dau = parseInt(data.expectedDAU) || 10000;
    const conversionRate = model === "premium" ? 1 : parseFloat(data.conversionRate) || 0.05;
    const projectedMonthly = Math.round(dau * conversionRate * chosen.avgLTV / 12);
    return { ok: true, result: { model, ...chosen, expectedDAU: dau, conversionRate: `${(conversionRate * 100).toFixed(1)}%`, projectedMonthlyRevenue: projectedMonthly, projectedAnnualRevenue: projectedMonthly * 12, ethicalConsiderations: model === "free-to-play" ? ["Avoid pay-to-win mechanics", "Don't target vulnerable players", "Transparent odds for loot boxes"] : ["Fair pricing for content"] } };
  });

  // ─── Tiled + LDtk + Nuclino 2026 parity — game design workbench ─────
  // Game projects with a GDD, a mechanics list, an entity roster, and a
  // real grid tilemap level editor with paintable layers.

  function getGdState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.gameDesignLens) STATE.gameDesignLens = {};
    const s = STATE.gameDesignLens;
    for (const k of ["games", "gdd", "mechanics", "entities", "levels"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveGdState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const gdId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const gdNow = () => new Date().toISOString();
  const gdAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const gdListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const gdNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const gdClamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, gdNum(v, d)));
  const gdClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const gdPick = (v, allowed, dflt) => (allowed.includes(String(v)) ? String(v) : dflt);

  const GD_MECHANIC_CATS = ["core", "progression", "combat", "economy", "social", "exploration"];
  const GD_ENTITY_KINDS = ["player", "enemy", "boss", "npc", "item", "prop"];

  // Built-in greybox tile palette (colour-typed tiles for blockout maps).
  const GD_TILES = [
    { id: "grass", name: "Grass", color: "#4ade80", category: "terrain" },
    { id: "dirt", name: "Dirt", color: "#a16207", category: "terrain" },
    { id: "stone", name: "Stone", color: "#71717a", category: "terrain" },
    { id: "sand", name: "Sand", color: "#fde047", category: "terrain" },
    { id: "water", name: "Water", color: "#38bdf8", category: "terrain" },
    { id: "snow", name: "Snow", color: "#e2e8f0", category: "terrain" },
    { id: "wall", name: "Wall", color: "#44403c", category: "structure" },
    { id: "floor", name: "Floor", color: "#d6d3d1", category: "structure" },
    { id: "door", name: "Door", color: "#92400e", category: "structure" },
    { id: "bridge", name: "Bridge", color: "#b45309", category: "structure" },
    { id: "lava", name: "Lava", color: "#f97316", category: "hazard" },
    { id: "spike", name: "Spikes", color: "#ef4444", category: "hazard" },
    { id: "pit", name: "Pit", color: "#1c1917", category: "hazard" },
    { id: "spawn", name: "Spawn", color: "#22c55e", category: "marker" },
    { id: "exit", name: "Exit", color: "#a855f7", category: "marker" },
    { id: "chest", name: "Chest", color: "#eab308", category: "marker" },
    { id: "checkpoint", name: "Checkpoint", color: "#06b6d4", category: "marker" },
  ];
  const GD_TILE_IDS = new Set(GD_TILES.map((t) => t.id));

  function gdGame(s, userId, gameId) {
    return (s.games.get(userId) || []).find((g) => g.id === gameId) || null;
  }
  function gdLayerTiles(cols, rows) {
    return new Array(cols * rows).fill(null);
  }

  // ── Game projects ───────────────────────────────────────────────────
  registerLensAction("game-design", "game-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = gdClean(params.title, 160);
    if (!title) return { ok: false, error: "game title required" };
    const game = {
      id: gdId("gam"), title,
      genre: gdClean(params.genre, 40) || "platformer",
      platform: gdClean(params.platform, 40) || "pc",
      pitch: gdClean(params.pitch, 600) || null,
      createdAt: gdNow(), updatedAt: gdNow(),
    };
    gdListB(s.games, gdAid(ctx)).push(game);
    saveGdState();
    return { ok: true, result: { game } };
  });

  registerLensAction("game-design", "game-list", (ctx, _a, _params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const games = s.games.get(gdAid(ctx)) || [];
    return { ok: true, result: { games, count: games.length } };
  });

  registerLensAction("game-design", "game-get", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const game = gdGame(s, userId, params.id);
    if (!game) return { ok: false, error: "game not found" };
    return {
      ok: true,
      result: {
        game,
        gdd: (s.gdd.get(userId) || []).filter((x) => x.gameId === game.id).sort((a, b) => a.order - b.order),
        mechanics: (s.mechanics.get(userId) || []).filter((x) => x.gameId === game.id),
        entities: (s.entities.get(userId) || []).filter((x) => x.gameId === game.id),
        levels: (s.levels.get(userId) || [])
          .filter((x) => x.gameId === game.id)
          .map((l) => ({ id: l.id, name: l.name, cols: l.cols, rows: l.rows, layerCount: l.layers.length })),
      },
    };
  });

  registerLensAction("game-design", "game-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const game = gdGame(s, gdAid(ctx), params.id);
    if (!game) return { ok: false, error: "game not found" };
    if (params.title != null) game.title = gdClean(params.title, 160) || game.title;
    if (params.genre != null) game.genre = gdClean(params.genre, 40) || game.genre;
    if (params.platform != null) game.platform = gdClean(params.platform, 40) || game.platform;
    if (params.pitch != null) game.pitch = gdClean(params.pitch, 600) || null;
    game.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { game } };
  });

  registerLensAction("game-design", "game-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const arr = s.games.get(userId) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "game not found" };
    arr.splice(i, 1);
    for (const k of ["gdd", "mechanics", "entities", "levels"]) {
      const list = s[k].get(userId);
      if (list) s[k].set(userId, list.filter((x) => x.gameId !== params.id));
    }
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── GDD sections ────────────────────────────────────────────────────
  registerLensAction("game-design", "gdd-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const title = gdClean(params.title, 120);
    if (!title) return { ok: false, error: "section title required" };
    const existing = (s.gdd.get(userId) || []).filter((x) => x.gameId === params.gameId);
    const section = {
      id: gdId("gdd"), gameId: String(params.gameId), title,
      content: gdClean(params.content, 8000) || "",
      order: existing.length, updatedAt: gdNow(),
    };
    gdListB(s.gdd, userId).push(section);
    saveGdState();
    return { ok: true, result: { section } };
  });

  registerLensAction("game-design", "gdd-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const section = (s.gdd.get(gdAid(ctx)) || []).find((x) => x.id === params.id);
    if (!section) return { ok: false, error: "section not found" };
    if (params.title != null) section.title = gdClean(params.title, 120) || section.title;
    if (params.content != null) section.content = gdClean(params.content, 8000);
    section.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { section } };
  });

  registerLensAction("game-design", "gdd-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.gdd.get(gdAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "section not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Mechanics ───────────────────────────────────────────────────────
  registerLensAction("game-design", "mechanic-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "mechanic name required" };
    const mechanic = {
      id: gdId("mec"), gameId: String(params.gameId), name,
      category: gdPick(params.category, GD_MECHANIC_CATS, "core"),
      description: gdClean(params.description, 1000) || null,
      createdAt: gdNow(),
    };
    gdListB(s.mechanics, userId).push(mechanic);
    saveGdState();
    return { ok: true, result: { mechanic } };
  });

  registerLensAction("game-design", "mechanic-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const mechanic = (s.mechanics.get(gdAid(ctx)) || []).find((x) => x.id === params.id);
    if (!mechanic) return { ok: false, error: "mechanic not found" };
    if (params.name != null) mechanic.name = gdClean(params.name, 120) || mechanic.name;
    if (params.category != null) mechanic.category = gdPick(params.category, GD_MECHANIC_CATS, mechanic.category);
    if (params.description != null) mechanic.description = gdClean(params.description, 1000) || null;
    saveGdState();
    return { ok: true, result: { mechanic } };
  });

  registerLensAction("game-design", "mechanic-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.mechanics.get(gdAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "mechanic not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Entities ────────────────────────────────────────────────────────
  registerLensAction("game-design", "entity-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "entity name required" };
    const entity = {
      id: gdId("ent"), gameId: String(params.gameId), name,
      kind: gdPick(params.kind, GD_ENTITY_KINDS, "enemy"),
      health: Math.max(0, Math.round(gdNum(params.health))),
      damage: Math.max(0, Math.round(gdNum(params.damage))),
      speed: Math.max(0, Math.round(gdNum(params.speed))),
      description: gdClean(params.description, 1000) || null,
      createdAt: gdNow(),
    };
    gdListB(s.entities, userId).push(entity);
    saveGdState();
    return { ok: true, result: { entity } };
  });

  registerLensAction("game-design", "entity-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entity = (s.entities.get(gdAid(ctx)) || []).find((x) => x.id === params.id);
    if (!entity) return { ok: false, error: "entity not found" };
    if (params.name != null) entity.name = gdClean(params.name, 120) || entity.name;
    if (params.kind != null) entity.kind = gdPick(params.kind, GD_ENTITY_KINDS, entity.kind);
    if (params.health != null) entity.health = Math.max(0, Math.round(gdNum(params.health)));
    if (params.damage != null) entity.damage = Math.max(0, Math.round(gdNum(params.damage)));
    if (params.speed != null) entity.speed = Math.max(0, Math.round(gdNum(params.speed)));
    if (params.description != null) entity.description = gdClean(params.description, 1000) || null;
    saveGdState();
    return { ok: true, result: { entity } };
  });

  registerLensAction("game-design", "entity-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.entities.get(gdAid(ctx)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "entity not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Tile palette ────────────────────────────────────────────────────
  registerLensAction("game-design", "tile-palette", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { tiles: GD_TILES, categories: [...new Set(GD_TILES.map((t) => t.category))] } };
  });

  // ── Levels — grid tilemap editor ────────────────────────────────────
  registerLensAction("game-design", "level-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const cols = Math.round(gdClamp(params.cols, 4, 64, 20));
    const rows = Math.round(gdClamp(params.rows, 4, 64, 14));
    const level = {
      id: gdId("lvl"), gameId: String(params.gameId),
      name: gdClean(params.name, 120) || "New level",
      cols, rows, tileSize: Math.round(gdClamp(params.tileSize, 8, 64, 24)),
      layers: [
        { id: gdId("lyr"), name: "Background", visible: true, tiles: gdLayerTiles(cols, rows) },
        { id: gdId("lyr"), name: "Foreground", visible: true, tiles: gdLayerTiles(cols, rows) },
      ],
      createdAt: gdNow(), updatedAt: gdNow(),
    };
    gdListB(s.levels, userId).push(level);
    saveGdState();
    return { ok: true, result: { level } };
  });

  registerLensAction("game-design", "level-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const levels = (s.levels.get(gdAid(ctx)) || [])
      .filter((l) => l.gameId === String(params.gameId))
      .map((l) => ({ id: l.id, name: l.name, cols: l.cols, rows: l.rows, layerCount: l.layers.length }));
    return { ok: true, result: { levels, count: levels.length } };
  });

  registerLensAction("game-design", "level-get", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.id);
    if (!level) return { ok: false, error: "level not found" };
    return { ok: true, result: { level } };
  });

  registerLensAction("game-design", "level-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.levels.get(gdAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "level not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("game-design", "level-layer-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    if (level.layers.length >= 8) return { ok: false, error: "layer limit (8) reached" };
    const layer = {
      id: gdId("lyr"),
      name: gdClean(params.name, 60) || `Layer ${level.layers.length + 1}`,
      visible: true, tiles: gdLayerTiles(level.cols, level.rows),
    };
    level.layers.push(layer);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { layer } };
  });

  registerLensAction("game-design", "level-layer-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (params.name != null) layer.name = gdClean(params.name, 60) || layer.name;
    if (params.visible != null) layer.visible = !!params.visible;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { layerId: layer.id, name: layer.name, visible: layer.visible } };
  });

  registerLensAction("game-design", "level-paint", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const index = Math.round(gdNum(params.index, -1));
    if (index < 0 || index >= layer.tiles.length) return { ok: false, error: "cell index out of range" };
    const tile = params.tile == null ? null : (GD_TILE_IDS.has(String(params.tile)) ? String(params.tile) : null);
    layer.tiles[index] = tile;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { index, tile } };
  });

  registerLensAction("game-design", "level-paint-batch", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const cells = Array.isArray(params.cells) ? params.cells : [];
    let painted = 0;
    for (const c of cells) {
      const index = Math.round(gdNum(c?.index, -1));
      if (index < 0 || index >= layer.tiles.length) continue;
      layer.tiles[index] = c?.tile == null ? null : (GD_TILE_IDS.has(String(c.tile)) ? String(c.tile) : null);
      painted += 1;
    }
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { painted } };
  });

  registerLensAction("game-design", "level-fill-layer", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = (s.levels.get(gdAid(ctx)) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    const tile = params.tile == null ? null : (GD_TILE_IDS.has(String(params.tile)) ? String(params.tile) : null);
    layer.tiles = new Array(level.cols * level.rows).fill(tile);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { filled: layer.id, tile } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("game-design", "game-dashboard", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const game = gdGame(s, userId, params.gameId);
    if (!game) return { ok: false, error: "game not found" };
    const mechanics = (s.mechanics.get(userId) || []).filter((x) => x.gameId === game.id);
    const byCategory = {};
    for (const c of GD_MECHANIC_CATS) byCategory[c] = mechanics.filter((m) => m.category === c).length;
    return {
      ok: true,
      result: {
        title: game.title,
        gddSections: (s.gdd.get(userId) || []).filter((x) => x.gameId === game.id).length,
        mechanics: mechanics.length,
        entities: (s.entities.get(userId) || []).filter((x) => x.gameId === game.id).length,
        levels: (s.levels.get(userId) || []).filter((x) => x.gameId === game.id).length,
        mechanicsByCategory: byCategory,
      },
    };
  });
}
