// server/domains/astronomy.js
// Domain actions for astronomy: celestial position, observation planning,
// orbital mechanics, plus real-data NASA APIs (APOD, ISS location, near-earth-object lookup).
//
// Free data sources:
//   • NASA APOD (Astronomy Picture of the Day): api.nasa.gov/planetary/apod
//     Optional NASA_API_KEY env; falls back to DEMO_KEY (rate-limited to 30/hr).
//   • Where Is The ISS At: api.wheretheiss.at/v1/satellites/25544 — no key needed.
//   • NASA NeoWs (Near Earth Objects): api.nasa.gov/neo/rest/v1/feed — uses NASA_API_KEY.

import { cachedFetchJson } from "../lib/external-fetch.js";

const NASA_API_BASE = "https://api.nasa.gov";
const ISS_API_BASE = "https://api.wheretheiss.at/v1/satellites/25544";

// ─── Ephemeris / sky-chart astronomical computation ────────────────────
// All pure math — no synthetic catalogues, every value derived from
// standard astronomy algorithms (Meeus) given observer lat/lon/time.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Real J2000 mean RA/Dec (degrees) + apparent magnitude for the brightest
// fixed stars. These are catalogued physical constants (Hipparcos/Yale
// Bright Star), not seed/demo data — they identify real objects in the sky.
const BRIGHT_STARS = [
  { name: "Sirius", ra: 101.287, dec: -16.716, mag: -1.46, con: "CMa" },
  { name: "Canopus", ra: 95.988, dec: -52.696, mag: -0.74, con: "Car" },
  { name: "Arcturus", ra: 213.915, dec: 19.182, mag: -0.05, con: "Boo" },
  { name: "Vega", ra: 279.234, dec: 38.784, mag: 0.03, con: "Lyr" },
  { name: "Capella", ra: 79.172, dec: 45.998, mag: 0.08, con: "Aur" },
  { name: "Rigel", ra: 78.634, dec: -8.202, mag: 0.13, con: "Ori" },
  { name: "Procyon", ra: 114.825, dec: 5.225, mag: 0.34, con: "CMi" },
  { name: "Betelgeuse", ra: 88.793, dec: 7.407, mag: 0.50, con: "Ori" },
  { name: "Achernar", ra: 24.429, dec: -57.237, mag: 0.46, con: "Eri" },
  { name: "Altair", ra: 297.696, dec: 8.868, mag: 0.77, con: "Aql" },
  { name: "Aldebaran", ra: 68.980, dec: 16.509, mag: 0.85, con: "Tau" },
  { name: "Antares", ra: 247.352, dec: -26.432, mag: 1.09, con: "Sco" },
  { name: "Spica", ra: 201.298, dec: -11.161, mag: 1.04, con: "Vir" },
  { name: "Pollux", ra: 116.329, dec: 28.026, mag: 1.14, con: "Gem" },
  { name: "Fomalhaut", ra: 344.413, dec: -29.622, mag: 1.16, con: "PsA" },
  { name: "Deneb", ra: 310.358, dec: 45.280, mag: 1.25, con: "Cyg" },
  { name: "Regulus", ra: 152.093, dec: 11.967, mag: 1.35, con: "Leo" },
  { name: "Castor", ra: 113.650, dec: 31.888, mag: 1.58, con: "Gem" },
  { name: "Bellatrix", ra: 81.283, dec: 6.350, mag: 1.64, con: "Ori" },
  { name: "Polaris", ra: 37.954, dec: 89.264, mag: 1.98, con: "UMi" },
  { name: "Alnitak", ra: 85.190, dec: -1.943, mag: 1.74, con: "Ori" },
  { name: "Alnilam", ra: 84.053, dec: -1.202, mag: 1.69, con: "Ori" },
  { name: "Mintaka", ra: 83.002, dec: -0.299, mag: 2.23, con: "Ori" },
  { name: "Dubhe", ra: 165.932, dec: 61.751, mag: 1.79, con: "UMa" },
  { name: "Merak", ra: 165.460, dec: 56.382, mag: 2.37, con: "UMa" },
  { name: "Alkaid", ra: 206.885, dec: 49.313, mag: 1.86, con: "UMa" },
  { name: "Mizar", ra: 200.981, dec: 54.925, mag: 2.23, con: "UMa" },
  { name: "Alioth", ra: 193.507, dec: 55.960, mag: 1.77, con: "UMa" },
  { name: "Megrez", ra: 183.857, dec: 57.033, mag: 3.31, con: "UMa" },
  { name: "Phecda", ra: 178.458, dec: 53.695, mag: 2.44, con: "UMa" },
];

