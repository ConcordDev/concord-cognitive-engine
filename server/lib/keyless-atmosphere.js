// server/lib/keyless-atmosphere.js
//
// Keyless air quality + US weather. AirNow and OpenWeatherMap both require
// operator API keys Concord cannot rely on. The default path uses:
//
//   Air quality  Open-Meteo Air Quality API (CAMS model, no key)
//                https://air-quality-api.open-meteo.com/v1/air-quality
//   ZIP → lat/lon zippopotam.us, then Open-Meteo geocoding if that misses
//   US weather   api.weather.gov (points → forecast, forecastHourly,
//                observation stations, alerts). User-Agent required.
//   non-US       OpenWeatherMap only when OPENWEATHERMAP_API_KEY is set;
//                otherwise an honest "unavailable outside the US".
//
// Optional: when EPA_AIRNOW_API_KEY or AIRNOW_API_KEY is set AND the
// upstream accepts it, AirNow monitor readings are attached as `secondary`.
// A missing or rejected key never blocks the Open-Meteo reading.
//
// Timeouts are 8s. Successful JSON is cached in memory for 10 minutes.
// Failures are not cached and never invent a number.

import { fetchPublicUrl } from "./public-fetch.js";

export const ATMOSPHERE_TIMEOUT_MS = 8000;
export const ATMOSPHERE_CACHE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_NWS_USER_AGENT = "ConcordOS (concord-os.org, contact@concord-os.org)";

const MAX_CACHE = 200;
const AQ_CURRENT = "us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone";

const _cache = new Map();
let _testFetch = null;
let _timeoutMs = ATMOSPHERE_TIMEOUT_MS;

/** Test-only transport. Pass null to restore the guarded fetch. */
export function setAtmosphereFetchForTests(fn) {
  _testFetch = typeof fn === "function" ? fn : null;
}

/** Test-only timeout. Pass null/undefined to restore 8s. */
export function __setAtmosphereTimeoutForTests(ms) {
  _timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : ATMOSPHERE_TIMEOUT_MS;
}

export function clearAtmosphereCache() {
  _cache.clear();
}

export function nwsUserAgent() {
  const raw = process.env.NWS_USER_AGENT;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || DEFAULT_NWS_USER_AGENT;
}

export function nwsHeaders() {
  return {
    "User-Agent": nwsUserAgent(),
    Accept: "application/geo+json",
  };
}

function remember(url, data) {
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(url, { data, expiresAt: Date.now() + ATMOSPHERE_CACHE_TTL_MS });
}

async function fetchJson(url, headers) {
  const hit = _cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), _timeoutMs);
  try {
    const init = { headers: headers || {}, signal: ctrl.signal };
    const response = _testFetch
      ? await _testFetch(url, init)
      : await fetchPublicUrl(url, init);
    if (!response || response.ok !== true) {
      const status = Number(response?.status) || 0;
      const err = new Error(`HTTP ${status || "error"}`);
      err.status = status;
      throw err;
    }
    const data = await response.json();
    remember(url, data);
    return data;
  } catch (e) {
    if (e?.code === "timeout") throw e;
    const aborted = e?.name === "AbortError" || e?.code === "ABORT_ERR";
    if (aborted) {
      const err = new Error(`timed out after ${_timeoutMs}ms`);
      err.code = "timeout";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function usAqiCategory(aqi) {
  const n = numOrNull(aqi);
  if (n == null) return { name: null, number: null };
  if (n <= 50) return { name: "Good", number: 1 };
  if (n <= 100) return { name: "Moderate", number: 2 };
  if (n <= 150) return { name: "Unhealthy for Sensitive Groups", number: 3 };
  if (n <= 200) return { name: "Unhealthy", number: 4 };
  if (n <= 300) return { name: "Very Unhealthy", number: 5 };
  return { name: "Hazardous", number: 6 };
}

function splitObserved(time) {
  if (!time) return { dateObserved: null, hourObserved: null };
  const m = String(time).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2})/);
  if (!m) return { dateObserved: String(time).slice(0, 10) || null, hourObserved: null };
  return { dateObserved: m[1], hourObserved: Number(m[2]) };
}

function failFrom(e, fallbackReason) {
  const code = e?.code;
  const reason = code === "timeout" || code === "geocode_failed" || code === "invalid_zip"
    ? code
    : fallbackReason;
  return {
    ok: false,
    reason,
    error: e instanceof Error ? e.message : String(e),
  };
}

