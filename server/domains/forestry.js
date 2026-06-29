// server/domains/forestry.js
//
// Pure-compute forestry helpers (timber volume, growth rate, carbon
// sequestration) plus real iTree Species + USFS Wildfire Risk to
// Communities + InciWeb wildfire incident reports. All free public
// sources; no API key required.

const INCIWEB_BASE = "https://inciweb.wildfire.gov/api/v1";
const NIFC_FIRE_API = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";

// Fail-closed finite coercion: parseFloat/Number admit Infinity & NaN silently,
// which would poison every downstream board-feet / risk / carbon number and
// render blank (NaN) or impossible (Infinity) tiles in the workbench. Coerce to
// a finite number, falling back to `fallback` for anything non-finite.
function frFinite(v, fallback = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (v == null || v === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}
// Per-species board-foot density factor (≈ taper/form relative to a generic
// mixed stand at 1.0) so timberVolume reflects the chosen species, not just a
// flat formula. Conifers yield more usable sawtimber per cubic foot than the
// hardwoods at the same age/acre.
const VOLUME_SPECIES_FACTOR = {
  "douglas-fir": 1.25, douglas_fir: 1.25,
  "ponderosa-pine": 1.1, ponderosa_pine: 1.1,
  "loblolly-pine": 1.15, loblolly_pine: 1.15,
  redwood: 1.4, hemlock: 1.05, cedar: 1.0, spruce: 1.1,
  oak: 0.85, maple: 0.8, aspen: 0.7, mixed: 1.0, other: 0.9,
};

export default function registerForestryActions(registerLensAction) {
  // timberVolume — the ForestryActionPanel sends { species, acres, avgAgeYears,
  // treeCount } (NOT a `trees` array). Estimate per-tree board feet from a
  // species×age yield model, scale by tree count, and return the fields the
  // panel renders: boardFeet, cubicFeet, valuation. Fail-closed on poison input.
  registerLensAction("forestry", "timberVolume", (ctx, artifact, params = {}) => {
    try {
      const src = (params && Object.keys(params).length ? params : artifact?.data) || {};
      // Fail-CLOSED: reject poisoned numerics (Infinity/NaN/1e308/-1) up front so
      // we never compute board-feet/valuation off garbage and still return ok:true.
      for (const f of ["acres", "treeCount", "pricePerMBF"]) {
        if (src[f] != null && !Number.isFinite(Number(src[f]))) return { ok: false, error: `invalid_${f}` };
      }
      const ageRaw = src.avgAgeYears ?? src.ageYears;
      if (ageRaw != null && !Number.isFinite(Number(ageRaw))) return { ok: false, error: "invalid_avgAgeYears" };
      const species = String(src.species || "mixed");
      const acres = Math.max(0, frFinite(src.acres, 0));
      const ageYears = Math.max(0, frFinite(src.avgAgeYears ?? src.ageYears, 0));
      const treeCount = Math.max(0, Math.round(frFinite(src.treeCount, 0)));
      if (treeCount <= 0 || acres <= 0) {
        return { ok: true, result: { message: "Enter species + acres + average age + tree count to estimate timber volume." } };
      }
      const factor = VOLUME_SPECIES_FACTOR[species] ?? 1.0;
      // Mean board feet per tree rises with stand age toward a ~mature plateau.
      // (deterministic, monotone, finite for any finite age)
      const ageMaturity = 1 - Math.exp(-ageYears / 35); // 0..~1
      const bfPerTree = Math.round(220 * factor * (0.15 + 0.85 * ageMaturity));
      const boardFeet = Math.round(bfPerTree * treeCount);
      const cubicFeet = Math.round(boardFeet / 6); // ≈6 bf per cubic foot (Int'l ¼")
      const pricePerMBF = Math.max(0, frFinite(src.pricePerMBF, 400));
      const valuation = Math.round((boardFeet / 1000) * pricePerMBF);
      return {
        ok: true,
        result: {
          species, acres, avgAgeYears: ageYears, treeCount,
          boardFeetPerTree: bfPerTree,
          boardFeet, cubicFeet, valuation, pricePerMBF,
          mbf: Math.round((boardFeet / 1000) * 10) / 10,
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  // fireRisk — panel sends { tempF, humidity, windMph }. Returns riskLevel +
  // score (the panel reads result.riskLevel and result.score) + factors.
  registerLensAction("forestry", "fireRisk", (ctx, artifact, params = {}) => {
    try {
      const src = (params && Object.keys(params).length ? params : artifact?.data) || {};
      // Fail-CLOSED: reject poisoned numerics for any supplied weather field so a
      // bogus Infinity/NaN can't silently land on a default and return ok:true.
      const _firePairs = [
        ["tempF", src.tempF ?? src.temperatureF],
        ["humidity", src.humidity ?? src.humidityPercent],
        ["windMph", src.windMph ?? src.windSpeedMph],
        ["droughtIndex", src.droughtIndex],
        ["fuelMoisturePercent", src.fuelMoisturePercent],
      ];
      for (const [name, v] of _firePairs) {
        if (v != null && !Number.isFinite(Number(v))) return { ok: false, error: `invalid_${name}` };
      }
      // Accept both the panel's (tempF/humidity/windMph) names AND the legacy
      // (temperatureF/humidityPercent/windSpeedMph) names; fail-closed to a sane
      // default for anything non-finite so the score never goes NaN.
      const temp = frFinite(src.tempF ?? src.temperatureF, 80);
      const humidity = frFinite(src.humidity ?? src.humidityPercent, 30);
      const wind = frFinite(src.windMph ?? src.windSpeedMph, 10);
      const drought = Math.max(0, Math.min(5, Math.round(frFinite(src.droughtIndex, 3))));
      const fuelMoisture = frFinite(src.fuelMoisturePercent, 15);
      let risk = 0;
      risk += temp > 95 ? 25 : temp > 85 ? 15 : temp > 75 ? 8 : 3;
      risk += humidity < 15 ? 25 : humidity < 25 ? 18 : humidity < 40 ? 10 : 3;
      risk += wind > 25 ? 20 : wind > 15 ? 12 : wind > 8 ? 6 : 2;
      risk += drought * 5;
      risk += fuelMoisture < 10 ? 15 : fuelMoisture < 20 ? 8 : 2;
      const score = Math.min(100, Math.max(0, Math.round(risk)));
      const riskLevel = score >= 75 ? "extreme" : score >= 50 ? "high" : score >= 30 ? "moderate" : "low";
      const factors = [];
      if (temp > 85) factors.push(`high temp ${Math.round(temp)}°F`);
      if (humidity < 25) factors.push(`low humidity ${Math.round(humidity)}%`);
      if (wind > 15) factors.push(`high wind ${Math.round(wind)} mph`);
      if (drought >= 4) factors.push("severe drought");
      if (fuelMoisture < 10) factors.push("critically dry fuel");
      return {
        ok: true,
        result: {
          conditions: { temperature: `${Math.round(temp)}°F`, humidity: `${Math.round(humidity)}%`, wind: `${Math.round(wind)} mph`, droughtIndex: drought, fuelMoisture: `${Math.round(fuelMoisture)}%` },
          score, riskScore: score, riskLevel, factors,
          actions: score >= 75 ? ["Red flag warning", "Close forest to public", "Pre-position fire crews"] : score >= 50 ? ["Fire watch", "Restrict campfires", "Alert fire crews"] : ["Normal operations"],
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  // harvestPlan — panel sends { species, acres, currentAge }; renders
  // result.schedule[] (a multi-year rotation removal schedule) + result.rotation.
  // Builds a real staged-cut schedule keyed off the species rotation age.
  registerLensAction("forestry", "harvestPlan", (ctx, artifact, params = {}) => {
    try {
      const src = (params && Object.keys(params).length ? params : artifact?.data) || {};
      // Fail-CLOSED: reject poisoned acres/age before building the schedule.
      const acresRaw = src.acreage ?? src.acres;
      if (acresRaw != null && !Number.isFinite(Number(acresRaw))) return { ok: false, error: "invalid_acres" };
      const currentAgeRaw = src.currentAge ?? src.ageYears;
      if (currentAgeRaw != null && !Number.isFinite(Number(currentAgeRaw))) return { ok: false, error: "invalid_currentAge" };
      const speciesRaw = String(src.species || "mixed");
      const acres = Math.max(0, frFinite(src.acreage ?? src.acres, 0));
      const currentAge = Math.max(0, frFinite(src.currentAge ?? src.ageYears, 0));
      const method = String(src.method || "selective").toLowerCase();
      if (acres <= 0) return { ok: true, result: { message: "Enter acres (and species + current age) to build a harvest schedule." } };
      const methods = {
        clearcut: { removal: 100, regen: "replant", impactLevel: "high", cyclYears: 60 },
        shelterwood: { removal: 70, regen: "natural + plant", impactLevel: "moderate", cyclYears: 80 },
        selective: { removal: 30, regen: "natural", impactLevel: "low", cyclYears: 20 },
        salvage: { removal: 50, regen: "replant", impactLevel: "moderate", cyclYears: 40 },
      };
      const plan = methods[method] || methods.selective;
      // Rotation comes from the species growth table (years from seed to mature
      // harvest); the schedule stages the cut from the stand's current age.
      const speciesKey = speciesRaw.replace(/-/g, "_");
      const g = SPECIES_GROWTH[speciesKey] || SPECIES_GROWTH.mixed;
      const rotation = g.rotation;
      const yearsToMaturity = Math.max(0, rotation - currentAge);
      // Stage the removal over up to 3 entries (selective/salvage) or a single
      // final harvest (clearcut). Each entry: { year, acres, volume }.
      const entries = method === "clearcut" || method === "salvage" ? 1 : 3;
      const harvestAcres = Math.round((acres * plan.removal) / 100);
      const perEntryAcres = Math.max(1, Math.round(harvestAcres / entries));
      // approximate volume per acre at maturity from the species peak MAI.
      const volPerAcre = Math.round(g.maiPeak * Math.min(rotation, g.peakAge) / g.peakAge);
      const schedule = [];
      for (let i = 0; i < entries; i++) {
        const year = Math.round((yearsToMaturity * (i + 1)) / entries);
        const a = i === entries - 1 ? Math.max(0, harvestAcres - perEntryAcres * (entries - 1)) : perEntryAcres;
        schedule.push({ year, acres: a, volume: Math.round(volPerAcre * a) });
      }
      return {
        ok: true,
        result: {
          species: speciesRaw, acres, currentAge, method,
          rotation, rotationYears: rotation,
          removalPercent: plan.removal, regeneration: plan.regen,
          impactLevel: plan.impactLevel,
          estimatedHarvestAcres: harvestAcres,
          schedule,
          roadRequired: acres > 50 ? "Yes — logging road needed" : "Existing access may suffice",
          bestSeason: "Fall/Winter (dry, dormant season)",
          permits: ["Timber Harvest Plan (THP)", "Environmental review", "Watershed protection plan"],
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  // carbonSequestration — panel sends { species, acres, ageYears }; renders
  // result.tonsPerYear, result.lifetimeTons, result.equivalentCars.
  registerLensAction("forestry", "carbonSequestration", (ctx, artifact, params = {}) => {
    try {
      const src = (params && Object.keys(params).length ? params : artifact?.data) || {};
      // Fail-CLOSED: reject poisoned acres/age/density before estimating carbon.
      const acresRaw = src.acreage ?? src.acres;
      if (acresRaw != null && !Number.isFinite(Number(acresRaw))) return { ok: false, error: "invalid_acres" };
      const ageRaw = src.standAge ?? src.ageYears;
      if (ageRaw != null && !Number.isFinite(Number(ageRaw))) return { ok: false, error: "invalid_ageYears" };
      if (src.treesPerAcre != null && !Number.isFinite(Number(src.treesPerAcre))) return { ok: false, error: "invalid_treesPerAcre" };
      const acres = Math.max(0, frFinite(src.acreage ?? src.acres, 0));
      const ageYears = Math.max(0, frFinite(src.standAge ?? src.ageYears, 0));
      const density = Math.max(0, Math.round(frFinite(src.treesPerAcre, 200)));
      if (acres <= 0) return { ok: true, result: { message: "Enter acres (and age) to estimate carbon sequestration." } };
      const tonsPerAcrePerYear = ageYears < 20 ? 2.5 : ageYears < 50 ? 1.8 : 1.0;
      const tonsPerYear = Math.round(acres * tonsPerAcrePerYear);
      const lifetimeTons = Math.round(acres * density * 0.015 * Math.max(1, ageYears));
      const creditValue = Math.round(tonsPerYear * 25);
      return {
        ok: true,
        result: {
          species: String(src.species || "mixed"), acres, standAge: ageYears, treesPerAcre: density,
          tonsPerYear, lifetimeTons,
          totalCarbonStored: lifetimeTons,
          carbonCreditsPerYear: tonsPerYear,
          estimatedCreditValue: creditValue,
          equivalentCars: Math.round(tonsPerYear / 4.6),
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  /**
   * inciweb-active-fires — Real active US wildfire incidents from
   * InciWeb (the National Interagency Fire Center's official
   * incident-information system). Returns fire name, location,
   * size in acres, containment %, status, last update.
   * Free, no API key.
   *
   * params: { state?: 2-letter US code, limit?: 1-100 }
   */
  registerLensAction("forestry", "inciweb-active-fires", async (_ctx, _artifact, params = {}) => {
    const state = params.state ? String(params.state).toUpperCase().trim() : null;
    if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "state must be 2-letter code (e.g. CA)" };
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    try {
      const url = `${INCIWEB_BASE}/incidents?per_page=${limit}${state ? `&state=${state}` : ""}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`inciweb ${r.status}`);
      const data = await r.json();
      const fires = (data?.data || data?.incidents || []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        location: f.location,
        state: f.state,
        county: f.county,
        sizeAcres: f.size,
        containmentPct: f.percent_contained,
        status: f.status,
        startDate: f.start_date,
        lastUpdated: f.updated_at,
        latitude: f.latitude ? Number(f.latitude) : null,
        longitude: f.longitude ? Number(f.longitude) : null,
        incidentUrl: f.url,
      }));
      return {
        ok: true,
        result: { fires, count: fires.length, state, source: "inciweb" },
      };
    } catch (e) {
      return { ok: false, error: `inciweb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * nifc-fire-perimeters — Real fire perimeter GeoJSON for currently
   * active US wildfires from NIFC's ArcGIS feature service.
   * Free, no API key.
   *
   * params: { whereClause?: SQL-like filter (default "1=1"), maxFeatures?: 1-2000 }
   */
  registerLensAction("forestry", "nifc-fire-perimeters", async (_ctx, _artifact, params = {}) => {
    const whereClause = String(params.whereClause || "1=1");
    const maxFeatures = Math.max(1, Math.min(2000, Number(params.maxFeatures) || 100));
    const url = `${NIFC_FIRE_API}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=${encodeURIComponent(whereClause)}&outFields=*&f=geojson&resultRecordCount=${maxFeatures}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`nifc ${r.status}`);
      const data = await r.json();
      const features = (data?.features || []).map((f) => ({
        objectId: f.properties?.OBJECTID,
        incidentName: f.properties?.poly_IncidentName,
        gisAcres: f.properties?.poly_GISAcres,
        mapMethod: f.properties?.poly_MapMethod,
        polygonDateTime: f.properties?.poly_PolygonDateTime,
        sourceCode: f.properties?.attr_FireCause,
        geometry: f.geometry,
      }));
      return {
        ok: true,
        result: {
          features, count: features.length,
          totalArea: features.reduce((s, f) => s + (f.gisAcres || 0), 0),
          source: "nifc-wfigs-perimeters",
        },
      };
    } catch (e) {
      return { ok: false, error: `nifc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Forest stand management substrate (per-user, STATE-backed) ──────

  function getForestryState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.forestryLens) STATE.forestryLens = {};
    const fl = STATE.forestryLens;
    if (!(fl.stands instanceof Map)) fl.stands = new Map(); // userId -> Array
    if (!(fl.polygons instanceof Map)) fl.polygons = new Map(); // userId -> Array
    if (!(fl.cruises instanceof Map)) fl.cruises = new Map(); // userId -> Array
    if (!(fl.pests instanceof Map)) fl.pests = new Map(); // userId -> Array
    if (!(fl.replanting instanceof Map)) fl.replanting = new Map(); // userId -> Array
    if (!(fl.carbonCredits instanceof Map)) fl.carbonCredits = new Map(); // userId -> Array
    return fl;
  }
  function saveForestry() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const frId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const frActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const frClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const frNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const frStands = (s, userId) => { if (!s.stands.has(userId)) s.stands.set(userId, []); return s.stands.get(userId); };
  const SPECIES = ["douglas_fir", "ponderosa_pine", "loblolly_pine", "oak", "maple", "spruce", "mixed", "other"];

  registerLensAction("forestry", "stand-add", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = frClean(params.name, 160);
    if (!name) return { ok: false, error: "stand name required" };
    const stand = {
      id: frId("std"), name,
      species: SPECIES.includes(params.species) ? params.species : "mixed",
      acres: Math.max(0, frNum(params.acres)),
      ageYears: Math.max(0, Math.round(frNum(params.ageYears))),
      treesPerAcre: Math.max(0, Math.round(frNum(params.treesPerAcre))),
      lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
      lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : null,
      notes: frClean(params.notes, 1000) || "",
      activities: [],
      createdAt: new Date().toISOString(),
    };
    frStands(s, frActor(ctx)).push(stand);
    saveForestry();
    return { ok: true, result: { stand } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("forestry", "stand-list", (ctx, _a, _params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stands = frStands(s, frActor(ctx)).map((st) => ({
      ...st, estimatedTrees: st.acres * st.treesPerAcre, activityCount: st.activities.length,
    }));
    return { ok: true, result: { stands, count: stands.length, totalAcres: stands.reduce((n, st) => n + st.acres, 0) } };
  });

  registerLensAction("forestry", "stand-delete", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = frStands(s, frActor(ctx));
    const i = arr.findIndex((st) => st.id === params.id);
    if (i < 0) return { ok: false, error: "stand not found" };
    arr.splice(i, 1);
    saveForestry();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("forestry", "activity-log", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stand = frStands(s, frActor(ctx)).find((st) => st.id === params.standId);
    if (!stand) return { ok: false, error: "stand not found" };
    const kind = ["planting", "thinning", "harvest", "prescribed_burn", "survey", "treatment"].includes(params.kind) ? params.kind : "survey";
    const activity = {
      id: frId("act"), kind,
      date: frClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      notes: frClean(params.notes, 600) || "",
    };
    stand.activities.push(activity);
    saveForestry();
    return { ok: true, result: { activity } };
  });

  registerLensAction("forestry", "forestry-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const stands = frStands(s, frActor(ctx));
    const bySpecies = {};
    for (const st of stands) bySpecies[st.species] = (bySpecies[st.species] || 0) + 1;
    return {
      ok: true,
      result: {
        stands: stands.length,
        totalAcres: stands.reduce((n, st) => n + st.acres, 0),
        activities: stands.reduce((n, st) => n + st.activities.length, 0),
        bySpecies,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Growth & yield projection over a rotation ─────────────────────
  // Per-species mean annual increment (MAI, board feet/acre/year) and the
  // age at which growth peaks. Values from USFS yield-table literature.
  const SPECIES_GROWTH = {
    douglas_fir:    { maiPeak: 520, peakAge: 50, rotation: 55 },
    ponderosa_pine: { maiPeak: 340, peakAge: 70, rotation: 90 },
    loblolly_pine:  { maiPeak: 480, peakAge: 25, rotation: 30 },
    oak:            { maiPeak: 180, peakAge: 75, rotation: 90 },
    maple:          { maiPeak: 200, peakAge: 65, rotation: 80 },
    spruce:         { maiPeak: 300, peakAge: 60, rotation: 70 },
    mixed:          { maiPeak: 280, peakAge: 55, rotation: 65 },
    other:          { maiPeak: 250, peakAge: 60, rotation: 70 },
  };

  registerLensAction("forestry", "growth-projection", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const species = SPECIES.includes(params.species) ? params.species : "mixed";
    const acres = Math.max(0, frNum(params.acres));
    const currentAge = Math.max(0, Math.round(frNum(params.currentAge)));
    const currentVolumePerAcre = Math.max(0, frNum(params.currentVolumePerAcre));
    const siteIndex = frNum(params.siteIndex) > 0 ? frNum(params.siteIndex) : 80;
    if (acres <= 0) return { ok: false, error: "acres must be > 0" };
    const g = SPECIES_GROWTH[species];
    // Site-index scaling: SI 80 is the base; scale MAI linearly.
    const siteFactor = Math.max(0.4, Math.min(1.8, siteIndex / 80));
    const rotation = Math.max(5, Math.round(frNum(params.rotationYears) || g.rotation));
    // Volume at a given age — Chapman-Richards style sigmoid anchored to MAI.
    const volAtAge = (age) => {
      if (age <= 0) return 0;
      const peak = g.maiPeak * siteFactor;
      // cumulative = MAI * age * growth-shape factor (rises then plateaus)
      const shape = 1 - Math.exp(-2.0 * age / g.peakAge);
      return Math.round(peak * age * shape / g.peakAge * 1.0 + peak * Math.min(age, g.peakAge) * 0.2);
    };
    const baseVol = currentVolumePerAcre > 0 ? currentVolumePerAcre : volAtAge(currentAge);
    const offset = currentVolumePerAcre > 0 ? currentVolumePerAcre - volAtAge(currentAge) : 0;
    const projection = [];
    for (let yr = 0; yr <= rotation - currentAge && yr <= 120; yr += Math.max(1, Math.round(rotation / 12))) {
      const age = currentAge + yr;
      const vpa = Math.max(0, Math.round(volAtAge(age) + offset));
      projection.push({
        year: yr, age,
        volumePerAcre: vpa,
        totalVolume: Math.round(vpa * acres),
        mai: age > 0 ? Math.round(vpa / age) : 0,
        cai: yr > 0 ? Math.round((vpa - projection[projection.length - 1].volumePerAcre) / Math.max(1, age - projection[projection.length - 1].age)) : 0,
      });
    }
    // Biological rotation age = where MAI peaks.
    const peakRow = projection.reduce((best, r) => (r.mai > (best?.mai || 0) ? r : best), null);
    const finalRow = projection[projection.length - 1];
    return {
      ok: true,
      result: {
        species, acres, currentAge, siteIndex, rotationYears: rotation,
        currentVolumePerAcre: Math.round(baseVol),
        currentTotalVolume: Math.round(baseVol * acres),
        projection,
        finalVolumePerAcre: finalRow?.volumePerAcre || 0,
        finalTotalVolume: finalRow?.totalVolume || 0,
        biologicalRotationAge: peakRow?.age || g.peakAge,
        peakMai: peakRow?.mai || 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── GIS stand mapping — polygon drawing + acreage from coordinates ──
  // Shoelace area on a lat/lon ring → acres (uses spherical earth approx).
  function polygonAcres(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    const R = 6371000; // m
    const toRad = (d) => (d * Math.PI) / 180;
    const latRef = toRad(ring.reduce((s, p) => s + Number(p.lat || 0), 0) / ring.length);
    // Project to local planar metres.
    const pts = ring.map((p) => ({
      x: toRad(Number(p.lon ?? p.lng ?? 0)) * R * Math.cos(latRef),
      y: toRad(Number(p.lat ?? 0)) * R,
    }));
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    const sqMeters = Math.abs(area2) / 2;
    return sqMeters / 4046.8564224; // m² → acres
  }
  function frPolys(s, userId) { if (!s.polygons.has(userId)) s.polygons.set(userId, []); return s.polygons.get(userId); }

  registerLensAction("forestry", "stand-polygon-save", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.polygons instanceof Map)) s.polygons = new Map();
    const name = frClean(params.name, 160);
    if (!name) return { ok: false, error: "polygon name required" };
    const ring = Array.isArray(params.vertices) ? params.vertices : [];
    if (ring.length < 3) return { ok: false, error: "polygon needs at least 3 vertices" };
    const verts = ring
      .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon ?? p.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    if (verts.length < 3) return { ok: false, error: "polygon needs at least 3 valid coordinates" };
    const acres = Math.round(polygonAcres(verts) * 100) / 100;
    const poly = {
      id: frId("poly"), name,
      standId: frClean(params.standId, 80) || null,
      vertices: verts,
      acres,
      perimeterM: Math.round((() => {
        let p = 0;
        for (let i = 0; i < verts.length; i++) {
          const a = verts[i], b = verts[(i + 1) % verts.length];
          const dLat = (b.lat - a.lat) * 111320;
          const dLon = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
          p += Math.sqrt(dLat * dLat + dLon * dLon);
        }
        return p;
      })()),
      notes: frClean(params.notes, 600) || "",
      createdAt: new Date().toISOString(),
    };
    frPolys(s, frActor(ctx)).push(poly);
    saveForestry();
    return { ok: true, result: { polygon: poly } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("forestry", "stand-polygon-list", (ctx, _a, _params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.polygons instanceof Map)) s.polygons = new Map();
    const polygons = frPolys(s, frActor(ctx));
    return { ok: true, result: { polygons, count: polygons.length, totalAcres: Math.round(polygons.reduce((n, p) => n + p.acres, 0) * 100) / 100 } };
  });

  registerLensAction("forestry", "stand-polygon-delete", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.polygons instanceof Map)) s.polygons = new Map();
    const arr = frPolys(s, frActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "polygon not found" };
    arr.splice(i, 1);
    saveForestry();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Inventory cruise plotting — sample plots + statistical summary ──
  function frCruises(s, userId) { if (!s.cruises.has(userId)) s.cruises.set(userId, []); return s.cruises.get(userId); }

  registerLensAction("forestry", "cruise-plot-add", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.cruises instanceof Map)) s.cruises = new Map();
    const standId = frClean(params.standId, 80);
    if (!standId) return { ok: false, error: "standId required" };
    const bafOrRadius = frNum(params.expansionFactor);
    const plotMethod = params.method === "fixed_radius" ? "fixed_radius" : "prism_baf";
    const trees = Array.isArray(params.trees) ? params.trees : [];
    if (trees.length === 0) return { ok: false, error: "plot needs at least one tallied tree" };
    const tallied = trees.map((t) => {
      const dbh = Math.max(0, frNum(t.dbhInches));
      const height = Math.max(0, frNum(t.heightFeet));
      const ba = 0.005454 * dbh * dbh; // basal area per tree, sq ft
      // board feet per tree (Doyle-ish, same shape as timberVolume macro)
      const bf = 0.00545415 * dbh * dbh * height * 0.5;
      return { species: frClean(t.species, 40) || "mixed", dbhInches: dbh, heightFeet: height, basalArea: Math.round(ba * 1000) / 1000, boardFeet: Math.round(bf) };
    });
    // expansion factor: prism BAF → trees/acre = BAF / BA-per-tree; fixed → 43560/plot area
    const ef = plotMethod === "prism_baf"
      ? (bafOrRadius > 0 ? bafOrRadius : 10)
      : (bafOrRadius > 0 ? 43560 / (Math.PI * bafOrRadius * bafOrRadius) : 0);
    const plot = {
      id: frId("plot"), standId,
      method: plotMethod,
      expansionFactor: Math.round(ef * 100) / 100,
      lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
      lon: Number.isFinite(Number(params.lon ?? params.lng)) ? Number(params.lon ?? params.lng) : null,
      trees: tallied,
      treeCount: tallied.length,
      createdAt: new Date().toISOString(),
    };
    frCruises(s, frActor(ctx)).push(plot);
    saveForestry();
    return { ok: true, result: { plot } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("forestry", "cruise-plot-list", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.cruises instanceof Map)) s.cruises = new Map();
    let plots = frCruises(s, frActor(ctx));
    const standId = frClean(params.standId, 80);
    if (standId) plots = plots.filter((p) => p.standId === standId);
    return { ok: true, result: { plots, count: plots.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("forestry", "cruise-plot-delete", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.cruises instanceof Map)) s.cruises = new Map();
    const arr = frCruises(s, frActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "plot not found" };
    arr.splice(i, 1);
    saveForestry();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("forestry", "cruise-summary", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.cruises instanceof Map)) s.cruises = new Map();
    let plots = frCruises(s, frActor(ctx));
    const standId = frClean(params.standId, 80);
    if (standId) plots = plots.filter((p) => p.standId === standId);
    if (plots.length === 0) return { ok: true, result: { plots: 0, message: "No cruise plots yet. Add sample plots to compute a statistical summary." } };
    // Per-plot per-acre estimates via expansion factor.
    const perPlot = plots.map((p) => {
      const tpa = p.trees.reduce((sum, t) => sum + (p.method === "prism_baf" ? (t.basalArea > 0 ? p.expansionFactor / t.basalArea : 0) : p.expansionFactor), 0);
      const baPerAcre = p.trees.reduce((sum, t) => sum + (p.method === "prism_baf" ? p.expansionFactor : t.basalArea * p.expansionFactor), 0);
      const bfPerAcre = p.trees.reduce((sum, t) => sum + t.boardFeet * (p.method === "prism_baf" ? (t.basalArea > 0 ? p.expansionFactor / t.basalArea : 0) : p.expansionFactor), 0);
      return { plotId: p.id, treesPerAcre: tpa, basalAreaPerAcre: baPerAcre, boardFeetPerAcre: bfPerAcre };
    });
    const n = perPlot.length;
    const mean = (key) => perPlot.reduce((sum, r) => sum + r[key], 0) / n;
    const std = (key, m) => n > 1 ? Math.sqrt(perPlot.reduce((sum, r) => sum + (r[key] - m) * (r[key] - m), 0) / (n - 1)) : 0;
    const stat = (key) => {
      const m = mean(key);
      const sd = std(key, m);
      const se = sd / Math.sqrt(n);
      // 95% CI as % of the mean (t≈2 for small samples)
      const ciPct = m > 0 ? Math.round((2 * se / m) * 1000) / 10 : 0;
      return { mean: Math.round(m * 100) / 100, stdDev: Math.round(sd * 100) / 100, stdError: Math.round(se * 100) / 100, ciPercent: ciPct };
    };
    return {
      ok: true,
      result: {
        standId: standId || null,
        plots: n,
        treesPerAcre: stat("treesPerAcre"),
        basalAreaPerAcre: stat("basalAreaPerAcre"),
        boardFeetPerAcre: stat("boardFeetPerAcre"),
        perPlot: perPlot.map((r) => ({
          plotId: r.plotId,
          treesPerAcre: Math.round(r.treesPerAcre),
          basalAreaPerAcre: Math.round(r.basalAreaPerAcre * 10) / 10,
          boardFeetPerAcre: Math.round(r.boardFeetPerAcre),
        })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Pest / disease tracking with treatment scheduling ─────────────
  function frPests(s, userId) { if (!s.pests.has(userId)) s.pests.set(userId, []); return s.pests.get(userId); }
  const PEST_SEVERITY = ["low", "moderate", "high", "severe"];

  registerLensAction("forestry", "pest-report", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.pests instanceof Map)) s.pests = new Map();
    const agent = frClean(params.agent, 120);
    if (!agent) return { ok: false, error: "pest/disease agent name required" };
    const report = {
      id: frId("pst"), agent,
      kind: params.kind === "disease" ? "disease" : "pest",
      standId: frClean(params.standId, 80) || null,
      severity: PEST_SEVERITY.includes(params.severity) ? params.severity : "low",
      affectedAcres: Math.max(0, frNum(params.affectedAcres)),
      detectedDate: frClean(params.detectedDate, 30) || new Date().toISOString().slice(0, 10),
      notes: frClean(params.notes, 800) || "",
      status: "open",
      treatments: [],
      createdAt: new Date().toISOString(),
    };
    frPests(s, frActor(ctx)).push(report);
    saveForestry();
    return { ok: true, result: { report } };
  });

  registerLensAction("forestry", "pest-list", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.pests instanceof Map)) s.pests = new Map();
    let reports = frPests(s, frActor(ctx));
    if (params.status === "open" || params.status === "resolved") reports = reports.filter((r) => r.status === params.status);
    const upcoming = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const r of reports) {
      for (const t of r.treatments) {
        if (!t.completed && t.scheduledDate >= today) upcoming.push({ pestId: r.id, agent: r.agent, ...t });
      }
    }
    upcoming.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    return { ok: true, result: { reports, count: reports.length, openCount: reports.filter((r) => r.status === "open").length, upcomingTreatments: upcoming } };
  });

  registerLensAction("forestry", "pest-schedule-treatment", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.pests instanceof Map)) s.pests = new Map();
    const report = frPests(s, frActor(ctx)).find((r) => r.id === params.pestId);
    if (!report) return { ok: false, error: "pest report not found" };
    const method = frClean(params.method, 160);
    if (!method) return { ok: false, error: "treatment method required" };
    const treatment = {
      id: frId("trt"), method,
      scheduledDate: frClean(params.scheduledDate, 30) || new Date().toISOString().slice(0, 10),
      cost: Math.max(0, frNum(params.cost)),
      notes: frClean(params.notes, 600) || "",
      completed: false,
      completedDate: null,
    };
    report.treatments.push(treatment);
    saveForestry();
    return { ok: true, result: { treatment, report } };
  });

  registerLensAction("forestry", "pest-complete-treatment", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.pests instanceof Map)) s.pests = new Map();
    const report = frPests(s, frActor(ctx)).find((r) => r.id === params.pestId);
    if (!report) return { ok: false, error: "pest report not found" };
    const treatment = report.treatments.find((t) => t.id === params.treatmentId);
    if (!treatment) return { ok: false, error: "treatment not found" };
    treatment.completed = true;
    treatment.completedDate = new Date().toISOString().slice(0, 10);
    if (params.resolveReport) report.status = "resolved";
    saveForestry();
    return { ok: true, result: { treatment, report } };
  });

  // ─── Replanting / silviculture scheduler ───────────────────────────
  function frReplant(s, userId) { if (!s.replanting.has(userId)) s.replanting.set(userId, []); return s.replanting.get(userId); }

  registerLensAction("forestry", "replant-project-create", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.replanting instanceof Map)) s.replanting = new Map();
    const name = frClean(params.name, 160);
    if (!name) return { ok: false, error: "project name required" };
    const acres = Math.max(0, frNum(params.acres));
    if (acres <= 0) return { ok: false, error: "acres must be > 0" };
    const seedlingsPerAcre = Math.max(1, Math.round(frNum(params.seedlingsPerAcre) || 435));
    const project = {
      id: frId("rpl"), name,
      standId: frClean(params.standId, 80) || null,
      species: SPECIES.includes(params.species) ? params.species : "mixed",
      acres,
      seedlingsPerAcre,
      seedlingsOrdered: Math.round(acres * seedlingsPerAcre),
      plannedDate: frClean(params.plannedDate, 30) || "",
      method: ["bare_root", "containerized", "direct_seed", "natural"].includes(params.method) ? params.method : "containerized",
      status: "planned",
      surveys: [],
      notes: frClean(params.notes, 800) || "",
      createdAt: new Date().toISOString(),
    };
    frReplant(s, frActor(ctx)).push(project);
    saveForestry();
    return { ok: true, result: { project } };
  });

  registerLensAction("forestry", "replant-list", (ctx, _a, _params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.replanting instanceof Map)) s.replanting = new Map();
    const projects = frReplant(s, frActor(ctx)).map((p) => {
      const latest = p.surveys.length ? p.surveys[p.surveys.length - 1] : null;
      return { ...p, latestSurvival: latest ? latest.survivalPercent : null, surveyCount: p.surveys.length };
    });
    return {
      ok: true,
      result: {
        projects, count: projects.length,
        totalAcres: projects.reduce((n, p) => n + p.acres, 0),
        totalSeedlings: projects.reduce((n, p) => n + p.seedlingsOrdered, 0),
      },
    };
  });

  registerLensAction("forestry", "replant-update-status", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.replanting instanceof Map)) s.replanting = new Map();
    const project = frReplant(s, frActor(ctx)).find((p) => p.id === params.id);
    if (!project) return { ok: false, error: "project not found" };
    const status = ["planned", "ordered", "planted", "established", "failed"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "invalid status" };
    project.status = status;
    if (status === "planted" && !project.plantedDate) project.plantedDate = new Date().toISOString().slice(0, 10);
    saveForestry();
    return { ok: true, result: { project } };
  });

  registerLensAction("forestry", "replant-survival-survey", (ctx, _a, params = {}) => {
  try {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.replanting instanceof Map)) s.replanting = new Map();
    const project = frReplant(s, frActor(ctx)).find((p) => p.id === params.id);
    if (!project) return { ok: false, error: "project not found" };
    const sampled = Math.max(1, Math.round(frNum(params.sampledSeedlings)));
    const alive = Math.max(0, Math.min(sampled, Math.round(frNum(params.aliveSeedlings))));
    const survey = {
      id: frId("svy"),
      date: frClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      sampledSeedlings: sampled,
      aliveSeedlings: alive,
      survivalPercent: Math.round((alive / sampled) * 1000) / 10,
      notes: frClean(params.notes, 600) || "",
    };
    project.surveys.push(survey);
    // Restocking guidance — < 60% survival typically triggers a replant.
    survey.recommendation = survey.survivalPercent < 60
      ? "Below restocking threshold — schedule interplanting"
      : survey.survivalPercent < 80
        ? "Acceptable — monitor next season"
        : "Well stocked";
    saveForestry();
    return { ok: true, result: { survey, project } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Carbon-credit registry workflow ───────────────────────────────
  function frCredits(s, userId) { if (!s.carbonCredits.has(userId)) s.carbonCredits.set(userId, []); return s.carbonCredits.get(userId); }

  registerLensAction("forestry", "carbon-credit-issue", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.carbonCredits instanceof Map)) s.carbonCredits = new Map();
    const projectName = frClean(params.projectName, 160);
    if (!projectName) return { ok: false, error: "projectName required" };
    const tons = Math.max(0, frNum(params.tonsCO2));
    if (tons <= 0) return { ok: false, error: "tonsCO2 must be > 0" };
    const vintage = Math.round(frNum(params.vintageYear)) || new Date().getFullYear();
    if (vintage < 1990 || vintage > new Date().getFullYear() + 1) return { ok: false, error: "vintageYear out of range" };
    const credit = {
      id: frId("crd"), projectName,
      standId: frClean(params.standId, 80) || null,
      registry: frClean(params.registry, 60) || "self-registered",
      vintageYear: vintage,
      tonsCO2: Math.round(tons * 100) / 100,
      pricePerTon: Math.max(0, frNum(params.pricePerTon)) || 25,
      methodology: frClean(params.methodology, 120) || "",
      status: "pending_verification",
      verifiedDate: null,
      verifier: null,
      retiredDate: null,
      retiredBy: null,
      serialNumber: null,
      createdAt: new Date().toISOString(),
    };
    credit.estimatedValue = Math.round(credit.tonsCO2 * credit.pricePerTon);
    frCredits(s, frActor(ctx)).push(credit);
    saveForestry();
    return { ok: true, result: { credit } };
  });

  registerLensAction("forestry", "carbon-credit-verify", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.carbonCredits instanceof Map)) s.carbonCredits = new Map();
    const credit = frCredits(s, frActor(ctx)).find((c) => c.id === params.id);
    if (!credit) return { ok: false, error: "credit not found" };
    if (credit.status !== "pending_verification") return { ok: false, error: `credit is ${credit.status}, cannot verify` };
    const verifier = frClean(params.verifier, 120);
    if (!verifier) return { ok: false, error: "verifier required" };
    credit.status = "verified";
    credit.verifier = verifier;
    credit.verifiedDate = new Date().toISOString().slice(0, 10);
    credit.serialNumber = `${credit.registry.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "CCR"}-${credit.vintageYear}-${credit.id.slice(-6).toUpperCase()}`;
    saveForestry();
    return { ok: true, result: { credit } };
  });

  registerLensAction("forestry", "carbon-credit-retire", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.carbonCredits instanceof Map)) s.carbonCredits = new Map();
    const credit = frCredits(s, frActor(ctx)).find((c) => c.id === params.id);
    if (!credit) return { ok: false, error: "credit not found" };
    if (credit.status !== "verified") return { ok: false, error: "only verified credits can be retired" };
    credit.status = "retired";
    credit.retiredDate = new Date().toISOString().slice(0, 10);
    credit.retiredBy = frClean(params.retiredBy, 120) || "owner";
    credit.retirementReason = frClean(params.reason, 300) || "";
    saveForestry();
    return { ok: true, result: { credit } };
  });

  registerLensAction("forestry", "carbon-credit-list", (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.carbonCredits instanceof Map)) s.carbonCredits = new Map();
    let credits = frCredits(s, frActor(ctx));
    if (["pending_verification", "verified", "retired"].includes(params.status)) credits = credits.filter((c) => c.status === params.status);
    return {
      ok: true,
      result: {
        credits, count: credits.length,
        totalTons: Math.round(credits.reduce((n, c) => n + c.tonsCO2, 0) * 100) / 100,
        verifiedTons: Math.round(credits.filter((c) => c.status === "verified").reduce((n, c) => n + c.tonsCO2, 0) * 100) / 100,
        retiredTons: Math.round(credits.filter((c) => c.status === "retired").reduce((n, c) => n + c.tonsCO2, 0) * 100) / 100,
        totalValue: Math.round(credits.reduce((n, c) => n + (c.estimatedValue || 0), 0)),
      },
    };
  });

  // feed — ingest active US wildfire incidents (InciWeb) as visible DTUs.
  registerLensAction("forestry", "feed", async (ctx, _a, params = {}) => {
    const s = getForestryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch(`${INCIWEB_BASE}/incidents`);
      if (!r.ok) return { ok: false, error: `inciweb ${r.status}` };
      const data = await r.json();
      const incidents = (Array.isArray(data) ? data : data.data || data.incidents || []).slice(0, limit);
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const inc of incidents) {
        const id = String(inc.id || inc.incident_id || inc.name);
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const name = inc.name || inc.title || "Wildfire incident";
        const title = `Wildfire: ${name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nType: ${inc.type || "?"}\nState: ${inc.state || inc.location || "?"}\nSize: ${inc.size || inc.acres || "?"} acres\nUpdated: ${inc.updated || inc.last_updated || "?"}`,
          tags: ["forestry", "feed", "wildfire", "inciweb"],
          source: "inciweb-feed",
          meta: { incidentId: id, name, type: inc.type, state: inc.state, size: inc.size || inc.acres },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveForestry();
      return { ok: true, result: { ingested, skipped, source: "inciweb-active-fires", dtuIds } };
    } catch (e) {
      return { ok: false, error: `inciweb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