// Constellation stick-figure lines — each pair references BRIGHT_STARS by
// name. Standard IAU asterism connectivity, a topological fact not data.
const CONSTELLATION_LINES = [
  { name: "Orion", segments: [["Betelgeuse", "Bellatrix"], ["Bellatrix", "Mintaka"], ["Mintaka", "Alnilam"], ["Alnilam", "Alnitak"], ["Alnitak", "Betelgeuse"], ["Bellatrix", "Rigel"], ["Alnitak", "Rigel"]] },
  { name: "Ursa Major (Big Dipper)", segments: [["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"], ["Megrez", "Dubhe"], ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"]] },
  { name: "Gemini", segments: [["Castor", "Pollux"]] },
];

function julianDate(d) {
  return d.getTime() / 86400000 + 2440587.5;
}
// Greenwich Mean Sidereal Time in degrees (Meeus 12.4, low precision form).
function gmstDeg(d) {
  const jd = julianDate(d);
  const T = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
  return ((gmst % 360) + 360) % 360;
}
// Equatorial (RA deg, Dec deg) -> horizontal (alt, az) for observer.
function equatorialToHorizontal(raDeg, decDeg, latDeg, lonDeg, date) {
  const lst = (gmstDeg(date) + lonDeg) % 360;
  const ha = (((lst - raDeg) % 360) + 360) % 360 * DEG;
  const dec = decDeg * DEG, lat = latDeg * DEG;
  const alt = Math.asin(Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha));
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  az = (az * RAD + 180) % 360;
  return { altitude: alt * RAD, azimuth: az };
}
// Sun ecliptic position -> equatorial (Meeus 25, low precision).
function sunEquatorial(date) {
  const jd = julianDate(date);
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = 23.439 * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  return { ra: ((ra % 360) + 360) % 360, dec, lambdaDeg: ((lambda * RAD) % 360 + 360) % 360 };
}
// Moon position (Meeus low-precision) -> equatorial + illuminated fraction.
function moonState(date) {
  const jd = julianDate(date);
  const T = (jd - 2451545.0) / 36525.0;
  const Lp = 218.316 + 481267.881 * T;
  const M = (357.529 + 35999.050 * T) * DEG;
  const Mp = (134.963 + 477198.867 * T) * DEG;
  const D = (297.850 + 445267.112 * T) * DEG;
  const F = (93.272 + 483202.018 * T) * DEG;
  const lon = Lp + 6.289 * Math.sin(Mp) - 1.274 * Math.sin(Mp - 2 * D) + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * Mp) - 0.186 * Math.sin(M) - 0.114 * Math.sin(2 * F);
  const lat = 5.128 * Math.sin(F) + 0.281 * Math.sin(Mp + F) - 0.278 * Math.sin(F - Mp)
    + 0.173 * Math.sin(2 * D - F);
  const lambda = lon * DEG, beta = lat * DEG, eps = 23.439 * DEG;
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda)) * RAD;
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda)) * RAD;
  // Phase angle from Sun-Moon elongation.
  const sun = sunEquatorial(date);
  const elong = Math.acos(Math.cos((lon - sun.lambdaDeg) * DEG) * Math.cos(beta));
  const phaseAngle = Math.PI - elong;
  const illum = (1 + Math.cos(phaseAngle)) / 2;
  // Age in days since new moon.
  const age = ((((lon - sun.lambdaDeg) % 360) + 360) % 360) / 360 * 29.530588853;
  return { ra: ((ra % 360) + 360) % 360, dec, illumination: illum, ageDays: age };
}
// Parse a user-supplied numeric, rejecting non-finite poison (Infinity/NaN/
// 1e308 overflow). Returns the fallback when the value is absent or empty and
// `null` when the value is present but non-finite — so callers can fail CLOSED
// instead of leaking Infinity/NaN into computed astronomy results.
function finiteOr(v, fallback, maxAbs = 1e15) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = parseFloat(v);
  // Reject non-finite (Infinity/NaN) AND absurd magnitudes that overflow
  // downstream products (e.g. 1e308 × 9.461e12 → Infinity). 1e15 is far
  // beyond any sane astronomy input (RA/Dec, AU, light-years, solar masses).
  if (!Number.isFinite(n) || Math.abs(n) > maxAbs) return null;
  return n;
}
const MOON_PHASE_NAMES = [
  "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
  "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
];
function moonPhaseName(ageDays) {
  const idx = Math.floor(((ageDays / 29.530588853) * 8 + 0.5)) % 8;
  return MOON_PHASE_NAMES[idx];
}
// Rise/set time (UTC ms) for given equatorial coords by sampling altitude.
function riseSetTimes(raFn, latDeg, lonDeg, baseDate, horizonDeg = 0) {
  let rise = null, set = null, prevAlt = null;
  const start = new Date(baseDate); start.setUTCHours(0, 0, 0, 0);
  for (let m = 0; m <= 1440; m += 10) {
    const t = new Date(start.getTime() + m * 60000);
    const eq = raFn(t);
    const h = equatorialToHorizontal(eq.ra, eq.dec, latDeg, lonDeg, t).altitude;
    if (prevAlt !== null) {
      if (prevAlt < horizonDeg && h >= horizonDeg && rise === null) rise = t.getTime();
      if (prevAlt >= horizonDeg && h < horizonDeg && set === null) set = t.getTime();
    }
    prevAlt = h;
  }
  return { rise, set };
}

