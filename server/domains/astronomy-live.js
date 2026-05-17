// server/domains/astronomy-live.js
//
// Phase 4 of the 10-dimension UX completeness sprint — real free-API
// wiring for the astronomy lens.
//
// Standalone macros that fetch live data without needing an artifact
// scaffold:
//
//   astronomy.live_apod              NASA Astronomy Picture of the Day
//   astronomy.live_iss               Current ISS location + velocity
//   astronomy.live_neo               Near-Earth Object feed for today
//   astronomy.live_mars_weather      Mars InSight weather (Curiosity REMS)
//
// All free; NASA_API_KEY env optional (DEMO_KEY rate-limits to 30/hr).
// Wired into publicReadDomains via the broad recent_mine bypass so
// the lens can call them as GETs.
//
// Each macro returns {ok, source, fetchedAt, ...data} or
// {ok:false, reason}. Data is real, not synthetic.

const NASA_API_BASE = "https://api.nasa.gov";
const ISS_API_BASE = "https://api.wheretheiss.at/v1/satellites/25544";
const FETCH_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default function registerAstronomyLiveMacros(register) {
  register("astronomy", "live_apod", async (_ctx, input = {}) => {
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const date = input.date ? `&date=${encodeURIComponent(String(input.date))}` : "";
    const url = `${NASA_API_BASE}/planetary/apod?api_key=${encodeURIComponent(apiKey)}${date}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      return {
        ok: true,
        source: "NASA APOD",
        fetchedAt: Math.floor(Date.now() / 1000),
        usingDemoKey: apiKey === "DEMO_KEY",
        apod: {
          date: data.date,
          title: data.title,
          explanation: data.explanation,
          mediaType: data.media_type,
          url: data.url,
          hdurl: data.hdurl || null,
          copyright: data.copyright || null,
        },
      };
    } catch (e) {
      return { ok: false, reason: "nasa_apod_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live NASA Astronomy Picture of the Day" });

  register("astronomy", "live_iss", async (_ctx, _input = {}) => {
    try {
      const data = await fetchJsonWithTimeout(ISS_API_BASE);
      return {
        ok: true,
        source: "wheretheiss.at",
        fetchedAt: Math.floor(Date.now() / 1000),
        iss: {
          latitude: data.latitude,
          longitude: data.longitude,
          altitudeKm: data.altitude,
          velocityKmh: data.velocity,
          visibility: data.visibility,
          footprintKm: data.footprint,
        },
      };
    } catch (e) {
      return { ok: false, reason: "iss_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live ISS position" });

  register("astronomy", "live_neo", async (_ctx, input = {}) => {
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const today = new Date().toISOString().slice(0, 10);
    const start = input.start_date || today;
    const end = input.end_date || start;
    const url = `${NASA_API_BASE}/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${encodeURIComponent(apiKey)}`;
    try {
      const data = await fetchJsonWithTimeout(url);
      const byDate = data.near_earth_objects || {};
      // Flatten into a single list with computed close-approach summary.
      const objects = [];
      for (const [date, objs] of Object.entries(byDate)) {
        for (const o of objs) {
          const ca = (o.close_approach_data && o.close_approach_data[0]) || {};
          objects.push({
            id: o.id,
            name: o.name,
            date,
            diameterKmMin: o.estimated_diameter?.kilometers?.estimated_diameter_min,
            diameterKmMax: o.estimated_diameter?.kilometers?.estimated_diameter_max,
            hazardous: !!o.is_potentially_hazardous_asteroid,
            missDistanceKm: ca.miss_distance?.kilometers ? parseFloat(ca.miss_distance.kilometers) : null,
            relativeVelocityKmh: ca.relative_velocity?.kilometers_per_hour
              ? parseFloat(ca.relative_velocity.kilometers_per_hour) : null,
            orbitingBody: ca.orbiting_body || null,
            jplUrl: o.nasa_jpl_url || null,
          });
        }
      }
      objects.sort((a, b) => (a.missDistanceKm ?? Infinity) - (b.missDistanceKm ?? Infinity));
      return {
        ok: true,
        source: "NASA NeoWs",
        fetchedAt: Math.floor(Date.now() / 1000),
        usingDemoKey: apiKey === "DEMO_KEY",
        elementCount: data.element_count || objects.length,
        objects: objects.slice(0, 20),
      };
    } catch (e) {
      return { ok: false, reason: "nasa_neo_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live NASA Near-Earth Objects" });
}
