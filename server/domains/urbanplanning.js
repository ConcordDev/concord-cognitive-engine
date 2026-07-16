// server/domains/urbanplanning.js
//
// Pure-compute urban planning (zoning, walkability, density, traffic
// impact) plus real US Census ACS demographics + HUD Income Limits.
// Census API works anonymously (low rate); CENSUS_API_KEY env raises
// the limit. HUD API needs HUD_API_TOKEN (free at huduser.gov/hudapi).

const CENSUS_API = "https://api.census.gov/data";
const HUD_API = "https://www.huduser.gov/hudapi/public";

// ─── Real solar position (NOAA algorithm) + shadow geometry ───────────────
// Backs the shadowStudy macro (below). Module-level + named-exported so
// they're directly unit-testable with exact expected values, independent
// of the registerLensAction wiring.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Real solar altitude + azimuth for a given latitude/longitude (degrees)
 * and UTC instant, via the NOAA Solar Calculator algorithm — the Spencer
 * (1971) Fourier-series approximation for the equation of time and solar
 * declination, exactly as published by NOAA's Global Monitoring Laboratory
 * ("General Solar Position Calculations",
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF). That approximation's
 * declination/equation-of-time accuracy is ~0.01deg — good enough for a
 * shadow study; this is NOT ephemeris-grade (no nutation/aberration/VSOP87
 * terms).
 *
 * Operates entirely in UTC (the NOAA formula's timezone-offset term is
 * fixed at 0 here) — no timezone/DST database is wired up, so every
 * timestamp in/out is true UTC clock time, not local civil time. That is
 * an honest scope limit, not an approximation error: the underlying
 * physics (longitude's effect on true solar time) is still correctly
 * modeled via the `4 * lngDeg` term below.
 *
 * Hand-verified (server/tests/depth/urbanplanning-sun-study-behavior.test.js):
 * at hour angle = 0 (solar noon) this formula reduces algebraically to
 * altitude = 90 - |lat - declination| and azimuth = 180 (due south, for
 * lat > declination) — provable directly from the trig identity
 * sin(lat)*cos(lat-decl) - sin(decl) === cos(lat)*sin(lat-decl). For New
 * York City (40.7128N) on the June solstice (declination ~23.44deg) that
 * gives altitude ~72.7deg, matching the published ~72-73.4deg solar-noon
 * altitude for NYC on June 21 (NOAA/timeanddate reference values).
 */
function computeSolarPosition(latDeg, lngDeg, utcDate) {
  const lat = latDeg * DEG2RAD;
  const startOfYearUtc = Date.UTC(utcDate.getUTCFullYear(), 0, 1);
  const msPerDay = 86400000;
  const dayOfYear = Math.floor((utcDate.getTime() - startOfYearUtc) / msPerDay) + 1;
  const hourUtc = utcDate.getUTCHours() + utcDate.getUTCMinutes() / 60 + utcDate.getUTCSeconds() / 3600;
  const y = utcDate.getUTCFullYear();
  const daysInYear = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;

  // Fractional year, radians (NOAA "gamma").
  const gamma = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1 + (hourUtc - 12) / 24);

  // Equation of time, minutes (Spencer 1971).
  const eqTimeMin = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );

  // Solar declination, radians (Spencer 1971).
  const decl = 0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  // True solar time (minutes); timezone offset is 0 because everything
  // here is UTC end-to-end.
  const timeOffsetMin = eqTimeMin + 4 * lngDeg;
  const trueSolarTimeMin = hourUtc * 60 + timeOffsetMin;

  // Hour angle, degrees (15deg/hour from solar noon), normalized to [-180,180).
  let haDeg = trueSolarTimeMin / 4 - 180;
  haDeg = (((haDeg + 180) % 360) + 360) % 360 - 180;
  const haRad = haDeg * DEG2RAD;

  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(haRad);
  const zenithRad = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const altitudeDeg = 90 - zenithRad * RAD2DEG;

  const sinZenith = Math.sin(zenithRad);
  const azDenom = Math.cos(lat) * sinZenith;
  let azimuthDeg;
  if (Math.abs(azDenom) < 1e-9) {
    // Sun at zenith/nadir (directly overhead) — azimuth is mathematically
    // undefined at this singularity. 180 is a documented convention here,
    // not a fabricated-precision claim; altitude (the load-bearing value)
    // is unaffected.
    azimuthDeg = 180;
  } else {
    const cosAz = Math.min(1, Math.max(-1,
      (Math.sin(lat) * Math.cos(zenithRad) - Math.sin(decl)) / azDenom));
    const azBaseDeg = Math.acos(cosAz) * RAD2DEG;
    azimuthDeg = haDeg > 0 ? (azBaseDeg + 180) % 360 : (540 - azBaseDeg) % 360;
  }

  return {
    altitudeDeg,
    azimuthDeg: ((azimuthDeg % 360) + 360) % 360,
    declinationDeg: decl * RAD2DEG,
    equationOfTimeMin: eqTimeMin,
  };
}

