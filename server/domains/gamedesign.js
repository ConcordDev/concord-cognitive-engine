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
    // FAIL-CLOSED: a provided expectedDAU / conversionRate must be a finite,
    // non-negative number. parseFloat("1e999") === Infinity would otherwise
    // leak straight into projectedMonthlyRevenue.
    if (data.expectedDAU !== undefined && data.expectedDAU !== null && data.expectedDAU !== "") {
      const n = Number(data.expectedDAU);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "invalid_expectedDAU" };
    }
    if (data.conversionRate !== undefined && data.conversionRate !== null && data.conversionRate !== "") {
      const n = Number(data.conversionRate);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "invalid_conversionRate" };
    }
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
    for (const k of [
      "games", "gdd", "mechanics", "entities", "levels",
      "loops", "narrativeNodes", "narrativeLinks", "enums", "customTiles", "autotileRules",
      "assets", "animations", "behaviors", "playtests", "collabSessions",
    ]) {
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

  const GD_LAYER_KINDS = ["tile", "object", "intgrid"];
  const GD_ORIENTATIONS = ["orthogonal", "isometric", "hexagonal"];
  const GD_FIELD_TYPES = ["int", "float", "string", "bool", "enum", "color"];
  const GD_LOOP_KINDS = ["core", "progression", "positive", "negative", "economy"];
  const GD_NARRATIVE_KINDS = ["start", "scene", "choice", "ending"];

  function gdGame(s, userId, gameId) {
    return (s.games.get(userId) || []).find((g) => g.id === gameId) || null;
  }
  function gdLayerTiles(cols, rows) {
    return new Array(cols * rows).fill(null);
  }
  // Migrate a layer in place to the kind/opacity/objects shape.
  function gdNormalizeLayer(layer) {
    if (!layer) return layer;
    if (!GD_LAYER_KINDS.includes(layer.kind)) layer.kind = "tile";
    if (typeof layer.opacity !== "number") layer.opacity = 1;
    if (layer.kind === "object") {
      if (!Array.isArray(layer.objects)) layer.objects = [];
    } else if (!Array.isArray(layer.tiles)) {
      layer.tiles = [];
    }
    return layer;
  }
  function gdNormalizeLevel(level) {
    if (!level) return level;
    if (!GD_ORIENTATIONS.includes(level.orientation)) level.orientation = "orthogonal";
    if (Array.isArray(level.layers)) for (const l of level.layers) gdNormalizeLayer(l);
    return level;
  }
  function gdFindLevel(s, userId, levelId) {
    const lvl = (s.levels.get(userId) || []).find((l) => l.id === levelId) || null;
    return gdNormalizeLevel(lvl);
  }
  // Every tile id a level may legitimately reference: built-ins + the
  // owning game's custom tiles.
  function gdValidTileIds(s, userId, gameId) {
    const custom = (s.customTiles.get(userId) || []).filter((t) => t.gameId === String(gameId));
    return new Set([...GD_TILE_IDS, ...custom.map((t) => t.id)]);
  }
  function gdResolveTile(validIds, raw) {
    if (raw == null) return null;
    return validIds.has(String(raw)) ? String(raw) : null;
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
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const cols = Math.round(gdClamp(params.cols, 4, 64, 20));
    const rows = Math.round(gdClamp(params.rows, 4, 64, 14));
    const level = {
      id: gdId("lvl"), gameId: String(params.gameId),
      name: gdClean(params.name, 120) || "New level",
      cols, rows, tileSize: Math.round(gdClamp(params.tileSize, 8, 64, 24)),
      orientation: gdPick(params.orientation, GD_ORIENTATIONS, "orthogonal"),
      layers: [
        { id: gdId("lyr"), name: "Background", kind: "tile", visible: true, opacity: 1, tiles: gdLayerTiles(cols, rows) },
        { id: gdId("lyr"), name: "Foreground", kind: "tile", visible: true, opacity: 1, tiles: gdLayerTiles(cols, rows) },
      ],
      createdAt: gdNow(), updatedAt: gdNow(),
    };
    gdListB(s.levels, userId).push(level);
    saveGdState();
    return { ok: true, result: { level } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    const level = gdFindLevel(s, gdAid(ctx), params.id);
    if (!level) return { ok: false, error: "level not found" };
    return { ok: true, result: { level } };
  });

  registerLensAction("game-design", "level-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.id);
    if (!level) return { ok: false, error: "level not found" };
    if (params.name != null) level.name = gdClean(params.name, 120) || level.name;
    if (params.orientation != null) level.orientation = gdPick(params.orientation, GD_ORIENTATIONS, level.orientation);
    level.updatedAt = gdNow();
    saveGdState();
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
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    if (level.layers.length >= 12) return { ok: false, error: "layer limit (12) reached" };
    const kind = gdPick(params.kind, GD_LAYER_KINDS, "tile");
    const layer = {
      id: gdId("lyr"), kind,
      name: gdClean(params.name, 60) || `${kind === "object" ? "Objects" : kind === "intgrid" ? "IntGrid" : "Layer"} ${level.layers.length + 1}`,
      visible: true, opacity: 1,
    };
    if (kind === "object") layer.objects = [];
    else if (kind === "intgrid") layer.tiles = new Array(level.cols * level.rows).fill(0);
    else layer.tiles = gdLayerTiles(level.cols, level.rows);
    level.layers.push(layer);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { layer } };
  });

  registerLensAction("game-design", "level-layer-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (params.name != null) layer.name = gdClean(params.name, 60) || layer.name;
    if (params.visible != null) layer.visible = !!params.visible;
    if (params.opacity != null) layer.opacity = gdClamp(params.opacity, 0, 1, layer.opacity);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { layerId: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity } };
  });

  registerLensAction("game-design", "level-layer-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    if (level.layers.length <= 1) return { ok: false, error: "a level needs at least one layer" };
    const i = level.layers.findIndex((l) => l.id === params.layerId);
    if (i < 0) return { ok: false, error: "layer not found" };
    level.layers.splice(i, 1);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { deleted: params.layerId } };
  });

  registerLensAction("game-design", "level-layer-duplicate", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    if (level.layers.length >= 12) return { ok: false, error: "layer limit (12) reached" };
    const src = level.layers.find((l) => l.id === params.layerId);
    if (!src) return { ok: false, error: "layer not found" };
    const copy = {
      id: gdId("lyr"), kind: src.kind, name: `${src.name} copy`,
      visible: src.visible, opacity: src.opacity,
    };
    if (src.kind === "object") {
      copy.objects = (src.objects || []).map((o) => ({ ...o, id: gdId("obj") }));
    } else {
      copy.tiles = [...(src.tiles || [])];
    }
    const i = level.layers.findIndex((l) => l.id === src.id);
    level.layers.splice(i + 1, 0, copy);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { layer: copy } };
  });

  // Reorder layers — params.order is the full ordered array of layer ids.
  registerLensAction("game-design", "level-layer-reorder", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const order = Array.isArray(params.order) ? params.order.map(String) : [];
    const byId = new Map(level.layers.map((l) => [l.id, l]));
    if (order.length !== level.layers.length || order.some((id) => !byId.has(id))) {
      return { ok: false, error: "order must list every layer id exactly once" };
    }
    level.layers = order.map((id) => byId.get(id));
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { order } };
  });

  // Resolve a paint value for a layer: tile layers get a tile id (or
  // null), intgrid layers get a clamped integer.
  function gdPaintValue(layer, validIds, raw) {
    if (layer.kind === "intgrid") return Math.round(gdClamp(raw, 0, 99, 0));
    return gdResolveTile(validIds, raw);
  }

  registerLensAction("game-design", "level-paint", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.kind === "object") return { ok: false, error: "object layers use level-object-* macros" };
    const index = Math.round(gdNum(params.index, -1));
    if (index < 0 || index >= layer.tiles.length) return { ok: false, error: "cell index out of range" };
    const validIds = gdValidTileIds(s, userId, level.gameId);
    const value = gdPaintValue(layer, validIds, params.tile);
    layer.tiles[index] = value;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { index, tile: value } };
  });

  registerLensAction("game-design", "level-paint-batch", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.kind === "object") return { ok: false, error: "object layers use level-object-* macros" };
    const validIds = gdValidTileIds(s, userId, level.gameId);
    const cells = Array.isArray(params.cells) ? params.cells : [];
    let painted = 0;
    for (const c of cells) {
      const index = Math.round(gdNum(c?.index, -1));
      if (index < 0 || index >= layer.tiles.length) continue;
      layer.tiles[index] = gdPaintValue(layer, validIds, c?.tile);
      painted += 1;
    }
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { painted } };
  });

  registerLensAction("game-design", "level-fill-layer", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.kind === "object") return { ok: false, error: "object layers use level-object-* macros" };
    const validIds = gdValidTileIds(s, userId, level.gameId);
    const value = gdPaintValue(layer, validIds, params.tile);
    layer.tiles = new Array(level.cols * level.rows).fill(value);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { filled: layer.id, tile: value } };
  });

  // ── Object instances (LDtk entity layers) ──────────────────────────
  registerLensAction("game-design", "level-object-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const layer = level.layers.find((l) => l.id === params.layerId);
    if (!layer) return { ok: false, error: "layer not found" };
    if (layer.kind !== "object") return { ok: false, error: "layer is not an object layer" };
    const obj = {
      id: gdId("obj"),
      name: gdClean(params.name, 80) || "Object",
      x: Math.round(gdNum(params.x)), y: Math.round(gdNum(params.y)),
      w: Math.round(gdClamp(params.w, 1, 4096, level.tileSize)),
      h: Math.round(gdClamp(params.h, 1, 4096, level.tileSize)),
      entityId: params.entityId ? String(params.entityId) : null,
      color: gdClean(params.color, 16) || "#a3e635",
      props: params.props && typeof params.props === "object" ? params.props : {},
    };
    layer.objects.push(obj);
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { object: obj } };
  });

  registerLensAction("game-design", "level-object-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    let obj = null;
    for (const l of level.layers) {
      if (l.kind !== "object") continue;
      const found = (l.objects || []).find((o) => o.id === params.id);
      if (found) { obj = found; break; }
    }
    if (!obj) return { ok: false, error: "object not found" };
    if (params.name != null) obj.name = gdClean(params.name, 80) || obj.name;
    if (params.x != null) obj.x = Math.round(gdNum(params.x));
    if (params.y != null) obj.y = Math.round(gdNum(params.y));
    if (params.w != null) obj.w = Math.round(gdClamp(params.w, 1, 4096, obj.w));
    if (params.h != null) obj.h = Math.round(gdClamp(params.h, 1, 4096, obj.h));
    if (params.entityId !== undefined) obj.entityId = params.entityId ? String(params.entityId) : null;
    if (params.color != null) obj.color = gdClean(params.color, 16) || obj.color;
    if (params.props && typeof params.props === "object") obj.props = params.props;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { object: obj } };
  });

  registerLensAction("game-design", "level-object-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    for (const l of level.layers) {
      if (l.kind !== "object") continue;
      const i = (l.objects || []).findIndex((o) => o.id === params.id);
      if (i >= 0) {
        l.objects.splice(i, 1);
        level.updatedAt = gdNow();
        saveGdState();
        return { ok: true, result: { deleted: params.id } };
      }
    }
    return { ok: false, error: "object not found" };
  });

  // ── Level resize / duplicate / export ──────────────────────────────
  registerLensAction("game-design", "level-resize", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const newCols = Math.round(gdClamp(params.cols, 4, 64, level.cols));
    const newRows = Math.round(gdClamp(params.rows, 4, 64, level.rows));
    for (const l of level.layers) {
      if (l.kind === "object") {
        const maxX = newCols * level.tileSize, maxY = newRows * level.tileSize;
        l.objects = (l.objects || []).filter((o) => o.x < maxX && o.y < maxY);
        continue;
      }
      const empty = l.kind === "intgrid" ? 0 : null;
      const next = new Array(newCols * newRows).fill(empty);
      for (let row = 0; row < Math.min(level.rows, newRows); row++) {
        for (let col = 0; col < Math.min(level.cols, newCols); col++) {
          next[row * newCols + col] = l.tiles[row * level.cols + col] ?? empty;
        }
      }
      l.tiles = next;
    }
    level.cols = newCols;
    level.rows = newRows;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { level } };
  });

  registerLensAction("game-design", "level-duplicate", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const src = gdFindLevel(s, userId, params.id);
    if (!src) return { ok: false, error: "level not found" };
    const copy = {
      id: gdId("lvl"), gameId: src.gameId,
      name: gdClean(params.name, 120) || `${src.name} copy`,
      cols: src.cols, rows: src.rows, tileSize: src.tileSize, orientation: src.orientation,
      layers: src.layers.map((l) => {
        const nl = { id: gdId("lyr"), kind: l.kind, name: l.name, visible: l.visible, opacity: l.opacity };
        if (l.kind === "object") nl.objects = (l.objects || []).map((o) => ({ ...o, id: gdId("obj") }));
        else nl.tiles = [...(l.tiles || [])];
        return nl;
      }),
      createdAt: gdNow(), updatedAt: gdNow(),
    };
    gdListB(s.levels, userId).push(copy);
    saveGdState();
    return { ok: true, result: { level: copy } };
  });

  registerLensAction("game-design", "level-export", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const level = gdFindLevel(s, gdAid(ctx), params.id);
    if (!level) return { ok: false, error: "level not found" };
    const map = {
      name: level.name, orientation: level.orientation,
      width: level.cols, height: level.rows, tileSize: level.tileSize,
      layers: level.layers.map((l) => {
        const base = { name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity };
        if (l.kind === "object") return { ...base, objects: l.objects || [] };
        return { ...base, data: l.tiles || [] };
      }),
    };
    return { ok: true, result: { map, json: JSON.stringify(map, null, 2) } };
  });

  // ── Auto-layer rules (LDtk AutoLayer) ──────────────────────────────
  registerLensAction("game-design", "autotile-rule-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const intValue = Math.round(gdClamp(params.intValue, 1, 99, 1));
    const validIds = gdValidTileIds(s, userId, params.gameId);
    const tile = gdResolveTile(validIds, params.tile);
    if (!tile) return { ok: false, error: "valid tile required" };
    const rule = { id: gdId("rul"), gameId: String(params.gameId), intValue, tile, createdAt: gdNow() };
    gdListB(s.autotileRules, userId).push(rule);
    saveGdState();
    return { ok: true, result: { rule } };
  });

  registerLensAction("game-design", "autotile-rule-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rules = (s.autotileRules.get(gdAid(ctx)) || []).filter((r) => r.gameId === String(params.gameId));
    return { ok: true, result: { rules, count: rules.length } };
  });

  registerLensAction("game-design", "autotile-rule-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.autotileRules.get(gdAid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "rule not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Generate a tile layer from an IntGrid layer by applying the game's
  // auto-layer rules. Fully regenerates the target (LDtk auto-layer model).
  registerLensAction("game-design", "level-autotile", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const source = level.layers.find((l) => l.id === params.sourceLayerId);
    const target = level.layers.find((l) => l.id === params.targetLayerId);
    if (!source || source.kind !== "intgrid") return { ok: false, error: "source must be an IntGrid layer" };
    if (!target || target.kind !== "tile") return { ok: false, error: "target must be a tile layer" };
    const rules = (s.autotileRules.get(userId) || []).filter((r) => r.gameId === level.gameId);
    const ruleByValue = new Map(rules.map((r) => [r.intValue, r.tile]));
    let painted = 0;
    const next = new Array(level.cols * level.rows).fill(null);
    for (let i = 0; i < source.tiles.length && i < next.length; i++) {
      const v = source.tiles[i];
      if (v && ruleByValue.has(v)) { next[i] = ruleByValue.get(v); painted += 1; }
    }
    target.tiles = next;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { painted, rulesApplied: rules.length } };
  });

  // ── Custom project tiles ───────────────────────────────────────────
  registerLensAction("game-design", "tile-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 60);
    if (!name) return { ok: false, error: "tile name required" };
    const tile = {
      id: gdId("tile"), gameId: String(params.gameId), name,
      color: gdClean(params.color, 16) || "#94a3b8",
      category: gdClean(params.category, 30) || "custom",
      createdAt: gdNow(),
    };
    gdListB(s.customTiles, userId).push(tile);
    saveGdState();
    return { ok: true, result: { tile } };
  });

  registerLensAction("game-design", "tile-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const custom = (s.customTiles.get(gdAid(ctx)) || []).filter((t) => t.gameId === String(params.gameId));
    return {
      ok: true,
      result: {
        builtin: GD_TILES,
        custom,
        all: [...GD_TILES, ...custom.map((t) => ({ id: t.id, name: t.name, color: t.color, category: t.category }))],
      },
    };
  });

  registerLensAction("game-design", "tile-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.customTiles.get(gdAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "tile not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── GDD reorder ─────────────────────────────────────────────────────
  registerLensAction("game-design", "gdd-reorder", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const sections = (s.gdd.get(userId) || []).filter((x) => x.gameId === String(params.gameId));
    const order = Array.isArray(params.order) ? params.order.map(String) : [];
    const byId = new Map(sections.map((x) => [x.id, x]));
    if (order.length !== sections.length || order.some((id) => !byId.has(id))) {
      return { ok: false, error: "order must list every section id exactly once" };
    }
    order.forEach((id, i) => { byId.get(id).order = i; });
    saveGdState();
    return { ok: true, result: { order } };
  });

  // ── Entity custom fields (LDtk entity fields) ──────────────────────
  registerLensAction("game-design", "entity-field-set", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entity = (s.entities.get(gdAid(ctx)) || []).find((x) => x.id === params.entityId);
    if (!entity) return { ok: false, error: "entity not found" };
    const key = gdClean(params.key, 60);
    if (!key) return { ok: false, error: "field key required" };
    const type = gdPick(params.type, GD_FIELD_TYPES, "string");
    let value = params.value;
    if (type === "int") value = Math.round(gdNum(value));
    else if (type === "float") value = gdNum(value);
    else if (type === "bool") value = !!value;
    else value = gdClean(value, 400);
    if (!Array.isArray(entity.fields)) entity.fields = [];
    const existing = entity.fields.find((f) => f.key === key);
    if (existing) { existing.type = type; existing.value = value; }
    else entity.fields.push({ key, type, value });
    saveGdState();
    return { ok: true, result: { fields: entity.fields } };
  });

  registerLensAction("game-design", "entity-field-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entity = (s.entities.get(gdAid(ctx)) || []).find((x) => x.id === params.entityId);
    if (!entity || !Array.isArray(entity.fields)) return { ok: false, error: "entity not found" };
    const i = entity.fields.findIndex((f) => f.key === params.key);
    if (i < 0) return { ok: false, error: "field not found" };
    entity.fields.splice(i, 1);
    saveGdState();
    return { ok: true, result: { fields: entity.fields } };
  });

  // ── Enums (LDtk enums) ──────────────────────────────────────────────
  registerLensAction("game-design", "enum-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 60);
    if (!name) return { ok: false, error: "enum name required" };
    const values = Array.isArray(params.values)
      ? [...new Set(params.values.map((v) => gdClean(v, 60)).filter(Boolean))].slice(0, 64)
      : [];
    const en = { id: gdId("enm"), gameId: String(params.gameId), name, values, createdAt: gdNow() };
    gdListB(s.enums, userId).push(en);
    saveGdState();
    return { ok: true, result: { enum: en } };
  });

  registerLensAction("game-design", "enum-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const enums = (s.enums.get(gdAid(ctx)) || []).filter((e) => e.gameId === String(params.gameId));
    return { ok: true, result: { enums, count: enums.length } };
  });

  registerLensAction("game-design", "enum-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.enums.get(gdAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "enum not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Core-loop modelling (Machinations) ─────────────────────────────
  registerLensAction("game-design", "loop-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "loop name required" };
    const loop = {
      id: gdId("loop"), gameId: String(params.gameId), name,
      kind: gdPick(params.kind, GD_LOOP_KINDS, "core"),
      description: gdClean(params.description, 600) || null,
      steps: [], createdAt: gdNow(),
    };
    gdListB(s.loops, userId).push(loop);
    saveGdState();
    return { ok: true, result: { loop } };
  });

  registerLensAction("game-design", "loop-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const loops = (s.loops.get(gdAid(ctx)) || []).filter((l) => l.gameId === String(params.gameId));
    return { ok: true, result: { loops, count: loops.length } };
  });

  registerLensAction("game-design", "loop-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.loops.get(gdAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "loop not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("game-design", "loop-step-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const loop = (s.loops.get(gdAid(ctx)) || []).find((l) => l.id === params.loopId);
    if (!loop) return { ok: false, error: "loop not found" };
    const label = gdClean(params.label, 160);
    if (!label) return { ok: false, error: "step label required" };
    const step = { id: gdId("stp"), label, delta: gdNum(params.delta, 0), resource: gdClean(params.resource, 40) || null };
    loop.steps.push(step);
    saveGdState();
    return { ok: true, result: { step } };
  });

  registerLensAction("game-design", "loop-step-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const loop = (s.loops.get(gdAid(ctx)) || []).find((l) => l.id === params.loopId);
    if (!loop) return { ok: false, error: "loop not found" };
    const i = loop.steps.findIndex((x) => x.id === params.stepId);
    if (i < 0) return { ok: false, error: "step not found" };
    loop.steps.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.stepId } };
  });

  // Per-loop net resource delta and a balance verdict.
  registerLensAction("game-design", "loop-analysis", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const loops = (s.loops.get(gdAid(ctx)) || []).filter((l) => l.gameId === String(params.gameId));
    if (loops.length === 0) return { ok: true, result: { message: "Model core loops to analyse balance.", loops: [] } };
    const analysed = loops.map((l) => {
      const net = l.steps.reduce((acc, st) => acc + gdNum(st.delta, 0), 0);
      let verdict;
      if (Math.abs(net) < 0.5) verdict = "balanced";
      else if (net > 0) verdict = l.kind === "negative" ? "leaky — drains expected, gains net" : "rewarding";
      else verdict = l.kind === "positive" ? "stalling — should net gains" : "draining";
      return { id: l.id, name: l.name, kind: l.kind, steps: l.steps.length, netDelta: Math.round(net * 100) / 100, verdict };
    });
    const unbalanced = analysed.filter((a) => a.verdict.includes("—")).length;
    return {
      ok: true,
      result: {
        loops: analysed, totalLoops: analysed.length, unbalanced,
        health: unbalanced === 0 ? "all loops resolve cleanly" : `${unbalanced} loop(s) need rebalancing`,
      },
    };
  });

  // ── Narrative branching (Twine / articy) ───────────────────────────
  registerLensAction("game-design", "narrative-node-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const title = gdClean(params.title, 160);
    if (!title) return { ok: false, error: "node title required" };
    const node = {
      id: gdId("nar"), gameId: String(params.gameId), title,
      kind: gdPick(params.kind, GD_NARRATIVE_KINDS, "scene"),
      body: gdClean(params.body, 4000) || "",
      x: Math.round(gdNum(params.x)), y: Math.round(gdNum(params.y)),
      createdAt: gdNow(),
    };
    gdListB(s.narrativeNodes, userId).push(node);
    saveGdState();
    return { ok: true, result: { node } };
  });

  registerLensAction("game-design", "narrative-node-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const nodes = (s.narrativeNodes.get(userId) || []).filter((n) => n.gameId === String(params.gameId));
    const links = (s.narrativeLinks.get(userId) || []).filter((l) => l.gameId === String(params.gameId));
    return { ok: true, result: { nodes, links } };
  });

  registerLensAction("game-design", "narrative-node-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const node = (s.narrativeNodes.get(gdAid(ctx)) || []).find((n) => n.id === params.id);
    if (!node) return { ok: false, error: "node not found" };
    if (params.title != null) node.title = gdClean(params.title, 160) || node.title;
    if (params.kind != null) node.kind = gdPick(params.kind, GD_NARRATIVE_KINDS, node.kind);
    if (params.body != null) node.body = gdClean(params.body, 4000);
    if (params.x != null) node.x = Math.round(gdNum(params.x));
    if (params.y != null) node.y = Math.round(gdNum(params.y));
    saveGdState();
    return { ok: true, result: { node } };
  });

  registerLensAction("game-design", "narrative-node-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const arr = s.narrativeNodes.get(userId) || [];
    const i = arr.findIndex((n) => n.id === params.id);
    if (i < 0) return { ok: false, error: "node not found" };
    arr.splice(i, 1);
    const links = s.narrativeLinks.get(userId);
    if (links) s.narrativeLinks.set(userId, links.filter((l) => l.fromId !== params.id && l.toId !== params.id));
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("game-design", "narrative-link-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const nodes = (s.narrativeNodes.get(userId) || []);
    const from = nodes.find((n) => n.id === params.fromId);
    const to = nodes.find((n) => n.id === params.toId);
    if (!from || !to) return { ok: false, error: "both nodes must exist" };
    if (from.gameId !== to.gameId) return { ok: false, error: "nodes belong to different games" };
    if (from.id === to.id) return { ok: false, error: "a node cannot link to itself" };
    const link = {
      id: gdId("lnk"), gameId: from.gameId,
      fromId: from.id, toId: to.id,
      label: gdClean(params.label, 160) || "continue",
    };
    gdListB(s.narrativeLinks, userId).push(link);
    saveGdState();
    return { ok: true, result: { link } };
  });

  registerLensAction("game-design", "narrative-link-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.narrativeLinks.get(gdAid(ctx)) || [];
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "link not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // Reachability / structure analysis of the narrative graph.
  registerLensAction("game-design", "narrative-graph", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const nodes = (s.narrativeNodes.get(userId) || []).filter((n) => n.gameId === String(params.gameId));
    const links = (s.narrativeLinks.get(userId) || []).filter((l) => l.gameId === String(params.gameId));
    if (nodes.length === 0) return { ok: true, result: { message: "Add narrative nodes to map the story graph.", totalNodes: 0 } };
    const out = new Map(nodes.map((n) => [n.id, []]));
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    for (const l of links) {
      if (out.has(l.fromId)) out.get(l.fromId).push(l.toId);
      if (indeg.has(l.toId)) indeg.set(l.toId, indeg.get(l.toId) + 1);
    }
    const starts = nodes.filter((n) => n.kind === "start" || indeg.get(n.id) === 0);
    const endings = nodes.filter((n) => n.kind === "ending" || out.get(n.id).length === 0);
    const orphans = nodes.filter((n) => indeg.get(n.id) === 0 && out.get(n.id).length === 0);
    // BFS reachability + depth from the start set.
    const seen = new Set();
    let depth = 0;
    let frontier = starts.map((n) => n.id);
    for (const id of frontier) seen.add(id);
    while (frontier.length) {
      const next = [];
      for (const id of frontier) {
        for (const t of out.get(id) || []) if (!seen.has(t)) { seen.add(t); next.push(t); }
      }
      if (next.length) depth += 1;
      frontier = next;
    }
    const unreachable = nodes.filter((n) => !seen.has(n.id)).map((n) => n.title);
    return {
      ok: true,
      result: {
        totalNodes: nodes.length, totalLinks: links.length,
        starts: starts.length, endings: endings.length,
        orphans: orphans.map((n) => n.title),
        unreachable, maxDepth: depth,
        avgChoicesPerNode: Math.round((links.length / nodes.length) * 10) / 10,
        replayValue: endings.length >= 3 ? "high" : endings.length >= 2 ? "moderate" : "low",
        health: unreachable.length === 0 && orphans.length === 0
          ? "every node is reachable"
          : `${unreachable.length} unreachable · ${orphans.length} orphaned`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Entity balance report ──────────────────────────────────────────
  registerLensAction("game-design", "balance-report", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const entities = (s.entities.get(userId) || []).filter((e) => e.gameId === String(params.gameId));
    if (entities.length === 0) return { ok: true, result: { message: "Add entities to generate a balance report.", entities: 0 } };
    const stat = (arr, key) => {
      const vals = arr.map((e) => gdNum(e[key]));
      if (!vals.length) return { min: 0, max: 0, avg: 0 };
      const sum = vals.reduce((a, b) => a + b, 0);
      return { min: Math.min(...vals), max: Math.max(...vals), avg: Math.round((sum / vals.length) * 10) / 10 };
    };
    const byKind = {};
    for (const k of GD_ENTITY_KINDS) {
      const grp = entities.filter((e) => e.kind === k);
      if (grp.length) byKind[k] = { count: grp.length, health: stat(grp, "health"), damage: stat(grp, "damage"), speed: stat(grp, "speed") };
    }
    const combat = entities.filter((e) => e.kind === "enemy" || e.kind === "boss");
    const hp = stat(combat, "health");
    const outliers = combat
      .filter((e) => hp.avg > 0 && (gdNum(e.health) > hp.avg * 2.5 || gdNum(e.damage) > stat(combat, "damage").avg * 2.5))
      .map((e) => e.name);
    const bossCount = entities.filter((e) => e.kind === "boss").length;
    const enemyCount = entities.filter((e) => e.kind === "enemy").length;
    return {
      ok: true,
      result: {
        entities: entities.length, byKind,
        combatHealth: hp, combatDamage: stat(combat, "damage"),
        outliers,
        difficultyBand: enemyCount === 0 ? "no-enemies"
          : bossCount / Math.max(1, enemyCount) > 0.4 ? "boss-heavy"
            : bossCount === 0 ? "no-bosses" : "balanced",
        verdict: outliers.length === 0 ? "stat spread is even" : `${outliers.length} entity(ies) sit far above the curve`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Whole-project JSON export ──────────────────────────────────────
  registerLensAction("game-design", "game-export", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const game = gdGame(s, userId, params.gameId);
    if (!game) return { ok: false, error: "game not found" };
    const f = (k) => (s[k].get(userId) || []).filter((x) => x.gameId === game.id);
    const project = {
      game,
      gdd: f("gdd").sort((a, b) => a.order - b.order),
      mechanics: f("mechanics"),
      loops: f("loops"),
      entities: f("entities"),
      enums: f("enums"),
      customTiles: f("customTiles"),
      autotileRules: f("autotileRules"),
      narrative: { nodes: f("narrativeNodes"), links: f("narrativeLinks") },
      levels: f("levels").map(gdNormalizeLevel),
      exportedAt: gdNow(),
    };
    return { ok: true, result: { project, json: JSON.stringify(project, null, 2) } };
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
        loops: (s.loops.get(userId) || []).filter((x) => x.gameId === game.id).length,
        entities: (s.entities.get(userId) || []).filter((x) => x.gameId === game.id).length,
        levels: (s.levels.get(userId) || []).filter((x) => x.gameId === game.id).length,
        narrativeNodes: (s.narrativeNodes.get(userId) || []).filter((x) => x.gameId === game.id).length,
        mechanicsByCategory: byCategory,
      },
    };
  });

  // ════════════════════════════════════════════════════════════════════
  // Feature-parity backlog — runtime, assets, collision, animation,
  // visual scripting, playtest analytics, collaborative editing.
  // ════════════════════════════════════════════════════════════════════

  // ── 1. Playable runtime — compile a level into a runnable scene ─────
  // Walks the level's layers + the game's entities and produces a
  // deterministic, JSON-serialisable runtime scene: a spawn point, a
  // solid-cell collision grid (from intgrid + collision config),
  // placed actors (object instances bound to entities), and the
  // mechanics/loops the runtime should advertise. The frontend renders
  // and steps this scene on a <canvas> — no engine code on the server.
  registerLensAction("game-design", "runtime-compile", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const game = gdGame(s, userId, level.gameId);
    if (!game) return { ok: false, error: "game not found" };
    const cellCount = level.cols * level.rows;
    // Collision: a cell is solid if any collision-flagged source marks it.
    const collisionLayer = (s.levels.get(userId) || [])
      .find((l) => l.id === level.id);
    const solid = new Array(cellCount).fill(false);
    const hazard = new Array(cellCount).fill(false);
    const cfg = (collisionLayer && collisionLayer.collision) || {};
    // intgrid layers: value 1..99 → solid if listed in cfg.solidInts
    const solidInts = new Set((Array.isArray(cfg.solidInts) ? cfg.solidInts : []).map((v) => Math.round(gdNum(v))));
    const hazardInts = new Set((Array.isArray(cfg.hazardInts) ? cfg.hazardInts : []).map((v) => Math.round(gdNum(v))));
    // tile ids: solid if listed in cfg.solidTiles
    const solidTiles = new Set((Array.isArray(cfg.solidTiles) ? cfg.solidTiles : []).map(String));
    const hazardTiles = new Set((Array.isArray(cfg.hazardTiles) ? cfg.hazardTiles : []).map(String));
    for (const ly of level.layers) {
      if (ly.kind === "object") continue;
      const arr = ly.tiles || [];
      for (let i = 0; i < arr.length && i < cellCount; i++) {
        const v = arr[i];
        if (v == null || v === 0) continue;
        if (ly.kind === "intgrid") {
          if (solidInts.has(Math.round(gdNum(v)))) solid[i] = true;
          if (hazardInts.has(Math.round(gdNum(v)))) hazard[i] = true;
        } else {
          if (solidTiles.has(String(v))) solid[i] = true;
          if (hazardTiles.has(String(v))) hazard[i] = true;
        }
      }
    }
    // Actors: every object that resolves to an entity (or any object).
    const entities = (s.entities.get(userId) || []).filter((e) => e.gameId === game.id);
    const entById = new Map(entities.map((e) => [e.id, e]));
    const actors = [];
    let spawn = null;
    for (const ly of level.layers) {
      if (ly.kind !== "object") continue;
      for (const o of ly.objects || []) {
        const ent = o.entityId ? entById.get(o.entityId) : null;
        const actor = {
          id: o.id, name: o.name,
          x: o.x, y: o.y, w: o.w, h: o.h,
          kind: ent ? ent.kind : "prop",
          health: ent ? ent.health : 0,
          damage: ent ? ent.damage : 0,
          speed: ent ? ent.speed : 0,
          entityId: o.entityId || null,
          color: o.color,
        };
        actors.push(actor);
        if ((ent && ent.kind === "player") && !spawn) spawn = { x: o.x, y: o.y };
      }
    }
    // Spawn fallback: first non-solid cell.
    if (!spawn) {
      let idx = solid.findIndex((v) => !v);
      if (idx < 0) idx = 0;
      spawn = { x: (idx % level.cols) * level.tileSize, y: Math.floor(idx / level.cols) * level.tileSize };
    }
    const scene = {
      levelId: level.id, levelName: level.name, gameTitle: game.title,
      cols: level.cols, rows: level.rows, tileSize: level.tileSize,
      orientation: level.orientation,
      gravity: cfg.gravity != null ? gdClamp(cfg.gravity, 0, 4000, 980) : 980,
      tilemap: level.layers
        .filter((l) => l.kind === "tile")
        .map((l) => ({ name: l.name, opacity: l.opacity, data: l.tiles || [] })),
      collision: { solid, hazard, solidCount: solid.filter(Boolean).length, hazardCount: hazard.filter(Boolean).length },
      spawn,
      actors,
      mechanics: (s.mechanics.get(userId) || []).filter((m) => m.gameId === game.id).map((m) => m.name),
      compiledAt: gdNow(),
    };
    return { ok: true, result: { scene } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Collision / physics config on a level ──────────────────────────
  registerLensAction("game-design", "level-collision-get", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = (s.levels.get(userId) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const cfg = level.collision || {};
    return {
      ok: true,
      result: {
        collision: {
          gravity: cfg.gravity != null ? gdNum(cfg.gravity, 980) : 980,
          solidInts: Array.isArray(cfg.solidInts) ? cfg.solidInts : [],
          hazardInts: Array.isArray(cfg.hazardInts) ? cfg.hazardInts : [],
          solidTiles: Array.isArray(cfg.solidTiles) ? cfg.solidTiles : [],
          hazardTiles: Array.isArray(cfg.hazardTiles) ? cfg.hazardTiles : [],
        },
      },
    };
  });

  registerLensAction("game-design", "level-collision-set", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = (s.levels.get(userId) || []).find((l) => l.id === params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    const intList = (raw) => (Array.isArray(raw)
      ? [...new Set(raw.map((v) => Math.round(gdClamp(v, 0, 99, 0))).filter((v) => v >= 1))].slice(0, 99)
      : []);
    const tileList = (raw) => (Array.isArray(raw)
      ? [...new Set(raw.map((v) => gdClean(v, 40)).filter(Boolean))].slice(0, 99)
      : []);
    const cfg = level.collision || {};
    if (params.gravity != null) cfg.gravity = gdClamp(params.gravity, 0, 4000, 980);
    if (params.solidInts != null) cfg.solidInts = intList(params.solidInts);
    if (params.hazardInts != null) cfg.hazardInts = intList(params.hazardInts);
    if (params.solidTiles != null) cfg.solidTiles = tileList(params.solidTiles);
    if (params.hazardTiles != null) cfg.hazardTiles = tileList(params.hazardTiles);
    level.collision = cfg;
    level.updatedAt = gdNow();
    saveGdState();
    return { ok: true, result: { collision: cfg } };
  });

  // ── 2. Asset import pipeline ────────────────────────────────────────
  // Imports a user-supplied asset (a data URL or external URL the user
  // pasted) and registers it as a project asset. No content is fetched
  // or generated server-side — the user provides the source.
  const GD_ASSET_KINDS = ["sprite", "tileset", "audio", "texture", "font", "other"];
  registerLensAction("game-design", "asset-import", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "asset name required" };
    const src = String(params.src == null ? "" : params.src).trim();
    if (!src) return { ok: false, error: "asset src (data URL or URL) required" };
    if (src.length > 4_000_000) return { ok: false, error: "asset src exceeds 4MB limit" };
    const isData = src.startsWith("data:");
    const isUrl = /^https?:\/\//i.test(src);
    if (!isData && !isUrl) return { ok: false, error: "src must be a data URL or http(s) URL" };
    const asset = {
      id: gdId("ast"), gameId: String(params.gameId), name,
      kind: gdPick(params.kind, GD_ASSET_KINDS, "sprite"),
      src, sourceType: isData ? "embedded" : "linked",
      width: Math.max(0, Math.round(gdNum(params.width))),
      height: Math.max(0, Math.round(gdNum(params.height))),
      frameW: Math.max(0, Math.round(gdNum(params.frameW))),
      frameH: Math.max(0, Math.round(gdNum(params.frameH))),
      tags: Array.isArray(params.tags)
        ? [...new Set(params.tags.map((t) => gdClean(t, 30)).filter(Boolean))].slice(0, 12)
        : [],
      bytes: isData ? src.length : 0,
      createdAt: gdNow(),
    };
    gdListB(s.assets, userId).push(asset);
    saveGdState();
    return { ok: true, result: { asset } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("game-design", "asset-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const assets = (s.assets.get(gdAid(ctx)) || []).filter((a) => a.gameId === String(params.gameId));
    const byKind = {};
    for (const k of GD_ASSET_KINDS) {
      const n = assets.filter((a) => a.kind === k).length;
      if (n) byKind[k] = n;
    }
    return { ok: true, result: { assets, count: assets.length, byKind } };
  });

  registerLensAction("game-design", "asset-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const asset = (s.assets.get(gdAid(ctx)) || []).find((a) => a.id === params.id);
    if (!asset) return { ok: false, error: "asset not found" };
    if (params.name != null) asset.name = gdClean(params.name, 120) || asset.name;
    if (params.kind != null) asset.kind = gdPick(params.kind, GD_ASSET_KINDS, asset.kind);
    if (params.frameW != null) asset.frameW = Math.max(0, Math.round(gdNum(params.frameW)));
    if (params.frameH != null) asset.frameH = Math.max(0, Math.round(gdNum(params.frameH)));
    if (params.width != null) asset.width = Math.max(0, Math.round(gdNum(params.width)));
    if (params.height != null) asset.height = Math.max(0, Math.round(gdNum(params.height)));
    if (Array.isArray(params.tags)) {
      asset.tags = [...new Set(params.tags.map((t) => gdClean(t, 30)).filter(Boolean))].slice(0, 12);
    }
    saveGdState();
    return { ok: true, result: { asset } };
  });

  registerLensAction("game-design", "asset-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.assets.get(gdAid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "asset not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── 3. Animation timeline for entities / sprites ────────────────────
  // An animation is a named clip on a game: an ordered list of frames,
  // each a {assetId?, frameIndex, durationMs} keyframe. Frames index a
  // sprite-sheet asset (or are abstract). Loop + fps metadata included.
  registerLensAction("game-design", "animation-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "animation name required" };
    const anim = {
      id: gdId("anm"), gameId: String(params.gameId), name,
      entityId: params.entityId ? String(params.entityId) : null,
      assetId: params.assetId ? String(params.assetId) : null,
      loop: params.loop == null ? true : !!params.loop,
      fps: Math.round(gdClamp(params.fps, 1, 60, 12)),
      frames: [],
      createdAt: gdNow(),
    };
    gdListB(s.animations, userId).push(anim);
    saveGdState();
    return { ok: true, result: { animation: anim } };
  });

  registerLensAction("game-design", "animation-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const animations = (s.animations.get(gdAid(ctx)) || []).filter((a) => a.gameId === String(params.gameId));
    return { ok: true, result: { animations, count: animations.length } };
  });

  registerLensAction("game-design", "animation-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = (s.animations.get(gdAid(ctx)) || []).find((a) => a.id === params.id);
    if (!anim) return { ok: false, error: "animation not found" };
    if (params.name != null) anim.name = gdClean(params.name, 120) || anim.name;
    if (params.entityId !== undefined) anim.entityId = params.entityId ? String(params.entityId) : null;
    if (params.assetId !== undefined) anim.assetId = params.assetId ? String(params.assetId) : null;
    if (params.loop != null) anim.loop = !!params.loop;
    if (params.fps != null) anim.fps = Math.round(gdClamp(params.fps, 1, 60, anim.fps));
    saveGdState();
    return { ok: true, result: { animation: anim } };
  });

  registerLensAction("game-design", "animation-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.animations.get(gdAid(ctx)) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "animation not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("game-design", "animation-frame-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = (s.animations.get(gdAid(ctx)) || []).find((a) => a.id === params.animationId);
    if (!anim) return { ok: false, error: "animation not found" };
    if (anim.frames.length >= 256) return { ok: false, error: "frame limit (256) reached" };
    const frame = {
      id: gdId("frm"),
      frameIndex: Math.max(0, Math.round(gdNum(params.frameIndex))),
      durationMs: Math.round(gdClamp(params.durationMs, 16, 10000, Math.round(1000 / anim.fps))),
    };
    const at = params.at != null ? Math.round(gdClamp(params.at, 0, anim.frames.length, anim.frames.length)) : anim.frames.length;
    anim.frames.splice(at, 0, frame);
    saveGdState();
    return { ok: true, result: { frame, frames: anim.frames } };
  });

  registerLensAction("game-design", "animation-frame-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = (s.animations.get(gdAid(ctx)) || []).find((a) => a.id === params.animationId);
    if (!anim) return { ok: false, error: "animation not found" };
    const frame = anim.frames.find((f) => f.id === params.frameId);
    if (!frame) return { ok: false, error: "frame not found" };
    if (params.frameIndex != null) frame.frameIndex = Math.max(0, Math.round(gdNum(params.frameIndex)));
    if (params.durationMs != null) frame.durationMs = Math.round(gdClamp(params.durationMs, 16, 10000, frame.durationMs));
    saveGdState();
    return { ok: true, result: { frame } };
  });

  registerLensAction("game-design", "animation-frame-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = (s.animations.get(gdAid(ctx)) || []).find((a) => a.id === params.animationId);
    if (!anim) return { ok: false, error: "animation not found" };
    const i = anim.frames.findIndex((f) => f.id === params.frameId);
    if (i < 0) return { ok: false, error: "frame not found" };
    anim.frames.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.frameId, frames: anim.frames } };
  });

  // Reorder frames — params.order is the full ordered array of frame ids.
  registerLensAction("game-design", "animation-frame-reorder", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const anim = (s.animations.get(gdAid(ctx)) || []).find((a) => a.id === params.animationId);
    if (!anim) return { ok: false, error: "animation not found" };
    const order = Array.isArray(params.order) ? params.order.map(String) : [];
    const byId = new Map(anim.frames.map((f) => [f.id, f]));
    if (order.length !== anim.frames.length || order.some((id) => !byId.has(id))) {
      return { ok: false, error: "order must list every frame id exactly once" };
    }
    anim.frames = order.map((id) => byId.get(id));
    saveGdState();
    return { ok: true, result: { order } };
  });

  // ── 4. Visual scripting for entity behavior ─────────────────────────
  // A behavior is a list of trigger→action rules ("event sheets" in
  // GDevelop / Construct terms). Each rule has a trigger (an event the
  // runtime fires) and an action with parameters. The runtime walks
  // these rules deterministically.
  const GD_VS_TRIGGERS = ["on-spawn", "on-tick", "on-collide", "on-key", "on-timer", "on-damage", "on-death", "on-trigger-zone"];
  const GD_VS_ACTIONS = ["move", "jump", "set-velocity", "spawn-entity", "destroy-self", "apply-damage", "set-variable", "play-animation", "emit-event", "wait"];
  registerLensAction("game-design", "behavior-create", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    const name = gdClean(params.name, 120);
    if (!name) return { ok: false, error: "behavior name required" };
    const behavior = {
      id: gdId("bhv"), gameId: String(params.gameId), name,
      entityId: params.entityId ? String(params.entityId) : null,
      rules: [],
      createdAt: gdNow(),
    };
    gdListB(s.behaviors, userId).push(behavior);
    saveGdState();
    return { ok: true, result: { behavior } };
  });

  registerLensAction("game-design", "behavior-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const behaviors = (s.behaviors.get(gdAid(ctx)) || []).filter((b) => b.gameId === String(params.gameId));
    return {
      ok: true,
      result: { behaviors, count: behaviors.length, triggers: GD_VS_TRIGGERS, actions: GD_VS_ACTIONS },
    };
  });

  registerLensAction("game-design", "behavior-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const behavior = (s.behaviors.get(gdAid(ctx)) || []).find((b) => b.id === params.id);
    if (!behavior) return { ok: false, error: "behavior not found" };
    if (params.name != null) behavior.name = gdClean(params.name, 120) || behavior.name;
    if (params.entityId !== undefined) behavior.entityId = params.entityId ? String(params.entityId) : null;
    saveGdState();
    return { ok: true, result: { behavior } };
  });

  registerLensAction("game-design", "behavior-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.behaviors.get(gdAid(ctx)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "behavior not found" };
    arr.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("game-design", "behavior-rule-add", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const behavior = (s.behaviors.get(gdAid(ctx)) || []).find((b) => b.id === params.behaviorId);
    if (!behavior) return { ok: false, error: "behavior not found" };
    if (behavior.rules.length >= 64) return { ok: false, error: "rule limit (64) reached" };
    if (!GD_VS_TRIGGERS.includes(String(params.trigger))) return { ok: false, error: "unknown trigger" };
    if (!GD_VS_ACTIONS.includes(String(params.action))) return { ok: false, error: "unknown action" };
    const rule = {
      id: gdId("rul"),
      trigger: String(params.trigger),
      action: String(params.action),
      triggerParam: gdClean(params.triggerParam, 80) || null,
      params: params.params && typeof params.params === "object" ? params.params : {},
      enabled: params.enabled == null ? true : !!params.enabled,
    };
    behavior.rules.push(rule);
    saveGdState();
    return { ok: true, result: { rule, rules: behavior.rules } };
  });

  registerLensAction("game-design", "behavior-rule-update", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const behavior = (s.behaviors.get(gdAid(ctx)) || []).find((b) => b.id === params.behaviorId);
    if (!behavior) return { ok: false, error: "behavior not found" };
    const rule = behavior.rules.find((r) => r.id === params.ruleId);
    if (!rule) return { ok: false, error: "rule not found" };
    if (params.trigger != null && GD_VS_TRIGGERS.includes(String(params.trigger))) rule.trigger = String(params.trigger);
    if (params.action != null && GD_VS_ACTIONS.includes(String(params.action))) rule.action = String(params.action);
    if (params.triggerParam !== undefined) rule.triggerParam = gdClean(params.triggerParam, 80) || null;
    if (params.params && typeof params.params === "object") rule.params = params.params;
    if (params.enabled != null) rule.enabled = !!params.enabled;
    saveGdState();
    return { ok: true, result: { rule } };
  });

  registerLensAction("game-design", "behavior-rule-delete", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const behavior = (s.behaviors.get(gdAid(ctx)) || []).find((b) => b.id === params.behaviorId);
    if (!behavior) return { ok: false, error: "behavior not found" };
    const i = behavior.rules.findIndex((r) => r.id === params.ruleId);
    if (i < 0) return { ok: false, error: "rule not found" };
    behavior.rules.splice(i, 1);
    saveGdState();
    return { ok: true, result: { deleted: params.ruleId, rules: behavior.rules } };
  });

  // ── 5. Playtest analytics ingestion (balance loop closure) ─────────
  // A playtest run records real outcomes from playing a level — the
  // frontend runtime reports these after a session. The macro stores
  // them; playtest-report aggregates real runs into balance verdicts.
  registerLensAction("game-design", "playtest-record", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const game = gdGame(s, userId, params.gameId);
    if (!game) return { ok: false, error: "game not found" };
    if (params.levelId && !gdFindLevel(s, userId, params.levelId)) return { ok: false, error: "level not found" };
    const outcome = gdPick(params.outcome, ["completed", "died", "quit", "timeout"], "quit");
    const run = {
      id: gdId("pty"), gameId: String(params.gameId),
      levelId: params.levelId ? String(params.levelId) : null,
      outcome,
      durationMs: Math.max(0, Math.round(gdNum(params.durationMs))),
      deaths: Math.max(0, Math.round(gdNum(params.deaths))),
      damageDealt: Math.max(0, Math.round(gdNum(params.damageDealt))),
      damageTaken: Math.max(0, Math.round(gdNum(params.damageTaken))),
      collected: Math.max(0, Math.round(gdNum(params.collected))),
      furthestX: Math.max(0, Math.round(gdNum(params.furthestX))),
      note: gdClean(params.note, 400) || null,
      recordedAt: gdNow(),
    };
    gdListB(s.playtests, userId).push(run);
    saveGdState();
    return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("game-design", "playtest-list", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let runs = (s.playtests.get(gdAid(ctx)) || []).filter((r) => r.gameId === String(params.gameId));
    if (params.levelId) runs = runs.filter((r) => r.levelId === String(params.levelId));
    return { ok: true, result: { runs: runs.slice(-200), count: runs.length } };
  });

  registerLensAction("game-design", "playtest-clear", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const all = s.playtests.get(userId) || [];
    const before = all.length;
    const kept = all.filter((r) => r.gameId !== String(params.gameId)
      || (params.levelId && r.levelId !== String(params.levelId)));
    s.playtests.set(userId, kept);
    saveGdState();
    return { ok: true, result: { cleared: before - kept.length } };
  });

  // Aggregate real playtest runs into a balance report — closes the
  // design → playtest → rebalance loop with measured data only.
  registerLensAction("game-design", "playtest-report", (ctx, _a, params = {}) => {
  try {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    if (!gdGame(s, userId, params.gameId)) return { ok: false, error: "game not found" };
    let runs = (s.playtests.get(userId) || []).filter((r) => r.gameId === String(params.gameId));
    if (params.levelId) runs = runs.filter((r) => r.levelId === String(params.levelId));
    if (runs.length === 0) {
      return { ok: true, result: { message: "No playtest runs recorded yet. Play a level to gather data.", runs: 0 } };
    }
    const n = runs.length;
    const completed = runs.filter((r) => r.outcome === "completed").length;
    const died = runs.filter((r) => r.outcome === "died").length;
    const quit = runs.filter((r) => r.outcome === "quit").length;
    const avg = (k) => Math.round(runs.reduce((acc, r) => acc + gdNum(r[k]), 0) / n);
    const completionRate = Math.round((completed / n) * 100);
    const sortedDur = runs.map((r) => r.durationMs).sort((a, b) => a - b);
    const medianDuration = sortedDur[Math.floor(sortedDur.length / 2)];
    let difficultyVerdict;
    if (completionRate >= 85) difficultyVerdict = "too-easy — almost everyone finishes";
    else if (completionRate >= 45) difficultyVerdict = "well-tuned — a fair completion rate";
    else if (completionRate >= 15) difficultyVerdict = "hard — most runs fail";
    else difficultyVerdict = "too-hard — almost nobody completes";
    const avgDeaths = avg("deaths");
    return {
      ok: true,
      result: {
        runs: n, completed, died, quit,
        completionRate,
        avgDurationMs: avg("durationMs"),
        medianDurationMs: medianDuration,
        avgDeaths,
        avgDamageDealt: avg("damageDealt"),
        avgDamageTaken: avg("damageTaken"),
        avgCollected: avg("collected"),
        avgFurthestX: avg("furthestX"),
        difficultyVerdict,
        rebalanceHint: completionRate < 15 ? "lower enemy damage or add checkpoints"
          : completionRate >= 85 ? "raise the challenge — add hazards or stronger enemies"
            : avgDeaths > 5 ? "many deaths despite completion — tighten the pacing"
              : "balance reads healthy from measured runs",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 6. Collaborative real-time level editing ───────────────────────
  // A collab session lets multiple participants share a level. Edits
  // are recorded as an ordered op log; clients poll since a cursor to
  // converge. Real participant ids only — no synthetic users.
  registerLensAction("game-design", "collab-open", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const level = gdFindLevel(s, userId, params.levelId);
    if (!level) return { ok: false, error: "level not found" };
    // One session per level per owner — reuse if already open.
    const list = gdListB(s.collabSessions, userId);
    let session = list.find((c) => c.levelId === level.id && c.open);
    if (!session) {
      session = {
        id: gdId("col"), levelId: level.id, gameId: level.gameId,
        ownerId: userId, open: true,
        participants: [{ id: userId, joinedAt: gdNow(), lastSeen: gdNow() }],
        ops: [], opSeq: 0,
        createdAt: gdNow(),
      };
      list.push(session);
    } else {
      const me = session.participants.find((p) => p.id === userId);
      if (me) me.lastSeen = gdNow();
      else session.participants.push({ id: userId, joinedAt: gdNow(), lastSeen: gdNow() });
    }
    saveGdState();
    return {
      ok: true,
      result: { sessionId: session.id, levelId: session.levelId, cursor: session.opSeq, participants: session.participants },
    };
  });

  function gdCollabSession(s, userId, sessionId) {
    return (s.collabSessions.get(userId) || []).find((c) => c.id === sessionId) || null;
  }

  registerLensAction("game-design", "collab-join", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    // Search every owner's sessions for this id (a collaborator is not
    // the owner of the session record).
    let session = null;
    for (const list of s.collabSessions.values()) {
      const found = list.find((c) => c.id === params.sessionId && c.open);
      if (found) { session = found; break; }
    }
    if (!session) return { ok: false, error: "session not found or closed" };
    const me = session.participants.find((p) => p.id === userId);
    if (me) me.lastSeen = gdNow();
    else session.participants.push({ id: userId, joinedAt: gdNow(), lastSeen: gdNow() });
    saveGdState();
    return {
      ok: true,
      result: { sessionId: session.id, levelId: session.levelId, cursor: session.opSeq, participants: session.participants },
    };
  });

  registerLensAction("game-design", "collab-push-op", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    let session = null;
    for (const list of s.collabSessions.values()) {
      const found = list.find((c) => c.id === params.sessionId && c.open);
      if (found) { session = found; break; }
    }
    if (!session) return { ok: false, error: "session not found or closed" };
    if (!session.participants.some((p) => p.id === userId)) {
      return { ok: false, error: "join the session before pushing ops" };
    }
    const kind = gdPick(params.kind, ["paint", "object", "layer", "resize", "note"], "paint");
    session.opSeq += 1;
    const op = {
      seq: session.opSeq, kind,
      authorId: userId,
      payload: params.payload && typeof params.payload === "object" ? params.payload : {},
      at: gdNow(),
    };
    session.ops.push(op);
    if (session.ops.length > 1000) session.ops = session.ops.slice(-1000);
    const me = session.participants.find((p) => p.id === userId);
    if (me) me.lastSeen = gdNow();
    saveGdState();
    return { ok: true, result: { seq: op.seq } };
  });

  registerLensAction("game-design", "collab-poll", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    let session = null;
    for (const list of s.collabSessions.values()) {
      const found = list.find((c) => c.id === params.sessionId);
      if (found) { session = found; break; }
    }
    if (!session) return { ok: false, error: "session not found" };
    const me = session.participants.find((p) => p.id === userId);
    if (me) me.lastSeen = gdNow();
    const since = Math.max(0, Math.round(gdNum(params.since)));
    const ops = session.ops.filter((o) => o.seq > since);
    // Active = seen in the last 60s.
    const cut = Date.now() - 60_000;
    const active = session.participants.filter((p) => new Date(p.lastSeen).getTime() >= cut);
    saveGdState();
    return {
      ok: true,
      result: {
        sessionId: session.id, levelId: session.levelId, open: session.open,
        cursor: session.opSeq, ops,
        participants: session.participants,
        activeParticipants: active.length,
      },
    };
  });

  registerLensAction("game-design", "collab-close", (ctx, _a, params = {}) => {
    const s = getGdState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = gdAid(ctx);
    const session = gdCollabSession(s, userId, params.sessionId);
    if (!session) return { ok: false, error: "session not found (only the owner can close)" };
    session.open = false;
    session.closedAt = gdNow();
    saveGdState();
    return { ok: true, result: { closed: session.id } };
  });
}
