// server/domains/civic-data-apis.js
//
// Phase 4 (sixth wave) — civic / reference / lifestyle REAL free APIs,
// no keys, no signup. Each handler attributes its source and returns
// { ok:false, reason } on upstream failure — never fakes data.
//
// Wires:
//   global.live_worldbank          World Bank indicators (no key)
//   finance.live_worldbank         World Bank indicators (shared)
//   food.live_breweries            Open Brewery DB (US breweries)
//   cooking.live_breweries         Open Brewery DB (shared)
//   pets.live_dog                  Dog CEO API random dog images
//   retail.live_zippopotam         Zippopotam.us — postal-code lookup
//   logistics.live_zippopotam      shared
//   travel.live_zippopotam         shared
//   astronomy.live_iss_pass        ISS pass times, computed from wheretheiss.at positions (Open Notify retired its endpoint)
//   space.live_iss_pass            shared
//
// No API keys needed; rate limits are generous for public open data.

const FETCH_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default function registerCivicDataApiMacros(register) {
  // ─────────────────────────────────────────────────────────────────────
  // WORLD BANK — country indicators, no key
  // ─────────────────────────────────────────────────────────────────────
  // Common indicators: NY.GDP.MKTP.CD (GDP USD), SP.POP.TOTL (Population),
  // SP.DYN.LE00.IN (Life expectancy), SE.ADT.LITR.ZS (Literacy %),
  // IT.NET.USER.ZS (Internet users %), EG.USE.ELEC.KH.PC (kWh/capita).
  const worldBank = async (_ctx, input = {}) => {
    const country = String(input.country || "US").trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(country)) return { ok: false, reason: "invalid_country_code" };
    const indicator = String(input.indicator || "NY.GDP.MKTP.CD").trim();
    if (!/^[A-Z0-9.]{1,40}$/i.test(indicator)) return { ok: false, reason: "invalid_indicator" };
    const yearsBack = Math.min(Math.max(Number(input.yearsBack) || 10, 1), 30);
    const now = new Date().getUTCFullYear();
    const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}?format=json&date=${now - yearsBack}:${now}&per_page=${yearsBack + 1}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      // World Bank returns [meta, dataArray]
      const series = Array.isArray(data) && data.length >= 2 ? data[1] || [] : [];
      const points = series.map(p => ({
        year: parseInt(p.date, 10),
        value: typeof p.value === "number" ? p.value : null,
        country: p.country?.value || country,
        indicator: p.indicator?.value || indicator,
      })).filter(p => Number.isFinite(p.year));
      const meta = Array.isArray(data) && data.length >= 1 ? data[0] : {};
      return {
        ok: true,
        source: "World Bank Open Data",
        fetchedAt: Math.floor(Date.now() / 1000),
        country, indicator,
        indicatorName: series[0]?.indicator?.value || null,
        total: meta.total || points.length,
        points: points.sort((a, b) => a.year - b.year),
      };
    } catch (e) {
      return { ok: false, reason: "worldbank_unreachable", error: String(e?.message || e) };
    }
  };
  register("global", "live_worldbank", worldBank, { note: "live World Bank country indicators" });
  register("finance", "live_worldbank", worldBank, { note: "live World Bank country indicators" });

  // ─────────────────────────────────────────────────────────────────────
  // OPEN BREWERY DB — US breweries, no key
  // ─────────────────────────────────────────────────────────────────────
  const openBrewery = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    const city = String(input.city || "").trim();
    const state = String(input.state || "").trim();
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50);
    if (q && q.length > 100) return { ok: false, reason: "query_too_long" };
    if (city && city.length > 60) return { ok: false, reason: "city_too_long" };
    if (state && state.length > 40) return { ok: false, reason: "state_too_long" };

    const params = new URLSearchParams({ per_page: String(limit) });
    if (q) params.set("by_name", q);
    if (city) params.set("by_city", city);
    if (state) params.set("by_state", state);
    const url = `https://api.openbrewerydb.org/v1/breweries?${params.toString()}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const breweries = (Array.isArray(data) ? data : []).map(b => ({
        id: b.id,
        name: b.name,
        type: b.brewery_type,
        street: b.street,
        city: b.city,
        state: b.state_province || b.state,
        country: b.country,
        postalCode: b.postal_code,
        latitude: b.latitude ? parseFloat(b.latitude) : null,
        longitude: b.longitude ? parseFloat(b.longitude) : null,
        phone: b.phone,
        websiteUrl: b.website_url,
      }));
      return {
        ok: true,
        source: "Open Brewery DB",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q || null,
        city: city || null,
        state: state || null,
        total: breweries.length,
        breweries,
      };
    } catch (e) {
      return { ok: false, reason: "openbrewery_unreachable", error: String(e?.message || e) };
    }
  };
  register("food", "live_breweries", openBrewery, { note: "live Open Brewery DB lookup" });
  register("cooking", "live_breweries", openBrewery, { note: "live Open Brewery DB lookup" });

  // ─────────────────────────────────────────────────────────────────────
  // DOG CEO API — random dog images, no key
  // ─────────────────────────────────────────────────────────────────────
  register("pets", "live_dog", async (_ctx, input = {}) => {
    const count = Math.min(Math.max(Number(input.count) || 6, 1), 25);
    const breed = String(input.breed || "").trim().toLowerCase();
    const url = breed
      ? `https://dog.ceo/api/breed/${encodeURIComponent(breed.replace(/[^a-z-]/g, ""))}/images/random/${count}`
      : `https://dog.ceo/api/breeds/image/random/${count}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      if (data.status !== "success") {
        return { ok: false, reason: "dog_ceo_error", message: data.message || null };
      }
      const images = Array.isArray(data.message) ? data.message : [data.message];
      return {
        ok: true,
        source: "Dog CEO API",
        fetchedAt: Math.floor(Date.now() / 1000),
        breed: breed || null,
        total: images.length,
        images,
      };
    } catch (e) {
      return { ok: false, reason: "dog_ceo_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live Dog CEO random images" });

  // ─────────────────────────────────────────────────────────────────────
  // ZIPPOPOTAM — postal-code → place lookup, no key
  // ─────────────────────────────────────────────────────────────────────
  const zippopotam = async (_ctx, input = {}) => {
    const country = String(input.country || "us").trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(country)) return { ok: false, reason: "invalid_country_code" };
    const postalCode = String(input.postalCode || "").trim();
    if (!postalCode) return { ok: false, reason: "missing_postal_code" };
    if (postalCode.length > 20) return { ok: false, reason: "postal_code_too_long" };
    const url = `https://api.zippopotam.us/${encodeURIComponent(country)}/${encodeURIComponent(postalCode)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const places = (data.places || []).map(p => ({
        placeName: p["place name"] || null,
        latitude: p.latitude ? parseFloat(p.latitude) : null,
        longitude: p.longitude ? parseFloat(p.longitude) : null,
        state: p.state || null,
        stateAbbrev: p["state abbreviation"] || null,
      }));
      return {
        ok: true,
        source: "Zippopotam.us",
        fetchedAt: Math.floor(Date.now() / 1000),
        country: data.country || country.toUpperCase(),
        countryAbbreviation: data["country abbreviation"] || country.toUpperCase(),
        postalCode: data["post code"] || postalCode,
        places,
      };
    } catch (e) {
      return { ok: false, reason: "zippopotam_unreachable", error: String(e?.message || e) };
    }
  };
  register("retail", "live_zippopotam", zippopotam, { note: "live Zippopotam.us postal lookup" });
  register("logistics", "live_zippopotam", zippopotam, { note: "live Zippopotam.us postal lookup" });
  register("travel", "live_zippopotam", zippopotam, { note: "live Zippopotam.us postal lookup" });

  // ─────────────────────────────────────────────────────────────────────
  // OPEN NOTIFY ISS PASS TIMES — over a lat/lon, no key
  // ─────────────────────────────────────────────────────────────────────
  // Note: open-notify.org currently serves http only; we proxy via fetch
  // so the browser doesn't issue a mixed-content fetch.
  // Open Notify RETIRED its iss-pass endpoint (it answers 404; the panel's
  // honest "unreachable" was the source's death, not a wiring fault). The
  // passes are now COMPUTED from wheretheiss.at's predicted ISS positions:
  // sample the next 24 h, convert each fix to a topocentric elevation for
  // the observer, and report the above-horizon windows. Same return shape
  // the panel has always rendered ({ risetime, riseTimeIso, durationSeconds }).
  const issPasses = async (_ctx, input = {}) => {
    const lat = Number(input.latitude);
    const lon = Number(input.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, reason: "invalid_latitude" };
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return { ok: false, reason: "invalid_longitude" };
    const n = Math.min(Math.max(Number(input.count) || 5, 1), 10);
    try {
      const positions = await sampleIssPositions(26 * 3600);
      if (positions.length < 10) return { ok: false, reason: "iss_positions_unreachable" };
      const passes = computePasses(positions, lat, lon).slice(0, n);
      return {
        ok: true,
        source: "wheretheiss.at positions — passes computed by Concord",
        fetchedAt: Math.floor(Date.now() / 1000),
        latitude: lat,
        longitude: lon,
        passes,
      };
    } catch (e) {
      return { ok: false, reason: "iss_positions_unreachable", error: String(e?.message || e) };
    }
  };

  // Fetch predicted ISS positions from wheretheiss.at (max 10 timestamps
  // per request), 3-minute steps for the first 12 h, 5-minute steps after.
  async function sampleIssPositions(spanSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const stamps = [];
    for (let t = now; t <= now + 12 * 3600; t += 180) stamps.push(t);
    for (let t = now + 12 * 3600 + 300; t <= now + spanSeconds; t += 300) stamps.push(t);
    const out = [];
    for (let i = 0; i < stamps.length; i += 10) {
      const batch = stamps.slice(i, i + 10);
      const url = `https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${batch.join(",")}&units=kilometers`;
      const data = await fetchJsonWithTimeout(url);
      if (Array.isArray(data)) out.push(...data);
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Topocentric elevation (degrees) of a satellite fix for an observer.
  function issElevationDeg(fix, obsLat, obsLon) {
    const R = 6371, D = Math.PI / 180;
    const ecef = (la, lo, altKm) => {
      const r = R + altKm, laR = la * D, loR = lo * D;
      return [r * Math.cos(laR) * Math.cos(loR), r * Math.cos(laR) * Math.sin(loR), r * Math.sin(laR)];
    };
    const o = ecef(obsLat, obsLon, 0);
    const s = ecef(fix.latitude, fix.longitude, fix.altitude);
    const rx = s[0] - o[0], ry = s[1] - o[1], rz = s[2] - o[2];
    const laR = obsLat * D, loR = obsLon * D;
    const up = rx * Math.cos(laR) * Math.cos(loR) + ry * Math.cos(laR) * Math.sin(loR) + rz * Math.sin(laR);
    const dist = Math.hypot(rx, ry, rz);
    return Math.asin(Math.max(-1, Math.min(1, up / dist))) / D;
  }

  // Above-horizon windows from sampled fixes; window edges refined by
  // linear interpolation of elevation between the bracketing samples.
  function computePasses(positions, obsLat, obsLon) {
    const pts = positions.map((f) => ({ t: f.timestamp, el: issElevationDeg(f, obsLat, obsLon) }));
    const passes = [];
    let start = null, prev = null;
    const cross = (a, b) => a.t + (b.t - a.t) * (0 - a.el) / (b.el - a.el);
    for (const pt of pts) {
      if (start === null && pt.el > 0 && prev && prev.el <= 0) start = cross(prev, pt);
      if (start !== null && pt.el <= 0 && prev && prev.el > 0) {
        const rise = Math.round(start), set = cross(prev, pt);
        passes.push({ risetime: rise, riseTimeIso: new Date(rise * 1000).toISOString(), durationSeconds: Math.max(0, Math.round(set - start)) });
        start = null;
      }
      prev = pt;
    }
    return passes;
  }

  register("astronomy", "live_iss_pass", issPasses, { note: "live Open Notify ISS pass times" });
  register("space", "live_iss_pass", issPasses, { note: "live Open Notify ISS pass times" });
}
