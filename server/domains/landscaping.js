// server/domains/landscaping.js
//
// Pure-compute landscaping helpers (plant selection, sprinkler
// design, lawn care, ROI) plus real Trefle.io plant database
// (~1M species, includes scientific name, family, edible flag,
// growth rate, hardiness zones). Free with API key from
// trefle.io/users/sign_up.

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
    const sqft = parseFloat(artifact.data?.squareFootage) || 1000;
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
    const sqft = parseFloat(data.squareFootage) || 100;
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
}
