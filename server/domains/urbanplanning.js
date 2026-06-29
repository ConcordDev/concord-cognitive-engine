// server/domains/urbanplanning.js
//
// Pure-compute urban planning (zoning, walkability, density, traffic
// impact) plus real US Census ACS demographics + HUD Income Limits.
// Census API works anonymously (low rate); CENSUS_API_KEY env raises
// the limit. HUD API needs HUD_API_TOKEN (free at huduser.gov/hudapi).

const CENSUS_API = "https://api.census.gov/data";
const HUD_API = "https://www.huduser.gov/hudapi/public";

export default function registerUrbanplanningActions(registerLensAction) {
  registerLensAction("urban-planning", "zoningAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; if (data.lotSizeSqFt != null) { const v = Number(data.lotSizeSqFt); if (!Number.isFinite(v) || v <= 0 || v > 1e10) return { ok: false, error: "invalid_lotSizeSqFt" }; } const zone = (data.zoneType || "residential").toLowerCase(); const rawLot = parseFloat(data.lotSizeSqFt); const lotSize = Number.isFinite(rawLot) ? (rawLot > 0 ? rawLot : 0) : 5000; const specs = { residential: { far: 0.5, maxHeight: 35, setback: 20, parking: 2, density: "low" }, commercial: { far: 2.0, maxHeight: 60, setback: 10, parking: 1, density: "medium" }, mixed: { far: 3.0, maxHeight: 85, setback: 5, parking: 1.5, density: "high" }, industrial: { far: 1.0, maxHeight: 45, setback: 30, parking: 0.5, density: "low" } }; const s = specs[zone] || specs.residential; const maxBuildable = Math.round(lotSize * s.far); return { ok: true, result: { zoneType: zone, lotSize, floorAreaRatio: s.far, maxBuildableSqFt: maxBuildable, maxHeight: `${s.maxHeight} ft`, setback: `${s.setback} ft`, parkingRequired: `${s.parking} spaces per unit`, density: s.density } }; });
  registerLensAction("urban-planning", "walkabilityScore", (ctx, artifact, _params) => { const amenities = artifact.data?.amenities || []; const categories = { grocery: 0, restaurant: 0, school: 0, park: 0, transit: 0, retail: 0, healthcare: 0 }; for (const a of amenities) { const cat = (a.category || "retail").toLowerCase(); if (categories[cat] !== undefined) categories[cat] += (a.withinWalkingDistance ? 1 : 0.3); } const maxPoints = Object.keys(categories).length * 2; const score = Math.min(100, Math.round(Object.values(categories).reduce((s,v)=>s+v,0) / maxPoints * 100)); return { ok: true, result: { walkabilityScore: score, rating: score >= 90 ? "walkers-paradise" : score >= 70 ? "very-walkable" : score >= 50 ? "somewhat-walkable" : score >= 25 ? "car-dependent" : "almost-all-errands-require-car", amenityScores: categories, totalAmenities: amenities.length } }; });
  registerLensAction("urban-planning", "densityCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; for (const f of ["population", "housingUnits"]) { if (data[f] != null) { const v = Number(data[f]); if (!Number.isFinite(v) || v < 0 || v > 1e12) return { ok: false, error: `invalid_${f}` }; } } if (data.areaSqMiles != null) { const a = Number(data.areaSqMiles); if (!Number.isFinite(a) || a <= 0 || a > 1e9) return { ok: false, error: "invalid_areaSqMiles" }; } const population = parseInt(data.population) || 0; const areaSqMiles = parseFloat(data.areaSqMiles) || 1; const units = parseInt(data.housingUnits) || 0; const popDensity = Math.round(population / areaSqMiles); const unitDensity = Math.round(units / areaSqMiles); return { ok: true, result: { population, area: `${areaSqMiles} sq mi`, populationDensity: `${popDensity}/sq mi`, housingDensity: `${unitDensity} units/sq mi`, classification: popDensity > 10000 ? "urban-core" : popDensity > 3000 ? "urban" : popDensity > 1000 ? "suburban" : "rural", transitViability: popDensity > 5000 ? "supports-rail" : popDensity > 2000 ? "supports-bus" : "car-dependent" } }; });
  registerLensAction("urban-planning", "trafficImpact", (ctx, artifact, _params) => { const data = artifact.data || {}; for (const f of ["newHousingUnits", "newCommercialSqFt"]) { if (data[f] != null) { const v = Number(data[f]); if (!Number.isFinite(v) || v < 0 || v > 1e12) return { ok: false, error: `invalid_${f}` }; } } if (data.currentADT != null) { const c = Number(data.currentADT); if (!Number.isFinite(c) || c <= 0 || c > 1e12) return { ok: false, error: "invalid_currentADT" }; } const newUnits = parseInt(data.newHousingUnits) || 0; const newCommercialSqFt = parseFloat(data.newCommercialSqFt) || 0; const tripsPerUnit = 8; const tripsPerSqFt = 0.01; const newTrips = Math.round(newUnits * tripsPerUnit + newCommercialSqFt * tripsPerSqFt); const peakHourTrips = Math.round(newTrips * 0.1); const currentADT = parseInt(data.currentADT) || 10000; const increase = Math.round((newTrips / currentADT) * 100); return { ok: true, result: { newDailyTrips: newTrips, peakHourTrips, currentADT, percentIncrease: increase, impactLevel: increase > 10 ? "significant" : increase > 5 ? "moderate" : "minimal", mitigation: increase > 5 ? ["Traffic signal optimization", "Turn lane additions", "Pedestrian improvements", "Transit service enhancement"] : ["Standard roadway capacity sufficient"] } }; });

  /**
   * census-acs-county — Real US Census ACS 5-year demographic data
   * for a county (FIPS state+county code). Returns population,
   * median income, age distribution, race/ethnicity, education,
   * commute time.
   *
   * params: { stateFips: "06", countyFips: "075" (S.F.), year?: 2022+ }
   */
  registerLensAction("urban-planning", "census-acs-county", async (_ctx, _artifact, params = {}) => {
    const stateFips = String(params.stateFips || "").padStart(2, "0");
    const countyFips = String(params.countyFips || "").padStart(3, "0");
    if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyFips)) {
      return { ok: false, error: "stateFips (2 digits) + countyFips (3 digits) required" };
    }
    const year = Number(params.year) || 2023;
    const apiKey = process.env.CENSUS_API_KEY;
    const VARS = [
      "B01003_001E",  // total population
      "B19013_001E",  // median household income
      "B01002_001E",  // median age
      "B15003_022E",  // bachelor's degree count
      "B15003_001E",  // total 25+ for education denom
      "B25003_002E",  // owner-occupied units
      "B25003_003E",  // renter-occupied units
      "B08303_001E",  // total commuters
      "B08303_013E",  // 60+ min commute
      "NAME",
    ];
    const url = `${CENSUS_API}/${year}/acs/acs5?get=${VARS.join(",")}&for=county:${countyFips}&in=state:${stateFips}${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`census ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data) || data.length < 2) {
        return { ok: false, error: "census returned no data for that county" };
      }
      const [headers, row] = data;
      const idx = (k) => headers.indexOf(k);
      const n = (k) => parseFloat(row[idx(k)]) || 0;
      const totalPop = n("B01003_001E");
      const total25 = n("B15003_001E");
      const bachelors = n("B15003_022E");
      const owners = n("B25003_002E");
      const renters = n("B25003_003E");
      const totalCommute = n("B08303_001E");
      const longCommute = n("B08303_013E");
      return {
        ok: true,
        result: {
          stateFips, countyFips, year,
          countyName: row[idx("NAME")],
          totalPopulation: totalPop,
          medianHouseholdIncome: n("B19013_001E"),
          medianAge: n("B01002_001E"),
          bachelorsPlusPct: total25 > 0 ? Math.round((bachelors / total25) * 1000) / 10 : null,
          ownerOccupiedPct: owners + renters > 0 ? Math.round((owners / (owners + renters)) * 1000) / 10 : null,
          longCommutePct: totalCommute > 0 ? Math.round((longCommute / totalCommute) * 1000) / 10 : null,
          source: "census-acs-5year",
        },
      };
    } catch (e) {
      return { ok: false, error: `census unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * hud-income-limits — Real HUD Income Limits by ZIP/county/MSA.
   * Determines affordable-housing eligibility thresholds (30/50/80/120%
   * AMI). Requires HUD_API_TOKEN env (free at huduser.gov/hudapi).
   *
   * params: { stateAbbr: 2-letter, countyFips?: 3-digit, year?: 2024+ }
   */
  registerLensAction("urban-planning", "hud-income-limits", async (_ctx, _artifact, params = {}) => {
    const token = process.env.HUD_API_TOKEN;
    if (!token) return { ok: false, error: "HUD_API_TOKEN env required (free at huduser.gov/hudapi/public/register)" };
    const stateAbbr = String(params.stateAbbr || "").toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(stateAbbr)) return { ok: false, error: "stateAbbr (2-letter) required" };
    const year = Number(params.year) || new Date().getFullYear() - 1;
    const entityid = params.countyFips ? `${stateAbbr}99999` : stateAbbr;  // statewide if no county
    try {
      const r = await fetch(`${HUD_API}/il/data/${entityid}?year=${year}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) return { ok: false, error: "HUD_API_TOKEN invalid" };
      if (!r.ok) throw new Error(`hud ${r.status}`);
      const data = await r.json();
      const d = data.data;
      if (!d) return { ok: false, error: "HUD returned no data for that area" };
      return {
        ok: true,
        result: {
          stateAbbr, countyFips: params.countyFips, year,
          areaName: d.area_name,
          medianIncome: d.median_income,
          veryLowIncome50Pct: d.very_low,
          extremelyLowIncome30Pct: d.extremely_low,
          lowIncome80Pct: d.low,
          source: "hud-income-limits",
        },
      };
    } catch (e) {
      return { ok: false, error: `hud unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Esri Urban parity — scenarios, parcels, massing, impacts ───────
  // Persistent per-user planning workspace: development scenarios,
  // parcels, 3D massing envelopes, impact projections, transit
  // catchments, public-comment workflow and shareable plan exports.

  function getUpState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.urbanPlanningLens) STATE.urbanPlanningLens = {};
    const s = STATE.urbanPlanningLens;
    for (const k of ["scenarios", "parcels", "comments"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveUpState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const upId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const upNow = () => new Date().toISOString();
  const upAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const upList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const upNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const upClean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const round = (n, p = 0) => { const m = 10 ** p; return Math.round(n * m) / m; };

  // Zoning specs reused by zoningAnalysis, shared with massing/impacts.
  const ZONE_SPECS = {
    residential: { far: 0.5, maxHeight: 35, setback: 20, lotCoverage: 0.4 },
    commercial: { far: 2.0, maxHeight: 60, setback: 10, lotCoverage: 0.7 },
    mixed: { far: 3.0, maxHeight: 85, setback: 5, lotCoverage: 0.8 },
    industrial: { far: 1.0, maxHeight: 45, setback: 30, lotCoverage: 0.6 },
  };
  const FLOOR_HEIGHT_FT = 11;        // typical floor-to-floor
  const SQFT_PER_UNIT = 900;         // avg residential unit
  const SQFT_PER_JOB = 350;          // commercial sqft per job
  const PERSONS_PER_UNIT = 2.4;      // avg household size
  const EMISSIONS_T_PER_UNIT = 4.6;  // operational CO2e tonnes/yr per dwelling
  const EMISSIONS_T_PER_JOB = 2.1;   // operational CO2e tonnes/yr per job

  /** Compute a 3D massing envelope + impact bundle for one parcel/scenario. */
  function computeMassing(zoneType, lotSizeSqFt, opts = {}) {
    const zone = String(zoneType || "residential").toLowerCase();
    const spec = ZONE_SPECS[zone] || ZONE_SPECS.residential;
    const lot = Math.max(0, upNum(lotSizeSqFt, 5000));
    const efficiency = Math.min(1, Math.max(0.4, upNum(opts.efficiency, 0.82)));
    const footprintSqFt = round(lot * spec.lotCoverage);
    const maxBuildableSqFt = round(lot * spec.far);
    const floors = footprintSqFt > 0
      ? Math.max(1, Math.min(
          Math.floor(spec.maxHeight / FLOOR_HEIGHT_FT),
          Math.round(maxBuildableSqFt / footprintSqFt)))
      : 1;
    const buildingHeightFt = floors * FLOOR_HEIGHT_FT;
    const grossFloorAreaSqFt = round(footprintSqFt * floors);
    const netFloorAreaSqFt = round(grossFloorAreaSqFt * efficiency);
    const mix = String(opts.useMix || zone).toLowerCase();
    const residentialShare = mix === "commercial" || mix === "industrial" ? 0
      : mix === "mixed" ? 0.6 : 1;
    const resSqFt = round(netFloorAreaSqFt * residentialShare);
    const commSqFt = round(netFloorAreaSqFt * (1 - residentialShare));
    const dwellingUnits = Math.round(resSqFt / SQFT_PER_UNIT);
    const jobs = Math.round(commSqFt / SQFT_PER_JOB);
    const population = Math.round(dwellingUnits * PERSONS_PER_UNIT);
    const emissionsTpy = round(dwellingUnits * EMISSIONS_T_PER_UNIT
      + jobs * EMISSIONS_T_PER_JOB, 1);
    return {
      zoneType: zone,
      lotSizeSqFt: lot,
      floorAreaRatio: spec.far,
      lotCoveragePct: round(spec.lotCoverage * 100),
      footprintSqFt,
      floors,
      buildingHeightFt,
      maxHeightFt: spec.maxHeight,
      setbackFt: spec.setback,
      grossFloorAreaSqFt,
      netFloorAreaSqFt,
      dwellingUnits,
      jobs,
      population,
      housingUnits: dwellingUnits,
      emissionsTonnesPerYear: emissionsTpy,
      // Box dimensions (ft) for a simple 3D massing render.
      envelope: {
        widthFt: round(Math.sqrt(footprintSqFt)),
        depthFt: round(Math.sqrt(footprintSqFt)),
        heightFt: buildingHeightFt,
      },
    };
  }

  // ── Parcels — pull a parcel and auto-fill lot size / zone ───────────
  registerLensAction("urban-planning", "parcel-add", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const apn = upClean(params.apn || params.parcelId, 40);
      if (!apn) return { ok: false, error: "parcel apn/parcelId required" };
      const zone = String(params.zoneType || "residential").toLowerCase();
      const parcel = {
        id: upId("parcel"),
        apn,
        address: upClean(params.address, 160),
        zoneType: ZONE_SPECS[zone] ? zone : "residential",
        lotSizeSqFt: Math.max(0, upNum(params.lotSizeSqFt, 5000)),
        lat: upNum(params.lat, 0) || null,
        lng: upNum(params.lng, 0) || null,
        owner: upClean(params.owner, 120),
        district: upClean(params.district, 80),
        createdAt: upNow(),
      };
      upList(s.parcels, upAid(ctx)).push(parcel);
      saveUpState();
      return { ok: true, result: { parcel } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "parcel-list", (ctx, _a, _params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      return { ok: true, result: { parcels: upList(s.parcels, upAid(ctx)) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "parcel-remove", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.parcels, upAid(ctx));
      const before = arr.length;
      s.parcels.set(upAid(ctx), arr.filter((p) => p.id !== params.id));
      saveUpState();
      return { ok: true, result: { removed: before - s.parcels.get(upAid(ctx)).length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── 3D massing / building-envelope visualization ────────────────────
  registerLensAction("urban-planning", "massingEnvelope", (_ctx, artifact, params = {}) => {
    try {
      const data = { ...(artifact?.data || {}), ...params };
      // Fail-CLOSED: poisoned lotSizeSqFt/efficiency must not feed computeMassing.
      if (data.lotSizeSqFt != null) { const v = Number(data.lotSizeSqFt); if (!Number.isFinite(v) || v <= 0 || v > 1e10) return { ok: false, error: "invalid_lotSizeSqFt" }; }
      if (data.efficiency != null) { const e = Number(data.efficiency); if (!Number.isFinite(e) || e <= 0 || e > 1) return { ok: false, error: "invalid_efficiency" }; }
      const massing = computeMassing(
        data.zoneType,
        data.lotSizeSqFt,
        { efficiency: data.efficiency, useMix: data.useMix });
      return { ok: true, result: massing };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Scenario planning — alternative development scenarios ────────────
  registerLensAction("urban-planning", "scenario-create", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = upClean(params.name, 120);
      if (!name) return { ok: false, error: "scenario name required" };
      const zone = String(params.zoneType || "residential").toLowerCase();
      const scenario = {
        id: upId("scn"),
        name,
        description: upClean(params.description, 280),
        zoneType: ZONE_SPECS[zone] ? zone : "residential",
        lotSizeSqFt: Math.max(0, upNum(params.lotSizeSqFt, 5000)),
        useMix: String(params.useMix || zone).toLowerCase(),
        efficiency: Math.min(1, Math.max(0.4, upNum(params.efficiency, 0.82))),
        parcelId: upClean(params.parcelId, 40) || null,
        createdAt: upNow(),
      };
      upList(s.scenarios, upAid(ctx)).push(scenario);
      saveUpState();
      return { ok: true, result: { scenario } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "scenario-list", (ctx, _a, _params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scenarios = upList(s.scenarios, upAid(ctx)).map((sc) => ({
        ...sc,
        impacts: computeMassing(sc.zoneType, sc.lotSizeSqFt,
          { efficiency: sc.efficiency, useMix: sc.useMix }),
      }));
      return { ok: true, result: { scenarios } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "scenario-remove", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.scenarios, upAid(ctx));
      const before = arr.length;
      s.scenarios.set(upAid(ctx), arr.filter((sc) => sc.id !== params.id));
      saveUpState();
      return { ok: true, result: { removed: before - s.scenarios.get(upAid(ctx)).length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Scenario comparison — side-by-side impact dashboard ─────────────
  registerLensAction("urban-planning", "scenario-compare", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const all = upList(s.scenarios, upAid(ctx));
      const ids = Array.isArray(params.ids) ? params.ids : null;
      const chosen = (ids ? all.filter((sc) => ids.includes(sc.id)) : all);
      if (chosen.length === 0) return { ok: false, error: "no scenarios to compare" };
      const rows = chosen.map((sc) => ({
        id: sc.id,
        name: sc.name,
        ...computeMassing(sc.zoneType, sc.lotSizeSqFt,
          { efficiency: sc.efficiency, useMix: sc.useMix }),
      }));
      const metrics = ["dwellingUnits", "jobs", "population",
        "grossFloorAreaSqFt", "emissionsTonnesPerYear", "floors"];
      const totals = {};
      const best = {};
      for (const m of metrics) {
        totals[m] = round(rows.reduce((a, r) => a + (r[m] || 0), 0), 1);
        // For emissions, lowest is best; otherwise highest yield is best.
        const sorted = [...rows].sort((a, b) =>
          m === "emissionsTonnesPerYear" ? a[m] - b[m] : b[m] - a[m]);
        best[m] = sorted[0]?.id || null;
      }
      return { ok: true, result: { scenarios: rows, metrics, totals, best, count: rows.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Impact dashboard — population/jobs/housing/emissions per scenario ─
  registerLensAction("urban-planning", "impactDashboard", (_ctx, artifact, params = {}) => {
    try {
      const data = { ...(artifact?.data || {}), ...params };
      const m = computeMassing(data.zoneType, data.lotSizeSqFt,
        { efficiency: data.efficiency, useMix: data.useMix });
      const baselinePop = Math.max(0, upNum(data.baselinePopulation, 0));
      const baselineJobs = Math.max(0, upNum(data.baselineJobs, 0));
      const popGrowthPct = baselinePop > 0
        ? round((m.population / baselinePop) * 100, 1) : null;
      const jobsGrowthPct = baselineJobs > 0
        ? round((m.jobs / baselineJobs) * 100, 1) : null;
      // Jobs-housing balance: 1.5 is healthy; <1 housing-rich, >2 jobs-rich.
      const jobsHousingRatio = m.dwellingUnits > 0
        ? round(m.jobs / m.dwellingUnits, 2) : null;
      return {
        ok: true,
        result: {
          projections: {
            population: m.population,
            jobs: m.jobs,
            housingUnits: m.dwellingUnits,
            emissionsTonnesPerYear: m.emissionsTonnesPerYear,
            grossFloorAreaSqFt: m.grossFloorAreaSqFt,
          },
          baselinePopulation: baselinePop,
          baselineJobs,
          populationGrowthPct: popGrowthPct,
          jobsGrowthPct,
          jobsHousingRatio,
          jobsHousingBalance: jobsHousingRatio == null ? "n/a"
            : jobsHousingRatio < 1 ? "housing-rich"
              : jobsHousingRatio > 2 ? "jobs-rich" : "balanced",
          emissionsPerCapita: m.population > 0
            ? round(m.emissionsTonnesPerYear / m.population, 2) : null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Transit-coverage analysis — catchment buffers around stops ──────
  registerLensAction("urban-planning", "transitCoverage", (_ctx, artifact, params = {}) => {
    try {
      const data = { ...(artifact?.data || {}), ...params };
      const stops = Array.isArray(data.stops) ? data.stops : [];
      if (stops.length === 0) return { ok: false, error: "stops array required" };
      // Walk-shed radii (meters): typical planning standards.
      const WALK_M = { bus: 400, brt: 600, rail: 800, ferry: 800 };
      const M_PER_DEG_LAT = 111_320;
      const catchments = stops.map((st, i) => {
        const mode = String(st.mode || "bus").toLowerCase();
        const radiusM = WALK_M[mode] || WALK_M.bus;
        const lat = upNum(st.lat, 0);
        const lng = upNum(st.lng, 0);
        // circular catchment area in acres
        const areaAcres = round((Math.PI * radiusM * radiusM) / 4046.86, 1);
        return {
          id: st.id || `stop_${i}`,
          name: upClean(st.name || `Stop ${i + 1}`, 80),
          mode,
          lat, lng,
          radiusMeters: radiusM,
          radiusDegLat: round(radiusM / M_PER_DEG_LAT, 5),
          catchmentAcres: areaAcres,
        };
      });
      const totalAcres = round(catchments.reduce((a, c) => a + c.catchmentAcres, 0), 1);
      // Parcels inside any catchment (point-in-circle).
      const parcels = Array.isArray(data.parcels) ? data.parcels : [];
      let served = 0;
      for (const p of parcels) {
        const plat = upNum(p.lat, NaN), plng = upNum(p.lng, NaN);
        if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
        for (const c of catchments) {
          const dLat = (plat - c.lat) * M_PER_DEG_LAT;
          const dLng = (plng - c.lng) * M_PER_DEG_LAT
            * Math.cos((plat * Math.PI) / 180);
          if (Math.sqrt(dLat * dLat + dLng * dLng) <= c.radiusMeters) {
            served++; break;
          }
        }
      }
      return {
        ok: true,
        result: {
          catchments,
          stopCount: catchments.length,
          totalCatchmentAcres: totalAcres,
          parcelsEvaluated: parcels.length,
          parcelsServed: served,
          parcelCoveragePct: parcels.length > 0
            ? round((served / parcels.length) * 100, 1) : null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Public-comment / stakeholder review workflow ────────────────────
  registerLensAction("urban-planning", "comment-add", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const subjectId = upClean(params.subjectId, 60);
      if (!subjectId) return { ok: false, error: "subjectId (project/scenario id) required" };
      const body = upClean(params.body, 1000);
      if (!body) return { ok: false, error: "comment body required" };
      const stance = ["support", "oppose", "neutral"].includes(
        String(params.stance).toLowerCase())
        ? String(params.stance).toLowerCase() : "neutral";
      const comment = {
        id: upId("cmt"),
        subjectId,
        author: upClean(params.author, 80) || "Anonymous",
        stance,
        body,
        status: "open",
        createdAt: upNow(),
      };
      upList(s.comments, upAid(ctx)).push(comment);
      saveUpState();
      return { ok: true, result: { comment } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "comment-list", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let comments = upList(s.comments, upAid(ctx));
      const subjectId = upClean(params.subjectId, 60);
      if (subjectId) comments = comments.filter((c) => c.subjectId === subjectId);
      const tally = { support: 0, oppose: 0, neutral: 0 };
      for (const c of comments) tally[c.stance] = (tally[c.stance] || 0) + 1;
      return { ok: true, result: { comments, total: comments.length, tally } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "comment-resolve", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.comments, upAid(ctx));
      const c = arr.find((x) => x.id === params.id);
      if (!c) return { ok: false, error: "comment not found" };
      const status = ["open", "reviewed", "addressed"].includes(
        String(params.status).toLowerCase())
        ? String(params.status).toLowerCase() : "reviewed";
      c.status = status;
      c.resolvedAt = upNow();
      saveUpState();
      return { ok: true, result: { comment: c } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Export plan as a shareable report (structured text payload) ─────
  registerLensAction("urban-planning", "exportPlan", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = upAid(ctx);
      const scenarios = upList(s.scenarios, uid).map((sc) => ({
        ...sc,
        impacts: computeMassing(sc.zoneType, sc.lotSizeSqFt,
          { efficiency: sc.efficiency, useMix: sc.useMix }),
      }));
      const parcels = upList(s.parcels, uid);
      const comments = upList(s.comments, uid);
      const title = upClean(params.title, 160) || "Urban Plan Report";
      const lines = [];
      lines.push(`# ${title}`);
      lines.push(`Generated ${upNow()}`);
      lines.push("");
      lines.push(`## Parcels (${parcels.length})`);
      for (const p of parcels) {
        lines.push(`- ${p.apn} — ${p.address || "no address"} `
          + `[${p.zoneType}, ${p.lotSizeSqFt.toLocaleString()} sqft]`);
      }
      lines.push("");
      lines.push(`## Development Scenarios (${scenarios.length})`);
      for (const sc of scenarios) {
        const im = sc.impacts;
        lines.push(`### ${sc.name}`);
        if (sc.description) lines.push(sc.description);
        lines.push(`- Zone: ${sc.zoneType} | Lot: ${sc.lotSizeSqFt.toLocaleString()} sqft`);
        lines.push(`- Massing: ${im.floors} floors, ${im.buildingHeightFt} ft, `
          + `${im.grossFloorAreaSqFt.toLocaleString()} sqft GFA`);
        lines.push(`- Yield: ${im.dwellingUnits} units, ${im.jobs} jobs, `
          + `${im.population} residents`);
        lines.push(`- Emissions: ${im.emissionsTonnesPerYear} t CO2e/yr`);
        lines.push("");
      }
      lines.push(`## Public Comments (${comments.length})`);
      for (const c of comments) {
        lines.push(`- [${c.stance}] ${c.author}: ${c.body} (${c.status})`);
      }
      const reportText = lines.join("\n");
      return {
        ok: true,
        result: {
          title,
          generatedAt: upNow(),
          reportText,
          format: "markdown",
          counts: {
            parcels: parcels.length,
            scenarios: scenarios.length,
            comments: comments.length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
