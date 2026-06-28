// server/domains/landscaping.js
//
// Pure-compute landscaping helpers (plant selection, sprinkler
// design, lawn care, ROI) plus real Trefle.io plant database
// (~1M species, includes scientific name, family, edible flag,
// growth rate, hardiness zones). Free with API key from
// trefle.io/users/sign_up.

import { callVision, callVisionUrl } from "../lib/vision-inference.js";

const TREFLE_BASE = "https://trefle.io/api/v1";

export default function registerLandscapingActions(registerLensAction) {
  registerLensAction("landscaping", "plantSelection", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const zone = parseInt(data.hardnessZone) || 7;
    const sun = (data.sunExposure || "full").toLowerCase();
    const soil = (data.soilType || "loam").toLowerCase();
    const plants = [
      { name: "Lavender", zones: [5,9], sun: "full", soil: ["sandy","loam"], type: "perennial" },
      { name: "Hosta", zones: [3,9], sun: "shade", soil: ["loam","clay"], type: "perennial" },
      { name: "Black-Eyed Susan", zones: [3,9], sun: "full", soil: ["loam","clay","sandy"], type: "perennial" },
      { name: "Japanese Maple", zones: [5,8], sun: "partial", soil: ["loam"], type: "tree" },
      { name: "Boxwood", zones: [5,9], sun: "full", soil: ["loam","clay"], type: "shrub" },
      { name: "Daylily", zones: [3,10], sun: "full", soil: ["loam","clay","sandy"], type: "perennial" },
    ];
    const suitable = plants.filter(p => zone >= p.zones[0] && zone <= p.zones[1] && (p.sun === sun || p.sun === "partial") && p.soil.includes(soil));
    return { ok: true, result: { zone, sunExposure: sun, soilType: soil, recommendations: suitable.map(p => ({ name: p.name, type: p.type })), totalMatches: suitable.length } };
  });
  registerLensAction("landscaping", "irrigationCalc", (ctx, artifact, _params) => {
    // fail-CLOSED: parseFloat(Infinity) is NaN, but parseFloat("Infinity")
    // and a raw Infinity are truthy → `|| 1000` would let Infinity through and
    // leak Infinity into every rendered gallons figure. Guard with isFinite +
    // floor negatives to 0 so the card never shows NaN/Infinity.
    const rawSqft = parseFloat(artifact.data?.squareFootage);
    const sqft = Number.isFinite(rawSqft) ? Math.max(0, rawSqft) || 1000 : 1000;
    const plantType = (artifact.data?.plantType || "lawn").toLowerCase();
    const rates = { lawn: 1.0, garden: 0.8, shrubs: 0.6, trees: 0.4, xeriscape: 0.2 };
    const inchesPerWeek = rates[plantType] || 1.0;
    const gallonsPerWeek = Math.round(sqft * inchesPerWeek * 0.623);
    return { ok: true, result: { squareFootage: sqft, plantType, inchesPerWeek, gallonsPerWeek, gallonsPerMonth: gallonsPerWeek * 4, runtimeMinutes: Math.round(gallonsPerWeek / 5), frequency: inchesPerWeek > 0.8 ? "3x per week" : "2x per week", monthlyCost: Math.round(gallonsPerWeek * 4 * 0.004 * 100) / 100 } };
  });
  registerLensAction("landscaping", "seasonalPlan", (ctx, artifact, _params) => {
    const zone = parseInt(artifact.data?.hardnessZone) || 7;
    const seasons = { spring: ["Fertilize lawn", "Prune winter damage", "Plant annuals", "Mulch beds", "Edge beds"], summer: ["Deep water weekly", "Mow at 3-4 inches", "Deadhead flowers", "Watch for pests", "Prune after bloom"], fall: ["Aerate lawn", "Overseed thin spots", "Plant bulbs", "Final fertilizer", "Clean up leaves"], winter: ["Plan spring design", "Order seeds", "Maintain tools", "Protect tender plants", "Prune dormant trees"] };
    return { ok: true, result: { zone, plan: seasons, currentSeason: ["winter","winter","spring","spring","spring","summer","summer","summer","fall","fall","fall","winter"][new Date().getMonth()], immediateActions: seasons[["winter","winter","spring","spring","spring","summer","summer","summer","fall","fall","fall","winter"][new Date().getMonth()]] } };
  });
  registerLensAction("landscaping", "materialEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // fail-CLOSED on poisoned numerics: Infinity/NaN/garbage must never leak
    // into cubicYards/bags/estimatedCost. isFinite guard + floor negatives.
    const rawSqft = parseFloat(data.squareFootage);
    const sqft = Number.isFinite(rawSqft) ? Math.max(0, rawSqft) || 100 : 100;
    const material = (data.material || "mulch").toLowerCase();
    const depths = { mulch: 3, gravel: 2, topsoil: 4, compost: 2, sand: 2, pavers: 0 };
    const depthInches = depths[material] || 3;
    const cubicYards = Math.round((sqft * depthInches / 12 / 27) * 10) / 10;
    const prices = { mulch: 35, gravel: 45, topsoil: 30, compost: 40, sand: 35, pavers: 0 };
    const costPerYard = prices[material] || 35;
    return { ok: true, result: { material, squareFootage: sqft, depthInches, cubicYards, bags: Math.ceil(cubicYards * 13.5), estimatedCost: Math.round(cubicYards * costPerYard), deliveryNote: cubicYards > 3 ? "Bulk delivery recommended" : "Bagged purchase sufficient" } };
  });

  /**
   * trefle-search — Real plant lookup via Trefle.io (~1M species).
   * Returns scientific name, family, edible flag, growth habit,
   * hardiness zones, image URLs.
   *
   * params: { query: string, page?: 1+ }
   */
  registerLensAction("landscaping", "trefle-search", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.TREFLE_API_KEY;
    if (!apiKey) return { ok: false, error: "TREFLE_API_KEY env required (free at trefle.io/users/sign_up)" };
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const page = Math.max(1, Number(params.page) || 1);
    try {
      const r = await fetch(`${TREFLE_BASE}/plants/search?token=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&page=${page}`);
      if (r.status === 401) return { ok: false, error: "TREFLE_API_KEY invalid" };
      if (!r.ok) throw new Error(`trefle ${r.status}`);
      const data = await r.json();
      const plants = (data.data || []).map((p) => ({
        id: p.id,
        commonName: p.common_name,
        scientificName: p.scientific_name,
        family: p.family,
        genus: p.genus,
        slug: p.slug,
        bibliography: p.bibliography,
        year: p.year,
        image: p.image_url,
        author: p.author,
      }));
      return {
        ok: true,
        result: {
          query, plants, count: plants.length,
          totalResults: data.meta?.total,
          source: "trefle.io",
        },
      };
    } catch (e) {
      return { ok: false, error: `trefle unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * trefle-plant — Full details for a Trefle plant by ID (returned
   * from trefle-search). Includes growth requirements, soil pH range,
   * hardiness zones, edible parts, and toxicity info.
   */
  registerLensAction("landscaping", "trefle-plant", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.TREFLE_API_KEY;
    if (!apiKey) return { ok: false, error: "TREFLE_API_KEY env required" };
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "id required (Trefle plant ID)" };
    try {
      const r = await fetch(`${TREFLE_BASE}/plants/${id}?token=${encodeURIComponent(apiKey)}`);
      if (r.status === 404) return { ok: false, error: `Trefle plant not found: ${id}` };
      if (!r.ok) throw new Error(`trefle ${r.status}`);
      const data = await r.json();
      const p = data?.data || {};
      const m = p.main_species || {};
      const growth = m.growth || {};
      const spec = m.specifications || {};
      return {
        ok: true,
        result: {
          id: p.id,
          commonName: p.common_name,
          scientificName: p.scientific_name,
          family: p.family,
          genus: p.genus,
          edible: m.edible,
          ediblePart: m.edible_part,
          vegetable: m.vegetable,
          imageUrl: p.image_url,
          observations: p.observations,
          growthHabit: spec.growth_habit,
          averageHeightCm: spec.average_height?.cm,
          maxHeightCm: spec.maximum_height?.cm,
          lightRequirement: growth.light,
          atmosphericHumidity: growth.atmospheric_humidity,
          soilHumidity: growth.soil_humidity,
          phMinimum: growth.ph_minimum,
          phMaximum: growth.ph_maximum,
          minimumTempC: growth.minimum_temperature?.deg_c,
          maximumTempC: growth.maximum_temperature?.deg_c,
          growthMonths: growth.growth_months,
          bloomMonths: growth.bloom_months,
          source: "trefle.io",
        },
      };
    } catch (e) {
      return { ok: false, error: `trefle unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Garden / bed management substrate (per-user, STATE-backed) ─────
  function getLandState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.landscapingLens) STATE.landscapingLens = {};
    const s = STATE.landscapingLens;
    if (!(s.beds instanceof Map)) s.beds = new Map(); // userId -> Array
    return s;
  }
  function saveLand() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const lsId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const lsActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const lsClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const lsNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const lsBeds = (s, userId) => { if (!s.beds.has(userId)) s.beds.set(userId, []); return s.beds.get(userId); };
  const SUN = ["full", "partial", "shade"];
  const SOIL = ["loam", "clay", "sandy", "silt", "chalk", "peat"];

  registerLensAction("landscaping", "bed-add", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = lsClean(params.name, 120);
    if (!name) return { ok: false, error: "bed name required" };
    const bed = {
      id: lsId("bed"), name,
      sizeSqft: Math.max(0, lsNum(params.sizeSqft)),
      sunExposure: SUN.includes(params.sunExposure) ? params.sunExposure : "full",
      soilType: SOIL.includes(params.soilType) ? params.soilType : "loam",
      notes: lsClean(params.notes, 1000) || "",
      plantings: [], careLog: [],
      createdAt: new Date().toISOString(),
    };
    lsBeds(s, lsActor(ctx)).push(bed);
    saveLand();
    return { ok: true, result: { bed } };
  });

  registerLensAction("landscaping", "bed-list", (ctx, _a, _params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beds = lsBeds(s, lsActor(ctx)).map((b) => ({
      ...b, plantingCount: b.plantings.length, careCount: b.careLog.length,
    }));
    return { ok: true, result: { beds, count: beds.length, totalSqft: beds.reduce((n, b) => n + b.sizeSqft, 0) } };
  });

  registerLensAction("landscaping", "bed-delete", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lsBeds(s, lsActor(ctx));
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "bed not found" };
    arr.splice(i, 1);
    saveLand();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("landscaping", "planting-add", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bed = lsBeds(s, lsActor(ctx)).find((b) => b.id === params.bedId);
    if (!bed) return { ok: false, error: "bed not found" };
    const planting = {
      id: lsId("plt"),
      plant: lsClean(params.plant, 120) || "plant",
      quantity: Math.max(1, Math.round(lsNum(params.quantity)) || 1),
      plantedDate: lsClean(params.plantedDate, 30) || new Date().toISOString().slice(0, 10),
      status: ["planned", "growing", "thriving", "struggling", "removed"].includes(params.status) ? params.status : "growing",
    };
    bed.plantings.push(planting);
    saveLand();
    return { ok: true, result: { planting } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("landscaping", "care-log", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const bed = lsBeds(s, lsActor(ctx)).find((b) => b.id === params.bedId);
    if (!bed) return { ok: false, error: "bed not found" };
    const kind = ["water", "fertilize", "prune", "weed", "mulch", "pest_treat", "harvest"].includes(params.kind) ? params.kind : "water";
    const entry = {
      id: lsId("care"), kind,
      date: lsClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      notes: lsClean(params.notes, 600) || "",
    };
    bed.careLog.push(entry);
    saveLand();
    return { ok: true, result: { entry } };
  });

  registerLensAction("landscaping", "landscaping-dashboard", (ctx, _a, _params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beds = lsBeds(s, lsActor(ctx));
    let plantings = 0, careEvents = 0;
    for (const b of beds) { plantings += b.plantings.length; careEvents += b.careLog.length; }
    return {
      ok: true,
      result: {
        beds: beds.length,
        totalSqft: beds.reduce((n, b) => n + b.sizeSqft, 0),
        plantings, careEvents,
      },
    };
  });

  // feed — ingest real plant species records from the GBIF backbone
  // taxonomy as visible DTUs. Free public API, no key.
  registerLensAction("landscaping", "feed", async (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const topics = ["maple", "rose", "lavender", "fern", "oak", "tulip", "hydrangea"];
    const q = lsClean(params.query, 60) || topics[new Date().getHours() % topics.length];
    try {
      const r = await fetch(`https://api.gbif.org/v1/species/search?q=${encodeURIComponent(q)}&rank=SPECIES&highertaxonKey=6&limit=${limit}`);
      if (!r.ok) return { ok: false, error: `gbif ${r.status}` };
      const data = await r.json();
      const species = (Array.isArray(data?.results) ? data.results : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const sp of species) {
        const id = `gbif_${sp.key || sp.nubKey}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const common = (sp.vernacularNames || []).find((v) => v.language === "eng")?.vernacularName;
        const name = sp.scientificName || sp.canonicalName || "Plant species";
        const title = `Plant: ${common || sp.canonicalName || name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nScientific name: ${name}\nFamily: ${sp.family || "?"}\nGenus: ${sp.genus || "?"}\nOrder: ${sp.order || "?"}\nSource: GBIF Backbone Taxonomy`,
          tags: ["landscaping", "feed", "plant", "gbif"],
          source: "gbif-feed",
          meta: { gbifKey: sp.key, scientificName: name, family: sp.family, commonName: common || null },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveLand();
      return { ok: true, result: { ingested, skipped, source: "gbif-plant-species", dtuIds } };
    } catch (e) {
      return { ok: false, error: `gbif unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Feature 1 — Visual yard designer (2D plot layouts) ─────────────
  // A layout is a plot canvas (width × height in feet) holding placed
  // elements (beds / plants / hardscape) with x,y coordinates.
  function lsLayouts(s, userId) {
    if (!(s.layouts instanceof Map)) s.layouts = new Map();
    if (!s.layouts.has(userId)) s.layouts.set(userId, []);
    return s.layouts.get(userId);
  }
  const ELEMENT_KINDS = ["bed", "plant", "tree", "shrub", "path", "patio", "water", "lawn", "fence"];

  registerLensAction("landscaping", "layout-create", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = lsClean(params.name, 120);
    if (!name) return { ok: false, error: "layout name required" };
    const layout = {
      id: lsId("yard"), name,
      plotWidthFt: Math.max(4, Math.min(2000, Math.round(lsNum(params.plotWidthFt)) || 40)),
      plotHeightFt: Math.max(4, Math.min(2000, Math.round(lsNum(params.plotHeightFt)) || 30)),
      elements: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    lsLayouts(s, lsActor(ctx)).push(layout);
    saveLand();
    return { ok: true, result: { layout } };
  });

  registerLensAction("landscaping", "layout-list", (ctx, _a, _params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const layouts = lsLayouts(s, lsActor(ctx)).map((l) => ({
      ...l, elementCount: l.elements.length,
    }));
    return { ok: true, result: { layouts, count: layouts.length } };
  });

  registerLensAction("landscaping", "layout-delete", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lsLayouts(s, lsActor(ctx));
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "layout not found" };
    arr.splice(i, 1);
    saveLand();
    return { ok: true, result: { deleted: params.id } };
  });

  // layout-save-elements — replace the full element set for a layout
  // (used by the drag-drop canvas which submits the whole arrangement).
  registerLensAction("landscaping", "layout-save-elements", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const layout = lsLayouts(s, lsActor(ctx)).find((l) => l.id === params.layoutId);
    if (!layout) return { ok: false, error: "layout not found" };
    const raw = Array.isArray(params.elements) ? params.elements : [];
    layout.elements = raw.slice(0, 500).map((e) => ({
      id: lsClean(e.id, 60) || lsId("el"),
      kind: ELEMENT_KINDS.includes(e.kind) ? e.kind : "plant",
      label: lsClean(e.label, 80) || "element",
      x: Math.max(0, Math.min(layout.plotWidthFt, lsNum(e.x))),
      y: Math.max(0, Math.min(layout.plotHeightFt, lsNum(e.y))),
      widthFt: Math.max(0.5, Math.min(layout.plotWidthFt, lsNum(e.widthFt) || 2)),
      heightFt: Math.max(0.5, Math.min(layout.plotHeightFt, lsNum(e.heightFt) || 2)),
      color: lsClean(e.color, 16) || "#22c55e",
    }));
    layout.updatedAt = new Date().toISOString();
    saveLand();
    return { ok: true, result: { layout, elementCount: layout.elements.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Feature 2 — AR / photo-overlay preview ─────────────────────────
  // Stores a yard photo (data URL) with positioned plant overlays so a
  // user can preview plant choices on their own yard.
  function lsPhotos(s, userId) {
    if (!(s.photoOverlays instanceof Map)) s.photoOverlays = new Map();
    if (!s.photoOverlays.has(userId)) s.photoOverlays.set(userId, []);
    return s.photoOverlays.get(userId);
  }

  registerLensAction("landscaping", "overlay-create", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const photoUrl = lsClean(params.photoUrl, 4_000_000);
    if (!photoUrl) return { ok: false, error: "photoUrl required (data URL or http)" };
    const overlay = {
      id: lsId("overlay"),
      name: lsClean(params.name, 120) || "Yard preview",
      photoUrl,
      placements: [],
      createdAt: new Date().toISOString(),
    };
    lsPhotos(s, lsActor(ctx)).push(overlay);
    saveLand();
    // do not echo the heavy photoUrl back
    return { ok: true, result: { overlay: { ...overlay, photoUrl: undefined, hasPhoto: true } } };
  });

  registerLensAction("landscaping", "overlay-list", (ctx, _a, _params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const overlays = lsPhotos(s, lsActor(ctx)).map((o) => ({
      id: o.id, name: o.name, photoUrl: o.photoUrl,
      placements: o.placements, createdAt: o.createdAt,
      placementCount: o.placements.length,
    }));
    return { ok: true, result: { overlays, count: overlays.length } };
  });

  registerLensAction("landscaping", "overlay-place", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const overlay = lsPhotos(s, lsActor(ctx)).find((o) => o.id === params.overlayId);
    if (!overlay) return { ok: false, error: "overlay not found" };
    const raw = Array.isArray(params.placements) ? params.placements : [];
    overlay.placements = raw.slice(0, 100).map((p) => ({
      id: lsClean(p.id, 60) || lsId("pl"),
      plant: lsClean(p.plant, 120) || "plant",
      imageUrl: lsClean(p.imageUrl, 600) || "",
      xPct: Math.max(0, Math.min(100, lsNum(p.xPct))),
      yPct: Math.max(0, Math.min(100, lsNum(p.yPct))),
      scalePct: Math.max(5, Math.min(300, lsNum(p.scalePct) || 100)),
    }));
    saveLand();
    return { ok: true, result: { overlay: { id: overlay.id, placements: overlay.placements } } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("landscaping", "overlay-delete", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lsPhotos(s, lsActor(ctx));
    const i = arr.findIndex((o) => o.id === params.id);
    if (i < 0) return { ok: false, error: "overlay not found" };
    arr.splice(i, 1);
    saveLand();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Feature 3 — Plant identification from photo (vision brain) ─────
  registerLensAction("landscaping", "identify-plant", async (_ctx, _a, params = {}) => {
    const imageB64 = params.imageB64;
    const imageUrl = lsClean(params.imageUrl, 2000);
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = "You are a botanist. Identify the plant species in this image. " +
      "Reply with: the most likely common name, the scientific name if known, " +
      "the plant type (tree/shrub/perennial/annual/grass), and any visible health " +
      "issues (disease, pest damage, nutrient deficiency, none). Be concise.";
    try {
      const r = imageUrl ? await callVisionUrl(imageUrl, prompt) : await callVision(imageB64, prompt);
      if (!r || r.ok === false) {
        return { ok: false, error: (r && r.error) || "vision unavailable" };
      }
      const text = r.result?.description || r.result?.text || r.text || r.description || "";
      return { ok: true, result: { identification: text, source: "vision-brain" } };
    } catch (e) {
      return { ok: false, error: `vision failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Feature 4 — Plant-care reminders from care-log cadence ─────────
  // Cadence in days per care kind; derives next-due date from the most
  // recent matching care-log entry across all beds.
  const CARE_CADENCE = {
    water: 3, fertilize: 30, prune: 90, weed: 14, mulch: 120, pest_treat: 21, harvest: 7,
  };

  registerLensAction("landscaping", "care-reminders", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beds = lsBeds(s, lsActor(ctx));
    const horizonDays = Math.max(1, Math.min(120, Math.round(lsNum(params.horizonDays)) || 14));
    const today = new Date();
    const todayMs = today.getTime();
    const reminders = [];
    for (const bed of beds) {
      // last entry per kind
      const last = {};
      for (const e of bed.careLog) {
        const t = Date.parse(e.date);
        if (!Number.isFinite(t)) continue;
        if (!last[e.kind] || t > last[e.kind]) last[e.kind] = t;
      }
      for (const [kind, cadence] of Object.entries(CARE_CADENCE)) {
        const lastMs = last[kind];
        if (lastMs == null) continue; // only remind for tasks the user already does
        const dueMs = lastMs + cadence * 86_400_000;
        const daysUntil = Math.round((dueMs - todayMs) / 86_400_000);
        if (daysUntil <= horizonDays) {
          reminders.push({
            bedId: bed.id, bedName: bed.name, kind, cadenceDays: cadence,
            lastDone: new Date(lastMs).toISOString().slice(0, 10),
            dueDate: new Date(dueMs).toISOString().slice(0, 10),
            daysUntil, overdue: daysUntil < 0,
          });
        }
      }
    }
    reminders.sort((a, b) => a.daysUntil - b.daysUntil);
    return {
      ok: true,
      result: {
        reminders, count: reminders.length,
        overdueCount: reminders.filter((r) => r.overdue).length,
        horizonDays,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Feature 5 — Climate / hardiness-zone plant matching ────────────
  // Open-Meteo (free, no key) for local climate; derives an approximate
  // USDA-style hardiness zone from coldest expected temperature and
  // returns zone-suitable plant recommendations.
  function zoneFromMinTempC(minC) {
    // USDA zones: each zone spans 5°F (~2.8°C); zone 1 min ≈ -51°C.
    const minF = minC * 9 / 5 + 32;
    const z = Math.floor((minF + 60) / 10) + 1;
    return Math.max(1, Math.min(13, z));
  }
  const ZONE_PLANTS = [
    { name: "Lavender", zones: [5, 9], type: "perennial" },
    { name: "Hosta", zones: [3, 9], type: "perennial" },
    { name: "Black-Eyed Susan", zones: [3, 9], type: "perennial" },
    { name: "Japanese Maple", zones: [5, 8], type: "tree" },
    { name: "Boxwood", zones: [5, 9], type: "shrub" },
    { name: "Daylily", zones: [3, 10], type: "perennial" },
    { name: "Coneflower", zones: [3, 9], type: "perennial" },
    { name: "Hydrangea", zones: [5, 9], type: "shrub" },
    { name: "Crape Myrtle", zones: [7, 10], type: "tree" },
    { name: "Bougainvillea", zones: [9, 11], type: "vine" },
    { name: "Blue Spruce", zones: [2, 7], type: "tree" },
    { name: "Hardy Geranium", zones: [4, 8], type: "perennial" },
    { name: "Citrus Tree", zones: [9, 11], type: "tree" },
    { name: "Sedum", zones: [3, 10], type: "succulent" },
  ];

  registerLensAction("landscaping", "climate-match", async (_ctx, _a, params = {}) => {
    const lat = Number(params.lat);
    const lon = Number(params.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: "valid lat/lon required" };
    }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_min,temperature_2m_max&forecast_days=16&timezone=auto`;
      const r = await fetch(url);
      if (!r.ok) return { ok: false, error: `open-meteo ${r.status}` };
      const data = await r.json();
      const mins = data?.daily?.temperature_2m_min || [];
      const maxs = data?.daily?.temperature_2m_max || [];
      if (!mins.length) return { ok: false, error: "no climate data for location" };
      const coldest = Math.min(...mins);
      const hottest = Math.max(...maxs);
      const avgMin = mins.reduce((a, b) => a + b, 0) / mins.length;
      const zone = zoneFromMinTempC(coldest);
      const recommendations = ZONE_PLANTS
        .filter((p) => zone >= p.zones[0] && zone <= p.zones[1])
        .map((p) => ({ name: p.name, type: p.type, zoneRange: `${p.zones[0]}-${p.zones[1]}` }));
      return {
        ok: true,
        result: {
          lat, lon, hardinessZone: zone,
          coldestForecastC: Math.round(coldest * 10) / 10,
          hottestForecastC: Math.round(hottest * 10) / 10,
          avgMinC: Math.round(avgMin * 10) / 10,
          recommendations, recommendationCount: recommendations.length,
          source: "open-meteo",
        },
      };
    } catch (e) {
      return { ok: false, error: `open-meteo unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Feature 6 — Cost estimate → proposal ───────────────────────────
  // Builds a structured contractor proposal from line items: computes
  // labor + materials, applies overhead + margin, returns a renderable
  // proposal document object (markdown body + totals).
  registerLensAction("landscaping", "proposal-build", (_ctx, _a, params = {}) => {
  try {
    const client = lsClean(params.client, 200) || "Client";
    const project = lsClean(params.project, 200) || "Landscaping project";
    const rawItems = Array.isArray(params.lineItems) ? params.lineItems : [];
    if (!rawItems.length) return { ok: false, error: "lineItems required" };
    const overheadPct = Math.max(0, Math.min(100, lsNum(params.overheadPct) || 15));
    const marginPct = Math.max(0, Math.min(100, lsNum(params.marginPct) || 20));
    const taxPct = Math.max(0, Math.min(30, lsNum(params.taxPct)));
    const lineItems = rawItems.slice(0, 200).map((it) => {
      const qty = Math.max(0, lsNum(it.quantity) || 1);
      const unitCost = Math.max(0, lsNum(it.unitCost));
      return {
        description: lsClean(it.description, 200) || "Line item",
        category: lsClean(it.category, 40) || "labor",
        unit: lsClean(it.unit, 20) || "ea",
        quantity: qty,
        unitCost,
        lineTotal: Math.round(qty * unitCost * 100) / 100,
      };
    });
    const subtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0);
    const overhead = Math.round(subtotal * overheadPct) / 100;
    const margin = Math.round((subtotal + overhead) * marginPct) / 100;
    const preTax = subtotal + overhead + margin;
    const tax = Math.round(preTax * taxPct) / 100;
    const total = Math.round((preTax + tax) * 100) / 100;
    const md = [
      `# Landscaping Proposal`,
      ``,
      `**Prepared for:** ${client}`,
      `**Project:** ${project}`,
      `**Date:** ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `## Scope & Line Items`,
      ``,
      `| Description | Category | Qty | Unit | Unit Cost | Total |`,
      `|---|---|---:|---|---:|---:|`,
      ...lineItems.map((i) =>
        `| ${i.description} | ${i.category} | ${i.quantity} | ${i.unit} | $${i.unitCost.toFixed(2)} | $${i.lineTotal.toFixed(2)} |`),
      ``,
      `## Cost Summary`,
      ``,
      `| Item | Amount |`,
      `|---|---:|`,
      `| Subtotal | $${subtotal.toFixed(2)} |`,
      `| Overhead (${overheadPct}%) | $${overhead.toFixed(2)} |`,
      `| Margin (${marginPct}%) | $${margin.toFixed(2)} |`,
      `| Tax (${taxPct}%) | $${tax.toFixed(2)} |`,
      `| **Total** | **$${total.toFixed(2)}** |`,
      ``,
      `_This proposal is valid for 30 days from the date above._`,
    ].join("\n");
    return {
      ok: true,
      result: {
        client, project, lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        overhead, margin, tax, total,
        overheadPct, marginPct, taxPct,
        proposalMarkdown: md,
        generatedAt: new Date().toISOString(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Feature 7 — Maintenance calendar (per-bed seasonal tasks) ──────
  // Generates a 12-month task schedule for a bed, biased by sun
  // exposure and the bed's plantings.
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_TASKS = {
    0: ["Plan layout", "Sharpen tools", "Order seeds"],
    1: ["Prune dormant trees", "Start seeds indoors"],
    2: ["Apply pre-emergent", "Clean beds", "Edge beds"],
    3: ["Plant cool-season crops", "Mulch beds", "First fertilize"],
    4: ["Plant annuals", "Install irrigation", "Weed"],
    5: ["Deep water weekly", "Deadhead flowers", "Watch for pests"],
    6: ["Mow high", "Mid-season fertilize", "Stake tall plants"],
    7: ["Prune after bloom", "Harvest", "Monitor drought stress"],
    8: ["Plant fall color", "Divide perennials", "Aerate lawn"],
    9: ["Overseed", "Plant bulbs", "Rake leaves"],
    10: ["Final fertilize", "Wrap tender plants", "Drain irrigation"],
    11: ["Protect from frost", "Compost cleanup", "Tool maintenance"],
  };

  registerLensAction("landscaping", "maintenance-calendar", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beds = lsBeds(s, lsActor(ctx));
    const bedId = lsClean(params.bedId, 80);
    const bed = bedId ? beds.find((b) => b.id === bedId) : null;
    if (bedId && !bed) return { ok: false, error: "bed not found" };
    const buildMonths = (b) => MONTH_NAMES.map((m, idx) => {
      const tasks = [...(MONTH_TASKS[idx] || [])];
      if (b) {
        if (b.sunExposure === "full" && [5, 6, 7].includes(idx)) tasks.push("Extra water — full sun");
        if (b.sunExposure === "shade" && [3, 4].includes(idx)) tasks.push("Check shade-plant spacing");
        if (b.plantings.length && [3, 9].includes(idx)) tasks.push(`Inspect ${b.plantings.length} planting(s)`);
      }
      return { monthIndex: idx, month: m, tasks };
    });
    if (bed) {
      return { ok: true, result: { bedId: bed.id, bedName: bed.name, months: buildMonths(bed) } };
    }
    // whole-yard: one calendar per bed plus a generic schedule
    return {
      ok: true,
      result: {
        generic: buildMonths(null),
        perBed: beds.map((b) => ({ bedId: b.id, bedName: b.name, months: buildMonths(b) })),
        bedCount: beds.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Feature 8 — Plant health diary (photo timeline per planting) ───
  function lsDiary(s, userId) {
    if (!(s.healthDiary instanceof Map)) s.healthDiary = new Map();
    if (!s.healthDiary.has(userId)) s.healthDiary.set(userId, []);
    return s.healthDiary.get(userId);
  }
  const HEALTH_RATINGS = ["thriving", "healthy", "stressed", "declining", "lost"];

  registerLensAction("landscaping", "diary-add", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const plant = lsClean(params.plant, 120);
    if (!plant) return { ok: false, error: "plant name required" };
    const entry = {
      id: lsId("diary"),
      plant,
      bedId: lsClean(params.bedId, 80) || "",
      date: lsClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      health: HEALTH_RATINGS.includes(params.health) ? params.health : "healthy",
      heightCm: Math.max(0, lsNum(params.heightCm)) || null,
      photoUrl: lsClean(params.photoUrl, 4_000_000) || "",
      notes: lsClean(params.notes, 1000) || "",
      createdAt: new Date().toISOString(),
    };
    lsDiary(s, lsActor(ctx)).push(entry);
    saveLand();
    return { ok: true, result: { entry: { ...entry, photoUrl: undefined, hasPhoto: !!entry.photoUrl } } };
  });

  registerLensAction("landscaping", "diary-timeline", (ctx, _a, params = {}) => {
  try {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let entries = lsDiary(s, lsActor(ctx));
    const plant = lsClean(params.plant, 120);
    if (plant) entries = entries.filter((e) => e.plant === plant);
    entries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const plants = [...new Set(lsDiary(s, lsActor(ctx)).map((e) => e.plant))];
    return {
      ok: true,
      result: {
        entries, count: entries.length,
        plants, filteredBy: plant || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("landscaping", "diary-delete", (ctx, _a, params = {}) => {
    const s = getLandState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lsDiary(s, lsActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "diary entry not found" };
    arr.splice(i, 1);
    saveLand();
    return { ok: true, result: { deleted: params.id } };
  });
}
