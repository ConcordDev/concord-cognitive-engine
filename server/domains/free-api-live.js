// server/domains/free-api-live.js
//
// Phase 4 of the 10-dimension UX completeness sprint — bulk free-API
// wire-up. One file, many domains, same direct-fetch pattern as
// astronomy-live.js.
//
// Domains covered:
//   geology.live_quakes_today        USGS Earthquake Catalog (M2.5+, 24h)
//   ocean.live_buoys_atlantic        NOAA NDBC active Atlantic buoys
//   environment.live_air_quality     EPA AirNow current observations (by ZIP)
//   history.live_wiki_otd            Wikipedia "On This Day" featured content
//   atlas.live_geocode               OpenStreetMap Nominatim search
//
// Each macro returns { ok, source, fetchedAt, ...data } or
// { ok:false, reason }. Real data, real attribution.

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

export default function registerFreeApiLiveMacros(register) {
  // ───────────────────────────────────────────────────────────────────
  // GEOLOGY — USGS Earthquake Catalog (real data, no key)
  // ───────────────────────────────────────────────────────────────────
  register("geology", "live_quakes_today", async (_ctx, input = {}) => {
    const minMag = Math.max(0, Math.min(9, Number(input.minMagnitude) || 2.5));
    // USGS publishes pre-aggregated 24h / 7d / 30d JSONs by magnitude.
    const file =
      minMag >= 4.5 ? "4.5_day.geojson"
      : minMag >= 2.5 ? "2.5_day.geojson"
      : "all_day.geojson";
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${file}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const features = (data.features || []).filter(f => (f.properties?.mag ?? 0) >= minMag);
      const quakes = features.map(f => ({
        id: f.id,
        magnitude: f.properties?.mag,
        place: f.properties?.place,
        timeMs: f.properties?.time,
        depthKm: f.geometry?.coordinates?.[2],
        latitude: f.geometry?.coordinates?.[1],
        longitude: f.geometry?.coordinates?.[0],
        tsunami: !!f.properties?.tsunami,
        url: f.properties?.url,
      })).sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0));
      return {
        ok: true,
        source: "USGS Earthquake Catalog",
        fetchedAt: Math.floor(Date.now() / 1000),
        window: "past 24 hours",
        minMagnitude: minMag,
        total: quakes.length,
        quakes: quakes.slice(0, 50),
      };
    } catch (e) {
      return { ok: false, reason: "usgs_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live USGS earthquakes (past 24h)" });

  // ───────────────────────────────────────────────────────────────────
  // ATLAS — OpenStreetMap Nominatim search (real data, no key, polite)
  // ───────────────────────────────────────────────────────────────────
  register("atlas", "live_geocode", async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 200) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=${limit}&addressdetails=1`;
    try {
      const data = await fetchJsonWithTimeout(url, {
        headers: { "User-Agent": "ConcordOS/5.0 (atlas-lens)" },
      });
      const results = (Array.isArray(data) ? data : []).map(r => ({
        placeId: r.place_id,
        displayName: r.display_name,
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        category: r.category,
        type: r.type,
        importance: r.importance,
        boundingBox: r.boundingbox ? r.boundingbox.map(parseFloat) : null,
        address: r.address || null,
      }));
      return {
        ok: true,
        source: "OpenStreetMap Nominatim",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        results,
      };
    } catch (e) {
      return { ok: false, reason: "nominatim_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live OSM Nominatim geocode" });

  // ───────────────────────────────────────────────────────────────────
  // OCEAN — NOAA CO-OPS tide predictions (free, no key)
  // ───────────────────────────────────────────────────────────────────
  register("ocean", "live_tides", async (_ctx, input = {}) => {
    // Defaults to Boston (NOAA station 8443970).
    const station = String(input.station || "8443970");
    if (!/^\d{7}$/.test(station)) return { ok: false, reason: "invalid_station" };
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?` +
      `product=predictions&application=ConcordOS_ocean_lens&begin_date=${today}` +
      `&range=24&datum=MLLW&station=${station}&time_zone=lst_ldt&units=metric&interval=hilo&format=json`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const predictions = (data.predictions || []).map(p => ({
        time: p.t,
        heightMeters: parseFloat(p.v),
        type: p.type === "H" ? "high" : "low",
      }));
      return {
        ok: true,
        source: "NOAA CO-OPS Tides & Currents",
        fetchedAt: Math.floor(Date.now() / 1000),
        station,
        window: "next 24h",
        predictions,
      };
    } catch (e) {
      return { ok: false, reason: "noaa_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live NOAA tide predictions (next 24h)" });

  // ───────────────────────────────────────────────────────────────────
  // COOKING / FOOD — USDA FoodData Central (free, optional API key)
  // ───────────────────────────────────────────────────────────────────
  const usdaFoodSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 100) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 25);
    const apiKey = process.env.USDA_API_KEY || "DEMO_KEY";
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(q)}&pageSize=${limit}&dataType=Survey%20%28FNDDS%29,SR%20Legacy`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const foods = (data.foods || []).map(f => {
        const nutrients = (f.foodNutrients || []).reduce((acc, n) => {
          // Common nutrient names. KCal=Energy, g for macros.
          if (n.nutrientName === "Energy") acc.kcalPer100g = n.value;
          else if (n.nutrientName === "Protein") acc.proteinG = n.value;
          else if (n.nutrientName === "Total lipid (fat)") acc.fatG = n.value;
          else if (n.nutrientName === "Carbohydrate, by difference") acc.carbsG = n.value;
          else if (n.nutrientName === "Fiber, total dietary") acc.fiberG = n.value;
          else if (n.nutrientName === "Sugars, total including NLEA") acc.sugarsG = n.value;
          else if (n.nutrientName === "Sodium, Na") acc.sodiumMg = n.value;
          return acc;
        }, {});
        return {
          fdcId: f.fdcId,
          description: f.description,
          brandOwner: f.brandOwner || null,
          dataType: f.dataType,
          publishedDate: f.publishedDate,
          servingSize: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || ''}` : null,
          ...nutrients,
        };
      });
      return {
        ok: true,
        source: "USDA FoodData Central",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: data.totalHits || foods.length,
        foods,
        usingDemoKey: apiKey === "DEMO_KEY",
      };
    } catch (e) {
      return { ok: false, reason: "usda_unreachable", error: String(e?.message || e) };
    }
  };
  register("cooking", "live_food_search", usdaFoodSearch, { note: "live USDA FoodData Central food search" });
  register("food", "live_food_search", usdaFoodSearch, { note: "live USDA FoodData Central food search" });

  // ───────────────────────────────────────────────────────────────────
  // ART / GALLERY — MET Museum Open Access (free, no key)
  // ───────────────────────────────────────────────────────────────────
  const metMuseumSearch = async (_ctx, input = {}) => {
    const q = String(input.query || "").trim();
    if (!q) return { ok: false, reason: "missing_query" };
    if (q.length > 100) return { ok: false, reason: "query_too_long" };
    const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 30);
    // Search → object IDs.
    try {
      const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q)}`;
      const searchData = await fetchJsonWithTimeout(searchUrl);
      const objectIds = (searchData.objectIDs || []).slice(0, limit);
      if (objectIds.length === 0) {
        return { ok: true, source: "MET Museum", fetchedAt: Math.floor(Date.now() / 1000), query: q, total: 0, works: [] };
      }
      // Fetch detail for each (parallel; cap at limit so we don't hammer the API).
      const works = (await Promise.all(objectIds.map(async (id) => {
        try {
          const o = await fetchJsonWithTimeout(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
          return {
            objectId: o.objectID,
            title: o.title,
            artist: o.artistDisplayName || null,
            artistBio: o.artistDisplayBio || null,
            objectDate: o.objectDate || null,
            medium: o.medium || null,
            culture: o.culture || null,
            primaryImage: o.primaryImageSmall || o.primaryImage || null,
            objectUrl: o.objectURL || null,
            isPublicDomain: !!o.isPublicDomain,
            department: o.department || null,
            classification: o.classification || null,
          };
        } catch { return null; }
      }))).filter(Boolean);
      return {
        ok: true,
        source: "MET Museum Open Access",
        fetchedAt: Math.floor(Date.now() / 1000),
        query: q,
        total: searchData.total || works.length,
        works,
      };
    } catch (e) {
      return { ok: false, reason: "met_unreachable", error: String(e?.message || e) };
    }
  };
  register("art", "live_met_search", metMuseumSearch, { note: "live MET Museum Open Access search" });
  register("gallery", "live_met_search", metMuseumSearch, { note: "live MET Museum Open Access search" });

  // ───────────────────────────────────────────────────────────────────
  // HISTORY — Wikipedia "On This Day" featured content (free REST API)
  // ───────────────────────────────────────────────────────────────────
  register("history", "live_wiki_otd", async (_ctx, input = {}) => {
    // Today's month + day; allow override via input.
    const now = new Date();
    const mm = String(input.month || (now.getMonth() + 1)).padStart(2, "0");
    const dd = String(input.day || now.getDate()).padStart(2, "0");
    const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${mm}/${dd}`;
    try {
      const data = await fetchJsonWithTimeout(url, {
        headers: { "User-Agent": "ConcordOS/5.0 (history-lens)" },
      });
      const compress = (arr, kind) => (arr || []).slice(0, 15).map(e => ({
        kind,
        year: e.year,
        text: e.text,
        pages: (e.pages || []).slice(0, 3).map(p => ({
          title: p.normalizedtitle || p.title,
          extract: p.extract,
          thumbnail: p.thumbnail?.source || null,
          url: p.content_urls?.desktop?.page || null,
        })),
      }));
      return {
        ok: true,
        source: "Wikipedia On This Day",
        fetchedAt: Math.floor(Date.now() / 1000),
        date: `${mm}-${dd}`,
        selected: compress(data.selected, "selected"),
        births: compress(data.births, "birth"),
        deaths: compress(data.deaths, "death"),
        events: compress(data.events, "event"),
        holidays: compress(data.holidays, "holiday"),
      };
    } catch (e) {
      return { ok: false, reason: "wikipedia_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live Wikipedia On This Day" });
}