// Guard constants for the shadow-length division (see computeShadow).
const MIN_ALT_FOR_SHADOW_DEG = 0.1;   // grazing-horizon floor for tan() — real shadows near
                                       // the horizon are extremely long, not infinite/NaN.
const SHADOW_LENGTH_CAP_FT = 100000;  // sane cap so a near-horizon sun reports a bounded,
                                       // honestly-labeled-huge number instead of Infinity.

/**
 * Shadow length (ft) + direction (deg, compass) cast by a `heightFt`-tall
 * mass, given real sun altitude/azimuth. Basic right-triangle trig:
 * length = height / tan(altitude); a shadow points directly away from the
 * sun, so direction = azimuth + 180deg. Returns honest nulls (no shadow)
 * when the sun is below the horizon or the mass has no height — never
 * divides by zero / produces Infinity or NaN.
 */
function computeShadow(heightFt, altitudeDeg, azimuthDeg) {
  const sunUp = altitudeDeg > 0;
  if (!sunUp || !(heightFt > 0)) {
    return { sunUp, shadowLengthFt: null, shadowDirectionDeg: null };
  }
  const altForTanDeg = Math.max(altitudeDeg, MIN_ALT_FOR_SHADOW_DEG);
  const lengthFt = Math.min(heightFt / Math.tan(altForTanDeg * DEG2RAD), SHADOW_LENGTH_CAP_FT);
  const directionDeg = ((azimuthDeg + 180) % 360 + 360) % 360;
  return { sunUp: true, shadowLengthFt: lengthFt, shadowDirectionDeg: directionDeg };
}

export { computeSolarPosition, computeShadow };

