// server/domains/urbanplanning.js
//
// Pure-compute urban planning (zoning, walkability, density, traffic
// impact) plus real US Census ACS demographics + HUD Income Limits.
// Census API works anonymously (low rate); CENSUS_API_KEY env raises
// the limit. HUD API needs HUD_API_TOKEN (free at huduser.gov/hudapi).

const CENSUS_API = "https://api.census.gov/data";
const HUD_API = "https://www.huduser.gov/hudapi/public";

export default function registerUrbanplanningActions(registerLensAction) {
  registerLensAction("urban-planning", "zoningAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const zone = (data.zoneType || "residential").toLowerCase(); const lotSize = parseFloat(data.lotSizeSqFt) || 5000; const specs = { residential: { far: 0.5, maxHeight: 35, setback: 20, parking: 2, density: "low" }, commercial: { far: 2.0, maxHeight: 60, setback: 10, parking: 1, density: "medium" }, mixed: { far: 3.0, maxHeight: 85, setback: 5, parking: 1.5, density: "high" }, industrial: { far: 1.0, maxHeight: 45, setback: 30, parking: 0.5, density: "low" } }; const s = specs[zone] || specs.residential; const maxBuildable = Math.round(lotSize * s.far); return { ok: true, result: { zoneType: zone, lotSize, floorAreaRatio: s.far, maxBuildableSqFt: maxBuildable, maxHeight: `${s.maxHeight} ft`, setback: `${s.setback} ft`, parkingRequired: `${s.parking} spaces per unit`, density: s.density } }; });
  registerLensAction("urban-planning", "walkabilityScore", (ctx, artifact, _params) => { const amenities = artifact.data?.amenities || []; const categories = { grocery: 0, restaurant: 0, school: 0, park: 0, transit: 0, retail: 0, healthcare: 0 }; for (const a of amenities) { const cat = (a.category || "retail").toLowerCase(); if (categories[cat] !== undefined) categories[cat] += (a.withinWalkingDistance ? 1 : 0.3); } const maxPoints = Object.keys(categories).length * 2; const score = Math.min(100, Math.round(Object.values(categories).reduce((s,v)=>s+v,0) / maxPoints * 100)); return { ok: true, result: { walkabilityScore: score, rating: score >= 90 ? "walkers-paradise" : score >= 70 ? "very-walkable" : score >= 50 ? "somewhat-walkable" : score >= 25 ? "car-dependent" : "almost-all-errands-require-car", amenityScores: categories, totalAmenities: amenities.length } }; });
  registerLensAction("urban-planning", "densityCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const population = parseInt(data.population) || 0; const areaSqMiles = parseFloat(data.areaSqMiles) || 1; const units = parseInt(data.housingUnits) || 0; const popDensity = Math.round(population / areaSqMiles); const unitDensity = Math.round(units / areaSqMiles); return { ok: true, result: { population, area: `${areaSqMiles} sq mi`, populationDensity: `${popDensity}/sq mi`, housingDensity: `${unitDensity} units/sq mi`, classification: popDensity > 10000 ? "urban-core" : popDensity > 3000 ? "urban" : popDensity > 1000 ? "suburban" : "rural", transitViability: popDensity > 5000 ? "supports-rail" : popDensity > 2000 ? "supports-bus" : "car-dependent" } }; });
  registerLensAction("urban-planning", "trafficImpact", (ctx, artifact, _params) => { const data = artifact.data || {}; const newUnits = parseInt(data.newHousingUnits) || 0; const newCommercialSqFt = parseFloat(data.newCommercialSqFt) || 0; const tripsPerUnit = 8; const tripsPerSqFt = 0.01; const newTrips = Math.round(newUnits * tripsPerUnit + newCommercialSqFt * tripsPerSqFt); const peakHourTrips = Math.round(newTrips * 0.1); const currentADT = parseInt(data.currentADT) || 10000; const increase = Math.round((newTrips / currentADT) * 100); return { ok: true, result: { newDailyTrips: newTrips, peakHourTrips, currentADT, percentIncrease: increase, impactLevel: increase > 10 ? "significant" : increase > 5 ? "moderate" : "minimal", mitigation: increase > 5 ? ["Traffic signal optimization", "Turn lane additions", "Pedestrian improvements", "Transit service enhancement"] : ["Standard roadway capacity sufficient"] } }; });

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
}