/**
 * US ZIP → coordinates. zippopotam.us first, Open-Meteo geocoding if it misses.
 * @param {string} zip
 */
export async function geocodeUsZip(zip) {
  const z = String(zip || "").trim();
  if (!/^\d{5}$/.test(z)) {
    const err = new Error("zipCode must be 5 digits");
    err.code = "invalid_zip";
    throw err;
  }
  try {
    const data = await fetchJson(`https://api.zippopotam.us/us/${z}`);
    const place = Array.isArray(data?.places) ? data.places[0] : null;
    const lat = numOrNull(place?.latitude);
    const lon = numOrNull(place?.longitude);
    if (lat != null && lon != null) {
      return {
        latitude: lat,
        longitude: lon,
        placeName: place["place name"] || null,
        stateCode: place["state abbreviation"] || null,
        countryCode: "US",
        geocodeSource: "zippopotam.us",
      };
    }
  } catch (e) {
    if (e?.code === "timeout") throw e;
  }
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", z);
  url.searchParams.set("count", "1");
  url.searchParams.set("countryCode", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  try {
    const geo = await fetchJson(url.toString());
    const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
    const lat = numOrNull(hit?.latitude);
    const lon = numOrNull(hit?.longitude);
    if (lat != null && lon != null) {
      return {
        latitude: lat,
        longitude: lon,
        placeName: hit.name || null,
        stateCode: typeof hit.admin1 === "string" && hit.admin1.length === 2 ? hit.admin1 : null,
        admin1: hit.admin1 || null,
        countryCode: hit.country_code || "US",
        geocodeSource: "open-meteo-geocoding",
      };
    }
  } catch (e) {
    if (e?.code === "timeout") throw e;
  }
  const err = new Error(`Could not resolve ZIP ${z} to coordinates`);
  err.code = "geocode_failed";
  throw err;
}

async function geocodePlace(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const geo = await fetchJson(url.toString());
  const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
  const lat = numOrNull(hit?.latitude);
  const lon = numOrNull(hit?.longitude);
  if (lat == null || lon == null) {
    const err = new Error(`Could not resolve "${name}" to coordinates`);
    err.code = "geocode_failed";
    throw err;
  }
  return {
    latitude: lat,
    longitude: lon,
    name: hit.name || name,
    admin1: hit.admin1 || null,
    countryCode: hit.country_code || null,
    country: hit.country || null,
    geocodeSource: "open-meteo-geocoding",
  };
}

function aqUrl(lat, lon) {
  const u = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("current", AQ_CURRENT);
  u.searchParams.set("timezone", "auto");
  return u.toString();
}

function airNowKey() {
  const a = process.env.EPA_AIRNOW_API_KEY;
  const b = process.env.AIRNOW_API_KEY;
  const key = (typeof a === "string" && a.trim()) || (typeof b === "string" && b.trim()) || "";
  return key || null;
}

async function maybeAirNow({ zip, lat, lon }) {
  const apiKey = airNowKey();
  if (!apiKey) return null;
  const distance = 25;
  const url = zip && /^\d{5}$/.test(String(zip))
    ? `https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json&zipCode=${encodeURIComponent(zip)}&distance=${distance}&API_KEY=${encodeURIComponent(apiKey)}`
    : `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=${distance}&API_KEY=${encodeURIComponent(apiKey)}`;
  try {
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
      source: "EPA AirNow",
      note: "Optional monitor readings. The primary numbers above are Open-Meteo CAMS model data.",
      observations: data.map((o) => ({
        dateObserved: o.DateObserved ?? null,
        hourObserved: o.HourObserved ?? null,
        localTimeZone: o.LocalTimeZone ?? null,
        reportingArea: o.ReportingArea ?? null,
        stateCode: o.StateCode ?? null,
        latitude: numOrNull(o.Latitude),
        longitude: numOrNull(o.Longitude),
        parameterName: o.ParameterName ?? null,
        aqi: numOrNull(o.AQI),
        category: o.Category?.Name ?? null,
        categoryNumber: numOrNull(o.Category?.Number),
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Keyless current air quality. ZIP or lat/lon.
 * Returns the flat payload both macros share (live_air_quality returns it
 * directly; airnow-current wraps it in `{ ok, result }`).
 */
export async function loadAirQuality(input = {}) {
  const zipRaw = input.zipCode ?? input.zip ?? null;
  const zip = zipRaw == null || zipRaw === "" ? null : String(zipRaw).trim();
  let lat = numOrNull(input.latitude ?? input.lat);
  let lon = numOrNull(input.longitude ?? input.lng ?? input.lon);
  let place = {
    placeName: null,
    stateCode: null,
    countryCode: null,
    geocodeSource: null,
  };

  if (zip) {
    if (!/^\d{5}$/.test(zip)) {
      return { ok: false, reason: "invalid_zip", error: "zipCode must be 5 digits" };
    }
    try {
      const g = await geocodeUsZip(zip);
      lat = g.latitude;
      lon = g.longitude;
      place = g;
    } catch (e) {
      return failFrom(e, "geocode_failed");
    }
  } else if (lat == null || lon == null) {
    return {
      ok: false,
      reason: "missing_location",
      error: "zipCode (5 digits) or latitude and longitude required",
    };
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, reason: "invalid_location", error: "latitude or longitude is out of range" };
  }

  let aq;
  try {
    aq = await fetchJson(aqUrl(lat, lon));
  } catch (e) {
    return failFrom(e, "upstream_unreachable");
  }
  const cur = aq?.current;
  if (!cur || typeof cur !== "object") {
    return {
      ok: false,
      reason: "upstream_unreachable",
      error: "Open-Meteo returned no current air-quality reading",
    };
  }

  const usAqi = numOrNull(cur.us_aqi);
  const pollutants = {
    us_aqi: usAqi,
    pm2_5: numOrNull(cur.pm2_5),
    pm10: numOrNull(cur.pm10),
    ozone: numOrNull(cur.ozone),
    no2: numOrNull(cur.nitrogen_dioxide),
    co: numOrNull(cur.carbon_monoxide),
    units: {
      us_aqi: "US AQI",
      pm2_5: "µg/m³",
      pm10: "µg/m³",
      ozone: "µg/m³",
      no2: "µg/m³",
      co: "µg/m³",
    },
  };
  const observed = splitObserved(cur.time);
  const cat = usAqiCategory(usAqi);
  const reportingArea = place.placeName || (zip ? `ZIP ${zip}` : `${lat}, ${lon}`);
  const base = {
    dateObserved: observed.dateObserved,
    hourObserved: observed.hourObserved,
    observedAt: cur.time || null,
    localTimeZone: aq.timezone_abbreviation || aq.timezone || null,
    reportingArea,
    stateCode: place.stateCode || null,
    latitude: lat,
    longitude: lon,
  };
  const specs = [
    ["PM2.5", pollutants.pm2_5, "µg/m³"],
    ["PM10", pollutants.pm10, "µg/m³"],
    ["Ozone", pollutants.ozone, "µg/m³"],
    ["NO2", pollutants.no2, "µg/m³"],
    ["CO", pollutants.co, "µg/m³"],
  ];
  const observations = [
    {
      ...base,
      parameter: "US AQI",
      parameterName: "US AQI",
      aqi: usAqi,
      category: cat.name,
      categoryNumber: cat.number,
      value: usAqi,
      unit: "US AQI",
      us_aqi: usAqi,
      pm2_5: pollutants.pm2_5,
      pm10: pollutants.pm10,
      ozone: pollutants.ozone,
      no2: pollutants.no2,
      co: pollutants.co,
    },
    ...specs.filter(([, value]) => value != null).map(([name, value, unit]) => ({
      ...base,
      parameter: name,
      parameterName: name,
      aqi: null,
      category: null,
      categoryNumber: null,
      value,
      unit,
    })),
  ];

  const secondary = await maybeAirNow({ zip, lat, lon });
  return {
    ok: true,
    source: "Open-Meteo",
    sourceNote: "Modeled CAMS data, not EPA monitor readings",
    model: "CAMS",
    fetchedAt: Math.floor(Date.now() / 1000),
    zipCode: zip,
    latitude: lat,
    longitude: lon,
    observedAt: cur.time || null,
    usAqi,
    us_aqi: usAqi,
    category: cat.name,
    pollutants,
    observations,
    count: observations.length,
    ...(secondary ? { secondary } : {}),
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function mapPeriod(p) {
  const start = p?.startTime ? Date.parse(p.startTime) : NaN;
  const popPct = numOrNull(p?.probabilityOfPrecipitation?.value);
  return {
    dt: Number.isFinite(start) ? Math.floor(start / 1000) : null,
    dtTxt: p?.name || p?.startTime || "",
    startTime: p?.startTime || null,
    endTime: p?.endTime || null,
    temp: numOrNull(p?.temperature),
    temperatureUnit: p?.temperatureUnit || "F",
    weather: p?.shortForecast || null,
    description: p?.shortForecast || null,
    detailedForecast: p?.detailedForecast || null,
    windSpeed: p?.windSpeed || null,
    windDirection: p?.windDirection || null,
    pop: popPct == null ? null : popPct / 100,
    isDaytime: p?.isDaytime ?? null,
    humidity: null,
  };
}

function mapObservation(obs, stationId) {
  const p = obs?.properties || {};
  const tempC = numOrNull(p.temperature?.value);
  return {
    stationId: stationId || p.stationId || null,
    observedAt: p.timestamp || null,
    description: p.textDescription || null,
    tempC,
    tempF: tempC == null ? null : Math.round(((tempC * 9) / 5 + 32) * 10) / 10,
    humidity: numOrNull(p.relativeHumidity?.value),
    windSpeedMs: numOrNull(p.windSpeed?.value),
    temperatureUnit: "F",
  };
}

function mapAlerts(geo) {
  const features = Array.isArray(geo?.features) ? geo.features : [];
  return features.slice(0, 20).map((f) => {
    const p = f?.properties || {};
    return {
      id: f?.id || p.id || null,
      event: p.event || null,
      severity: p.severity || null,
      headline: p.headline || null,
      description: p.description || null,
      instruction: p.instruction || null,
      area: p.areaDesc || null,
      sent: p.sent || null,
      expires: p.expires || null,
      urgency: p.urgency || null,
    };
  });
}

async function openWeatherFallback(input, place, lat, lon) {
  const apiKey = typeof process.env.OPENWEATHERMAP_API_KEY === "string"
    ? process.env.OPENWEATHERMAP_API_KEY.trim()
    : "";
  if (!apiKey) {
    return {
      ok: false,
      reason: "unavailable_outside_us",
      error: "unavailable outside the US",
      message: "National Weather Service covers US points only. No OpenWeatherMap key is configured, so this location stays unavailable.",
      city: place?.name || input.city || input.q || null,
      country: place?.countryCode || null,
      latitude: lat,
      longitude: lon,
    };
  }
  const units = ["metric", "imperial", "standard"].includes(input.units) ? input.units : "metric";
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${encodeURIComponent(apiKey)}&units=${units}`;
  let data;
  try {
    data = await fetchJson(url);
  } catch (e) {
    return {
      ok: false,
      reason: e?.code === "timeout" ? "timeout" : "upstream_unreachable",
      error: `OpenWeatherMap unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const list = Array.isArray(data?.list) ? data.list : [];
  const unit = units === "imperial" ? "F" : units === "metric" ? "C" : "K";
  return {
    ok: true,
    source: "OpenWeatherMap",
    sourceNote: "Fallback for a point outside National Weather Service coverage.",
    fetchedAt: Math.floor(Date.now() / 1000),
    city: data?.city?.name || place?.name || input.city || null,
    country: data?.city?.country || place?.countryCode || null,
    units,
    latitude: lat,
    longitude: lon,
    forecasts: list.slice(0, 40).map((row) => ({
      dt: numOrNull(row.dt),
      dtTxt: row.dt_txt || null,
      temp: numOrNull(row.main?.temp),
      feelsLike: numOrNull(row.main?.feels_like),
      humidity: numOrNull(row.main?.humidity),
      pressure: numOrNull(row.main?.pressure),
      weather: row.weather?.[0]?.main || null,
      description: row.weather?.[0]?.description || null,
      icon: row.weather?.[0]?.icon || null,
      windSpeed: numOrNull(row.wind?.speed),
      windDeg: numOrNull(row.wind?.deg),
      clouds: numOrNull(row.clouds?.all),
      pop: numOrNull(row.pop),
      temperatureUnit: unit,
    })),
    hourly: [],
    current: null,
    alerts: [],
  };
}

/**
 * US forecast / hourly / latest observation / point alerts from api.weather.gov.
 * Non-US (points 404) falls through to OpenWeatherMap only when that key exists.
 */
export async function loadUsWeather(input = {}) {
  const zipRaw = input.zipCode ?? input.zip ?? null;
  const zip = zipRaw == null || zipRaw === "" ? null : String(zipRaw).trim();
  let lat = numOrNull(input.latitude ?? input.lat);
  let lon = numOrNull(input.longitude ?? input.lng ?? input.lon);
  let place = null;

  if (zip) {
    if (!/^\d{5}$/.test(zip)) {
      return { ok: false, reason: "invalid_zip", error: "zipCode must be 5 digits" };
    }
    try {
      const g = await geocodeUsZip(zip);
      lat = g.latitude;
      lon = g.longitude;
      place = { name: g.placeName, admin1: g.stateCode, countryCode: "US" };
    } catch (e) {
      return failFrom(e, "geocode_failed");
    }
  } else if (lat == null || lon == null) {
    const city = String(input.city || input.q || "").trim();
    if (!city) {
      return {
        ok: false,
        reason: "missing_location",
        error: "city, zipCode, or latitude and longitude required",
      };
    }
    try {
      place = await geocodePlace(city);
      lat = place.latitude;
      lon = place.longitude;
    } catch (e) {
      return failFrom(e, "geocode_failed");
    }
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, reason: "invalid_location", error: "latitude or longitude is out of range" };
  }

  const latR = round4(lat);
  const lonR = round4(lon);
  const pointsUrl = `https://api.weather.gov/points/${latR},${lonR}`;
  let points;
  try {
    points = await fetchJson(pointsUrl, nwsHeaders());
  } catch (e) {
    if (e?.status === 404) return openWeatherFallback(input, place, latR, lonR);
    return {
      ok: false,
      reason: e?.code === "timeout" ? "timeout" : "upstream_unreachable",
      error: `api.weather.gov unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const props = points?.properties || {};
  const forecastUrl = props.forecast;
  const hourlyUrl = props.forecastHourly;
  const stationsUrl = props.observationStations;
  if (!forecastUrl || !hourlyUrl) {
    return {
      ok: false,
      reason: "upstream_unreachable",
      error: "api.weather.gov points response had no forecast URL",
    };
  }

  let forecast;
  let hourly;
  let stations;
  let alerts;
  try {
    const headers = nwsHeaders();
    [forecast, hourly, stations, alerts] = await Promise.all([
      fetchJson(forecastUrl, headers),
      fetchJson(hourlyUrl, headers),
      stationsUrl ? fetchJson(stationsUrl, headers) : Promise.resolve(null),
      fetchJson(`https://api.weather.gov/alerts/active?point=${latR},${lonR}`, headers),
    ]);
  } catch (e) {
    return {
      ok: false,
      reason: e?.code === "timeout" ? "timeout" : "upstream_unreachable",
      error: `api.weather.gov unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let current = null;
  const stationId = stations?.features?.[0]?.properties?.stationIdentifier
    || stations?.features?.[0]?.properties?.stationId
    || null;
  if (stationId) {
    try {
      const obs = await fetchJson(
        `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
        nwsHeaders(),
      );
      current = mapObservation(obs, stationId);
    } catch {
      current = null;
    }
  }

  const rel = props.relativeLocation?.properties || {};
  const periods = Array.isArray(forecast?.properties?.periods) ? forecast.properties.periods : [];
  const hourlyPeriods = Array.isArray(hourly?.properties?.periods) ? hourly.properties.periods : [];
  return {
    ok: true,
    source: "NWS api.weather.gov",
    sourceNote: "National Weather Service forecast for a US point.",
    fetchedAt: Math.floor(Date.now() / 1000),
    city: rel.city || place?.name || input.city || null,
    state: rel.state || place?.admin1 || null,
    country: "US",
    units: "imperial",
    latitude: latR,
    longitude: lonR,
    office: props.gridId || null,
    updated: forecast?.properties?.updated || null,
    forecasts: periods.map(mapPeriod),
    hourly: hourlyPeriods.slice(0, 48).map(mapPeriod),
    current,
    alerts: mapAlerts(alerts),
  };
}
