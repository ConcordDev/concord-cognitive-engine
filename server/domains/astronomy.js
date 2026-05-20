// server/domains/astronomy.js
// Domain actions for astronomy: celestial position, observation planning,
// orbital mechanics, plus real-data NASA APIs (APOD, ISS location, near-earth-object lookup).
//
// Free data sources:
//   • NASA APOD (Astronomy Picture of the Day): api.nasa.gov/planetary/apod
//     Optional NASA_API_KEY env; falls back to DEMO_KEY (rate-limited to 30/hr).
//   • Where Is The ISS At: api.wheretheiss.at/v1/satellites/25544 — no key needed.
//   • NASA NeoWs (Near Earth Objects): api.nasa.gov/neo/rest/v1/feed — uses NASA_API_KEY.

const NASA_API_BASE = "https://api.nasa.gov";
const ISS_API_BASE = "https://api.wheretheiss.at/v1/satellites/25544";

export default function registerAstronomyActions(registerLensAction) {
  registerLensAction("astronomy", "celestialPosition", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const ra = parseFloat(data.rightAscension) || 0; // hours
    const dec = parseFloat(data.declination) || 0; // degrees
    const lat = parseFloat(data.latitude) || 40.7; // observer latitude
    const lon = parseFloat(data.longitude) || -74.0;
    const now = new Date();
    // Simplified altitude calculation
    const lst = (now.getUTCHours() + now.getUTCMinutes() / 60 + lon / 15) % 24; // Local Sidereal Time approx
    const hourAngle = (lst - ra) * 15; // degrees
    const latRad = lat * Math.PI / 180, decRad = dec * Math.PI / 180, haRad = hourAngle * Math.PI / 180;
    const altitude = Math.asin(Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)) * 180 / Math.PI;
    const azimuth = Math.atan2(-Math.sin(haRad), Math.cos(latRad) * Math.tan(decRad) - Math.sin(latRad) * Math.cos(haRad)) * 180 / Math.PI;
    return { ok: true, result: { object: data.name || artifact.title, ra: `${ra}h`, dec: `${dec}°`, altitude: Math.round(altitude * 10) / 10, azimuth: Math.round(((azimuth + 360) % 360) * 10) / 10, visible: altitude > 0, bestViewing: altitude > 30 ? "excellent" : altitude > 15 ? "good" : altitude > 0 ? "low-on-horizon" : "below-horizon", observerLocation: { lat, lon } } };
  });

  registerLensAction("astronomy", "planObservation", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const targets = data.targets || [];
    if (targets.length === 0) return { ok: true, result: { message: "Add observation targets with RA/Dec coordinates." } };
    const moonPhase = ((new Date().getTime() / 86400000 - 10) % 29.53) / 29.53; // approximate
    const moonIllumination = Math.round(Math.abs(Math.cos(moonPhase * 2 * Math.PI)) * 100);
    const darknessFactor = moonIllumination < 25 ? "excellent" : moonIllumination < 50 ? "good" : moonIllumination < 75 ? "fair" : "poor";
    const planned = targets.map(t => ({ name: t.name, type: t.type || "star", magnitude: parseFloat(t.magnitude) || 0, difficulty: parseFloat(t.magnitude) > 6 ? "telescope-only" : parseFloat(t.magnitude) > 4 ? "binoculars" : "naked-eye", priority: parseFloat(t.magnitude) <= 2 ? "high" : "medium" }));
    return { ok: true, result: { moonIllumination: `${moonIllumination}%`, darknessFactor, targets: planned, bestTargets: planned.filter(t => t.difficulty === "naked-eye"), equipmentNeeded: planned.some(t => t.difficulty === "telescope-only") ? "Telescope recommended" : "Binoculars sufficient" } };
  });

  registerLensAction("astronomy", "lightTravelTime", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const distanceLY = parseFloat(data.distanceLightYears) || 0;
    const distancePC = parseFloat(data.distanceParsecs) || 0;
    const distanceAU = parseFloat(data.distanceAU) || 0;
    const lyFinal = distanceLY || distancePC * 3.2616 || distanceAU * 0.0000158;
    if (lyFinal === 0) return { ok: true, result: { message: "Provide distance in light-years, parsecs, or AU." } };
    const lightSpeed = 299792.458; // km/s
    const seconds = lyFinal * 365.25 * 86400;
    const km = lyFinal * 9.461e12;
    return { ok: true, result: { object: data.name || artifact.title, distanceLightYears: Math.round(lyFinal * 1000) / 1000, distanceParsecs: Math.round(lyFinal / 3.2616 * 1000) / 1000, distanceKm: km.toExponential(3), travelTimeLight: lyFinal < 0.001 ? `${Math.round(seconds)} seconds` : lyFinal < 1 ? `${Math.round(lyFinal * 365.25)} days` : `${Math.round(lyFinal * 100) / 100} years`, lookbackTime: `We see this object as it was ${Math.round(lyFinal * 100) / 100} years ago` } };
  });

  registerLensAction("astronomy", "orbitalMechanics", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const semiMajorAU = parseFloat(data.semiMajorAxis) || 1; // AU
    const eccentricity = parseFloat(data.eccentricity) || 0;
    const massSolar = parseFloat(data.centralMass) || 1; // solar masses
    // Kepler's third law: T² = a³/M (years, AU, solar masses)
    const periodYears = Math.sqrt(Math.pow(semiMajorAU, 3) / massSolar);
    const perihelion = semiMajorAU * (1 - eccentricity);
    const aphelion = semiMajorAU * (1 + eccentricity);
    const orbitalVelocity = 29.78 / Math.sqrt(semiMajorAU); // km/s, simplified
    return { ok: true, result: { object: data.name || artifact.title, semiMajorAxisAU: semiMajorAU, eccentricity, periodYears: Math.round(periodYears * 1000) / 1000, periodDays: Math.round(periodYears * 365.25 * 10) / 10, perihelionAU: Math.round(perihelion * 1000) / 1000, aphelionAU: Math.round(aphelion * 1000) / 1000, avgOrbitalVelocityKmS: Math.round(orbitalVelocity * 10) / 10, orbitType: eccentricity < 0.05 ? "nearly-circular" : eccentricity < 0.5 ? "elliptical" : "highly-eccentric" } };
  });

  /**
   * apod — Astronomy Picture of the Day from NASA.
   * Free; NASA_API_KEY env optional (falls back to DEMO_KEY).
   * params: { date?: "YYYY-MM-DD" — defaults to today }
   */
  registerLensAction("astronomy", "apod", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const date = params.date ? `&date=${encodeURIComponent(String(params.date))}` : "";
    const url = `${NASA_API_BASE}/planetary/apod?api_key=${encodeURIComponent(apiKey)}${date}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`nasa apod ${r.status}`);
      const data = await r.json();
      return {
        ok: true,
        result: {
          date: data.date,
          title: data.title,
          explanation: data.explanation,
          mediaType: data.media_type,
          url: data.url,
          hdurl: data.hdurl || null,
          copyright: data.copyright || null,
          source: "nasa-apod",
          usingDemoKey: apiKey === "DEMO_KEY",
        },
      };
    } catch (e) {
      return { ok: false, error: `nasa apod unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * iss-current-location — Real-time International Space Station
   * latitude/longitude/altitude/velocity. Free, no API key.
   */
  registerLensAction("astronomy", "iss-current-location", async (_ctx, _artifact, _params = {}) => {
    try {
      const r = await fetch(ISS_API_BASE);
      if (!r.ok) throw new Error(`iss api ${r.status}`);
      const data = await r.json();
      return {
        ok: true,
        result: {
          satelliteId: data.id,
          name: data.name,
          latitude: data.latitude,
          longitude: data.longitude,
          altitudeKm: data.altitude,
          velocityKmH: data.velocity,
          visibility: data.visibility,
          footprintKm: data.footprint,
          solarLatitude: data.solar_lat,
          solarLongitude: data.solar_lon,
          timestamp: data.timestamp,
          daynum: data.daynum,
          units: data.units,
          source: "wheretheiss.at",
        },
      };
    } catch (e) {
      return { ok: false, error: `iss api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * near-earth-objects — NASA NeoWs feed of asteroids/comets passing
   * close to Earth in a given date range (max 7 days).
   * Requires NASA_API_KEY (DEMO_KEY rate-limited).
   * params: { startDate: "YYYY-MM-DD", endDate?: "YYYY-MM-DD" }
   */
  registerLensAction("astronomy", "near-earth-objects", async (_ctx, _artifact, params = {}) => {
    const startDate = String(params.startDate || new Date().toISOString().slice(0, 10));
    const endDate = String(params.endDate || startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { ok: false, error: "startDate / endDate must be YYYY-MM-DD" };
    }
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const url = `${NASA_API_BASE}/neo/rest/v1/feed?start_date=${startDate}&end_date=${endDate}&api_key=${encodeURIComponent(apiKey)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`neows ${r.status}`);
      const data = await r.json();
      const objects = [];
      for (const [date, list] of Object.entries(data.near_earth_objects || {})) {
        for (const obj of list) {
          const approach = obj.close_approach_data?.[0];
          objects.push({
            id: obj.id,
            name: obj.name,
            absoluteMagnitude: obj.absolute_magnitude_h,
            estimatedDiameterMeters: {
              min: obj.estimated_diameter?.meters?.estimated_diameter_min,
              max: obj.estimated_diameter?.meters?.estimated_diameter_max,
            },
            potentiallyHazardous: obj.is_potentially_hazardous_asteroid,
            sentryObject: obj.is_sentry_object || false,
            approach: approach ? {
              date,
              relativeVelocityKmH: parseFloat(approach.relative_velocity?.kilometers_per_hour),
              missDistanceKm: parseFloat(approach.miss_distance?.kilometers),
              missDistanceLunar: parseFloat(approach.miss_distance?.lunar),
              orbitingBody: approach.orbiting_body,
            } : null,
            nasaJplUrl: obj.nasa_jpl_url,
          });
        }
      }
      objects.sort((a, b) => (a.approach?.missDistanceKm || Infinity) - (b.approach?.missDistanceKm || Infinity));
      return {
        ok: true,
        result: {
          startDate, endDate,
          objects,
          count: objects.length,
          hazardousCount: objects.filter((o) => o.potentiallyHazardous).length,
          source: "nasa-neows",
          usingDemoKey: apiKey === "DEMO_KEY",
        },
      };
    } catch (e) {
      return { ok: false, error: `neows unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Stellarium + SkySafari 2026 parity — sky observation ───────────
  // Observing targets, observation log, sessions with sky conditions,
  // equipment, a wishlist, astronomical events, and a built-in catalog
  // of real famous deep-sky objects.

  function getAstroState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.astronomyLens) STATE.astronomyLens = {};
    const s = STATE.astronomyLens;
    for (const k of ["targets", "observations", "sessions", "equipment", "wishlist", "events"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveAstroState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const asId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const asNow = () => new Date().toISOString();
  const asAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const asListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const asNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const asClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const asDay = (v) => asClean(v, 10).slice(0, 10);
  const findTarget = (s, userId, id) => (s.targets.get(userId) || []).find((t) => t.id === id) || null;

  const OBJECT_TYPES = ["planet", "moon", "star", "double_star", "galaxy", "nebula", "cluster", "comet", "asteroid", "other"];

  // Built-in catalog of real, well-known deep-sky objects (Messier).
  const MESSIER_CATALOG = [
    { id: "M1", name: "Crab Nebula", type: "nebula", constellation: "Taurus", magnitude: 8.4 },
    { id: "M8", name: "Lagoon Nebula", type: "nebula", constellation: "Sagittarius", magnitude: 6.0 },
    { id: "M13", name: "Hercules Globular Cluster", type: "cluster", constellation: "Hercules", magnitude: 5.8 },
    { id: "M16", name: "Eagle Nebula", type: "nebula", constellation: "Serpens", magnitude: 6.0 },
    { id: "M27", name: "Dumbbell Nebula", type: "nebula", constellation: "Vulpecula", magnitude: 7.5 },
    { id: "M31", name: "Andromeda Galaxy", type: "galaxy", constellation: "Andromeda", magnitude: 3.4 },
    { id: "M42", name: "Orion Nebula", type: "nebula", constellation: "Orion", magnitude: 4.0 },
    { id: "M44", name: "Beehive Cluster", type: "cluster", constellation: "Cancer", magnitude: 3.7 },
    { id: "M45", name: "Pleiades", type: "cluster", constellation: "Taurus", magnitude: 1.6 },
    { id: "M51", name: "Whirlpool Galaxy", type: "galaxy", constellation: "Canes Venatici", magnitude: 8.4 },
    { id: "M57", name: "Ring Nebula", type: "nebula", constellation: "Lyra", magnitude: 8.8 },
    { id: "M63", name: "Sunflower Galaxy", type: "galaxy", constellation: "Canes Venatici", magnitude: 8.6 },
    { id: "M81", name: "Bode's Galaxy", type: "galaxy", constellation: "Ursa Major", magnitude: 6.9 },
    { id: "M97", name: "Owl Nebula", type: "nebula", constellation: "Ursa Major", magnitude: 9.9 },
    { id: "M101", name: "Pinwheel Galaxy", type: "galaxy", constellation: "Ursa Major", magnitude: 7.9 },
    { id: "M104", name: "Sombrero Galaxy", type: "galaxy", constellation: "Virgo", magnitude: 8.0 },
  ];

  // ── Observing targets ───────────────────────────────────────────────
  registerLensAction("astronomy", "target-add", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = asClean(params.name, 120);
    if (!name) return { ok: false, error: "target name required" };
    const target = {
      id: asId("tgt"), name,
      type: OBJECT_TYPES.includes(String(params.type).toLowerCase()) ? String(params.type).toLowerCase() : "other",
      constellation: asClean(params.constellation, 60) || null,
      magnitude: Number.isFinite(Number(params.magnitude)) ? Number(params.magnitude) : null,
      ra: asClean(params.ra, 24) || null,
      dec: asClean(params.dec, 24) || null,
      catalogId: asClean(params.catalogId, 24) || null,
      createdAt: asNow(),
    };
    asListB(s.targets, asAid(ctx)).push(target);
    saveAstroState();
    return { ok: true, result: { target } };
  });

  registerLensAction("astronomy", "target-list", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    let targets = [...(s.targets.get(userId) || [])];
    if (params.type) targets = targets.filter((t) => t.type === String(params.type).toLowerCase());
    const obs = s.observations.get(userId) || [];
    const observedIds = new Set(obs.map((o) => o.targetId));
    targets = targets.map((t) => ({ ...t, observed: observedIds.has(t.id), observationCount: obs.filter((o) => o.targetId === t.id).length }));
    return { ok: true, result: { targets, count: targets.length } };
  });

  registerLensAction("astronomy", "target-update", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const target = findTarget(s, asAid(ctx), params.id);
    if (!target) return { ok: false, error: "target not found" };
    if (params.name != null) { const n = asClean(params.name, 120); if (n) target.name = n; }
    if (params.constellation != null) target.constellation = asClean(params.constellation, 60) || null;
    if (params.magnitude != null) target.magnitude = Number.isFinite(Number(params.magnitude)) ? Number(params.magnitude) : null;
    if (params.ra != null) target.ra = asClean(params.ra, 24) || null;
    if (params.dec != null) target.dec = asClean(params.dec, 24) || null;
    saveAstroState();
    return { ok: true, result: { target } };
  });

  registerLensAction("astronomy", "target-delete", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.targets.get(asAid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "target not found" };
    arr.splice(i, 1);
    saveAstroState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("astronomy", "target-detail", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const target = findTarget(s, userId, params.id);
    if (!target) return { ok: false, error: "target not found" };
    const observations = (s.observations.get(userId) || [])
      .filter((o) => o.targetId === target.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ok: true, result: { target, observations } };
  });

  // ── Observation log ─────────────────────────────────────────────────
  registerLensAction("astronomy", "observation-log", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const target = findTarget(s, userId, params.targetId);
    if (!target) return { ok: false, error: "target not found" };
    const obs = {
      id: asId("obs"), targetId: target.id, targetName: target.name,
      sessionId: params.sessionId ? String(params.sessionId) : null,
      date: asDay(params.date) || asDay(asNow()),
      equipment: asClean(params.equipment, 120) || null,
      conditions: asClean(params.conditions, 120) || null,
      notes: asClean(params.notes, 800) || null,
      rating: Math.max(0, Math.min(5, Math.round(asNum(params.rating)))),
      createdAt: asNow(),
    };
    asListB(s.observations, userId).push(obs);
    saveAstroState();
    return { ok: true, result: { observation: obs } };
  });

  registerLensAction("astronomy", "observation-list", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let obs = [...(s.observations.get(asAid(ctx)) || [])];
    if (params.targetId) obs = obs.filter((o) => o.targetId === params.targetId);
    obs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ok: true, result: { observations: obs, count: obs.length } };
  });

  registerLensAction("astronomy", "observation-delete", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.observations.get(asAid(ctx)) || [];
    const i = arr.findIndex((o) => o.id === params.id);
    if (i < 0) return { ok: false, error: "observation not found" };
    arr.splice(i, 1);
    saveAstroState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Observing sessions ──────────────────────────────────────────────
  registerLensAction("astronomy", "session-create", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const session = {
      id: asId("ses"),
      date: asDay(params.date) || asDay(asNow()),
      location: asClean(params.location, 120) || null,
      bortle: Math.max(1, Math.min(9, Math.round(asNum(params.bortle, 5)))),
      seeing: ["excellent", "good", "average", "poor"].includes(String(params.seeing).toLowerCase())
        ? String(params.seeing).toLowerCase() : "average",
      transparency: ["excellent", "good", "average", "poor"].includes(String(params.transparency).toLowerCase())
        ? String(params.transparency).toLowerCase() : "average",
      notes: asClean(params.notes, 500) || null,
      createdAt: asNow(),
    };
    asListB(s.sessions, asAid(ctx)).push(session);
    saveAstroState();
    return { ok: true, result: { session } };
  });

  registerLensAction("astronomy", "session-list", (ctx, _a, _params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const obs = s.observations.get(userId) || [];
    const sessions = (s.sessions.get(userId) || [])
      .map((ses) => ({ ...ses, observationCount: obs.filter((o) => o.sessionId === ses.id).length }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ok: true, result: { sessions, count: sessions.length } };
  });

  registerLensAction("astronomy", "session-detail", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const session = (s.sessions.get(userId) || []).find((x) => x.id === params.id);
    if (!session) return { ok: false, error: "session not found" };
    const observations = (s.observations.get(userId) || [])
      .filter((o) => o.sessionId === session.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { ok: true, result: { session, observations } };
  });

  // ── Equipment ───────────────────────────────────────────────────────
  registerLensAction("astronomy", "equipment-add", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = asClean(params.name, 120);
    if (!name) return { ok: false, error: "equipment name required" };
    const item = {
      id: asId("eq"), name,
      kind: ["telescope", "eyepiece", "camera", "binoculars", "mount", "filter", "other"]
        .includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "telescope",
      specs: asClean(params.specs, 200) || null,
      aperture: Number.isFinite(Number(params.aperture)) ? Number(params.aperture) : null,
      focalLength: Number.isFinite(Number(params.focalLength)) ? Number(params.focalLength) : null,
      createdAt: asNow(),
    };
    asListB(s.equipment, asAid(ctx)).push(item);
    saveAstroState();
    return { ok: true, result: { equipment: item } };
  });

  registerLensAction("astronomy", "equipment-list", (ctx, _a, _params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { equipment: s.equipment.get(asAid(ctx)) || [] } };
  });

  registerLensAction("astronomy", "equipment-delete", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.equipment.get(asAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "equipment not found" };
    arr.splice(i, 1);
    saveAstroState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Wishlist ────────────────────────────────────────────────────────
  registerLensAction("astronomy", "wishlist-add", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = asClean(params.name, 120);
    if (!name) return { ok: false, error: "object name required" };
    const entry = {
      id: asId("wl"), name,
      type: OBJECT_TYPES.includes(String(params.type).toLowerCase()) ? String(params.type).toLowerCase() : "other",
      constellation: asClean(params.constellation, 60) || null,
      priority: ["high", "medium", "low"].includes(String(params.priority).toLowerCase())
        ? String(params.priority).toLowerCase() : "medium",
      createdAt: asNow(),
    };
    asListB(s.wishlist, asAid(ctx)).push(entry);
    saveAstroState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("astronomy", "wishlist-list", (ctx, _a, _params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const obsNames = new Set((s.observations.get(userId) || []).map((o) => String(o.targetName).toLowerCase()));
    const PRI = { high: 0, medium: 1, low: 2 };
    const items = (s.wishlist.get(userId) || [])
      .map((w) => ({ ...w, observed: obsNames.has(w.name.toLowerCase()) }))
      .sort((a, b) => (PRI[a.priority] - PRI[b.priority]));
    return { ok: true, result: { items, count: items.length, remaining: items.filter((w) => !w.observed).length } };
  });

  registerLensAction("astronomy", "wishlist-remove", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.wishlist.get(asAid(ctx)) || [];
    const i = arr.findIndex((w) => w.id === params.id);
    if (i < 0) return { ok: false, error: "wishlist entry not found" };
    arr.splice(i, 1);
    saveAstroState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Astronomical events ─────────────────────────────────────────────
  registerLensAction("astronomy", "event-add", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = asClean(params.name, 120);
    if (!name) return { ok: false, error: "event name required" };
    const date = asDay(params.date);
    if (!date) return { ok: false, error: "date required" };
    const event = {
      id: asId("evt"), name, date,
      kind: ["eclipse", "meteor_shower", "conjunction", "opposition", "transit", "comet", "other"]
        .includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "other",
      notes: asClean(params.notes, 400) || null,
      createdAt: asNow(),
    };
    asListB(s.events, asAid(ctx)).push(event);
    saveAstroState();
    return { ok: true, result: { event } };
  });

  registerLensAction("astronomy", "event-list", (ctx, _a, _params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = asDay(asNow());
    const events = (s.events.get(asAid(ctx)) || [])
      .map((e) => ({ ...e, upcoming: e.date >= today }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      ok: true,
      result: {
        events,
        upcoming: events.filter((e) => e.upcoming).length,
        next: events.find((e) => e.upcoming) || null,
      },
    };
  });

  registerLensAction("astronomy", "event-delete", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.events.get(asAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "event not found" };
    arr.splice(i, 1);
    saveAstroState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Built-in Messier catalog ────────────────────────────────────────
  registerLensAction("astronomy", "catalog-list", (_ctx, _a, params = {}) => {
    let rows = MESSIER_CATALOG.slice();
    if (params.type) rows = rows.filter((r) => r.type === String(params.type).toLowerCase());
    if (params.maxMagnitude != null) {
      const m = asNum(params.maxMagnitude);
      rows = rows.filter((r) => r.magnitude <= m);
    }
    rows.sort((a, b) => a.magnitude - b.magnitude);
    return { ok: true, result: { catalog: rows, count: rows.length, source: "Messier catalogue (built-in)" } };
  });

  registerLensAction("astronomy", "catalog-import", (ctx, _a, params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = MESSIER_CATALOG.find((r) => r.id === asClean(params.catalogId, 24));
    if (!entry) return { ok: false, error: "catalog object not found" };
    const target = {
      id: asId("tgt"), name: `${entry.id} — ${entry.name}`,
      type: entry.type, constellation: entry.constellation,
      magnitude: entry.magnitude, ra: null, dec: null,
      catalogId: entry.id, createdAt: asNow(),
    };
    asListB(s.targets, asAid(ctx)).push(target);
    saveAstroState();
    return { ok: true, result: { target } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("astronomy", "astro-dashboard", (ctx, _a, _params = {}) => {
    const s = getAstroState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const today = asDay(asNow());
    const targets = s.targets.get(userId) || [];
    const obs = s.observations.get(userId) || [];
    const observedTargetIds = new Set(obs.map((o) => o.targetId));
    const events = s.events.get(userId) || [];
    return {
      ok: true,
      result: {
        targets: targets.length,
        observed: observedTargetIds.size,
        observations: obs.length,
        sessions: (s.sessions.get(userId) || []).length,
        equipment: (s.equipment.get(userId) || []).length,
        wishlistRemaining: (s.wishlist.get(userId) || []).filter((w) => {
          const names = new Set(obs.map((o) => String(o.targetName).toLowerCase()));
          return !names.has(w.name.toLowerCase());
        }).length,
        upcomingEvents: events.filter((e) => e.date >= today).length,
      },
    };
  });
}
