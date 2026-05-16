// server/domains/forestry.js
//
// Pure-compute forestry helpers (timber volume, growth rate, carbon
// sequestration) plus real iTree Species + USFS Wildfire Risk to
// Communities + InciWeb wildfire incident reports. All free public
// sources; no API key required.

const INCIWEB_BASE = "https://inciweb.wildfire.gov/api/v1";
const NIFC_FIRE_API = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";

export default function registerForestryActions(registerLensAction) {
  registerLensAction("forestry", "timberVolume", (ctx, artifact, _params) => {
    const trees = artifact.data?.trees || [];
    if (trees.length === 0) return { ok: true, result: { message: "Add tree measurements (DBH, height) to estimate timber volume." } };
    const estimated = trees.map(t => { const dbh = parseFloat(t.dbhInches || t.diameter) || 12; const height = parseFloat(t.heightFeet || t.height) || 60; const species = t.species || "mixed"; const bf = 0.00545415 * Math.pow(dbh, 2) * height * 0.5; return { species, dbhInches: dbh, heightFeet: height, boardFeet: Math.round(bf), logs: Math.floor(height / 16) }; });
    const totalBF = estimated.reduce((s, t) => s + t.boardFeet, 0);
    const pricePerMBF = parseFloat(artifact.data?.pricePerMBF) || 400;
    return { ok: true, result: { trees: estimated, totalTrees: trees.length, totalBoardFeet: totalBF, totalMBF: Math.round(totalBF / 1000 * 10) / 10, estimatedValue: Math.round(totalBF / 1000 * pricePerMBF), avgBFPerTree: Math.round(totalBF / trees.length), pricePerMBF } };
  });
  registerLensAction("forestry", "fireRisk", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const temp = parseFloat(data.temperatureF) || 80;
    const humidity = parseFloat(data.humidityPercent) || 30;
    const wind = parseFloat(data.windSpeedMph) || 10;
    const drought = parseInt(data.droughtIndex) || 3;
    const fuelMoisture = parseFloat(data.fuelMoisturePercent) || 15;
    let risk = 0;
    risk += temp > 95 ? 25 : temp > 85 ? 15 : temp > 75 ? 8 : 3;
    risk += humidity < 15 ? 25 : humidity < 25 ? 18 : humidity < 40 ? 10 : 3;
    risk += wind > 25 ? 20 : wind > 15 ? 12 : wind > 8 ? 6 : 2;
    risk += drought * 5;
    risk += fuelMoisture < 10 ? 15 : fuelMoisture < 20 ? 8 : 2;
    return { ok: true, result: { conditions: { temperature: `${temp}°F`, humidity: `${humidity}%`, wind: `${wind} mph`, droughtIndex: drought, fuelMoisture: `${fuelMoisture}%` }, riskScore: Math.min(100, risk), riskLevel: risk >= 75 ? "extreme" : risk >= 50 ? "high" : risk >= 30 ? "moderate" : "low", actions: risk >= 75 ? ["Red flag warning", "Close forest to public", "Pre-position fire crews"] : risk >= 50 ? ["Fire watch", "Restrict campfires", "Alert fire crews"] : ["Normal operations"] } };
  });
  registerLensAction("forestry", "harvestPlan", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const acreage = parseFloat(data.acreage) || 100;
    const method = (data.method || "selective").toLowerCase();
    const methods = { clearcut: { removal: 100, regen: "replant", impactLevel: "high", cyclYears: 60 }, shelterwood: { removal: 70, regen: "natural + plant", impactLevel: "moderate", cyclYears: 80 }, selective: { removal: 30, regen: "natural", impactLevel: "low", cyclYears: 20 }, salvage: { removal: 50, regen: "replant", impactLevel: "moderate", cyclYears: 40 } };
    const plan = methods[method] || methods.selective;
    return { ok: true, result: { acreage, method, removalPercent: plan.removal, regeneration: plan.regen, impactLevel: plan.impactLevel, rotationYears: plan.cyclYears, estimatedHarvestAcres: Math.round(acreage * plan.removal / 100), roadRequired: acreage > 50 ? "Yes — logging road needed" : "Existing access may suffice", bestSeason: "Fall/Winter (dry, dormant season)", permits: ["Timber Harvest Plan (THP)", "Environmental review", "Watershed protection plan"] } };
  });
  registerLensAction("forestry", "carbonSequestration", (ctx, artifact, _params) => {
    const acreage = parseFloat(artifact.data?.acreage) || 100;
    const ageYears = parseInt(artifact.data?.standAge) || 30;
    const density = parseInt(artifact.data?.treesPerAcre) || 200;
    const tonsPerAcrePerYear = ageYears < 20 ? 2.5 : ageYears < 50 ? 1.8 : 1.0;
    const annualSequestration = acreage * tonsPerAcrePerYear;
    const totalStored = acreage * density * 0.015 * ageYears;
    const carbonCredits = annualSequestration; // ~1 credit per ton
    const creditValue = Math.round(carbonCredits * 25);
    return { ok: true, result: { acreage, standAge: ageYears, treesPerAcre: density, annualSequestration: `${Math.round(annualSequestration)} tons CO2/year`, totalCarbonStored: `${Math.round(totalStored)} tons CO2`, carbonCreditsPerYear: Math.round(carbonCredits), estimatedCreditValue: `$${creditValue}/year`, equivalentCars: Math.round(annualSequestration / 4.6) } };
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
}
