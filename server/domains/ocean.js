// server/domains/ocean.js
//
// Pure-compute ocean helpers (wave analysis, salinity profile,
// marine ecosystem, approximate tidal sin curve) plus real NOAA
// Tides & Currents API for water-level / tide prediction / met
// observations at thousands of NOAA stations. Free, no API key.
//
// Plus live marine data: Open-Meteo Marine forecast, NOAA NDBC
// real-time buoy observations, surf-spot condition scoring, tide
// alerts/reminders, sea-surface-temperature lookup, and session
// logbook export (GPX / CSV).

import { cachedFetchJson } from "../lib/external-fetch.js";

const NOAA_TIDES_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_MDAPI_BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const OPEN_METEO_MARINE = "https://marine-api.open-meteo.com/v1/marine";
const NDBC_REALTIME = "https://www.ndbc.noaa.gov/data/realtime2";

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

  // ─── Ocean spot log (surf / dive / fishing spot tracker, per-user) ───

  function getOceanState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.oceanLens) STATE.oceanLens = {};
    const s = STATE.oceanLens;
    if (!(s.spots instanceof Map)) s.spots = new Map();   // userId -> Array<spot>
    if (!(s.sessions instanceof Map)) s.sessions = new Map(); // userId -> Array<session>
    return s;
  }
  function saveOcean() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const ocId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ocNow = () => new Date().toISOString();
  const ocActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const ocClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const ocNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const ocSpots = (s, userId) => { if (!s.spots.has(userId)) s.spots.set(userId, []); return s.spots.get(userId); };
  const ocSessions = (s, userId) => { if (!s.sessions.has(userId)) s.sessions.set(userId, []); return s.sessions.get(userId); };
  const SPOT_KINDS = ["surf", "dive", "fishing", "swim", "other"];

  registerLensAction("ocean", "spot-add", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = ocClean(params.name, 160);
    if (!name) return { ok: false, error: "spot name required" };
    const spot = {
      id: ocId("spot"),
      name,
      kind: SPOT_KINDS.includes(params.kind) ? params.kind : "surf",
      lat: ocNum(params.lat),
      lon: ocNum(params.lon),
      stationId: ocClean(params.stationId, 40) || null,
      notes: ocClean(params.notes, 1000) || "",
      createdAt: ocNow(),
    };
    ocSpots(s, ocActor(ctx)).push(spot);
    saveOcean();
    return { ok: true, result: { spot } };
  });

  registerLensAction("ocean", "spot-list", (ctx, _a, params = {}) => {
  try {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ocActor(ctx);
    let spots = [...ocSpots(s, userId)];
    if (params.kind) spots = spots.filter((x) => x.kind === params.kind);
    const sessions = ocSessions(s, userId);
    const out = spots.map((sp) => ({
      ...sp, sessionCount: sessions.filter((se) => se.spotId === sp.id).length,
    }));
    return { ok: true, result: { spots: out, count: out.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("ocean", "spot-delete", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ocActor(ctx);
    const arr = ocSpots(s, userId);
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "spot not found" };
    arr.splice(i, 1);
    s.sessions.set(userId, ocSessions(s, userId).filter((se) => se.spotId !== params.id));
    saveOcean();
    return { ok: true, result: { deleted: params.id } };
  });

  // session-log — record a surf/dive/fishing session at a spot.
  registerLensAction("ocean", "session-log", (ctx, _a, params = {}) => {
  try {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ocActor(ctx);
    const spot = ocSpots(s, userId).find((x) => x.id === params.spotId);
    if (!spot) return { ok: false, error: "spot not found" };
    const session = {
      id: ocId("ses"),
      spotId: spot.id,
      spotName: spot.name,
      date: ocClean(params.date, 30) || ocNow().slice(0, 10),
      waveHeightM: ocNum(params.waveHeightM),
      waterTempC: ocNum(params.waterTempC),
      conditions: ocClean(params.conditions, 200) || null,
      rating: params.rating != null ? Math.max(1, Math.min(5, Math.round(Number(params.rating)))) : null,
      notes: ocClean(params.notes, 1000) || "",
      loggedAt: ocNow(),
    };
    ocSessions(s, userId).push(session);
    saveOcean();
    return { ok: true, result: { session } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("ocean", "session-list", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let sessions = [...ocSessions(s, ocActor(ctx))];
    if (params.spotId) sessions = sessions.filter((x) => x.spotId === params.spotId);
    sessions.sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true, result: { sessions, count: sessions.length } };
  });

  registerLensAction("ocean", "session-delete", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ocSessions(s, ocActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "session not found" };
    arr.splice(i, 1);
    saveOcean();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("ocean", "ocean-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ocActor(ctx);
    const spots = ocSpots(s, userId);
    const sessions = ocSessions(s, userId);
    const rated = sessions.filter((x) => x.rating != null);
    const byKind = {};
    for (const sp of spots) byKind[sp.kind] = (byKind[sp.kind] || 0) + 1;
    return {
      ok: true,
      result: {
        spots: spots.length,
        sessions: sessions.length,
        byKind,
        avgRating: rated.length > 0 ? Math.round((rated.reduce((n, x) => n + x.rating, 0) / rated.length) * 10) / 10 : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest active NWS marine weather alerts as visible DTUs.
  registerLensAction("ocean", "feed", async (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch("https://api.weather.gov/alerts/active?region_type=marine&status=actual&message_type=alert", {
        headers: { "User-Agent": "Concord-OS/1.0 (https://concord-os.org)", Accept: "application/geo+json" },
      });
      if (!r.ok) return { ok: false, error: `nws ${r.status}` };
      const data = await r.json();
      const feats = (data.features || []).slice(0, limit);
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const f of feats) {
        const p = f.properties || {};
        if (s.feedSeen.has(p.id || f.id)) { skipped++; continue; }
        const title = `${p.event || "Marine alert"} — ${(p.areaDesc || "").slice(0, 80)}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${p.event || "Marine alert"}\nSeverity: ${p.severity || "?"}\nArea: ${p.areaDesc || "?"}\nEffective: ${p.effective || "?"}\nExpires: ${p.expires || "?"}\n\n${(p.headline || p.description || "").slice(0, 600)}`,
          tags: ["ocean", "feed", "marine-alert", "nws"],
          source: "nws-marine-alerts-feed",
          meta: { alertId: p.id || f.id, event: p.event, severity: p.severity, areaDesc: p.areaDesc, expires: p.expires },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(p.id || f.id); }
      }
      saveOcean();
      return { ok: true, result: { ingested, skipped, source: "nws-marine-alerts", dtuIds } };
    } catch (e) {
      return { ok: false, error: `nws unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─────────────────────────────────────────────────────────────
  //  Live marine data — AIS vessels, Open-Meteo Marine forecast,
  //  NDBC buoys, surf scoring, tide alerts, SST, logbook export.
  // ─────────────────────────────────────────────────────────────

  const ocLat = (v) => { const n = Number(v); return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null; };
  const ocLon = (v) => { const n = Number(v); return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null; };

  /**
   * ais-vessels — Live AIS vessel positions within a bounding box.
   * Pulls the free AISHub REST feed (https://www.aishub.net) — free
   * for AIS data contributors; the AISHUB_USERNAME env var supplies
   * the contributor username. Without it the macro returns an
   * explicit { ok:false, configRequired } so the UI can prompt for
   * a key rather than silently fabricating data.
   * params: { latMin, latMax, lonMin, lonMax }
   */
  registerLensAction("ocean", "ais-vessels", async (_ctx, _a, params = {}) => {
    const username = process.env.AISHUB_USERNAME;
    const latMin = ocLat(params.latMin);
    const latMax = ocLat(params.latMax);
    const lonMin = ocLon(params.lonMin);
    const lonMax = ocLon(params.lonMax);
    if (latMin == null || latMax == null || lonMin == null || lonMax == null) {
      return { ok: false, error: "latMin/latMax/lonMin/lonMax required" };
    }
    if (!username) {
      return {
        ok: false,
        configRequired: "AISHUB_USERNAME",
        error: "Live AIS requires an AISHub contributor username — set AISHUB_USERNAME. Free at aishub.net.",
      };
    }
    const url = `https://data.aishub.net/ws.php?username=${encodeURIComponent(username)}`
      + `&format=1&output=json&compress=0`
      + `&latmin=${latMin}&latmax=${latMax}&lonmin=${lonMin}&lonmax=${lonMax}`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 2 * 60 * 1000 });
      // AISHub returns [ {ERROR,...meta}, [ ...vessels ] ].
      const meta = Array.isArray(data) ? data[0] : null;
      if (meta && meta.ERROR) {
        return { ok: false, error: `AISHub error: ${meta.ERROR_MESSAGE || JSON.stringify(meta)}` };
      }
      const rows = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      const SHIPTYPE = (t) => {
        const n = Number(t);
        if (n >= 60 && n <= 69) return "passenger";
        if (n >= 70 && n <= 79) return "cargo";
        if (n >= 80 && n <= 89) return "tanker";
        if (n === 30) return "fishing";
        if (n >= 35 && n <= 36) return "military";
        return "other";
      };
      const vessels = rows.map((v) => ({
        mmsi: v.MMSI,
        imo: v.IMO || null,
        name: (v.NAME || "").trim() || `MMSI ${v.MMSI}`,
        callsign: v.CALLSIGN || null,
        lat: Number(v.LATITUDE),
        lon: Number(v.LONGITUDE),
        speed: Number(v.SOG),
        heading: Number(v.COG),
        type: SHIPTYPE(v.TYPE),
        destination: (v.DEST || "").trim() || null,
        lastSeen: v.TIME || null,
      })).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
      return {
        ok: true,
        result: {
          vessels, count: vessels.length,
          bbox: { latMin, latMax, lonMin, lonMax },
          source: "aishub",
        },
      };
    } catch (e) {
      return { ok: false, error: `aishub unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * marine-forecast — Open-Meteo Marine API. Real wave height /
   * period / direction + swell + wind-wave hourly forecast at a
   * lat/lon. Free, no API key.
   * params: { lat, lon, hours? (default 48, max 168) }
   */
  registerLensAction("ocean", "marine-forecast", async (_ctx, _a, params = {}) => {
    const lat = ocLat(params.lat);
    const lon = ocLon(params.lon);
    if (lat == null || lon == null) return { ok: false, error: "valid lat/lon required" };
    const hours = Math.max(1, Math.min(168, Math.round(Number(params.hours) || 48)));
    const vars = [
      "wave_height", "wave_direction", "wave_period",
      "swell_wave_height", "swell_wave_direction", "swell_wave_period",
      "wind_wave_height", "wind_wave_period", "sea_surface_temperature",
    ].join(",");
    const url = `${OPEN_METEO_MARINE}?latitude=${lat}&longitude=${lon}&hourly=${vars}&forecast_days=7&timezone=GMT`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 30 * 60 * 1000 });
      const h = data?.hourly || {};
      const times = h.time || [];
      const series = times.slice(0, hours).map((t, i) => ({
        time: t,
        waveHeight: h.wave_height?.[i] ?? null,
        wavePeriod: h.wave_period?.[i] ?? null,
        waveDirection: h.wave_direction?.[i] ?? null,
        swellHeight: h.swell_wave_height?.[i] ?? null,
        swellPeriod: h.swell_wave_period?.[i] ?? null,
        swellDirection: h.swell_wave_direction?.[i] ?? null,
        windWaveHeight: h.wind_wave_height?.[i] ?? null,
        seaSurfaceTemp: h.sea_surface_temperature?.[i] ?? null,
      }));
      const heights = series.map((s) => s.waveHeight).filter((v) => Number.isFinite(v));
      return {
        ok: true,
        result: {
          lat, lon, hours: series.length,
          units: data?.hourly_units || {},
          series,
          peakWaveHeight: heights.length ? Math.max(...heights) : null,
          source: "open-meteo-marine",
        },
      };
    } catch (e) {
      return { ok: false, error: `open-meteo marine unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * ndbc-buoy — NOAA NDBC real-time buoy observation. Parses the
   * fixed-width realtime2 .txt feed for a buoy station. Free.
   * params: { buoyId (e.g. "46026") }
   */
  registerLensAction("ocean", "ndbc-buoy", async (_ctx, _a, params = {}) => {
    const buoyId = String(params.buoyId || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(buoyId)) return { ok: false, error: "valid buoyId required (e.g. 46026)" };
    const url = `${NDBC_REALTIME}/${buoyId}.txt`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Concord-OS/1.0 (https://concord-os.org)" } });
      if (r.status === 404) return { ok: false, error: `buoy ${buoyId} not found` };
      if (!r.ok) throw new Error(`ndbc ${r.status}`);
      const text = await r.text();
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length < 3) return { ok: false, error: "no buoy data" };
      const headers = lines[0].replace(/^#/, "").trim().split(/\s+/);
      const cols = lines[2].trim().split(/\s+/); // line 0=names,1=units,2=latest
      const row = {};
      headers.forEach((hName, i) => { row[hName] = cols[i]; });
      const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== "MM" ? n : null; };
      const obsTime = `${row.YY}-${row.MM}-${row.DD}T${row.hh}:${row.mm}:00Z`;
      return {
        ok: true,
        result: {
          buoyId,
          observedAt: obsTime,
          waveHeightM: num(row.WVHT),
          dominantWavePeriodS: num(row.DPD),
          averageWavePeriodS: num(row.APD),
          meanWaveDirectionDeg: num(row.MWD),
          windSpeedMs: num(row.WSPD),
          windGustMs: num(row.GST),
          windDirectionDeg: num(row.WDIR),
          airTempC: num(row.ATMP),
          waterTempC: num(row.WTMP),
          pressureHpa: num(row.PRES),
          source: "noaa-ndbc",
        },
      };
    } catch (e) {
      return { ok: false, error: `ndbc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * surf-score — combine swell, wind and tide into a 0-100 surf
   * rating for a saved spot. Pulls live Open-Meteo marine data at
   * the spot's lat/lon. Persists nothing (read-only compute).
   * params: { spotId } OR { lat, lon }
   */
  registerLensAction("ocean", "surf-score", async (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let lat = ocLat(params.lat);
    let lon = ocLon(params.lon);
    let spotName = null;
    if (params.spotId) {
      const spot = ocSpots(s, ocActor(ctx)).find((x) => x.id === params.spotId);
      if (!spot) return { ok: false, error: "spot not found" };
      lat = ocLat(spot.lat);
      lon = ocLon(spot.lon);
      spotName = spot.name;
    }
    if (lat == null || lon == null) return { ok: false, error: "spotId with lat/lon, or explicit lat/lon required" };
    const vars = ["wave_height", "wave_period", "swell_wave_height", "swell_wave_period", "wind_wave_height"].join(",");
    const marineUrl = `${OPEN_METEO_MARINE}?latitude=${lat}&longitude=${lon}&hourly=${vars}&forecast_days=1&timezone=GMT`;
    const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m&forecast_days=1&timezone=GMT`;
    try {
      const [marine, wind] = await Promise.all([
        cachedFetchJson(marineUrl, { ttlMs: 30 * 60 * 1000 }),
        cachedFetchJson(windUrl, { ttlMs: 30 * 60 * 1000 }),
      ]);
      const mh = marine?.hourly || {};
      const wh = wind?.hourly || {};
      const idx = 12; // midday slice
      const swellH = Number(mh.swell_wave_height?.[idx]) || Number(mh.wave_height?.[idx]) || 0;
      const swellP = Number(mh.swell_wave_period?.[idx]) || Number(mh.wave_period?.[idx]) || 0;
      const windWaveH = Number(mh.wind_wave_height?.[idx]) || 0;
      const windKmh = Number(wh.wind_speed_10m?.[idx]) || 0;
      // Score components (0..1 each).
      const swellScore = Math.max(0, Math.min(1, swellH / 2.5));        // ideal ~2-2.5m
      const periodScore = Math.max(0, Math.min(1, (swellP - 6) / 8));   // longer = cleaner
      const windPenalty = Math.max(0, Math.min(1, windKmh / 30));       // higher wind = worse
      const chopPenalty = Math.max(0, Math.min(1, windWaveH / 1.5));    // wind chop hurts
      const score = Math.round(
        100 * (0.40 * swellScore + 0.30 * periodScore + 0.20 * (1 - windPenalty) + 0.10 * (1 - chopPenalty)),
      );
      const rating = score >= 75 ? "epic" : score >= 55 ? "good" : score >= 35 ? "fair" : "poor";
      return {
        ok: true,
        result: {
          spotId: params.spotId || null, spotName, lat, lon,
          score, rating,
          components: {
            swellHeightM: Math.round(swellH * 100) / 100,
            swellPeriodS: Math.round(swellP * 10) / 10,
            windWaveHeightM: Math.round(windWaveH * 100) / 100,
            windSpeedKmh: Math.round(windKmh),
          },
          summary: `${rating} — ${swellH.toFixed(1)}m swell @ ${swellP.toFixed(0)}s, ${Math.round(windKmh)}km/h wind`,
          source: "open-meteo",
        },
      };
    } catch (e) {
      return { ok: false, error: `surf-score data unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Tide alerts / reminders (per-user) ───

  const ocAlerts = (s, userId) => { if (!s.alerts.has(userId)) s.alerts.set(userId, []); return s.alerts.get(userId); };

  registerLensAction("ocean", "tide-alert-add", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.alerts instanceof Map)) s.alerts = new Map();
    const stationId = ocClean(params.stationId, 40);
    if (!stationId) return { ok: false, error: "stationId required" };
    const tideType = ["high", "low", "both"].includes(params.tideType) ? params.tideType : "both";
    const alert = {
      id: ocId("alrt"),
      stationId,
      stationName: ocClean(params.stationName, 160) || stationId,
      tideType,
      leadMinutes: Math.max(0, Math.min(720, Math.round(Number(params.leadMinutes) || 60))),
      label: ocClean(params.label, 200) || "",
      enabled: true,
      createdAt: ocNow(),
    };
    ocAlerts(s, ocActor(ctx)).push(alert);
    saveOcean();
    return { ok: true, result: { alert } };
  });

  registerLensAction("ocean", "tide-alert-delete", (ctx, _a, params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.alerts instanceof Map)) s.alerts = new Map();
    const arr = ocAlerts(s, ocActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "alert not found" };
    arr.splice(i, 1);
    saveOcean();
    return { ok: true, result: { deleted: params.id } };
  });

  /**
   * tide-alerts-check — list configured alerts and, for each, fetch
   * the next high/low tide from NOAA and compute when to notify.
   */
  registerLensAction("ocean", "tide-alerts-check", async (ctx, _a, _params = {}) => {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.alerts instanceof Map)) s.alerts = new Map();
    const alerts = ocAlerts(s, ocActor(ctx)).filter((a) => a.enabled);
    const now = new Date();
    const today = now.toISOString().slice(0, 10).replace(/-/g, "");
    const tomorrowD = new Date(now.getTime() + 86400000);
    const tomorrow = tomorrowD.toISOString().slice(0, 10).replace(/-/g, "");
    const out = [];
    for (const alert of alerts) {
      try {
        const qs = new URLSearchParams({
          product: "predictions", application: "Concord-OS",
          begin_date: today, end_date: tomorrow, datum: "MLLW",
          station: alert.stationId, time_zone: "gmt", units: "metric",
          format: "json", interval: "hilo",
        });
        const data = await cachedFetchJson(`${NOAA_TIDES_BASE}?${qs.toString()}`, { ttlMs: 30 * 60 * 1000 });
        const preds = (data?.predictions || [])
          .map((p) => ({ time: p.t, height: parseFloat(p.v), type: p.type === "H" ? "high" : "low" }))
          .filter((p) => new Date(p.time + "Z").getTime() > now.getTime())
          .filter((p) => alert.tideType === "both" || p.type === alert.tideType);
        const next = preds[0] || null;
        if (next) {
          const tideMs = new Date(next.time + "Z").getTime();
          const notifyMs = tideMs - alert.leadMinutes * 60000;
          out.push({
            alertId: alert.id, stationName: alert.stationName, tideType: alert.tideType,
            label: alert.label,
            nextTide: { ...next },
            notifyAt: new Date(notifyMs).toISOString(),
            minutesUntilNotify: Math.round((notifyMs - now.getTime()) / 60000),
            due: notifyMs <= now.getTime() && tideMs > now.getTime(),
          });
        } else {
          out.push({ alertId: alert.id, stationName: alert.stationName, error: "no upcoming tide" });
        }
      } catch (e) {
        out.push({ alertId: alert.id, stationName: alert.stationName, error: String(e instanceof Error ? e.message : e) });
      }
    }
    return { ok: true, result: { alerts: out, count: out.length, checkedAt: now.toISOString() } };
  });

  /**
   * sea-surface-temp — sea surface temperature at a lat/lon from the
   * Open-Meteo Marine API (NOAA/Copernicus-derived SST). Returns the
   * current value plus a 24h series for a simple map / chart layer.
   * params: { lat, lon } OR { points: [{lat,lon,label?}, ...] } for a layer
   */
  registerLensAction("ocean", "sea-surface-temp", async (_ctx, _a, params = {}) => {
    const fetchSst = async (lat, lon) => {
      const url = `${OPEN_METEO_MARINE}?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&forecast_days=1&timezone=GMT`;
      const data = await cachedFetchJson(url, { ttlMs: 60 * 60 * 1000 });
      const h = data?.hourly || {};
      const temps = (h.sea_surface_temperature || []).filter((v) => Number.isFinite(v));
      const now = new Date().getUTCHours();
      return {
        current: h.sea_surface_temperature?.[now] ?? (temps[0] ?? null),
        series: (h.time || []).map((t, i) => ({ time: t, temp: h.sea_surface_temperature?.[i] ?? null })),
        min: temps.length ? Math.min(...temps) : null,
        max: temps.length ? Math.max(...temps) : null,
      };
    };
    try {
      if (Array.isArray(params.points) && params.points.length > 0) {
        const pts = params.points.slice(0, 25);
        const layer = [];
        for (const p of pts) {
          const lat = ocLat(p.lat);
          const lon = ocLon(p.lon);
          if (lat == null || lon == null) continue;
          const sst = await fetchSst(lat, lon);
          layer.push({ lat, lon, label: ocClean(p.label, 80) || `${lat},${lon}`, temp: sst.current });
        }
        return { ok: true, result: { layer, count: layer.length, source: "open-meteo-marine" } };
      }
      const lat = ocLat(params.lat);
      const lon = ocLon(params.lon);
      if (lat == null || lon == null) return { ok: false, error: "valid lat/lon (or points[]) required" };
      const sst = await fetchSst(lat, lon);
      return { ok: true, result: { lat, lon, ...sst, source: "open-meteo-marine" } };
    } catch (e) {
      return { ok: false, error: `sst data unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * session-export — export the user's logged sessions as GPX or CSV.
   * params: { format: "gpx"|"csv", spotId? }
   * Returns { format, filename, mimeType, content }.
   */
  registerLensAction("ocean", "session-export", (ctx, _a, params = {}) => {
  try {
    const s = getOceanState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ocActor(ctx);
    const format = params.format === "gpx" ? "gpx" : "csv";
    let sessions = [...ocSessions(s, userId)];
    if (params.spotId) sessions = sessions.filter((x) => x.spotId === params.spotId);
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    const spots = ocSpots(s, userId);
    const spotOf = (id) => spots.find((sp) => sp.id === id) || null;
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const xmlEsc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ts = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
      const head = ["date", "spot", "kind", "lat", "lon", "waveHeightM", "waterTempC", "conditions", "rating", "notes"];
      const rows = sessions.map((se) => {
        const sp = spotOf(se.spotId);
        return [se.date, se.spotName, sp?.kind || "", sp?.lat ?? "", sp?.lon ?? "",
          se.waveHeightM ?? "", se.waterTempC ?? "", se.conditions ?? "", se.rating ?? "", se.notes ?? ""]
          .map(esc).join(",");
      });
      return {
        ok: true,
        result: {
          format: "csv",
          filename: `ocean-sessions-${ts}.csv`,
          mimeType: "text/csv",
          count: sessions.length,
          content: [head.map(esc).join(","), ...rows].join("\n"),
        },
      };
    }
    // GPX — one waypoint per session that has a geolocated spot.
    const wpts = sessions
      .map((se) => ({ se, sp: spotOf(se.spotId) }))
      .filter(({ sp }) => sp && ocLat(sp.lat) != null && ocLon(sp.lon) != null)
      .map(({ se, sp }) => {
        const desc = [
          se.conditions ? `Conditions: ${se.conditions}` : "",
          se.waveHeightM != null ? `Wave: ${se.waveHeightM}m` : "",
          se.waterTempC != null ? `Water: ${se.waterTempC}°C` : "",
          se.rating != null ? `Rating: ${se.rating}/5` : "",
          se.notes || "",
        ].filter(Boolean).join(" · ");
        return `  <wpt lat="${sp.lat}" lon="${sp.lon}">\n    <name>${xmlEsc(se.spotName)}</name>\n    <time>${xmlEsc(se.date)}T00:00:00Z</time>\n    <type>${xmlEsc(sp.kind)}</type>\n    <desc>${xmlEsc(desc)}</desc>\n  </wpt>`;
      });
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Concord-OS Ocean Lens" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>Ocean Sessions</name><time>${new Date().toISOString()}</time></metadata>\n${wpts.join("\n")}\n</gpx>`;
    return {
      ok: true,
      result: {
        format: "gpx",
        filename: `ocean-sessions-${ts}.gpx`,
        mimeType: "application/gpx+xml",
        count: wpts.length,
        skipped: sessions.length - wpts.length,
        content: gpx,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