export default function registerUrbanplanningActions(registerLensAction) {
  registerLensAction("urban-planning", "zoningAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const zone = (data.zoneType || "residential").toLowerCase(); const rawLot = parseFloat(data.lotSizeSqFt); const lotSize = Number.isFinite(rawLot) ? (rawLot > 0 ? rawLot : 0) : 5000; const specs = { residential: { far: 0.5, maxHeight: 35, setback: 20, parking: 2, density: "low" }, commercial: { far: 2.0, maxHeight: 60, setback: 10, parking: 1, density: "medium" }, mixed: { far: 3.0, maxHeight: 85, setback: 5, parking: 1.5, density: "high" }, industrial: { far: 1.0, maxHeight: 45, setback: 30, parking: 0.5, density: "low" } }; const s = specs[zone] || specs.residential; const maxBuildable = Math.round(lotSize * s.far); return { ok: true, result: { zoneType: zone, lotSize, floorAreaRatio: s.far, maxBuildableSqFt: maxBuildable, maxHeight: `${s.maxHeight} ft`, setback: `${s.setback} ft`, parkingRequired: `${s.parking} spaces per unit`, density: s.density } }; });
  registerLensAction("urban-planning", "walkabilityScore", (ctx, artifact, _params) => { const amenities = artifact.data?.amenities || []; const categories = { grocery: 0, restaurant: 0, school: 0, park: 0, transit: 0, retail: 0, healthcare: 0 }; for (const a of amenities) { const cat = (a.category || "retail").toLowerCase(); if (categories[cat] !== undefined) categories[cat] += (a.withinWalkingDistance ? 1 : 0.3); } const maxPoints = Object.keys(categories).length * 2; const score = Math.min(100, Math.round(Object.values(categories).reduce((s,v)=>s+v,0) / maxPoints * 100)); return { ok: true, result: { walkabilityScore: score, rating: score >= 90 ? "walkers-paradise" : score >= 70 ? "very-walkable" : score >= 50 ? "somewhat-walkable" : score >= 25 ? "car-dependent" : "almost-all-errands-require-car", amenityScores: categories, totalAmenities: amenities.length } }; });
  registerLensAction("urban-planning", "densityCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const population = parseInt(data.population) || 0; const areaSqMiles = parseFloat(data.areaSqMiles) || 1; const units = parseInt(data.housingUnits) || 0; const popDensity = Math.round(population / areaSqMiles); const unitDensity = Math.round(units / areaSqMiles); return { ok: true, result: { population, area: `${areaSqMiles} sq mi`, populationDensity: `${popDensity}/sq mi`, housingDensity: `${unitDensity} units/sq mi`, classification: popDensity > 10000 ? "urban-core" : popDensity > 3000 ? "urban" : popDensity > 1000 ? "suburban" : "rural", transitViability: popDensity > 5000 ? "supports-rail" : popDensity > 2000 ? "supports-bus" : "car-dependent" } }; });
  registerLensAction("urban-planning", "trafficImpact", (ctx, artifact, _params) => { const data = artifact.data || {};
    // Fail-CLOSED finite coercion: parseFloat("Infinity")/parseFloat("1e999") both
    // yield Infinity, and `Infinity || d` keeps Infinity (truthy), so the old
    // `parseFloat(x) || 0` pattern leaked Infinity into newTrips/percentIncrease.
    // finPos collapses any non-finite/negative value to the fallback and caps a
    // finite-but-absurd magnitude so the products can never overflow to Infinity.
    const SANE_MAX = 1e12;
    const finPos = (v, d = 0) => { const n = typeof v === "number" ? v : parseFloat(v); return (Number.isFinite(n) && n >= 0) ? Math.min(n, SANE_MAX) : d; };
    const newUnits = finPos(data.newHousingUnits, 0); const newCommercialSqFt = finPos(data.newCommercialSqFt, 0); const tripsPerUnit = 8; const tripsPerSqFt = 0.01; const newTrips = Math.round(newUnits * tripsPerUnit + newCommercialSqFt * tripsPerSqFt); const peakHourTrips = Math.round(newTrips * 0.1); const currentADT = finPos(data.currentADT, 0) || 10000; const increase = currentADT > 0 ? Math.round((newTrips / currentADT) * 100) : 0; return { ok: true, result: { newDailyTrips: newTrips, peakHourTrips, currentADT, percentIncrease: increase, impactLevel: increase > 10 ? "significant" : increase > 5 ? "moderate" : "minimal", mitigation: increase > 5 ? ["Traffic signal optimization", "Turn lane additions", "Pedestrian improvements", "Transit service enhancement"] : ["Standard roadway capacity sufficient"] } }; });

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
    for (const k of ["scenarios", "parcels", "comments", "projects"]) {
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
      const massing = computeMassing(
        data.zoneType,
        data.lotSizeSqFt,
        { efficiency: data.efficiency, useMix: data.useMix });
      return { ok: true, result: massing };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Shadow/sun-path study — real solar position + shadow geometry ────
  // Closes the "Shadow/sun-path 3D massing study" row in
  // docs/lens-specs/urban-planning-capability-map.md / docs/WAVE4_INVENTORY.md.
  // Honest scope: this is a real 2D shadow-path computation — genuine
  // NOAA-algorithm solar position (see computeSolarPosition above) crossed
  // with the massing envelope's height via basic shadow trig, sampled
  // hourly across one UTC day. It is explicitly NOT a rendered 3D massing
  // study (no geometry engine, no renderer) — the `label` field on the
  // result says so, and callers should too.
  registerLensAction("urban-planning", "shadowStudy", (ctx, artifact, params = {}) => {
    try {
      const s = getUpState();
      const data = { ...(artifact?.data || {}), ...params };

      // Location: prefer a real saved parcel's lat/lng; else explicit lat/lng.
      let lat = upNum(data.lat, NaN);
      let lng = upNum(data.lng, NaN);
      let locationSource = "params";
      if (data.parcelId) {
        if (!s) return { ok: false, error: "STATE unavailable" };
        const parcel = upList(s.parcels, upAid(ctx)).find((p) => p.id === data.parcelId);
        if (!parcel) return { ok: false, error: "parcel not found" };
        if (parcel.lat == null || parcel.lng == null) {
          return { ok: false, error: "parcel has no lat/lng on file — add coordinates via parcel-add before running a sun study" };
        }
        lat = parcel.lat; lng = parcel.lng; locationSource = "parcel";
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, error: "lat/lng required (directly, or via a saved parcelId that has coordinates)" };
      }
      if (lat < -90 || lat > 90) return { ok: false, error: "lat must be between -90 and 90" };
      if (lng < -180 || lng > 180) return { ok: false, error: "lng must be between -180 and 180" };

      // Envelope: explicit override wins; else derive from zoning via computeMassing.
      let envelope;
      if (data.envelope && Number.isFinite(upNum(data.envelope.heightFt, NaN))) {
        envelope = {
          heightFt: Math.max(0, upNum(data.envelope.heightFt, 0)),
          widthFt: Math.max(0, upNum(data.envelope.widthFt, 0)),
          depthFt: Math.max(0, upNum(data.envelope.depthFt, 0)),
        };
      } else {
        envelope = computeMassing(data.zoneType, data.lotSizeSqFt,
          { efficiency: data.efficiency, useMix: data.useMix }).envelope;
      }
      if (!(envelope.heightFt > 0)) {
        return { ok: false, error: "envelope heightFt must be greater than 0 (a zero-height mass casts no shadow)" };
      }

      // Date: explicit UTC calendar date (YYYY-MM-DD), else today (UTC).
      // A calendar date (not a single timestamp) is the deliberate scope —
      // callers get the whole day's real shadow path, not one instant. A
      // supplied-but-malformed date is a HARD rejection (never silently
      // swapped for today's date — that would honestly mislead a caller
      // who asked for a specific day, e.g. a solstice study).
      if (data.date != null && data.date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
        return { ok: false, error: "date must be a valid YYYY-MM-DD" };
      }
      const dateStr = data.date || upNow().slice(0, 10);
      const [yy, mo, dd] = dateStr.split("-").map(Number);
      if (!(yy > 1900 && yy < 2200) || mo < 1 || mo > 12 || dd < 1 || dd > 31) {
        return { ok: false, error: "date must be a valid YYYY-MM-DD" };
      }

      // Hourly UTC samples across the day. Hourly resolution is a
      // deliberate scope choice: a true continuous path needs sub-hourly
      // sampling, but hourly already gives a real, honest shadow-path
      // (not a single instant) without pretending to sub-hour precision
      // this algorithm's ~0.01deg accuracy doesn't meaningfully buy.
      // Every timestamp is UTC clock time (see computeSolarPosition doc).
      const samples = [];
      let peakAltitude = -90;
      let peakHourUtc = null;
      for (let h = 0; h < 24; h++) {
        const t = new Date(Date.UTC(yy, mo - 1, dd, h, 0, 0));
        const { altitudeDeg, azimuthDeg } = computeSolarPosition(lat, lng, t);
        const shadow = computeShadow(envelope.heightFt, altitudeDeg, azimuthDeg);
        if (shadow.sunUp && altitudeDeg > peakAltitude) { peakAltitude = altitudeDeg; peakHourUtc = h; }
        samples.push({
          hourUtc: h,
          sunUp: shadow.sunUp,
          altitudeDeg: round(altitudeDeg, 2),
          azimuthDeg: round(azimuthDeg, 2),
          shadowLengthFt: shadow.shadowLengthFt == null ? null : round(shadow.shadowLengthFt, 1),
          shadowDirectionDeg: shadow.shadowDirectionDeg == null ? null : round(shadow.shadowDirectionDeg, 1),
        });
      }
      const daylightSamples = samples.filter((sm) => sm.sunUp);

      return {
        ok: true,
        result: {
          label: "2D shadow-path study — real hourly sun position + shadow length/direction; NOT a rendered 3D massing study",
          location: { lat: round(lat, 5), lng: round(lng, 5), source: locationSource },
          date: dateStr,
          envelope,
          method: "NOAA Solar Calculator algorithm (Spencer 1971 declination + "
            + "equation-of-time series, https://gml.noaa.gov/grad/solcalc/solareqns.PDF), "
            + "computed in UTC throughout. shadowLengthFt = heightFt / tan(altitude); "
            + "shadowDirectionDeg = azimuth + 180deg.",
          resolution: "hourly (24 UTC samples/day)",
          samples,
          daylightHours: daylightSamples.length,
          approxSolarNoon: peakHourUtc == null ? null : {
            hourUtc: peakHourUtc,
            altitudeDeg: round(peakAltitude, 2),
            note: "highest-altitude hourly sample (UTC); true solar noon may fall between samples",
          },
        },
      };
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

  // ── Projects — honest permit-status tracking (proposed→approved→built) ─
  // Closes the "Genuinely missing" gap in
  // docs/lens-specs/urban-planning-capability-map.md: the prior "Projects"
  // tab faked this with a client-only artifact store. This is the real
  // backing macro set. Lifecycle is a HARD-validated enum on
  // project-status-update (unlike comment-resolve's soft default above)
  // because a civic project's proposed→approved→built status is a
  // load-bearing public record, not a stakeholder-comment triage label —
  // silently coercing an unrecognized status to the wrong stage is a more
  // serious honesty violation here than it is for `comment-resolve`.
  const PROJECT_TYPES = [
    "residential_development", "commercial_development", "mixed_use",
    "infrastructure", "public_space", "transit", "rezoning", "other",
  ];
  // Six-stage lifecycle. The capability-map's own framing names
  // proposed→approved→built as the minimum arc, but a real civic project
  // also needs a construction stage (approved projects don't teleport to
  // built) and two honest non-happy-path terminals — most real projects
  // that don't get built were DENIED or CANCELLED, not silently stuck.
  const PROJECT_STATUSES = [
    "proposed", "approved", "under_construction", "built", "denied", "cancelled",
  ];

  registerLensAction("urban-planning", "project-add", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = upClean(params.name, 200);
      if (!name) return { ok: false, error: "project name required" };
      let parcelId = null, parcelApn = null, parcelAddress = null;
      if (params.parcelId != null && upClean(params.parcelId, 40)) {
        parcelId = upClean(params.parcelId, 40);
        const parcels = upList(s.parcels, upAid(ctx));
        const parcel = parcels.find((p) => p.id === parcelId);
        if (!parcel) return { ok: false, error: "parcel not found" };
        parcelApn = parcel.apn;
        parcelAddress = parcel.address;
      }
      const projectType = String(params.projectType || "other").toLowerCase();
      const now = upNow();
      const project = {
        id: upId("proj"),
        name,
        description: upClean(params.description, 2000),
        parcelId,
        parcelApn,
        parcelAddress,
        projectType: PROJECT_TYPES.includes(projectType) ? projectType : "other",
        budget: Math.max(0, upNum(params.budget, 0)),
        permitNumber: upClean(params.permitNumber, 80),
        targetCompletionDate: upClean(params.targetCompletionDate, 30),
        status: "proposed",
        statusHistory: [{ status: "proposed", at: now, note: null }],
        createdAt: now,
        updatedAt: now,
      };
      upList(s.projects, upAid(ctx)).push(project);
      saveUpState();
      return { ok: true, result: { project } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "project-list", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let projects = upList(s.projects, upAid(ctx));
      const status = params.status ? String(params.status).toLowerCase() : null;
      if (status) projects = projects.filter((p) => p.status === status);
      const projectType = params.projectType ? String(params.projectType).toLowerCase() : null;
      if (projectType) projects = projects.filter((p) => p.projectType === projectType);
      const byStatus = {};
      let totalBudget = 0;
      for (const p of projects) {
        byStatus[p.status] = (byStatus[p.status] || 0) + 1;
        totalBudget += upNum(p.budget, 0);
      }
      return {
        ok: true,
        result: { projects, count: projects.length, byStatus, totalBudget: round(totalBudget, 2) },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "project-update", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.projects, upAid(ctx));
      const project = arr.find((p) => p.id === params.id);
      if (!project) return { ok: false, error: "project not found" };
      if (params.name !== undefined) {
        const name = upClean(params.name, 200);
        if (!name) return { ok: false, error: "project name required" };
        project.name = name;
      }
      if (params.description !== undefined) project.description = upClean(params.description, 2000);
      if (params.budget !== undefined) project.budget = Math.max(0, upNum(params.budget, project.budget));
      if (params.permitNumber !== undefined) project.permitNumber = upClean(params.permitNumber, 80);
      if (params.targetCompletionDate !== undefined) {
        project.targetCompletionDate = upClean(params.targetCompletionDate, 30);
      }
      project.updatedAt = upNow();
      saveUpState();
      return { ok: true, result: { project } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "project-status-update", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.projects, upAid(ctx));
      const project = arr.find((p) => p.id === params.id);
      if (!project) return { ok: false, error: "project not found" };
      const status = String(params.status || "").toLowerCase();
      // HARD rejection (unlike comment-resolve's soft default) — see the
      // section comment above for why this field doesn't tolerate a silent
      // fallback.
      if (!PROJECT_STATUSES.includes(status)) {
        return { ok: false, error: `unrecognized status: ${params.status ?? "(none)"}` };
      }
      const note = params.note != null ? upClean(params.note, 500) : null;
      const now = upNow();
      project.status = status;
      project.statusHistory.push({ status, at: now, note });
      project.updatedAt = now;
      saveUpState();
      return { ok: true, result: { project } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("urban-planning", "project-remove", (ctx, _a, params = {}) => {
    try {
      const s = getUpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = upList(s.projects, upAid(ctx));
      const before = arr.length;
      const found = arr.some((p) => p.id === params.id);
      if (!found) return { ok: false, error: "project not found" };
      s.projects.set(upAid(ctx), arr.filter((p) => p.id !== params.id));
      saveUpState();
      return { ok: true, result: { removed: before - s.projects.get(upAid(ctx)).length } };
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
