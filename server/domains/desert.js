// server/domains/desert.js
//
// Desert lens — arid-environment field-survey + expedition tooling.
// Parity vs a field-survey / expedition planner: route planning with
// per-leg water budgets, live heat/UV alerts on a tracked location,
// resource-node mapping (water/shade/hazards), a solar-installation
// calculator, terrain-overlay classification, and a survival kit
// checklist per expedition.
//
// Live data: Open-Meteo (free, no key) for forecast + UV index.
// Persistent per-user data: globalThis._concordSTATE.desertLens Maps.
// Pure-compute macros for budgets, sizing, classification.

import { cachedFetchJson } from "../lib/external-fetch.js";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

export default function registerDesertActions(registerLensAction) {
  // ───────────────────────── shared state ─────────────────────────
  function getDesertState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.desertLens) {
      STATE.desertLens = {
        routes: new Map(),    // userId -> Map<routeId, route>
        nodes: new Map(),     // userId -> Map<nodeId, node>
        tracked: new Map(),   // userId -> Map<trackId, trackedLocation>
        kits: new Map(),      // userId -> Map<kitId, survivalKit>
      };
    }
    return STATE.desertLens;
  }
  function saveDesertState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function actor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIso() { return new Date().toISOString(); }
  function userMap(rootMap, userId) {
    if (!rootMap.has(userId)) rootMap.set(userId, new Map());
    return rootMap.get(userId);
  }

  // Haversine distance in km between two lat/lng points.
  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ════════════════ existing pure-compute analysis macros ════════════════

  registerLensAction("desert", "waterBudget", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const rainfall = parseFloat(data.annualRainfallMm) || 250;
    const evaporation = parseFloat(data.evaporationMm) || 2000;
    const areaHectares = parseFloat(data.areaHectares) || 100;
    const waterInflow = rainfall * areaHectares * 10; // cubic meters
    const waterLoss = Math.min(evaporation, rainfall * 1.5) * areaHectares * 10;
    const netBalance = waterInflow - waterLoss;
    return { ok: true, result: { annualRainfall: `${rainfall} mm`, evaporationRate: `${evaporation} mm`, area: `${areaHectares} hectares`, waterInflow: `${Math.round(waterInflow)} m³/year`, waterLoss: `${Math.round(waterLoss)} m³/year`, netBalance: `${Math.round(netBalance)} m³/year`, deficit: netBalance < 0, aridity: rainfall < 100 ? "hyper-arid" : rainfall < 250 ? "arid" : rainfall < 500 ? "semi-arid" : "sub-humid", irrigationNeeded: netBalance < 0 ? `${Math.abs(Math.round(netBalance))} m³/year supplemental water required` : "Natural water balance sufficient" } };
  });

  registerLensAction("desert", "heatStressIndex", (ctx, artifact, _params) => {
    const temp = parseFloat(artifact.data?.temperatureCelsius) || 40;
    const humidity = parseFloat(artifact.data?.humidityPercent) || 20;
    const wind = parseFloat(artifact.data?.windSpeedKmh) || 10;
    const heatIndex = temp + 0.33 * (humidity / 100 * 6.105 * Math.exp(17.27 * temp / (237.7 + temp))) - 0.7 * wind / 3.6 - 4;
    const risk = heatIndex > 54 ? "extreme-danger" : heatIndex > 41 ? "danger" : heatIndex > 32 ? "extreme-caution" : heatIndex > 27 ? "caution" : "safe";
    return { ok: true, result: { temperature: `${temp}°C`, humidity: `${humidity}%`, windSpeed: `${wind} km/h`, heatIndex: Math.round(heatIndex * 10) / 10, riskLevel: risk, recommendations: risk === "extreme-danger" ? ["Cease all outdoor activity", "Seek air-conditioned shelter", "Hydrate continuously"] : risk === "danger" ? ["Limit outdoor exposure", "Take breaks every 15 min", "Drink 1L water per hour"] : ["Stay hydrated", "Wear sun protection"] } };
  });

  registerLensAction("desert", "terrainClassification", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const elevation = parseFloat(data.elevationMeters) || 500;
    const soilType = (data.soilType || "sand").toLowerCase();
    const vegetation = parseFloat(data.vegetationCoverPercent) || 5;
    const slope = parseFloat(data.slopePercent) || 2;
    const terrainTypes = { sand: "erg (sand sea)", rock: "hamada (stone desert)", gravel: "reg (gravel plain)", salt: "sabkha (salt flat)", clay: "playa (dry lake bed)" };
    const terrain = terrainTypes[soilType] || "mixed desert";
    const traversability = slope < 5 && soilType !== "sand" ? "easy" : slope < 15 ? "moderate" : "difficult";
    return { ok: true, result: { classification: terrain, elevation: `${elevation}m`, soilType, vegetationCover: `${vegetation}%`, slope: `${slope}%`, traversability, ecosystem: vegetation > 20 ? "desert-scrubland" : vegetation > 5 ? "sparse-desert" : "barren-desert", habitability: vegetation > 10 && elevation < 2000 ? "marginal" : "inhospitable" } };
  });

  registerLensAction("desert", "solarPotential", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const latitude = parseFloat(data.latitude) || 25;
    const clearDays = parseInt(data.clearDaysPerYear) || 300;
    const areaAcres = parseFloat(data.areaAcres) || 10;
    const irradiance = Math.max(3, 8 - Math.abs(latitude - 25) * 0.1);
    const annualIrradiance = irradiance * clearDays;
    const panelEfficiency = 0.20;
    const areaM2 = areaAcres * 4047;
    const annualOutput = Math.round(areaM2 * annualIrradiance * panelEfficiency / 1000); // MWh
    const homesEquivalent = Math.round(annualOutput / 10);
    return { ok: true, result: { latitude, clearDaysPerYear: clearDays, dailyIrradiance: `${Math.round(irradiance * 10) / 10} kWh/m²`, annualIrradiance: `${Math.round(annualIrradiance)} kWh/m²`, solarArea: `${areaAcres} acres (${Math.round(areaM2).toLocaleString()} m²)`, annualOutputMWh: annualOutput, homesEquivalent, potential: annualOutput > 1000 ? "excellent" : annualOutput > 100 ? "good" : "modest" } };
  });

  // ════════════════ FEATURE 1 — Expedition route planner ════════════════
  // Persistent route with ordered waypoints; computes per-leg distance,
  // estimated travel time, and water/supply requirements.

  // Water need ~ 1 L per 5 km on foot in arid heat, scaled by terrain.
  const TERRAIN_FACTOR = {
    sand: 1.6, dune: 1.8, rocky: 1.15, gravel: 1.1,
    salt_flat: 1.0, oasis: 0.9, canyon: 1.3, plateau: 1.05,
  };

  function computeLegs(waypoints, opts) {
    const teamSize = Math.max(1, parseInt(opts.teamSize, 10) || 1);
    const walkSpeedKmh = Math.max(1, parseFloat(opts.walkSpeedKmh) || 4);
    const waterLPerKmPerPerson = parseFloat(opts.waterLPerKmPerPerson) || 0.2;
    const foodKgPerDayPerPerson = parseFloat(opts.foodKgPerDayPerPerson) || 0.7;
    const legs = [];
    for (let i = 1; i < waypoints.length; i++) {
      const from = waypoints[i - 1];
      const to = waypoints[i];
      const distanceKm = haversineKm(from, to);
      const terrain = (to.terrain || from.terrain || "rocky").toLowerCase();
      const factor = TERRAIN_FACTOR[terrain] || 1.2;
      const hours = (distanceKm / walkSpeedKmh) * factor;
      const waterL = distanceKm * waterLPerKmPerPerson * factor * teamSize;
      const foodKg = (hours / 24) * foodKgPerDayPerPerson * teamSize;
      legs.push({
        index: i,
        from: from.name || `WP${i - 1}`,
        to: to.name || `WP${i}`,
        terrain,
        distanceKm: Math.round(distanceKm * 100) / 100,
        travelHours: Math.round(hours * 100) / 100,
        waterLiters: Math.round(waterL * 10) / 10,
        foodKg: Math.round(foodKg * 100) / 100,
      });
    }
    const totalDistanceKm = legs.reduce((s, l) => s + l.distanceKm, 0);
    const totalHours = legs.reduce((s, l) => s + l.travelHours, 0);
    const totalWaterL = legs.reduce((s, l) => s + l.waterLiters, 0);
    const totalFoodKg = legs.reduce((s, l) => s + l.foodKg, 0);
    return {
      legs,
      totals: {
        teamSize,
        distanceKm: Math.round(totalDistanceKm * 100) / 100,
        travelHours: Math.round(totalHours * 100) / 100,
        travelDays: Math.round((totalHours / 8) * 100) / 100,
        waterLiters: Math.round(totalWaterL * 10) / 10,
        waterLitersPerPerson: Math.round((totalWaterL / teamSize) * 10) / 10,
        foodKg: Math.round(totalFoodKg * 100) / 100,
      },
    };
  }

  registerLensAction("desert", "routeSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
      const clean = waypoints
        .map((w) => ({
          name: String(w?.name || "").slice(0, 80),
          lat: Number(w?.lat),
          lng: Number(w?.lng),
          terrain: String(w?.terrain || "rocky").toLowerCase(),
        }))
        .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
      if (clean.length < 2) {
        return { ok: false, error: "at least 2 valid waypoints required" };
      }
      const map = userMap(s.routes, userId);
      const id = params.id && map.has(params.id) ? params.id : nextId("route");
      const opts = {
        teamSize: params.teamSize,
        walkSpeedKmh: params.walkSpeedKmh,
        waterLPerKmPerPerson: params.waterLPerKmPerPerson,
        foodKgPerDayPerPerson: params.foodKgPerDayPerPerson,
      };
      const computed = computeLegs(clean, opts);
      const route = {
        id,
        name: String(params.name || "Untitled route").slice(0, 120),
        waypoints: clean,
        opts,
        ...computed,
        createdAt: map.get(id)?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      map.set(id, route);
      saveDesertState();
      return { ok: true, result: route };
    } catch (e) {
      return { ok: false, error: e?.message || "routeSave failed" };
    }
  });

  registerLensAction("desert", "routeList", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.routes, actor(ctx));
      const routes = Array.from(map.values()).sort(
        (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")
      );
      return { ok: true, result: { routes, count: routes.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "routeList failed" };
    }
  });

  registerLensAction("desert", "routeDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.routes, actor(ctx));
      if (!params.id || !map.has(params.id)) return { ok: false, error: "not found" };
      map.delete(params.id);
      saveDesertState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || "routeDelete failed" };
    }
  });

  // Stateless preview — compute legs without persisting.
  registerLensAction("desert", "routePreview", (ctx, _artifact, params = {}) => {
    try {
      const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
      const clean = waypoints
        .map((w) => ({
          name: String(w?.name || ""),
          lat: Number(w?.lat),
          lng: Number(w?.lng),
          terrain: String(w?.terrain || "rocky").toLowerCase(),
        }))
        .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));
      if (clean.length < 2) return { ok: false, error: "at least 2 valid waypoints required" };
      return { ok: true, result: computeLegs(clean, params) };
    } catch (e) {
      return { ok: false, error: e?.message || "routePreview failed" };
    }
  });

  // ════════════════ FEATURE 2 — Live heat-index / UV alerts ════════════════
  // Track a named location; pull live Open-Meteo forecast (temp, humidity,
  // wind, UV) and derive heat-stress + UV alert levels.

  function uvCategory(uv) {
    if (uv >= 11) return { level: "extreme", advice: "Avoid sun 10:00–16:00; SPF50+, full cover" };
    if (uv >= 8) return { level: "very-high", advice: "Minimise midday exposure; SPF50+, hat, shade" };
    if (uv >= 6) return { level: "high", advice: "Seek shade midday; SPF30+, sunglasses" };
    if (uv >= 3) return { level: "moderate", advice: "SPF30, hat during peak hours" };
    return { level: "low", advice: "Minimal protection needed" };
  }

  function heatIndexC(temp, humidity, wind) {
    return (
      temp +
      0.33 * ((humidity / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp))) -
      0.7 * (wind / 3.6) -
      4
    );
  }
  function heatRisk(hi) {
    if (hi > 54) return "extreme-danger";
    if (hi > 41) return "danger";
    if (hi > 32) return "extreme-caution";
    if (hi > 27) return "caution";
    return "safe";
  }

  async function fetchDesertWeather(lat, lng) {
    const url =
      `${OPEN_METEO}?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature` +
      `&hourly=uv_index,temperature_2m,relative_humidity_2m,wind_speed_10m` +
      `&daily=uv_index_max,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&forecast_days=3&timezone=auto`;
    return cachedFetchJson(url, { ttlMs: 10 * 60 * 1000 });
  }

  function shapeWeatherAlert(data, lat, lng, name) {
    const cur = data.current || {};
    const temp = Number(cur.temperature_2m) || 0;
    const humidity = Number(cur.relative_humidity_2m) || 0;
    const wind = Number(cur.wind_speed_10m) || 0;
    const hi = heatIndexC(temp, humidity, wind);
    // Find the next UV reading from the hourly series.
    const uvSeries = data.hourly?.uv_index || [];
    const uvTimes = data.hourly?.time || [];
    const nowMs = Date.now();
    let currentUv = 0;
    for (let i = 0; i < uvTimes.length; i++) {
      if (new Date(uvTimes[i]).getTime() >= nowMs) {
        currentUv = Number(uvSeries[i]) || 0;
        break;
      }
    }
    if (!currentUv && uvSeries.length) currentUv = Number(uvSeries[0]) || 0;
    const uvCat = uvCategory(currentUv);
    const risk = heatRisk(hi);
    const alerts = [];
    if (risk === "danger" || risk === "extreme-danger") {
      alerts.push({ kind: "heat", severity: risk, message: `Heat index ${Math.round(hi)}°C — ${risk.replace("-", " ")}` });
    }
    if (uvCat.level === "very-high" || uvCat.level === "extreme") {
      alerts.push({ kind: "uv", severity: uvCat.level, message: `UV index ${currentUv.toFixed(1)} — ${uvCat.level.replace("-", " ")}` });
    }
    if (wind >= 40) {
      alerts.push({ kind: "wind", severity: wind >= 60 ? "extreme" : "high", message: `Wind ${Math.round(wind)} km/h — sandstorm / dust risk` });
    }
    return {
      location: { name, lat, lng },
      observedAt: cur.time || nowIso(),
      temperatureC: Math.round(temp * 10) / 10,
      apparentC: cur.apparent_temperature != null ? Math.round(Number(cur.apparent_temperature) * 10) / 10 : null,
      humidityPercent: Math.round(humidity),
      windKmh: Math.round(wind * 10) / 10,
      heatIndexC: Math.round(hi * 10) / 10,
      heatRisk: risk,
      uvIndex: Math.round(currentUv * 10) / 10,
      uvLevel: uvCat.level,
      uvAdvice: uvCat.advice,
      uvMax3day: (data.daily?.uv_index_max || []).map((u, i) => ({
        date: data.daily?.time?.[i],
        uvMax: u,
        tempMax: data.daily?.temperature_2m_max?.[i],
        tempMin: data.daily?.temperature_2m_min?.[i],
        sunrise: data.daily?.sunrise?.[i],
        sunset: data.daily?.sunset?.[i],
      })),
      alerts,
      alertLevel: alerts.some((a) => /extreme/.test(a.severity))
        ? "extreme"
        : alerts.some((a) => /danger|very-high|high/.test(a.severity))
          ? "elevated"
          : "nominal",
      source: "open-meteo",
    };
  }

  // Ad-hoc heat/UV alert lookup for any lat/lng.
  registerLensAction("desert", "heatUvAlert", async (ctx, _artifact, params = {}) => {
    try {
      const lat = Number(params.lat);
      const lng = Number(params.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, error: "lat/lng required" };
      }
      const data = await fetchDesertWeather(lat, lng);
      return { ok: true, result: shapeWeatherAlert(data, lat, lng, params.name || "Location") };
    } catch (e) {
      return { ok: false, error: e?.message || "weather fetch failed" };
    }
  });

  // Add a persistent tracked location.
  registerLensAction("desert", "trackedAdd", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const lat = Number(params.lat);
      const lng = Number(params.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, error: "lat/lng required" };
      }
      const map = userMap(s.tracked, actor(ctx));
      const id = params.id && map.has(params.id) ? params.id : nextId("track");
      const rec = {
        id,
        name: String(params.name || "Tracked location").slice(0, 120),
        lat,
        lng,
        createdAt: map.get(id)?.createdAt || nowIso(),
      };
      map.set(id, rec);
      saveDesertState();
      return { ok: true, result: rec };
    } catch (e) {
      return { ok: false, error: e?.message || "trackedAdd failed" };
    }
  });

  registerLensAction("desert", "trackedDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.tracked, actor(ctx));
      if (!params.id || !map.has(params.id)) return { ok: false, error: "not found" };
      map.delete(params.id);
      saveDesertState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || "trackedDelete failed" };
    }
  });

  // List tracked locations, each enriched with a live alert snapshot.
  registerLensAction("desert", "trackedAlerts", async (ctx, _artifact, _params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.tracked, actor(ctx));
      const list = Array.from(map.values());
      const results = [];
      for (const rec of list) {
        try {
          const data = await fetchDesertWeather(rec.lat, rec.lng);
          results.push({ ...rec, alert: shapeWeatherAlert(data, rec.lat, rec.lng, rec.name) });
        } catch (e) {
          results.push({ ...rec, alert: null, alertError: e?.message || "fetch failed" });
        }
      }
      const counts = {
        extreme: results.filter((r) => r.alert?.alertLevel === "extreme").length,
        elevated: results.filter((r) => r.alert?.alertLevel === "elevated").length,
        nominal: results.filter((r) => r.alert?.alertLevel === "nominal").length,
      };
      return { ok: true, result: { tracked: results, count: results.length, counts } };
    } catch (e) {
      return { ok: false, error: e?.message || "trackedAlerts failed" };
    }
  });

  // ════════════════ FEATURE 3 — Resource node mapping ════════════════
  // Map-pinned water sources, shade, and hazards.

  const NODE_KINDS = new Set(["water", "shade", "hazard", "supply", "shelter", "fuel"]);

  registerLensAction("desert", "nodeSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const lat = Number(params.lat);
      const lng = Number(params.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, error: "lat/lng required" };
      }
      const kind = String(params.kind || "water").toLowerCase();
      if (!NODE_KINDS.has(kind)) {
        return { ok: false, error: `kind must be one of ${[...NODE_KINDS].join(", ")}` };
      }
      const map = userMap(s.nodes, actor(ctx));
      const id = params.id && map.has(params.id) ? params.id : nextId("node");
      const node = {
        id,
        kind,
        name: String(params.name || `${kind} node`).slice(0, 120),
        lat,
        lng,
        notes: String(params.notes || "").slice(0, 500),
        reliability: ["confirmed", "reported", "seasonal", "depleted"].includes(params.reliability)
          ? params.reliability
          : "reported",
        severity: ["low", "moderate", "high", "extreme"].includes(params.severity)
          ? params.severity
          : null,
        createdAt: map.get(id)?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      map.set(id, node);
      saveDesertState();
      return { ok: true, result: node };
    } catch (e) {
      return { ok: false, error: e?.message || "nodeSave failed" };
    }
  });

  registerLensAction("desert", "nodeList", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.nodes, actor(ctx));
      let nodes = Array.from(map.values());
      if (params.kind) {
        const k = String(params.kind).toLowerCase();
        nodes = nodes.filter((n) => n.kind === k);
      }
      nodes.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      const byKind = {};
      for (const n of map.values()) byKind[n.kind] = (byKind[n.kind] || 0) + 1;
      return { ok: true, result: { nodes, count: nodes.length, byKind } };
    } catch (e) {
      return { ok: false, error: e?.message || "nodeList failed" };
    }
  });

  registerLensAction("desert", "nodeDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.nodes, actor(ctx));
      if (!params.id || !map.has(params.id)) return { ok: false, error: "not found" };
      map.delete(params.id);
      saveDesertState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || "nodeDelete failed" };
    }
  });

  // Nearest water + shade nodes to a point, with distances.
  registerLensAction("desert", "nodesNearby", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const lat = Number(params.lat);
      const lng = Number(params.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { ok: false, error: "lat/lng required" };
      }
      const radiusKm = parseFloat(params.radiusKm) || 50;
      const here = { lat, lng };
      const map = userMap(s.nodes, actor(ctx));
      const near = Array.from(map.values())
        .map((n) => ({ ...n, distanceKm: Math.round(haversineKm(here, n) * 100) / 100 }))
        .filter((n) => n.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
      const nearestWater = near.find((n) => n.kind === "water") || null;
      const nearestShade = near.find((n) => n.kind === "shade" || n.kind === "shelter") || null;
      const hazards = near.filter((n) => n.kind === "hazard");
      return {
        ok: true,
        result: { from: here, radiusKm, nodes: near, count: near.length, nearestWater, nearestShade, hazards },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "nodesNearby failed" };
    }
  });

  // ════════════════ FEATURE 4 — Solar-installation calculator ════════════════
  // Panel sizing + yield estimate from a target load or panel count.

  registerLensAction("desert", "solarInstall", (ctx, _artifact, params = {}) => {
    try {
      const latitude = parseFloat(params.latitude);
      if (!Number.isFinite(latitude)) return { ok: false, error: "latitude required" };
      const panelWatt = parseFloat(params.panelWatt) || 450; // W per panel
      const panelAreaM2 = parseFloat(params.panelAreaM2) || 2.0;
      const systemLossFactor = parseFloat(params.systemLossFactor) || 0.82; // inverter/wiring/soiling
      const clearDays = parseInt(params.clearDaysPerYear, 10) || 300;
      // Peak-sun-hours from latitude proximity to desert solar belt (~25°).
      const peakSunHours = Math.max(3, 7.5 - Math.abs(latitude - 25) * 0.08);

      let panelCount = parseInt(params.panelCount, 10);
      const targetDailyKwh = parseFloat(params.targetDailyKwh);
      let sizedFor = "panelCount";
      if (!Number.isFinite(panelCount) || panelCount <= 0) {
        if (Number.isFinite(targetDailyKwh) && targetDailyKwh > 0) {
          const perPanelDailyKwh = (panelWatt / 1000) * peakSunHours * systemLossFactor;
          panelCount = Math.ceil(targetDailyKwh / perPanelDailyKwh);
          sizedFor = "targetLoad";
        } else {
          return { ok: false, error: "provide panelCount or targetDailyKwh" };
        }
      }

      const arrayKw = (panelCount * panelWatt) / 1000;
      const dailyKwh = arrayKw * peakSunHours * systemLossFactor;
      const annualKwh = dailyKwh * clearDays + dailyKwh * (365 - clearDays) * 0.35;
      const arrayAreaM2 = panelCount * panelAreaM2;
      // 1.6x footprint for inter-row spacing to avoid self-shading.
      const footprintM2 = Math.round(arrayAreaM2 * 1.6);
      const co2AvoidedKgYr = Math.round(annualKwh * 0.4); // ~0.4 kg CO2/kWh grid avg
      const batteryKwhRecommended =
        Math.round(dailyKwh * (parseFloat(params.autonomyDays) || 1) * 1.25 * 10) / 10;

      return {
        ok: true,
        result: {
          sizedFor,
          latitude,
          peakSunHours: Math.round(peakSunHours * 100) / 100,
          panelCount,
          panelWatt,
          arrayKw: Math.round(arrayKw * 100) / 100,
          systemLossFactor,
          dailyKwh: Math.round(dailyKwh * 100) / 100,
          annualKwh: Math.round(annualKwh),
          annualMwh: Math.round(annualKwh / 100) / 10,
          arrayAreaM2: Math.round(arrayAreaM2),
          footprintM2,
          footprintAcres: Math.round((footprintM2 / 4047) * 1000) / 1000,
          batteryKwhRecommended,
          co2AvoidedKgYr,
          homesEquivalent: Math.round(annualKwh / 10000),
          rating: arrayKw >= 1000 ? "utility-scale" : arrayKw >= 50 ? "commercial" : "residential",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "solarInstall failed" };
    }
  });

  // ════════════════ FEATURE 5 — Terrain dataset overlay ════════════════
  // Classify a grid of survey samples into sand/rock/dune/etc. classes
  // for a map overlay, with per-class share + traversability.

  function classifySample(sample) {
    const soil = String(sample.soil || sample.soilType || "sand").toLowerCase();
    const slope = Number(sample.slopePercent) || 0;
    const duneHeight = Number(sample.duneHeightM) || 0;
    const vegetation = Number(sample.vegetationCoverPercent) || 0;
    let cls;
    if (duneHeight >= 5 || (soil === "sand" && slope >= 12)) cls = "dune";
    else if (soil === "sand") cls = "sand";
    else if (soil === "rock" || soil === "stone") cls = "rock";
    else if (soil === "gravel") cls = "gravel";
    else if (soil === "salt" || soil === "clay") cls = "salt_flat";
    else if (vegetation >= 15) cls = "scrub";
    else cls = "mixed";
    const traverseScore = { dune: 0.2, sand: 0.45, rock: 0.7, gravel: 0.8, salt_flat: 0.9, scrub: 0.6, mixed: 0.6 };
    return {
      lat: Number(sample.lat),
      lng: Number(sample.lng),
      class: cls,
      slopePercent: slope,
      duneHeightM: duneHeight,
      vegetationCoverPercent: vegetation,
      traversability: traverseScore[cls],
    };
  }

  registerLensAction("desert", "terrainOverlay", (ctx, _artifact, params = {}) => {
    try {
      const samples = Array.isArray(params.samples) ? params.samples : [];
      const valid = samples
        .filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng)))
        .map(classifySample);
      if (!valid.length) return { ok: false, error: "no valid samples (need lat/lng)" };
      const byClass = {};
      for (const v of valid) byClass[v.class] = (byClass[v.class] || 0) + 1;
      const distribution = Object.entries(byClass)
        .map(([cls, n]) => ({ class: cls, count: n, share: Math.round((n / valid.length) * 1000) / 10 }))
        .sort((a, b) => b.count - a.count);
      const avgTraversability =
        Math.round((valid.reduce((s, v) => s + v.traversability, 0) / valid.length) * 100) / 100;
      const dominant = distribution[0]?.class || "mixed";
      return {
        ok: true,
        result: {
          samples: valid,
          count: valid.length,
          distribution,
          dominant,
          avgTraversability,
          overallTraversability:
            avgTraversability >= 0.7 ? "easy" : avgTraversability >= 0.45 ? "moderate" : "difficult",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "terrainOverlay failed" };
    }
  });

  // ════════════════ FEATURE 6 — Survival kit checklist ════════════════
  // Per-expedition kit; generates a baseline recommended list scaled to
  // team size + days; tracks packed/unpacked items.

  function baselineKit(teamSize, days) {
    const ts = Math.max(1, teamSize);
    const d = Math.max(1, days);
    return [
      { category: "water", item: "Water (4 L/person/day)", qty: ts * d * 4, unit: "L", critical: true },
      { category: "water", item: "Electrolyte sachets", qty: ts * d * 3, unit: "pcs", critical: true },
      { category: "navigation", item: "GPS unit + spare batteries", qty: Math.ceil(ts / 4), unit: "set", critical: true },
      { category: "navigation", item: "Topographic map + compass", qty: Math.ceil(ts / 4), unit: "set", critical: true },
      { category: "shelter", item: "Emergency bivvy / shade tarp", qty: ts, unit: "pcs", critical: true },
      { category: "sun", item: "Wide-brim hat", qty: ts, unit: "pcs", critical: true },
      { category: "sun", item: "SPF50+ sunscreen", qty: Math.ceil((ts * d) / 5), unit: "tube", critical: true },
      { category: "sun", item: "UV-rated sunglasses", qty: ts, unit: "pcs", critical: false },
      { category: "medical", item: "First-aid kit", qty: Math.ceil(ts / 4), unit: "kit", critical: true },
      { category: "medical", item: "Heat-illness response card", qty: 1, unit: "pcs", critical: false },
      { category: "comms", item: "Satellite messenger / PLB", qty: 1, unit: "pcs", critical: true },
      { category: "food", item: "High-calorie rations", qty: ts * d, unit: "day-pack", critical: true },
      { category: "tools", item: "Multi-tool / knife", qty: ts, unit: "pcs", critical: false },
      { category: "tools", item: "Headlamp + spare batteries", qty: ts, unit: "set", critical: true },
      { category: "signalling", item: "Signal mirror + whistle", qty: ts, unit: "set", critical: false },
    ];
  }

  registerLensAction("desert", "kitSave", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.kits, actor(ctx));
      const id = params.id && map.has(params.id) ? params.id : nextId("kit");
      const teamSize = Math.max(1, parseInt(params.teamSize, 10) || 1);
      const days = Math.max(1, parseInt(params.days, 10) || 1);
      const existing = map.get(id);
      let items;
      if (Array.isArray(params.items)) {
        items = params.items.map((it, i) => ({
          id: it.id || `kititem_${i}`,
          category: String(it.category || "general"),
          item: String(it.item || "Item").slice(0, 160),
          qty: Number(it.qty) || 1,
          unit: String(it.unit || "pcs"),
          critical: !!it.critical,
          packed: !!it.packed,
        }));
      } else if (existing) {
        items = existing.items;
      } else {
        items = baselineKit(teamSize, days).map((it, i) => ({ id: `kititem_${i}`, ...it, packed: false }));
      }
      const kit = {
        id,
        name: String(params.name || "Expedition kit").slice(0, 120),
        expeditionId: params.expeditionId || existing?.expeditionId || null,
        teamSize,
        days,
        items,
        createdAt: existing?.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      map.set(id, kit);
      saveDesertState();
      return { ok: true, result: kitWithStats(kit) };
    } catch (e) {
      return { ok: false, error: e?.message || "kitSave failed" };
    }
  });

  function kitWithStats(kit) {
    const total = kit.items.length;
    const packed = kit.items.filter((i) => i.packed).length;
    const criticalTotal = kit.items.filter((i) => i.critical).length;
    const criticalPacked = kit.items.filter((i) => i.critical && i.packed).length;
    return {
      ...kit,
      stats: {
        total,
        packed,
        unpacked: total - packed,
        packedPercent: total ? Math.round((packed / total) * 100) : 0,
        criticalTotal,
        criticalPacked,
        criticalMissing: criticalTotal - criticalPacked,
        ready: criticalTotal > 0 && criticalPacked === criticalTotal,
      },
    };
  }

  registerLensAction("desert", "kitList", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.kits, actor(ctx));
      const kits = Array.from(map.values())
        .map(kitWithStats)
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return { ok: true, result: { kits, count: kits.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "kitList failed" };
    }
  });

  registerLensAction("desert", "kitToggleItem", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.kits, actor(ctx));
      const kit = params.id ? map.get(params.id) : null;
      if (!kit) return { ok: false, error: "kit not found" };
      const item = kit.items.find((i) => i.id === params.itemId);
      if (!item) return { ok: false, error: "item not found" };
      item.packed = params.packed != null ? !!params.packed : !item.packed;
      kit.updatedAt = nowIso();
      saveDesertState();
      return { ok: true, result: kitWithStats(kit) };
    } catch (e) {
      return { ok: false, error: e?.message || "kitToggleItem failed" };
    }
  });

  registerLensAction("desert", "kitDelete", (ctx, _artifact, params = {}) => {
    try {
      const s = getDesertState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const map = userMap(s.kits, actor(ctx));
      if (!params.id || !map.has(params.id)) return { ok: false, error: "not found" };
      map.delete(params.id);
      saveDesertState();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: e?.message || "kitDelete failed" };
    }
  });
}
