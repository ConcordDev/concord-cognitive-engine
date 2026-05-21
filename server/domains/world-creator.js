// server/domains/world-creator.js
//
// World-Creator lens — authoring substrate for player-built sub-worlds.
//
// The REST `/api/worlds` route mints the world record itself (name +
// rule_modulators). This domain holds the *authoring* layer that route
// has no surface for: visual scene drafts (terrain + props), biome
// preview, spawn-points & zones, world templates, NPC/faction placement,
// rule-modulator editing of a draft, publish/privacy + discovery, and
// archive — everything Roblox Studio gives you before you hit "play".
//
// Drafts are kept per-user in globalThis._concordSTATE so a creator can
// iterate before committing to a real world record. Nothing here throws;
// every handler returns { ok, result?, error? }.

export default function registerWorldCreatorActions(registerLensAction) {
  // ---- state helpers -------------------------------------------------
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.worldCreatorLens) STATE.worldCreatorLens = {};
    const s = STATE.worldCreatorLens;
    for (const k of ["drafts"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const wcid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();
  const aid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const listB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const clamp = (v, lo, hi, d) => { const n = num(v, d); return Math.min(hi, Math.max(lo, n)); };
  const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const bool = (v) => v === true || v === "true" || v === 1;

  // ---- static reference data ----------------------------------------
  const BIOMES = {
    temperate_forest: { label: "Temperate Forest", temp: 14, humidity: 65, light: 70, palette: ["#2d5016", "#3a6b1f", "#6b8e3a", "#8fa86b"], hazard: "low", growth: 1.0 },
    desert:           { label: "Arid Desert",      temp: 38, humidity: 18, light: 95, palette: ["#c2986a", "#d4a96a", "#e8c98a", "#f0deb0"], hazard: "high", growth: 0.3 },
    tundra:           { label: "Frozen Tundra",    temp: -12, humidity: 45, light: 55, palette: ["#aebfc9", "#c7d4dc", "#e0e9ee", "#f4f8fa"], hazard: "high", growth: 0.4 },
    tropical:         { label: "Tropical Jungle",  temp: 28, humidity: 88, light: 60, palette: ["#0d3b16", "#1a5c28", "#2f8c3f", "#5cb85c"], hazard: "medium", growth: 1.6 },
    volcanic:         { label: "Volcanic Wastes",  temp: 52, humidity: 22, light: 40, palette: ["#1c1c1c", "#3a2218", "#6b2f15", "#c44016"], hazard: "extreme", growth: 0.2 },
    coastal:          { label: "Coastal Lowlands", temp: 20, humidity: 72, light: 80, palette: ["#1f6f8c", "#3a93a8", "#9bc4ce", "#e3cf9e"], hazard: "low", growth: 1.1 },
    grassland:        { label: "Open Grassland",   temp: 18, humidity: 50, light: 85, palette: ["#5a7a2e", "#7a9c45", "#a3bf6b", "#cdd99a"], hazard: "low", growth: 0.9 },
    alpine:           { label: "Alpine Highlands", temp: 4, humidity: 55, light: 75, palette: ["#5a6a72", "#7d8c92", "#a7b3b8", "#e6ecef"], hazard: "medium", growth: 0.6 },
  };

  const TEMPLATES = {
    forest_realm: {
      label: "Forest Realm", biome: "temperate_forest",
      description: "A balanced woodland starter — gentle combat, dense quests.",
      rules: { combatLethality: 0.8, refusalSensitivity: 1.0, questDensity: 1.3, weatherIntensity: 0.9 },
      props: [
        { kind: "tree", x: -20, z: 10 }, { kind: "tree", x: 14, z: -8 }, { kind: "tree", x: 30, z: 22 },
        { kind: "rock", x: 0, z: 0 }, { kind: "campfire", x: 5, z: 5 },
      ],
      spawnPoints: [{ name: "Grove Clearing", x: 0, z: 0 }],
      zones: [{ name: "Whispering Woods", kind: "safe", x: 0, z: 0, radius: 60 }],
    },
    desert_outpost: {
      label: "Desert Outpost", biome: "desert",
      description: "Scarce, lethal, frontier-styled — long travel, high stakes.",
      rules: { combatLethality: 1.4, refusalSensitivity: 1.1, questDensity: 0.7, weatherIntensity: 1.4 },
      props: [
        { kind: "rock", x: -15, z: 12 }, { kind: "rock", x: 22, z: -18 },
        { kind: "ruin", x: 0, z: 0 }, { kind: "well", x: 8, z: 4 },
      ],
      spawnPoints: [{ name: "Dune Camp", x: 0, z: 0 }],
      zones: [{ name: "Sunscorch Flats", kind: "hazard", x: 30, z: 30, radius: 80 }],
    },
    urban_sprawl: {
      label: "Urban Sprawl", biome: "grassland",
      description: "Dense city grid — social play, low lethality, packed quests.",
      rules: { combatLethality: 0.6, refusalSensitivity: 1.3, questDensity: 1.5, weatherIntensity: 0.8 },
      props: [
        { kind: "building", x: -25, z: 0 }, { kind: "building", x: 25, z: 0 },
        { kind: "building", x: 0, z: -25 }, { kind: "lamp", x: 10, z: 10 }, { kind: "lamp", x: -10, z: -10 },
      ],
      spawnPoints: [{ name: "Central Plaza", x: 0, z: 0 }],
      zones: [{ name: "Market District", kind: "social", x: 0, z: 0, radius: 70 }],
    },
  };

  const PROP_KINDS = ["tree", "rock", "building", "campfire", "well", "ruin", "lamp", "bridge", "statue", "fence", "crystal", "altar"];
  const ZONE_KINDS = ["safe", "hazard", "social", "combat", "quest", "neutral"];
  const NPC_ARCHETYPES = ["warrior", "scholar", "trader", "mystic", "guard", "healer", "hunter", "wanderer"];

  function defaultRules() {
    return { combatLethality: 1.0, refusalSensitivity: 1.0, questDensity: 1.0, weatherIntensity: 1.0 };
  }
  function clampRules(r = {}) {
    const out = defaultRules();
    for (const k of Object.keys(out)) {
      if (r[k] != null) out[k] = clamp(r[k], 0.5, 1.5, 1.0);
    }
    return out;
  }
  function findDraft(s, userId, id) {
    return (s.drafts.get(userId) || []).find((d) => d.id === id) || null;
  }

  // ---- F4: world templates ------------------------------------------
  registerLensAction("world-creator", "templates", (_ctx, _a, _params = {}) => {
    try {
      const templates = Object.entries(TEMPLATES).map(([id, t]) => ({
        id, label: t.label, biome: t.biome, biomeLabel: BIOMES[t.biome]?.label || t.biome,
        description: t.description, rules: t.rules,
        propCount: t.props.length, spawnCount: t.spawnPoints.length, zoneCount: t.zones.length,
      }));
      return { ok: true, result: { templates } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F2: biome / climate preview ----------------------------------
  registerLensAction("world-creator", "biomes", (_ctx, _a, _params = {}) => {
    try {
      const biomes = Object.entries(BIOMES).map(([id, b]) => ({
        id, label: b.label, temperatureC: b.temp, humidityPct: b.humidity,
        lightPct: b.light, palette: b.palette, hazard: b.hazard, growthMultiplier: b.growth,
      }));
      return { ok: true, result: { biomes } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "biome-preview", (_ctx, _a, params = {}) => {
    try {
      const id = clean(params.biome, 40);
      const b = BIOMES[id];
      if (!b) return { ok: false, error: `unknown biome: ${id}` };
      const weather = clamp(params.weatherIntensity, 0.5, 1.5, 1.0);
      // derive a day-cycle climate curve + a hazard forecast for the preview
      const hours = [0, 4, 8, 12, 16, 20];
      const climateCurve = hours.map((h) => {
        const solar = Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2));
        return {
          hour: h,
          temperatureC: Math.round((b.temp + solar * 8 - 4) * 10) / 10,
          lightPct: Math.round(b.light * (0.25 + solar * 0.75)),
        };
      });
      const hazardScore = ({ low: 1, medium: 2, high: 3, extreme: 4 })[b.hazard] || 1;
      const stormChancePct = Math.min(95, Math.round(hazardScore * 12 * weather));
      return {
        ok: true,
        result: {
          biome: id, label: b.label, palette: b.palette,
          baseTemperatureC: b.temp, baseHumidityPct: b.humidity, baseLightPct: b.light,
          hazard: b.hazard, growthMultiplier: b.growth,
          climateCurve, stormChancePct,
          summary: `${b.label}: ~${b.temp}°C, ${b.humidity}% humidity, ${b.hazard} hazard, ${stormChancePct}% storm chance.`,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- draft lifecycle (scene editor backing store) -----------------
  // F1 (scene editor), F3 (spawn/zones), F5 (NPC placement), F6 (rule edit)
  registerLensAction("world-creator", "draft-create", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = clean(params.name, 64);
      if (name.length < 3) return { ok: false, error: "world name must be ≥ 3 characters" };
      let biome = clean(params.biome, 40) || "temperate_forest";
      let rules = clampRules(params.rules);
      let props = [];
      let spawnPoints = [];
      let zones = [];
      const tplId = clean(params.template, 40);
      if (tplId && TEMPLATES[tplId]) {
        const t = TEMPLATES[tplId];
        biome = t.biome;
        rules = clampRules(t.rules);
        props = t.props.map((p) => ({ id: wcid("prop"), ...p, rotation: 0 }));
        spawnPoints = t.spawnPoints.map((sp) => ({ id: wcid("spawn"), ...sp }));
        zones = t.zones.map((z) => ({ id: wcid("zone"), ...z }));
      }
      const draft = {
        id: wcid("draft"), name,
        description: clean(params.description, 500),
        universeType: clean(params.universeType, 40) || "concordia-hub",
        template: tplId && TEMPLATES[tplId] ? tplId : null,
        biome, rules, props, spawnPoints, zones,
        npcs: [], factions: [],
        terrain: { seed: Math.floor(Math.random() * 1e6), roughness: 0.5, waterLevel: 0.3 },
        visibility: "private", // private | unlisted | public
        publishedWorldId: null,
        createdAt: now(), updatedAt: now(),
      };
      listB(s.drafts, aid(ctx)).push(draft);
      save();
      return { ok: true, result: { draft } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "draft-list", (ctx, _a, _params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const drafts = (s.drafts.get(aid(ctx)) || [])
        .map((d) => ({
          id: d.id, name: d.name, biome: d.biome, biomeLabel: BIOMES[d.biome]?.label || d.biome,
          universeType: d.universeType, template: d.template, visibility: d.visibility,
          publishedWorldId: d.publishedWorldId,
          propCount: d.props.length, npcCount: d.npcs.length, zoneCount: d.zones.length,
          spawnCount: d.spawnPoints.length, factionCount: d.factions.length,
          createdAt: d.createdAt, updatedAt: d.updatedAt,
        }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { ok: true, result: { drafts, count: drafts.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "draft-get", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.id, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      return { ok: true, result: { draft } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // F6: edit rule modulators / settings of a draft (and of an existing world)
  registerLensAction("world-creator", "draft-update", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.id, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      if (params.name != null) { const n = clean(params.name, 64); if (n.length >= 3) draft.name = n; }
      if (params.description != null) draft.description = clean(params.description, 500);
      if (params.universeType != null) draft.universeType = clean(params.universeType, 40);
      if (params.biome != null && BIOMES[clean(params.biome, 40)]) draft.biome = clean(params.biome, 40);
      if (params.rules != null) draft.rules = clampRules({ ...draft.rules, ...params.rules });
      if (params.terrain != null) {
        draft.terrain = {
          seed: Math.floor(num(params.terrain.seed, draft.terrain.seed)),
          roughness: clamp(params.terrain.roughness, 0, 1, draft.terrain.roughness),
          waterLevel: clamp(params.terrain.waterLevel, 0, 1, draft.terrain.waterLevel),
        };
      }
      draft.updatedAt = now();
      save();
      return { ok: true, result: { draft } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // F8: delete / archive a draft
  registerLensAction("world-creator", "draft-delete", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = s.drafts.get(aid(ctx)) || [];
      const i = arr.findIndex((d) => d.id === clean(params.id, 80));
      if (i < 0) return { ok: false, error: "draft not found" };
      const [removed] = arr.splice(i, 1);
      save();
      return { ok: true, result: { deleted: removed.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F1: scene editor — props -------------------------------------
  registerLensAction("world-creator", "prop-place", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const kind = clean(params.kind, 40);
      if (!PROP_KINDS.includes(kind)) return { ok: false, error: `unknown prop kind: ${kind}` };
      if (draft.props.length >= 500) return { ok: false, error: "prop limit (500) reached" };
      const prop = {
        id: wcid("prop"), kind,
        x: clamp(params.x, -250, 250, 0), z: clamp(params.z, -250, 250, 0),
        rotation: clamp(params.rotation, 0, 360, 0),
        scale: clamp(params.scale, 0.25, 4, 1),
      };
      draft.props.push(prop);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { prop, propCount: draft.props.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "prop-move", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const prop = draft.props.find((p) => p.id === clean(params.propId, 80));
      if (!prop) return { ok: false, error: "prop not found" };
      if (params.x != null) prop.x = clamp(params.x, -250, 250, prop.x);
      if (params.z != null) prop.z = clamp(params.z, -250, 250, prop.z);
      if (params.rotation != null) prop.rotation = clamp(params.rotation, 0, 360, prop.rotation);
      if (params.scale != null) prop.scale = clamp(params.scale, 0.25, 4, prop.scale);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { prop } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "prop-remove", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const i = draft.props.findIndex((p) => p.id === clean(params.propId, 80));
      if (i < 0) return { ok: false, error: "prop not found" };
      draft.props.splice(i, 1);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { removed: clean(params.propId, 80), propCount: draft.props.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F3: spawn points ---------------------------------------------
  registerLensAction("world-creator", "spawn-add", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const name = clean(params.name, 60) || `Spawn ${draft.spawnPoints.length + 1}`;
      if (draft.spawnPoints.length >= 32) return { ok: false, error: "spawn-point limit (32) reached" };
      const spawn = {
        id: wcid("spawn"), name,
        x: clamp(params.x, -250, 250, 0), z: clamp(params.z, -250, 250, 0),
        isDefault: bool(params.isDefault) || draft.spawnPoints.length === 0,
      };
      if (spawn.isDefault) draft.spawnPoints.forEach((sp) => { sp.isDefault = false; });
      draft.spawnPoints.push(spawn);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { spawn, spawnCount: draft.spawnPoints.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "spawn-remove", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const i = draft.spawnPoints.findIndex((sp) => sp.id === clean(params.spawnId, 80));
      if (i < 0) return { ok: false, error: "spawn point not found" };
      const wasDefault = draft.spawnPoints[i].isDefault;
      draft.spawnPoints.splice(i, 1);
      if (wasDefault && draft.spawnPoints.length) draft.spawnPoints[0].isDefault = true;
      draft.updatedAt = now();
      save();
      return { ok: true, result: { removed: clean(params.spawnId, 80), spawnCount: draft.spawnPoints.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F3: zones ----------------------------------------------------
  registerLensAction("world-creator", "zone-add", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const kind = clean(params.kind, 30);
      if (!ZONE_KINDS.includes(kind)) return { ok: false, error: `unknown zone kind: ${kind}` };
      if (draft.zones.length >= 48) return { ok: false, error: "zone limit (48) reached" };
      const zone = {
        id: wcid("zone"),
        name: clean(params.name, 60) || `${kind} zone`,
        kind,
        x: clamp(params.x, -250, 250, 0), z: clamp(params.z, -250, 250, 0),
        radius: clamp(params.radius, 5, 250, 40),
      };
      draft.zones.push(zone);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { zone, zoneCount: draft.zones.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "zone-remove", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const i = draft.zones.findIndex((z) => z.id === clean(params.zoneId, 80));
      if (i < 0) return { ok: false, error: "zone not found" };
      draft.zones.splice(i, 1);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { removed: clean(params.zoneId, 80), zoneCount: draft.zones.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F5: NPC / faction placement ----------------------------------
  registerLensAction("world-creator", "npc-place", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const name = clean(params.name, 60);
      if (!name) return { ok: false, error: "NPC name required" };
      const archetype = clean(params.archetype, 30);
      if (!NPC_ARCHETYPES.includes(archetype)) return { ok: false, error: `unknown archetype: ${archetype}` };
      if (draft.npcs.length >= 200) return { ok: false, error: "NPC limit (200) reached" };
      const npc = {
        id: wcid("npc"), name, archetype,
        x: clamp(params.x, -250, 250, 0), z: clamp(params.z, -250, 250, 0),
        backstory: clean(params.backstory, 600),
        factionId: clean(params.factionId, 80) || null,
        level: clamp(params.level, 1, 100, 1),
      };
      if (npc.factionId && !draft.factions.some((f) => f.id === npc.factionId)) npc.factionId = null;
      draft.npcs.push(npc);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { npc, npcCount: draft.npcs.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "npc-remove", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const i = draft.npcs.findIndex((n) => n.id === clean(params.npcId, 80));
      if (i < 0) return { ok: false, error: "NPC not found" };
      draft.npcs.splice(i, 1);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { removed: clean(params.npcId, 80), npcCount: draft.npcs.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "faction-add", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const name = clean(params.name, 60);
      if (!name) return { ok: false, error: "faction name required" };
      if (draft.factions.length >= 24) return { ok: false, error: "faction limit (24) reached" };
      const faction = {
        id: wcid("faction"), name,
        ethos: clean(params.ethos, 300),
        color: clean(params.color, 9) || "#c0a060",
        stance: clean(params.stance, 20) || "neutral",
      };
      draft.factions.push(faction);
      draft.updatedAt = now();
      save();
      return { ok: true, result: { faction, factionCount: draft.factions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("world-creator", "faction-remove", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.draftId, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const i = draft.factions.findIndex((f) => f.id === clean(params.factionId, 80));
      if (i < 0) return { ok: false, error: "faction not found" };
      const [removed] = draft.factions.splice(i, 1);
      draft.npcs.forEach((n) => { if (n.factionId === removed.id) n.factionId = null; });
      draft.updatedAt = now();
      save();
      return { ok: true, result: { removed: removed.id, factionCount: draft.factions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F7: publish / privacy ----------------------------------------
  registerLensAction("world-creator", "draft-publish", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.id, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const visibility = clean(params.visibility, 20);
      if (!["private", "unlisted", "public"].includes(visibility)) {
        return { ok: false, error: "visibility must be private | unlisted | public" };
      }
      if (visibility !== "private" && draft.spawnPoints.length === 0) {
        return { ok: false, error: "a world needs at least one spawn point before it can be published" };
      }
      draft.visibility = visibility;
      if (params.publishedWorldId != null) draft.publishedWorldId = clean(params.publishedWorldId, 80) || null;
      draft.updatedAt = now();
      save();
      return { ok: true, result: { id: draft.id, visibility: draft.visibility, publishedWorldId: draft.publishedWorldId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // F7: discovery listing — public + unlisted-by-id worlds across all creators
  registerLensAction("world-creator", "discover", (_ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const q = clean(params.query, 60).toLowerCase();
      const out = [];
      for (const [creatorId, drafts] of s.drafts.entries()) {
        for (const d of drafts) {
          if (d.visibility !== "public") continue;
          if (q && !(`${d.name} ${d.description}`.toLowerCase().includes(q))) continue;
          out.push({
            id: d.id, name: d.name, description: d.description,
            biome: d.biome, biomeLabel: BIOMES[d.biome]?.label || d.biome,
            universeType: d.universeType, creatorId,
            publishedWorldId: d.publishedWorldId,
            propCount: d.props.length, npcCount: d.npcs.length, zoneCount: d.zones.length,
            updatedAt: d.updatedAt,
          });
        }
      }
      out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { ok: true, result: { worlds: out.slice(0, 60), count: out.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ---- F9: playtest readiness check ---------------------------------
  registerLensAction("world-creator", "playtest-check", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const draft = findDraft(s, aid(ctx), clean(params.id, 80));
      if (!draft) return { ok: false, error: "draft not found" };
      const issues = [];
      const warnings = [];
      if (draft.spawnPoints.length === 0) issues.push("No spawn point — a player has nowhere to land.");
      if (!draft.spawnPoints.some((sp) => sp.isDefault) && draft.spawnPoints.length) {
        warnings.push("No default spawn point set — the first spawn will be used.");
      }
      if (draft.name.trim().length < 3) issues.push("World name is too short.");
      if (draft.props.length === 0) warnings.push("Scene is empty — no props placed.");
      if (draft.npcs.length === 0) warnings.push("No NPCs placed — the world will feel lifeless.");
      if (draft.zones.length === 0) warnings.push("No zones defined — no safe/hazard areas.");
      const defaultSpawn = draft.spawnPoints.find((sp) => sp.isDefault) || draft.spawnPoints[0] || null;
      const ready = issues.length === 0;
      return {
        ok: true,
        result: {
          ready, issues, warnings,
          draftId: draft.id, name: draft.name,
          universeType: draft.universeType, biome: draft.biome,
          rules: draft.rules,
          spawn: defaultSpawn,
          // payload the frontend can POST straight to /api/worlds
          worldPayload: {
            name: draft.name,
            universe_type: draft.universeType,
            description: draft.description,
            physics_modulators: {},
            rule_modulators: { ...draft.rules, biome: draft.biome },
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
