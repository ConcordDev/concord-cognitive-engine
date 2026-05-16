// server/domains/ocean.js
//
// Pure-compute ocean helpers (wave analysis, salinity profile,
// marine ecosystem, approximate tidal sin curve) plus real NOAA
// Tides & Currents API for water-level / tide prediction / met
// observations at thousands of NOAA stations. Free, no API key.

const NOAA_TIDES_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_MDAPI_BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";

export default function registerOceanActions(registerLensAction) {
  registerLensAction("ocean", "waveAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const height = parseFloat(data.waveHeightMeters) || 1; const period = parseFloat(data.wavePeriodSeconds) || 8; const windSpeed = parseFloat(data.windSpeedKnots) || 15; const wavelength = 1.56 * period * period; const deepWaterSpeed = 1.56 * period; const energy = 0.5 * 1025 * 9.81 * height * height; const beaufort = windSpeed < 1 ? 0 : windSpeed < 4 ? 1 : windSpeed < 7 ? 2 : windSpeed < 11 ? 3 : windSpeed < 17 ? 4 : windSpeed < 22 ? 5 : windSpeed < 28 ? 6 : windSpeed < 34 ? 7 : 8; return { ok: true, result: { significantWaveHeight: `${height}m`, period: `${period}s`, wavelength: `${Math.round(wavelength)}m`, speed: `${Math.round(deepWaterSpeed*10)/10} m/s`, energyDensity: `${Math.round(energy)} J/m²`, beaufortScale: beaufort, seaState: height < 0.5 ? "calm" : height < 1.25 ? "slight" : height < 2.5 ? "moderate" : height < 4 ? "rough" : "very-rough", navigationAdvisory: height > 3 ? "Small craft advisory" : "Safe for navigation" } }; });
  registerLensAction("ocean", "tidalPrediction", (ctx, artifact, _params) => { const data = artifact.data || {}; const location = data.location || "unknown"; const lunarDay = ((Date.now() / 86400000) % 29.53); const phase = lunarDay / 29.53; const tidalRange = parseFloat(data.tidalRangeMeters) || 2; const currentHeight = Math.round(Math.sin(phase * 2 * Math.PI) * tidalRange / 2 * 100) / 100; return { ok: true, result: { location, lunarPhase: phase < 0.25 ? "new-moon" : phase < 0.5 ? "first-quarter" : phase < 0.75 ? "full-moon" : "last-quarter", springOrNeap: phase < 0.1 || Math.abs(phase - 0.5) < 0.1 ? "spring-tide" : "neap-tide", estimatedCurrentHeight: `${currentHeight}m`, tidalRange: `${tidalRange}m`, nextHigh: "~6 hours", nextLow: "~12 hours", note: "Approximate — use official tide tables for navigation" } }; });
  registerLensAction("ocean", "salinityProfile", (ctx, artifact, _params) => { const readings = artifact.data?.readings || []; if (readings.length === 0) return { ok: true, result: { message: "Add depth/salinity readings to build profile." } }; const sorted = readings.map(r => ({ depth: parseFloat(r.depth) || 0, salinity: parseFloat(r.salinity) || 35, temperature: parseFloat(r.temperature) || 15 })).sort((a,b) => a.depth - b.depth); const avgSalinity = sorted.reduce((s,r) => s + r.salinity, 0) / sorted.length; const halocline = sorted.find((r,i) => i > 0 && Math.abs(r.salinity - sorted[i-1].salinity) > 1); return { ok: true, result: { readings: sorted, avgSalinity: Math.round(avgSalinity*10)/10, maxDepth: sorted[sorted.length-1]?.depth || 0, haloclineDepth: halocline?.depth || "none detected", waterMass: avgSalinity > 36 ? "subtropical" : avgSalinity > 34 ? "temperate" : "sub-polar" } }; });
  registerLensAction("ocean", "marineEcosystem", (ctx, artifact, _params) => { const species = artifact.data?.species || []; const byTrophic = {}; for (const s of species) { const lvl = s.trophicLevel || "primary"; byTrophic[lvl] = (byTrophic[lvl] || 0) + 1; } const diversity = species.length; const shannonIndex = species.length > 1 ? Math.round(Math.log(species.length) * 100) / 100 : 0; return { ok: true, result: { speciesCount: diversity, trophicLevels: byTrophic, shannonDiversityIndex: shannonIndex, ecosystemHealth: diversity > 20 ? "thriving" : diversity > 10 ? "moderate" : diversity > 3 ? "stressed" : "critical", threatened: species.filter(s => s.threatened || s.endangered).length, invasive: species.filter(s => s.invasive).length } }; });

  /**
   * noaa-tide-prediction — Real predicted tide for a NOAA station
   * over a date range. Free, no API key. Returns high/low predicted
   * water levels with time.
   *
   * params: {
   *   stationId: string (CO-OPS station ID, e.g. "9414290" for SF),
   *   beginDate?: "YYYYMMDD" (default today),
   *   endDate?: "YYYYMMDD" (default beginDate + 1 day),
   *   units?: "english"|"metric"      // default metric
   * }
   */
  registerLensAction("ocean", "noaa-tide-prediction", async (_ctx, _artifact, params = {}) => {
    const stationId = String(params.stationId || "").trim();
    if (!stationId) return { ok: false, error: "stationId required (NOAA CO-OPS station ID, e.g. 9414290 = San Francisco)" };
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const beginDate = String(params.beginDate || today);
    const endDate = String(params.endDate || (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    })());
    if (!/^\d{8}$/.test(beginDate) || !/^\d{8}$/.test(endDate)) {
      return { ok: false, error: "beginDate / endDate must be YYYYMMDD" };
    }
    const units = ["metric", "english"].includes(params.units) ? params.units : "metric";
    const qs = new URLSearchParams({
      product: "predictions",
      application: "Concord-OS",
      begin_date: beginDate, end_date: endDate,
      datum: "MLLW",
      station: stationId,
      time_zone: "gmt",
      units, format: "json",
      interval: "hilo",  // high/low only — efficient + most useful
    });
    try {
      const r = await fetch(`${NOAA_TIDES_BASE}?${qs.toString()}`);
      if (!r.ok) throw new Error(`noaa tides ${r.status}`);
      const data = await r.json();
      if (data.error) return { ok: false, error: `NOAA error: ${data.error.message || JSON.stringify(data.error)}` };
      const predictions = (data.predictions || []).map((p) => ({
        time: p.t,
        height: parseFloat(p.v),
        type: p.type === "H" ? "high" : p.type === "L" ? "low" : p.type,
      }));
      return {
        ok: true,
        result: {
          stationId, beginDate, endDate, units, datum: "MLLW",
          predictions, count: predictions.length,
          source: "noaa-tides-and-currents",
        },
      };
    } catch (e) {
      return { ok: false, error: `noaa tides unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * noaa-water-level — Real observed water level at a station for a
   * date range (6-min readings; defaults to last 24h).
   * params: { stationId, beginDate?, endDate?, units? }
   */
  registerLensAction("ocean", "noaa-water-level", async (_ctx, _artifact, params = {}) => {
    const stationId = String(params.stationId || "").trim();
    if (!stationId) return { ok: false, error: "stationId required" };
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const beginDate = String(params.beginDate || yesterday.toISOString().slice(0, 10).replace(/-/g, ""));
    const endDate = String(params.endDate || today.toISOString().slice(0, 10).replace(/-/g, ""));
    const units = ["metric", "english"].includes(params.units) ? params.units : "metric";
    const qs = new URLSearchParams({
      product: "water_level",
      application: "Concord-OS",
      begin_date: beginDate, end_date: endDate,
      datum: "MLLW",
      station: stationId,
      time_zone: "gmt",
      units, format: "json",
    });
    try {
      const r = await fetch(`${NOAA_TIDES_BASE}?${qs.toString()}`);
      if (!r.ok) throw new Error(`noaa tides ${r.status}`);
      const data = await r.json();
      if (data.error) return { ok: false, error: `NOAA error: ${data.error.message || JSON.stringify(data.error)}` };
      const readings = (data.data || []).map((d) => ({
        time: d.t,
        waterLevel: parseFloat(d.v),
        sigma: parseFloat(d.s),
        flags: d.f,
      }));
      const latest = readings[readings.length - 1] || null;
      return {
        ok: true,
        result: {
          stationId, beginDate, endDate, units, datum: "MLLW",
          latest, readings, count: readings.length,
          source: "noaa-tides-and-currents",
        },
      };
    } catch (e) {
      return { ok: false, error: `noaa tides unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * noaa-stations — Real list of all NOAA tide/water-level stations
   * (or by state). Useful for picking a stationId for the above macros.
   * params: { state?: 2-letter US code (e.g. "CA"), type?: "tidepredictions"|"waterlevels" }
   */
  registerLensAction("ocean", "noaa-stations", async (_ctx, _artifact, params = {}) => {
    const type = ["tidepredictions", "waterlevels"].includes(params.type) ? params.type : "tidepredictions";
    const url = `${NOAA_MDAPI_BASE}/stations.json?type=${type}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`noaa mdapi ${r.status}`);
      const data = await r.json();
      let stations = (data.stations || []).map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        latitude: s.lat,
        longitude: s.lng,
        timezone: s.timezone,
        timezoneOffset: s.timezonecorr,
        type,
      }));
      if (params.state) {
        const st = String(params.state).toUpperCase();
        stations = stations.filter((s) => s.state === st);
      }
      return {
        ok: true,
        result: { stations, count: stations.length, type, source: "noaa-mdapi" },
      };
    } catch (e) {
      return { ok: false, error: `noaa mdapi unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
