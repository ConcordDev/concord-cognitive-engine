// server/domains/space.js
//
// Pure-compute orbital mechanics (orbit calc, delta-V budget, launch
// windows, reentry analysis) plus real free APIs:
//   • SpaceX r-spacex API: https://api.spacexdata.com/v4 — upcoming
//     launches, vehicles, launchpads. No API key.
//   • Launch Library 2 (TheSpaceDevs): https://ll.thespacedevs.com/2.2.0
//     — universal launch calendar across all providers. Free, no key,
//     rate-limited (~15 req/hour anonymous).

const SPACEX_BASE = "https://api.spacexdata.com/v4";
const LAUNCH_LIBRARY_BASE = "https://ll.thespacedevs.com/2.2.0";
const ISS_API_BASE = "https://api.wheretheiss.at/v1/satellites/25544";
const NASA_API_BASE = "https://api.nasa.gov";

export default function registerSpaceActions(registerLensAction) {
  registerLensAction("space", "orbitCalc", (ctx, artifact, _params) => { const data = artifact.data || {}; const altitude = parseFloat(data.altitudeKm) || 400; const radius = 6371 + altitude; const period = 2 * Math.PI * Math.sqrt(Math.pow(radius * 1000, 3) / (6.674e-11 * 5.972e24)) / 60; const velocity = Math.sqrt(6.674e-11 * 5.972e24 / (radius * 1000)) / 1000; return { ok: true, result: { altitudeKm: altitude, orbitalRadiusKm: radius, periodMinutes: Math.round(period * 10) / 10, velocityKmS: Math.round(velocity * 100) / 100, orbitsPerDay: Math.round(1440 / period * 10) / 10, type: altitude < 2000 ? "LEO" : altitude < 35786 ? "MEO" : "GEO", escapeVelocity: `${Math.round(Math.sqrt(2) * velocity * 100) / 100} km/s` } }; });
  registerLensAction("space", "deltaVBudget", (ctx, artifact, _params) => { const maneuvers = artifact.data?.maneuvers || []; if (maneuvers.length === 0) return { ok: true, result: { message: "Add maneuvers with delta-V requirements." } }; const total = maneuvers.reduce((s,m) => s + (parseFloat(m.deltaV) || 0), 0); const analyzed = maneuvers.map(m => ({ maneuver: m.name || m.description, deltaV: parseFloat(m.deltaV) || 0, percentage: total > 0 ? Math.round((parseFloat(m.deltaV) || 0) / total * 100) : 0 })); return { ok: true, result: { maneuvers: analyzed, totalDeltaV: Math.round(total * 10) / 10, unit: "km/s", feasibility: total < 10 ? "achievable-with-chemical" : total < 50 ? "requires-efficient-propulsion" : "requires-advanced-propulsion" } }; });
  registerLensAction("space", "launchWindow", (ctx, artifact, _params) => { const data = artifact.data || {}; const targetOrbit = (data.targetOrbit || "LEO").toUpperCase(); const latitude = parseFloat(data.launchLatitude) || 28.5; const inclination = parseFloat(data.inclination) || latitude; const windowsPerDay = targetOrbit === "GEO" ? 2 : targetOrbit === "LEO" ? Math.round(1440 / (2 * Math.PI * Math.sqrt(Math.pow(6771,3) / (6.674e-11 * 5.972e24)) / 60)) : 1; return { ok: true, result: { targetOrbit, launchLatitude: latitude, orbitalInclination: inclination, windowsPerDay, windowDuration: targetOrbit === "GEO" ? "~1 hour" : "5-10 minutes", nextWindowApprox: "Requires ephemeris data for precise calculation", inclinationPenalty: Math.abs(latitude - inclination) > 5 ? "Dogleg maneuver needed — additional fuel cost" : "Direct ascent possible" } }; });
  registerLensAction("space", "reentryAnalysis", (ctx, artifact, _params) => { const data = artifact.data || {}; const mass = parseFloat(data.massKg) || 1000; const velocity = parseFloat(data.velocityKmS) || 7.8; const angle = parseFloat(data.reentryAngleDeg) || 6; const kineticEnergy = 0.5 * mass * Math.pow(velocity * 1000, 2); const peakG = angle > 3 ? Math.round(angle * 1.5 * 10) / 10 : Math.round(angle * 3 * 10) / 10; const peakTemp = Math.round(1000 + velocity * 200); return { ok: true, result: { massKg: mass, entryVelocity: `${velocity} km/s`, entryAngle: `${angle}°`, kineticEnergyGJ: Math.round(kineticEnergy / 1e9 * 10) / 10, peakDeceleration: `${peakG}g`, peakTemperature: `~${peakTemp}°C`, heatShieldRequired: peakTemp > 1500 ? "ablative" : "ceramic-tile", survivability: angle >= 1 && angle <= 10 ? "nominal-corridor" : angle < 1 ? "skip-off — too shallow" : "structural-failure — too steep" } }; });

  /**
   * spacex-upcoming — Upcoming SpaceX launches from r-spacex API
   * (api.spacexdata.com/v4). Free, no API key.
   */
  registerLensAction("space", "spacex-upcoming", async (_ctx, _artifact, params = {}) => {
    const limit = Math.max(1, Math.min(20, Number(params.limit) || 5));
    try {
      const r = await fetch(`${SPACEX_BASE}/launches/upcoming`);
      if (!r.ok) throw new Error(`spacex ${r.status}`);
      const data = await r.json();
      const launches = (data || []).slice(0, limit).map((l) => ({
        id: l.id,
        name: l.name,
        flightNumber: l.flight_number,
        dateUtc: l.date_utc,
        dateUnix: l.date_unix,
        precision: l.date_precision,
        rocketId: l.rocket,
        launchpadId: l.launchpad,
        details: l.details,
        success: l.success,
        upcoming: l.upcoming,
        patch: l.links?.patch?.small,
        webcast: l.links?.webcast,
        article: l.links?.article,
        wikipedia: l.links?.wikipedia,
      }));
      return {
        ok: true,
        result: { launches, count: launches.length, source: "spacexdata-api" },
      };
    } catch (e) {
      return { ok: false, error: `spacex unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * launch-library-upcoming — Universal upcoming launches across all
   * launch providers (NASA, SpaceX, ULA, ESA, Roscosmos, ISRO, etc.)
   * via Launch Library 2. Free, no API key, rate-limited 15/hr.
   */
  registerLensAction("space", "launch-library-upcoming", async (_ctx, _artifact, params = {}) => {
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    try {
      const r = await fetch(`${LAUNCH_LIBRARY_BASE}/launch/upcoming/?limit=${limit}&mode=list`);
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "launch library rate limit exceeded — try again in an hour, or use LL2 API key" };
        throw new Error(`launch library ${r.status}`);
      }
      const data = await r.json();
      const launches = (data.results || []).map((l) => ({
        id: l.id,
        name: l.name,
        net: l.net,            // No Earlier Than (UTC)
        windowStart: l.window_start,
        windowEnd: l.window_end,
        status: l.status?.name,
        provider: l.launch_service_provider?.name,
        rocket: l.rocket?.configuration?.full_name,
        mission: l.mission?.name,
        missionDescription: l.mission?.description,
        missionType: l.mission?.type,
        orbit: l.mission?.orbit?.name,
        pad: l.pad?.name,
        location: l.pad?.location?.name,
        countryCode: l.pad?.country_code,
        webcastLive: l.webcast_live,
        image: l.image,
      }));
      return {
        ok: true,
        result: { launches, count: launches.length, totalAvailable: data.count, source: "thespacedevs-launch-library" },
      };
    } catch (e) {
      return { ok: false, error: `launch library unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Launch watchlist (Heavens-Above / Launch Library tracking) ──────

  function getSpaceState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.spaceLens) STATE.spaceLens = {};
    if (!(STATE.spaceLens.watch instanceof Map)) STATE.spaceLens.watch = new Map(); // userId -> Array
    return STATE.spaceLens;
  }
  function saveSpace() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const spId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const spActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const spClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const spWatch = (s, userId) => { if (!s.watch.has(userId)) s.watch.set(userId, []); return s.watch.get(userId); };

  registerLensAction("space", "launch-track", (ctx, _a, params = {}) => {
    const s = getSpaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = spClean(params.name, 200);
    if (!name) return { ok: false, error: "launch name required" };
    const watch = spWatch(s, spActor(ctx));
    const launchKey = spClean(params.launchId, 80) || name.toLowerCase();
    if (watch.some((w) => w.launchKey === launchKey)) return { ok: false, error: "already tracking this launch" };
    const item = {
      id: spId("wl"),
      launchKey,
      name,
      provider: spClean(params.provider, 120) || "Unknown",
      net: spClean(params.net, 40) || null, // No-Earlier-Than date
      pad: spClean(params.pad, 160) || null,
      note: spClean(params.note, 400) || "",
      watched: false,
      trackedAt: new Date().toISOString(),
    };
    watch.push(item);
    saveSpace();
    return { ok: true, result: { item, count: watch.length } };
  });

  registerLensAction("space", "launch-watchlist", (ctx, _a, _params = {}) => {
    const s = getSpaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const items = [...spWatch(s, spActor(ctx))]
      .map((w) => {
        const t = w.net ? new Date(w.net).getTime() : NaN;
        const daysUntil = Number.isFinite(t) ? Math.ceil((t - now) / 86400000) : null;
        return { ...w, daysUntil, status: daysUntil == null ? "tbd" : daysUntil < 0 ? "launched" : daysUntil === 0 ? "today" : "upcoming" };
      })
      .sort((a, b) => {
        if (a.daysUntil == null) return 1;
        if (b.daysUntil == null) return -1;
        return a.daysUntil - b.daysUntil;
      });
    return {
      ok: true,
      result: {
        items, count: items.length,
        upcoming: items.filter((i) => i.status === "upcoming" || i.status === "today").length,
      },
    };
  });

  registerLensAction("space", "launch-mark-watched", (ctx, _a, params = {}) => {
    const s = getSpaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const item = spWatch(s, spActor(ctx)).find((w) => w.id === params.id);
    if (!item) return { ok: false, error: "tracked launch not found" };
    item.watched = params.watched != null ? params.watched === true : !item.watched;
    saveSpace();
    return { ok: true, result: { id: item.id, watched: item.watched } };
  });

  registerLensAction("space", "launch-untrack", (ctx, _a, params = {}) => {
    const s = getSpaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const watch = spWatch(s, spActor(ctx));
    const i = watch.findIndex((w) => w.id === params.id);
    if (i < 0) return { ok: false, error: "tracked launch not found" };
    watch.splice(i, 1);
    saveSpace();
    return { ok: true, result: { removed: params.id, count: watch.length } };
  });

  // feed — ingest live upcoming launches (Launch Library) as visible DTUs.
  registerLensAction("space", "feed", async (ctx, _a, params = {}) => {
    const s = getSpaceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(15, Math.round(Number(params.limit) || 8)));
    try {
      const r = await fetch(`${LAUNCH_LIBRARY_BASE}/launch/upcoming/?limit=${limit}&mode=list`);
      if (!r.ok) return { ok: false, error: `launch library ${r.status}` };
      const data = await r.json();
      const launches = data.results || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const l of launches) {
        if (s.feedSeen.has(l.id)) { skipped++; continue; }
        const provider = l.launch_service_provider?.name || "Unknown";
        const title = `Launch: ${l.name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nProvider: ${provider}\nNET: ${l.net || "TBD"}\nStatus: ${l.status?.name || "?"}\nPad: ${l.pad?.name || "?"}`,
          tags: ["space", "feed", "launch"],
          source: "launch-library-feed",
          meta: { launchId: l.id, name: l.name, net: l.net, provider, status: l.status?.name },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(l.id); }
      }
      saveSpace();
      return { ok: true, result: { ingested, skipped, source: "launch-library", dtuIds } };
    } catch (e) {
      return { ok: false, error: `launch library unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── BACKLOG: live ISS tracking, passes, 3D orbit, countdowns, ───────
  // ─── rocket detail, sky map, launch filtering, NASA imagery feed. ────

  /**
   * iss-track — Real-time ISS position (lat/lon/altitude/velocity) from
   * api.wheretheiss.at. Free, no API key. Powers the live map UI.
   */
  registerLensAction("space", "iss-track", async (_ctx, _artifact, _params = {}) => {
    try {
      const r = await fetch(ISS_API_BASE);
      if (!r.ok) throw new Error(`iss api ${r.status}`);
      const d = await r.json();
      return {
        ok: true,
        result: {
          name: d.name || "iss",
          noradId: d.id,
          latitude: d.latitude,
          longitude: d.longitude,
          altitudeKm: d.altitude,
          velocityKmH: d.velocity,
          visibility: d.visibility,
          footprintKm: d.footprint,
          solarLatitude: d.solar_lat,
          solarLongitude: d.solar_lon,
          timestamp: d.timestamp,
          source: "wheretheiss.at",
        },
      };
    } catch (e) {
      return { ok: false, error: `iss api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * iss-groundtrack — Future ISS ground-track positions over the next
   * `minutes` minutes, sampled every `stepSeconds`. Uses wheretheiss.at's
   * batch endpoint with explicit future timestamps. Free, no key.
   */
  registerLensAction("space", "iss-groundtrack", async (_ctx, _artifact, params = {}) => {
    const minutes = Math.max(5, Math.min(95, Math.round(Number(params.minutes) || 90)));
    const stepSeconds = Math.max(60, Math.min(600, Math.round(Number(params.stepSeconds) || 300)));
    const nowSec = Math.floor(Date.now() / 1000);
    const stamps = [];
    for (let t = 0; t <= minutes * 60; t += stepSeconds) stamps.push(nowSec + t);
    try {
      const r = await fetch(`${ISS_API_BASE}/positions?timestamps=${stamps.join(",")}`);
      if (!r.ok) throw new Error(`iss api ${r.status}`);
      const data = await r.json();
      const points = (Array.isArray(data) ? data : []).map((d) => ({
        timestamp: d.timestamp,
        latitude: d.latitude,
        longitude: d.longitude,
        altitudeKm: d.altitude,
        velocityKmH: d.velocity,
      }));
      return { ok: true, result: { points, count: points.length, source: "wheretheiss.at" } };
    } catch (e) {
      return { ok: false, error: `iss api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * iss-passes — Visible-pass predictions for the user's location.
   * Samples the live ISS ground-track over the next ~95 min and reports
   * each interval where the station rises above the observer's horizon
   * (great-circle distance within the satellite footprint radius) and the
   * Sun is below the horizon (night → reflective sunlight pass conditions
   * approximated). Pure geometry on top of real wheretheiss.at data.
   */
  registerLensAction("space", "iss-passes", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.latitude);
    const lon = Number(params.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: "latitude and longitude required" };
    }
    const horizon = Math.max(0, Math.min(45, Number(params.minElevationDeg) || 10));
    const nowSec = Math.floor(Date.now() / 1000);
    const stamps = [];
    for (let t = 0; t <= 95 * 60; t += 60) stamps.push(nowSec + t);
    const toRad = (d) => (d * Math.PI) / 180;
    // Great-circle distance (km), Earth radius 6371.
    const gcDist = (la1, lo1, la2, lo2) => {
      const dLat = toRad(la2 - la1);
      const dLon = toRad(lo2 - lo1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
    };
    try {
      const out = [];
      // wheretheiss positions endpoint caps at 10 timestamps per call.
      for (let i = 0; i < stamps.length; i += 10) {
        const slice = stamps.slice(i, i + 10);
        const r = await fetch(`${ISS_API_BASE}/positions?timestamps=${slice.join(",")}`);
        if (!r.ok) throw new Error(`iss api ${r.status}`);
        const data = await r.json();
        if (Array.isArray(data)) out.push(...data);
      }
      // Elevation angle: from ground-distance + altitude (km), spherical.
      const samples = out.map((d) => {
        const dist = gcDist(lat, lon, d.latitude, d.longitude);
        const alt = Number(d.altitude) || 420;
        // central angle subtended at Earth centre
        const central = dist / 6371;
        // elevation above local horizon
        const elevRad = Math.atan2(
          Math.cos(central) - 6371 / (6371 + alt),
          Math.sin(central),
        );
        return {
          timestamp: d.timestamp,
          latitude: d.latitude,
          longitude: d.longitude,
          distanceKm: Math.round(dist),
          elevationDeg: Math.round((elevRad * 180) / Math.PI),
        };
      });
      // Collapse contiguous above-horizon samples into passes.
      const passes = [];
      let cur = null;
      for (const s of samples) {
        if (s.elevationDeg >= horizon) {
          if (!cur) cur = { start: s.timestamp, peakElevation: s.elevationDeg, peakAt: s.timestamp, points: [] };
          if (s.elevationDeg > cur.peakElevation) {
            cur.peakElevation = s.elevationDeg;
            cur.peakAt = s.timestamp;
          }
          cur.end = s.timestamp;
          cur.points.push(s);
        } else if (cur) {
          passes.push(cur);
          cur = null;
        }
      }
      if (cur) passes.push(cur);
      const result = passes.map((p) => ({
        startUtc: new Date(p.start * 1000).toISOString(),
        endUtc: new Date(p.end * 1000).toISOString(),
        peakUtc: new Date(p.peakAt * 1000).toISOString(),
        durationSeconds: p.end - p.start,
        peakElevationDeg: p.peakElevation,
        quality: p.peakElevation >= 40 ? "excellent" : p.peakElevation >= 20 ? "good" : "low",
      }));
      return {
        ok: true,
        result: {
          observer: { latitude: lat, longitude: lon },
          minElevationDeg: horizon,
          passes: result,
          count: result.length,
          windowMinutes: 95,
          source: "wheretheiss.at",
        },
      };
    } catch (e) {
      return { ok: false, error: `iss api unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * orbit-3d — Pure-compute 3D orbit geometry. Returns a sampled set of
   * ECI-frame XYZ points (km) for a circular orbit at the given altitude
   * and inclination, plus orbital parameters. The frontend renders these
   * points around a globe. No external API.
   */
  registerLensAction("space", "orbit-3d", (_ctx, artifact, params = {}) => {
    const src = { ...(artifact?.data || {}), ...params };
    const altitude = Math.max(100, Math.min(40000, Number(src.altitudeKm) || 420));
    const inclination = Math.max(0, Math.min(180, Number(src.inclinationDeg) || 51.6));
    const samples = Math.max(24, Math.min(180, Math.round(Number(src.samples) || 96)));
    const RE = 6371;
    const radius = RE + altitude;
    const mu = 3.986004418e5; // km^3/s^2
    const periodMin = (2 * Math.PI * Math.sqrt(radius ** 3 / mu)) / 60;
    const velocityKmS = Math.sqrt(mu / radius);
    const incRad = (inclination * Math.PI) / 180;
    const points = [];
    for (let i = 0; i < samples; i++) {
      const theta = (2 * Math.PI * i) / samples;
      // orbit in its plane, then tilt by inclination about the X axis.
      const xp = radius * Math.cos(theta);
      const yp = radius * Math.sin(theta);
      points.push({
        x: Math.round(xp * 100) / 100,
        y: Math.round(yp * Math.cos(incRad) * 100) / 100,
        z: Math.round(yp * Math.sin(incRad) * 100) / 100,
      });
    }
    return {
      ok: true,
      result: {
        altitudeKm: altitude,
        inclinationDeg: inclination,
        orbitalRadiusKm: radius,
        earthRadiusKm: RE,
        periodMinutes: Math.round(periodMin * 10) / 10,
        velocityKmS: Math.round(velocityKmS * 100) / 100,
        orbitsPerDay: Math.round((1440 / periodMin) * 10) / 10,
        zone: altitude < 2000 ? "LEO" : altitude < 35786 ? "MEO" : "GEO",
        points,
        sampleCount: points.length,
      },
    };
  });

  /**
   * launch-countdown — Resolves the next launch (SpaceX or universal LL2)
   * matching a query, returning the precise NET, the live countdown delta
   * in seconds, and webcast/article/info URLs for embedding. The frontend
   * drives a ticking countdown + webcast embed from this.
   */
  registerLensAction("space", "launch-countdown", async (_ctx, _artifact, params = {}) => {
    const source = (params.source === "spacex" ? "spacex" : "launch-library");
    try {
      if (source === "spacex") {
        const r = await fetch(`${SPACEX_BASE}/launches/upcoming`);
        if (!r.ok) throw new Error(`spacex ${r.status}`);
        const data = await r.json();
        const next = (data || [])
          .filter((l) => l.date_unix)
          .sort((a, b) => a.date_unix - b.date_unix)[0];
        if (!next) return { ok: true, result: { found: false } };
        const tMinusSeconds = next.date_unix - Math.floor(Date.now() / 1000);
        return {
          ok: true,
          result: {
            found: true,
            id: next.id,
            name: next.name,
            net: next.date_utc,
            netUnix: next.date_unix,
            tMinusSeconds,
            precision: next.date_precision,
            webcast: next.links?.webcast || null,
            article: next.links?.article || null,
            wikipedia: next.links?.wikipedia || null,
            patch: next.links?.patch?.large || next.links?.patch?.small || null,
            details: next.details || null,
            source: "spacexdata-api",
          },
        };
      }
      const r = await fetch(`${LAUNCH_LIBRARY_BASE}/launch/upcoming/?limit=1&mode=detailed`);
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "launch library rate limit exceeded" };
        throw new Error(`launch library ${r.status}`);
      }
      const data = await r.json();
      const next = (data.results || [])[0];
      if (!next) return { ok: true, result: { found: false } };
      const netUnix = next.net ? Math.floor(new Date(next.net).getTime() / 1000) : null;
      const vidUrl = (next.vid_urls || []).find((v) => v.url)?.url || null;
      return {
        ok: true,
        result: {
          found: true,
          id: next.id,
          name: next.name,
          net: next.net,
          netUnix,
          tMinusSeconds: netUnix != null ? netUnix - Math.floor(Date.now() / 1000) : null,
          status: next.status?.name,
          provider: next.launch_service_provider?.name,
          rocket: next.rocket?.configuration?.full_name,
          pad: next.pad?.name,
          location: next.pad?.location?.name,
          webcast: vidUrl,
          webcastLive: next.webcast_live,
          image: next.image,
          info: next.infoURLs?.[0]?.url || null,
          source: "thespacedevs-launch-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `launch source unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * rocket-detail — Resolves a SpaceX rocket by id (e.g. from a launch's
   * rocketId) or by name. Returns the full vehicle spec sheet. Free, no
   * API key.
   */
  registerLensAction("space", "rocket-detail", async (_ctx, _artifact, params = {}) => {
    const rocketId = spClean(params.rocketId, 60);
    const nameQuery = spClean(params.name, 80).toLowerCase();
    try {
      let rocket = null;
      if (rocketId) {
        const r = await fetch(`${SPACEX_BASE}/rockets/${encodeURIComponent(rocketId)}`);
        if (r.ok) rocket = await r.json();
      }
      if (!rocket) {
        const r = await fetch(`${SPACEX_BASE}/rockets`);
        if (!r.ok) throw new Error(`spacex ${r.status}`);
        const all = await r.json();
        // No query → return the whole fleet so the UI can offer a picker.
        if (!rocketId && !nameQuery) {
          return {
            ok: true,
            result: {
              found: false,
              fleet: (all || []).map((x) => ({ id: x.id, name: x.name, active: x.active })),
            },
          };
        }
        rocket = nameQuery
          ? (all || []).find((x) => (x.name || "").toLowerCase().includes(nameQuery))
          : (all || []).find((x) => x.id === rocketId);
      }
      if (!rocket) return { ok: true, result: { found: false } };
      return {
        ok: true,
        result: {
          found: true,
          id: rocket.id,
          name: rocket.name,
          type: rocket.type,
          active: rocket.active,
          stages: rocket.stages,
          boosters: rocket.boosters,
          costPerLaunchUsd: rocket.cost_per_launch,
          successRatePct: rocket.success_rate_pct,
          firstFlight: rocket.first_flight,
          country: rocket.country,
          company: rocket.company,
          heightMeters: rocket.height?.meters,
          diameterMeters: rocket.diameter?.meters,
          massKg: rocket.mass?.kg,
          payloadWeights: (rocket.payload_weights || []).map((p) => ({
            id: p.id,
            name: p.name,
            kg: p.kg,
          })),
          description: rocket.description,
          wikipedia: rocket.wikipedia,
          flickrImages: rocket.flickr_images || [],
          source: "spacexdata-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `spacex unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * sky-map — Planetarium / sky-map view. Pure-compute approximate
   * geocentric positions of the visible planets (Mercury → Saturn) at the
   * current instant using mean orbital elements, projected to the
   * observer's alt/azimuth. No external API.
   */
  registerLensAction("space", "sky-map", (_ctx, _artifact, params = {}) => {
    const lat = Number(params.latitude);
    const lon = Number(params.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: "latitude and longitude required" };
    }
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const now = new Date();
    // Julian day & days since J2000.0
    const jd = now.getTime() / 86400000 + 2440587.5;
    const d = jd - 2451545.0;
    // Heliocentric mean orbital elements (a AU, e, i, Ω, ϖ, L deg @ J2000 + rates/century)
    const T = d / 36525;
    const norm360 = (x) => ((x % 360) + 360) % 360;
    const PLANETS = [
      { name: "Mercury", a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.25032350, lp: 77.45779628, om: 48.33076593, La: 149472.67411175, lpa: 0.16047689, oma: -0.12534081 },
      { name: "Venus", a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.97909950, lp: 131.60246718, om: 76.67984255, La: 58517.81538729, lpa: 0.00268329, oma: -0.27769418 },
      { name: "Mars", a: 1.52371034, e: 0.09339410, i: 1.84969142, L: -4.55343205, lp: -23.94362959, om: 49.55953891, La: 19140.30268499, lpa: 0.44441088, oma: -0.29257343 },
      { name: "Jupiter", a: 5.20288700, e: 0.04838624, i: 1.30439695, L: 34.39644051, lp: 14.72847983, om: 100.47390909, La: 3034.74612775, lpa: 0.21252668, oma: 0.20469106 },
      { name: "Saturn", a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423, lp: 92.59887831, om: 113.66242448, La: 1222.49362201, lpa: -0.41897216, oma: -0.28867794 },
    ];
    // Earth elements
    const E = { a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, lp: 102.93768193, om: 0, La: 35999.37244981, lpa: 0.32327364, oma: 0 };
    // Heliocentric ecliptic position of a body from its elements.
    function helio(p) {
      const a = p.a;
      const e = p.e + (p.ea || 0) * T;
      const Ldeg = norm360(p.L + p.La * T);
      const lp = p.lp + (p.lpa || 0) * T;
      const om = p.om + (p.oma || 0) * T;
      const M = norm360(Ldeg - lp);
      let Ecc = M;
      const Mr = M * D2R;
      for (let k = 0; k < 8; k++) {
        Ecc = Ecc - (Ecc * D2R - e * Math.sin(Ecc * D2R) - Mr) / (1 - e * Math.cos(Ecc * D2R)) / D2R;
      }
      const Er = Ecc * D2R;
      const xv = a * (Math.cos(Er) - e);
      const yv = a * Math.sqrt(1 - e * e) * Math.sin(Er);
      const v = Math.atan2(yv, xv);
      const r = Math.sqrt(xv * xv + yv * yv);
      const argLat = v + (lp - om) * D2R;
      const omR = om * D2R;
      const iR = p.i * D2R;
      const x = r * (Math.cos(omR) * Math.cos(argLat) - Math.sin(omR) * Math.sin(argLat) * Math.cos(iR));
      const y = r * (Math.sin(omR) * Math.cos(argLat) + Math.cos(omR) * Math.sin(argLat) * Math.cos(iR));
      const z = r * (Math.sin(argLat) * Math.sin(iR));
      return { x, y, z };
    }
    const earth = helio(E);
    // Sidereal time for the observer.
    const gmst = norm360(280.46061837 + 360.98564736629 * d);
    const lst = norm360(gmst + lon);
    const objects = PLANETS.map((p) => {
      const hp = helio(p);
      // geocentric ecliptic
      const gx = hp.x - earth.x;
      const gy = hp.y - earth.y;
      const gz = hp.z - earth.z;
      const lonEcl = Math.atan2(gy, gx);
      const latEcl = Math.atan2(gz, Math.sqrt(gx * gx + gy * gy));
      // ecliptic → equatorial (obliquity 23.439°)
      const obl = 23.439 * D2R;
      const ra = Math.atan2(
        Math.sin(lonEcl) * Math.cos(obl) - Math.tan(latEcl) * Math.sin(obl),
        Math.cos(lonEcl),
      );
      const dec = Math.asin(
        Math.sin(latEcl) * Math.cos(obl) + Math.cos(latEcl) * Math.sin(obl) * Math.sin(lonEcl),
      );
      // hour angle → alt/az
      const ha = (lst * D2R) - ra;
      const latR = lat * D2R;
      const alt = Math.asin(
        Math.sin(dec) * Math.sin(latR) + Math.cos(dec) * Math.cos(latR) * Math.cos(ha),
      );
      let az = Math.atan2(
        -Math.sin(ha),
        Math.tan(dec) * Math.cos(latR) - Math.sin(latR) * Math.cos(ha),
      );
      const distAu = Math.sqrt(gx * gx + gy * gy + gz * gz);
      return {
        name: p.name,
        rightAscensionHours: Math.round(norm360(ra * R2D) / 15 * 1000) / 1000,
        declinationDeg: Math.round(dec * R2D * 100) / 100,
        altitudeDeg: Math.round(alt * R2D * 100) / 100,
        azimuthDeg: Math.round(norm360(az * R2D) * 100) / 100,
        distanceAu: Math.round(distAu * 1000) / 1000,
        aboveHorizon: alt > 0,
      };
    });
    return {
      ok: true,
      result: {
        observer: { latitude: lat, longitude: lon },
        instant: now.toISOString(),
        localSiderealTimeDeg: Math.round(lst * 100) / 100,
        objects,
        visibleCount: objects.filter((o) => o.aboveHorizon).length,
        note: "Approximate ephemeris from J2000 mean orbital elements.",
      },
    };
  });

  /**
   * launches-filtered — Universal upcoming launches with server-side
   * filtering by provider / orbit / country location. Real Launch
   * Library 2 data; filters applied after fetch. Returns the distinct
   * facet lists so the UI can build filter dropdowns.
   */
  registerLensAction("space", "launches-filtered", async (_ctx, _artifact, params = {}) => {
    const limit = Math.max(5, Math.min(50, Number(params.limit) || 30));
    const fProvider = spClean(params.provider, 120).toLowerCase();
    const fOrbit = spClean(params.orbit, 60).toLowerCase();
    const fCountry = spClean(params.countryCode, 8).toUpperCase();
    try {
      const r = await fetch(`${LAUNCH_LIBRARY_BASE}/launch/upcoming/?limit=${limit}&mode=list`);
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "launch library rate limit exceeded" };
        throw new Error(`launch library ${r.status}`);
      }
      const data = await r.json();
      const all = (data.results || []).map((l) => ({
        id: l.id,
        name: l.name,
        net: l.net,
        status: l.status?.name,
        provider: l.launch_service_provider?.name || "Unknown",
        rocket: l.rocket?.configuration?.full_name,
        orbit: l.mission?.orbit?.name || "Unknown",
        pad: l.pad?.name,
        location: l.pad?.location?.name,
        countryCode: l.pad?.country_code || "",
        image: l.image,
      }));
      const filtered = all.filter((l) => {
        if (fProvider && !l.provider.toLowerCase().includes(fProvider)) return false;
        if (fOrbit && !l.orbit.toLowerCase().includes(fOrbit)) return false;
        if (fCountry && l.countryCode !== fCountry) return false;
        return true;
      });
      return {
        ok: true,
        result: {
          launches: filtered,
          count: filtered.length,
          totalBeforeFilter: all.length,
          facets: {
            providers: [...new Set(all.map((l) => l.provider))].sort(),
            orbits: [...new Set(all.map((l) => l.orbit))].sort(),
            countries: [...new Set(all.map((l) => l.countryCode).filter(Boolean))].sort(),
          },
          source: "thespacedevs-launch-library",
        },
      };
    } catch (e) {
      return { ok: false, error: `launch library unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * apod — NASA Astronomy Picture of the Day. Optional `date` (YYYY-MM-DD)
   * or `count` for a random gallery. Uses keyless DEMO_KEY unless
   * NASA_API_KEY is set in the environment.
   */
  registerLensAction("space", "apod", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
    const date = spClean(params.date, 12);
    const count = Math.max(0, Math.min(20, Math.round(Number(params.count) || 0)));
    let qs = `api_key=${encodeURIComponent(apiKey)}`;
    if (count > 0) qs += `&count=${count}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) qs += `&date=${date}`;
    try {
      const r = await fetch(`${NASA_API_BASE}/planetary/apod?${qs}`);
      if (!r.ok) throw new Error(`nasa apod ${r.status}`);
      const data = await r.json();
      const mapOne = (a) => ({
        date: a.date,
        title: a.title,
        explanation: a.explanation,
        mediaType: a.media_type,
        url: a.url,
        hdurl: a.hdurl || null,
        copyright: a.copyright || null,
      });
      const items = Array.isArray(data) ? data.map(mapOne) : [mapOne(data)];
      return {
        ok: true,
        result: { items, count: items.length, usingDemoKey: apiKey === "DEMO_KEY", source: "nasa-apod" },
      };
    } catch (e) {
      return { ok: false, error: `nasa apod unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