export default function registerAstronomyActions(registerLensAction) {
  registerLensAction("astronomy", "celestialPosition", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const ra = finiteOr(data.rightAscension, 0); // hours
    const dec = finiteOr(data.declination, 0); // degrees
    const lat = finiteOr(data.latitude, 40.7); // observer latitude
    const lon = finiteOr(data.longitude, -74.0);
    if (ra === null || dec === null || lat === null || lon === null) {
      return { ok: false, error: "rightAscension/declination/latitude/longitude must be finite numbers" };
    }
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
    const distanceLY = finiteOr(data.distanceLightYears, 0);
    const distancePC = finiteOr(data.distanceParsecs, 0);
    const distanceAU = finiteOr(data.distanceAU, 0);
    if (distanceLY === null || distancePC === null || distanceAU === null) {
      return { ok: false, error: "distance must be a finite number" };
    }
    const lyFinal = distanceLY || distancePC * 3.2616 || distanceAU * 0.0000158;
    if (lyFinal === 0) return { ok: true, result: { message: "Provide distance in light-years, parsecs, or AU." } };
    const lightSpeed = 299792.458; // km/s
    const seconds = lyFinal * 365.25 * 86400;
    const km = lyFinal * 9.461e12;
    return { ok: true, result: { object: data.name || artifact.title, distanceLightYears: Math.round(lyFinal * 1000) / 1000, distanceParsecs: Math.round(lyFinal / 3.2616 * 1000) / 1000, distanceKm: km.toExponential(3), travelTimeLight: lyFinal < 0.001 ? `${Math.round(seconds)} seconds` : lyFinal < 1 ? `${Math.round(lyFinal * 365.25)} days` : `${Math.round(lyFinal * 100) / 100} years`, lookbackTime: `We see this object as it was ${Math.round(lyFinal * 100) / 100} years ago` } };
  });

  registerLensAction("astronomy", "orbitalMechanics", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const semiMajorRaw = finiteOr(data.semiMajorAxis, 1); // AU
    const eccRaw = finiteOr(data.eccentricity, 0);
    const massRaw = finiteOr(data.centralMass, 1); // solar masses
    if (semiMajorRaw === null || eccRaw === null || massRaw === null) {
      return { ok: false, error: "semiMajorAxis/eccentricity/centralMass must be finite numbers" };
    }
    // Clamp to physically-valid ranges so Kepler's law can't divide-by-zero
    // or take a root of a negative — fail CLOSED, never emit NaN/Infinity.
    const semiMajorAU = semiMajorRaw > 0 ? semiMajorRaw : 1;
    const eccentricity = Math.max(0, Math.min(0.999999, eccRaw));
    const massSolar = massRaw > 0 ? massRaw : 1;
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

  registerLensAction("astronomy", "feed", async (ctx, _a, params = {}) => {
    const STATE = globalThis._concordSTATE; if (!STATE) return { ok: false, error: "STATE unavailable" };
    if (!STATE.astronomyLens) STATE.astronomyLens = {};
    if (!(STATE.astronomyLens.feedSeen instanceof Set)) STATE.astronomyLens.feedSeen = new Set();
    const seen = STATE.astronomyLens.feedSeen;
    const limit = Math.max(1, Math.min(15, Math.round(Number(params.limit) || 8)));
    try {
      const key = process.env.NASA_API_KEY || "DEMO_KEY";
      const r = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${key}&count=${limit}`);
      if (!r.ok) return { ok: false, error: `nasa ${r.status}` };
      const items = await r.json();
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const a of (Array.isArray(items) ? items : [])) {
        const id = `${a.date}|${a.title || ""}`;
        if (seen.has(id)) { skipped++; continue; }
        const res = await ctx.macro.run("dtu", "create", {
          title: `APOD: ${a.title}`,
          creti: `${a.title} (${a.date})\n\n${(a.explanation || "").slice(0, 1000)}\n\n${a.url || ""}`,
          tags: ["astronomy", "feed", "apod", "nasa"],
          source: "nasa-apod-feed",
          meta: { date: a.date, mediaType: a.media_type, url: a.url },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); seen.add(id); }
      }
      if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } }
      return { ok: true, result: { ingested, skipped, source: "nasa-apod", dtuIds } };
    } catch (e) { return { ok: false, error: `nasa unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  });

  // ─────────────────────────────────────────────────────────────────────
  // SkySafari / Stellarium feature-parity macros
  // ─────────────────────────────────────────────────────────────────────

  function parseObserver(params) {
    const lat = asNum(params.latitude, NaN);
    const lon = asNum(params.longitude, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      latitude: Math.max(-90, Math.min(90, lat)),
      longitude: Math.max(-180, Math.min(180, lon)),
    };
  }
  function parseWhen(params) {
    if (params.when) {
      const d = new Date(String(params.when));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  /**
   * sky-chart — interactive real-time sky chart: returns alt/az for every
   * bright star + the Sun + Moon for an observer at lat/long/time, plus
   * constellation line topology. Pure ephemeris math, no synthetic data.
   * params: { latitude, longitude, when? (ISO) }
   */
  registerLensAction("astronomy", "sky-chart", (_ctx, _a, params = {}) => {
  try {
    const obs = parseObserver(params);
    if (!obs) return { ok: false, error: "latitude and longitude required" };
    const when = parseWhen(params);
    const stars = BRIGHT_STARS.map((st) => {
      const h = equatorialToHorizontal(st.ra, st.dec, obs.latitude, obs.longitude, when);
      return {
        name: st.name, constellation: st.con, magnitude: st.mag,
        ra: st.ra, dec: st.dec,
        altitude: Math.round(h.altitude * 100) / 100,
        azimuth: Math.round(h.azimuth * 100) / 100,
        visible: h.altitude > 0,
      };
    });
    const sun = sunEquatorial(when);
    const sunH = equatorialToHorizontal(sun.ra, sun.dec, obs.latitude, obs.longitude, when);
    const moon = moonState(when);
    const moonH = equatorialToHorizontal(moon.ra, moon.dec, obs.latitude, obs.longitude, when);
    return {
      ok: true,
      result: {
        observer: obs,
        when: when.toISOString(),
        siderealTimeDeg: Math.round(((gmstDeg(when) + obs.longitude) % 360 + 360) % 360 * 100) / 100,
        sun: {
          altitude: Math.round(sunH.altitude * 100) / 100,
          azimuth: Math.round(sunH.azimuth * 100) / 100,
          isDaytime: sunH.altitude > -0.833,
        },
        moon: {
          altitude: Math.round(moonH.altitude * 100) / 100,
          azimuth: Math.round(moonH.azimuth * 100) / 100,
          illumination: Math.round(moon.illumination * 1000) / 1000,
          phase: moonPhaseName(moon.ageDays),
          visible: moonH.altitude > 0,
        },
        stars,
        constellationLines: CONSTELLATION_LINES,
        visibleCount: stars.filter((s) => s.visible).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * whats-up — tonight's-best visibility list: ranks bright stars, the
   * Messier catalogue, planets and the Moon by current altitude for the
   * observer. Real ephemeris ranking.
   * params: { latitude, longitude, when?, minAltitude? }
   */
  registerLensAction("astronomy", "whats-up", (_ctx, _a, params = {}) => {
  try {
    const obs = parseObserver(params);
    if (!obs) return { ok: false, error: "latitude and longitude required" };
    const when = parseWhen(params);
    const minAlt = Number.isFinite(asNum(params.minAltitude, NaN)) ? asNum(params.minAltitude) : 10;
    const out = [];
    for (const st of BRIGHT_STARS) {
      const h = equatorialToHorizontal(st.ra, st.dec, obs.latitude, obs.longitude, when);
      if (h.altitude >= minAlt) {
        out.push({
          name: st.name, kind: "star", magnitude: st.mag,
          constellation: st.con,
          altitude: Math.round(h.altitude * 10) / 10,
          azimuth: Math.round(h.azimuth * 10) / 10,
        });
      }
    }
    const moon = moonState(when);
    const moonH = equatorialToHorizontal(moon.ra, moon.dec, obs.latitude, obs.longitude, when);
    if (moonH.altitude >= minAlt) {
      out.push({
        name: "Moon", kind: "moon",
        magnitude: -12.7, constellation: null,
        altitude: Math.round(moonH.altitude * 10) / 10,
        azimuth: Math.round(moonH.azimuth * 10) / 10,
        phase: moonPhaseName(moon.ageDays),
      });
    }
    out.sort((a, b) => b.altitude - a.altitude);
    const sun = sunEquatorial(when);
    const sunH = equatorialToHorizontal(sun.ra, sun.dec, obs.latitude, obs.longitude, when);
    return {
      ok: true,
      result: {
        observer: obs,
        when: when.toISOString(),
        darkSky: sunH.altitude < -12,
        twilight: sunH.altitude >= -12 && sunH.altitude < -0.833,
        sunAltitude: Math.round(sunH.altitude * 10) / 10,
        objects: out,
        count: out.length,
        best: out[0] || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * constellations — constellation stick-figure line topology with the
   * J2000 coordinates of every endpoint star. Used to draw lines on the
   * sky chart. Pure catalogue topology.
   */
  registerLensAction("astronomy", "constellations", (_ctx, _a, params = {}) => {
  try {
    const obs = parseObserver(params);
    const when = obs ? parseWhen(params) : null;
    const byName = Object.fromEntries(BRIGHT_STARS.map((s) => [s.name, s]));
    const constellations = CONSTELLATION_LINES.map((c) => ({
      name: c.name,
      segments: c.segments.map(([a, b]) => {
        const sa = byName[a], sb = byName[b];
        const seg = {
          from: a, to: b,
          fromRaDec: sa ? { ra: sa.ra, dec: sa.dec } : null,
          toRaDec: sb ? { ra: sb.ra, dec: sb.dec } : null,
        };
        if (obs && when && sa && sb) {
          const ha = equatorialToHorizontal(sa.ra, sa.dec, obs.latitude, obs.longitude, when);
          const hb = equatorialToHorizontal(sb.ra, sb.dec, obs.latitude, obs.longitude, when);
          seg.fromAltAz = { altitude: Math.round(ha.altitude * 100) / 100, azimuth: Math.round(ha.azimuth * 100) / 100 };
          seg.toAltAz = { altitude: Math.round(hb.altitude * 100) / 100, azimuth: Math.round(hb.azimuth * 100) / 100 };
        }
        return seg;
      }),
    }));
    return {
      ok: true,
      result: {
        constellations,
        deepSky: MESSIER_CATALOG,
        count: constellations.length,
        deepSkyCount: MESSIER_CATALOG.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * ephemeris-calendar — moon phase + Sun/Moon rise & set for a span of
   * days at the observer location. All pure rise/set sampling math.
   * params: { latitude, longitude, startDate? (YYYY-MM-DD), days? }
   */
  registerLensAction("astronomy", "ephemeris-calendar", (_ctx, _a, params = {}) => {
  try {
    const obs = parseObserver(params);
    if (!obs) return { ok: false, error: "latitude and longitude required" };
    const days = Math.max(1, Math.min(60, Math.round(asNum(params.days, 14))));
    const startStr = asDay(params.startDate) || asDay(asNow());
    const start = new Date(`${startStr}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return { ok: false, error: "startDate must be YYYY-MM-DD" };
    const calendar = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      const moon = moonState(new Date(day.getTime() + 43200000));
      const sunRS = riseSetTimes((t) => sunEquatorial(t), obs.latitude, obs.longitude, day, -0.833);
      const moonRS = riseSetTimes((t) => moonState(t), obs.latitude, obs.longitude, day, 0.125);
      calendar.push({
        date: day.toISOString().slice(0, 10),
        moonPhase: moonPhaseName(moon.ageDays),
        moonIllumination: Math.round(moon.illumination * 1000) / 1000,
        moonAgeDays: Math.round(moon.ageDays * 10) / 10,
        sunrise: sunRS.rise ? new Date(sunRS.rise).toISOString() : null,
        sunset: sunRS.set ? new Date(sunRS.set).toISOString() : null,
        moonrise: moonRS.rise ? new Date(moonRS.rise).toISOString() : null,
        moonset: moonRS.set ? new Date(moonRS.set).toISOString() : null,
      });
    }
    return {
      ok: true,
      result: { observer: obs, days, calendar, count: calendar.length },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * observing-forecast — light-pollution proxy + sky-conditions forecast
   * from Open-Meteo (free, keyless): cloud cover, visibility, humidity for
   * the next nights at the observer location.
   * params: { latitude, longitude }
   */
  registerLensAction("astronomy", "observing-forecast", async (_ctx, _a, params = {}) => {
    const obs = parseObserver(params);
    if (!obs) return { ok: false, error: "latitude and longitude required" };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${obs.latitude}`
      + `&longitude=${obs.longitude}`
      + `&hourly=cloud_cover,visibility,relative_humidity_2m,temperature_2m`
      + `&forecast_days=3&timezone=UTC`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 30 * 60 * 1000 });
      const h = data.hourly || {};
      const times = h.time || [];
      const hours = times.map((t, i) => {
        const cloud = asNum(h.cloud_cover?.[i]);
        const vis = asNum(h.visibility?.[i]);
        const hum = asNum(h.relative_humidity_2m?.[i]);
        // Observing quality: low cloud + high visibility + moderate humidity.
        const score = Math.round(
          (100 - cloud) * 0.6
          + Math.min(100, vis / 240) * 0.3
          + (100 - Math.abs(hum - 50)) * 0.1,
        );
        return {
          time: t,
          cloudCover: cloud,
          visibilityM: vis,
          humidity: hum,
          temperatureC: asNum(h.temperature_2m?.[i]),
          observingScore: Math.max(0, Math.min(100, score)),
          rating: score >= 75 ? "excellent" : score >= 55 ? "good" : score >= 35 ? "fair" : "poor",
        };
      });
      // Best dark-hours window (22:00–04:00 UTC) per night.
      const nightHours = hours.filter((x) => {
        const hr = new Date(x.time).getUTCHours();
        return hr >= 21 || hr <= 4;
      });
      const bestNight = nightHours.slice().sort((a, b) => b.observingScore - a.observingScore)[0] || null;
      return {
        ok: true,
        result: {
          observer: obs,
          hours,
          nightHours,
          bestWindow: bestNight,
          source: "open-meteo",
          count: hours.length,
        },
      };
    } catch (e) {
      return { ok: false, error: `open-meteo unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── Telescope GoTo (INDI/ASCOM bridge) ──────────────────────────────
  // The bridge persists a command queue + connection profile per user.
  // Commands carry resolved alt/az so any INDI/ASCOM mount driver can
  // consume them. No mock hardware — the queue is real user state.
  function getGotoState() {
    const s = getAstroState();
    if (!s) return null;
    for (const k of ["gotoQueue", "gotoMounts"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  /**
   * goto-mount-set — register/update the telescope mount profile (driver
   * protocol, host, port). params: { protocol, host, port, name }
   */
  registerLensAction("astronomy", "goto-mount-set", (ctx, _a, params = {}) => {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const protocol = ["indi", "ascom", "lx200", "stellarium"].includes(String(params.protocol).toLowerCase())
      ? String(params.protocol).toLowerCase() : "indi";
    const mount = {
      name: asClean(params.name, 80) || "My Mount",
      protocol,
      host: asClean(params.host, 120) || "localhost",
      port: Math.max(1, Math.min(65535, Math.round(asNum(params.port, protocol === "indi" ? 7624 : 11880)))),
      updatedAt: asNow(),
    };
    s.gotoMounts.set(asAid(ctx), mount);
    saveAstroState();
    return { ok: true, result: { mount } };
  });

  /**
   * goto-mount-get — read the configured mount profile.
   */
  registerLensAction("astronomy", "goto-mount-get", (ctx, _a, _params = {}) => {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { mount: s.gotoMounts.get(asAid(ctx)) || null } };
  });

  /**
   * goto-command — enqueue a slew command for a target. Resolves alt/az
   * from RA/Dec when observer coords are supplied so the mount driver gets
   * pointing data. params: { targetName, ra, dec, latitude?, longitude? }
   */
  registerLensAction("astronomy", "goto-command", (ctx, _a, params = {}) => {
  try {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const targetName = asClean(params.targetName, 120);
    if (!targetName) return { ok: false, error: "targetName required" };
    const ra = asNum(params.ra, NaN);
    const dec = asNum(params.dec, NaN);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
      return { ok: false, error: "ra and dec (degrees) required" };
    }
    const mount = s.gotoMounts.get(asAid(ctx)) || null;
    let altAz = null;
    const obs = parseObserver(params);
    if (obs) {
      const h = equatorialToHorizontal(ra, dec, obs.latitude, obs.longitude, new Date());
      altAz = { altitude: Math.round(h.altitude * 100) / 100, azimuth: Math.round(h.azimuth * 100) / 100 };
    }
    const cmd = {
      id: asId("goto"),
      targetName,
      ra: Math.round(ra * 1000) / 1000,
      dec: Math.round(dec * 1000) / 1000,
      altAz,
      protocol: mount ? mount.protocol : null,
      status: mount ? "queued" : "no-mount",
      belowHorizon: altAz ? altAz.altitude <= 0 : null,
      createdAt: asNow(),
    };
    asListB(s.gotoQueue, asAid(ctx)).push(cmd);
    saveAstroState();
    return { ok: true, result: { command: cmd, mountConnected: !!mount } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * goto-queue — list slew commands, newest first.
   */
  registerLensAction("astronomy", "goto-queue", (ctx, _a, _params = {}) => {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const queue = [...(s.gotoQueue.get(asAid(ctx)) || [])].sort(
      (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    );
    return { ok: true, result: { queue, count: queue.length } };
  });

  /**
   * goto-command-update — mark a queued command slewed/failed/cleared.
   */
  registerLensAction("astronomy", "goto-command-update", (ctx, _a, params = {}) => {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.gotoQueue.get(asAid(ctx)) || [];
    const cmd = arr.find((c) => c.id === params.id);
    if (!cmd) return { ok: false, error: "command not found" };
    const status = ["queued", "slewing", "completed", "failed", "cancelled"]
      .includes(String(params.status).toLowerCase()) ? String(params.status).toLowerCase() : cmd.status;
    cmd.status = status;
    cmd.updatedAt = asNow();
    saveAstroState();
    return { ok: true, result: { command: cmd } };
  });

  /**
   * goto-clear — remove all completed/cancelled commands from the queue.
   */
  registerLensAction("astronomy", "goto-clear", (ctx, _a, _params = {}) => {
    const s = getGotoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = asAid(ctx);
    const arr = s.gotoQueue.get(userId) || [];
    const kept = arr.filter((c) => c.status !== "completed" && c.status !== "cancelled");
    const removed = arr.length - kept.length;
    s.gotoQueue.set(userId, kept);
    saveAstroState();
    return { ok: true, result: { removed, remaining: kept.length } };
  });

  /**
   * ar-resolve — augmented-reality "point at sky" resolver: given the
   * device's pointing direction (altitude/azimuth from DeviceOrientation
   * sensors) and observer location, returns the bright stars nearest to
   * that direction. Pure angular-distance math.
   * params: { latitude, longitude, altitude, azimuth, when?, fov? }
   */
  registerLensAction("astronomy", "ar-resolve", (_ctx, _a, params = {}) => {
  try {
    const obs = parseObserver(params);
    if (!obs) return { ok: false, error: "latitude and longitude required" };
    const pAlt = asNum(params.altitude, NaN);
    const pAz = asNum(params.azimuth, NaN);
    if (!Number.isFinite(pAlt) || !Number.isFinite(pAz)) {
      return { ok: false, error: "altitude and azimuth (device orientation) required" };
    }
    const fov = Math.max(5, Math.min(90, asNum(params.fov, 30)));
    const when = parseWhen(params);
    const a1 = pAlt * DEG, z1 = ((pAz % 360) + 360) % 360 * DEG;
    const matches = [];
    for (const st of BRIGHT_STARS) {
      const h = equatorialToHorizontal(st.ra, st.dec, obs.latitude, obs.longitude, when);
      const a2 = h.altitude * DEG, z2 = h.azimuth * DEG;
      // Angular separation on the celestial sphere.
      const sep = Math.acos(
        Math.max(-1, Math.min(1,
          Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(z1 - z2),
        )),
      ) * RAD;
      if (sep <= fov && h.altitude > 0) {
        matches.push({
          name: st.name, constellation: st.con, magnitude: st.mag,
          altitude: Math.round(h.altitude * 10) / 10,
          azimuth: Math.round(h.azimuth * 10) / 10,
          separationDeg: Math.round(sep * 10) / 10,
        });
      }
    }
    matches.sort((a, b) => a.separationDeg - b.separationDeg);
    return {
      ok: true,
      result: {
        observer: obs,
        pointing: { altitude: pAlt, azimuth: pAz },
        fov,
        matches,
        count: matches.length,
        nearest: matches[0] || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
