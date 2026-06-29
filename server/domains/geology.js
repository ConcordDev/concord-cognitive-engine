// server/domains/geology.js
//
// Pure-compute geology helpers (rock classify, mineral ID,
// stratigraphic column) plus real USGS APIs for earthquake data
// and seismic-hazard design parameters.
//
// Free, no API key:
//   • USGS Earthquake Catalog: earthquake.usgs.gov/fdsnws/event/1/
//   • USGS DESIGNMAPS (ASCE 7 / IBC seismic): earthquake.usgs.gov/ws/designmaps/asce7-22

const USGS_EQ_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const USGS_DESIGNMAPS = "https://earthquake.usgs.gov/ws/designmaps/asce7-22.json";
// Macrostrat — free, keyless geologic-map + rock-unit API (the data
// source behind Rockd's bedrock overlay and "rocks near me" lookup).
const MACROSTRAT_API = "https://macrostrat.org/api/v2";

export default function registerGeologyActions(registerLensAction) {
  // Fail-CLOSED numeric coercion: parseFloat/Number pass "Infinity"/1e999/NaN
  // through silently, which then serialize to `null` (or leak Infinity) in the
  // result and read as blank in production. fin() returns a finite number or
  // the supplied fallback — never Infinity/NaN. Used by every geology handler
  // that does physics/depth/hardness math (richter/seismic/density/mineral).
  const fin = (v, fallback = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  registerLensAction("geology", "rockClassify", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Mohs scale is 1–10; clamp to a sane band so a poisoned/huge value can't
    // leak and the durability/uses branches stay meaningful.
    const hardness = Math.max(0, Math.min(10, fin(data.mohsHardness, 0)));
    const luster = (data.luster || "").toLowerCase();
    const color = data.color || "";
    const texture = (data.texture || "").toLowerCase();
    const rockType = texture.includes("crystal") || texture.includes("foliat") ? "metamorphic" : texture.includes("vesicul") || texture.includes("porphyr") ? "igneous" : texture.includes("clastic") || texture.includes("fossil") ? "sedimentary" : "unclassified";
    return { ok: true, result: { specimen: data.name || artifact.title, rockType, mohsHardness: hardness, luster, color, texture, durability: hardness >= 7 ? "highly-durable" : hardness >= 5 ? "moderate" : "soft", commonUses: hardness >= 7 ? ["construction", "countertops", "monuments"] : hardness >= 4 ? ["building stone", "crushed aggregate"] : ["carving", "talc", "filler"] } };
  });
  registerLensAction("geology", "seismicRisk", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Coordinates clamp to the real lat/lon envelope; a poisoned Infinity/NaN
    // falls back to the default site rather than leaking null into `location`.
    const lat = Math.max(-90, Math.min(90, fin(data.latitude, 37)));
    const lon = Math.max(-180, Math.min(180, fin(data.longitude, -122)));
    const soilType = (data.soilType || "rock").toLowerCase();
    const buildingCode = data.buildingCode || "IBC 2021";
    const amplificationFactors = { rock: 1.0, "stiff-soil": 1.2, "soft-soil": 1.6, "very-soft": 2.0, sand: 1.4, clay: 1.5 };
    const amp = amplificationFactors[soilType] || 1.0;
    const baseRisk = Math.abs(lat - 37) < 5 && Math.abs(lon + 122) < 5 ? 0.8 : Math.abs(lat - 35) < 10 ? 0.4 : 0.15;
    const adjustedRisk = Math.min(1, baseRisk * amp);
    return { ok: true, result: { location: { lat, lon }, soilType, amplificationFactor: amp, baseSeismicRisk: Math.round(baseRisk * 100), adjustedRisk: Math.round(adjustedRisk * 100), riskLevel: adjustedRisk > 0.6 ? "high" : adjustedRisk > 0.3 ? "moderate" : "low", buildingCode, recommendations: adjustedRisk > 0.5 ? ["Seismic retrofit required", "Foundation isolation recommended", "Earthquake insurance essential"] : ["Standard building codes sufficient"] } };
  });
  registerLensAction("geology", "mineralId", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Hardness 0–10 (Mohs), specific gravity 0–25 (osmium ~22.6 is the densest
    // natural solid) — clamp both so a poisoned numeric can't leak Infinity/NaN.
    const properties = { hardness: Math.max(0, Math.min(10, fin(data.hardness, 0))), streak: data.streak || "", cleavage: data.cleavage || "", fracture: data.fracture || "", specific_gravity: Math.max(0, Math.min(25, fin(data.specificGravity, 0))) };
    const score = (properties.hardness > 0 ? 25 : 0) + (properties.streak ? 20 : 0) + (properties.cleavage ? 20 : 0) + (properties.specific_gravity > 0 ? 20 : 0) + (data.color ? 15 : 0);
    return { ok: true, result: { specimen: data.name || artifact.title, properties, identificationConfidence: score, testsPerformed: Object.values(properties).filter(v => v && v !== 0).length, testsRecommended: score < 60 ? ["streak test", "acid test", "hardness test", "specific gravity"].filter(t => !properties[t.split(" ")[0]]) : [], classification: properties.hardness >= 7 ? "silicate-likely" : properties.hardness >= 3 ? "carbonate-or-sulfate" : "clay-or-evaporite" } };
  });
  registerLensAction("geology", "stratigraphicColumn", (ctx, artifact, _params) => {
    const layers = artifact.data?.layers || [];
    if (layers.length === 0) return { ok: true, result: { message: "Add geological layers with thickness and age." } };
    let cumulativeDepth = 0;
    // Thickness must be a positive finite metre value; a poisoned Infinity/NaN
    // or negative thickness can't be allowed to leak into cumulativeDepth and
    // invert the depth axis. Clamp to ≥0; default to 1 m when absent.
    const column = layers.map(l => { const raw = fin(l.thickness, 1); const thick = raw > 0 ? raw : (raw === 0 ? 0 : 1); cumulativeDepth += thick; return { formation: l.name || l.formation, lithology: l.lithology || l.rockType || "unknown", thickness: thick, depthTop: cumulativeDepth - thick, depthBottom: cumulativeDepth, age: l.age || "unknown", fossils: Array.isArray(l.fossils) ? l.fossils : [] }; });
    return { ok: true, result: { layers: column, totalThickness: cumulativeDepth, layerCount: layers.length, oldestFormation: column[column.length - 1]?.formation, youngestFormation: column[0]?.formation, fossiliferous: column.filter(l => l.fossils.length > 0).length } };
  });

  /**
   * recent-earthquakes — Real seismic events from USGS Earthquake
   * Catalog (FDSN web service). Free, no API key. Default window
   * is the last 24 hours globally with magnitude ≥ 2.5.
   *
   * params: {
   *   minMagnitude?: number (default 2.5),
   *   limit?: number (1-200, default 20),
   *   latitude?, longitude?, radiusKm? — circle filter,
   *   minlatitude?, maxlatitude?, minlongitude?, maxlongitude? — bbox filter,
   *   sinceHours?: number (default 24)
   * }
   */
  registerLensAction("geology", "recent-earthquakes", async (_ctx, _artifact, params = {}) => {
    const minMagnitude = Number(params.minMagnitude);
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 20));
    const sinceHours = Math.max(0.5, Math.min(24 * 30, Number(params.sinceHours) || 24));
    const starttime = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
    const qs = new URLSearchParams({
      format: "geojson",
      starttime,
      orderby: "time",
      limit: String(limit),
    });
    if (Number.isFinite(minMagnitude) && minMagnitude > 0) qs.set("minmagnitude", String(minMagnitude));
    if (params.latitude != null && params.longitude != null && params.radiusKm != null) {
      qs.set("latitude", String(Number(params.latitude)));
      qs.set("longitude", String(Number(params.longitude)));
      qs.set("maxradiuskm", String(Number(params.radiusKm)));
    } else if (
      params.minlatitude != null && params.maxlatitude != null &&
      params.minlongitude != null && params.maxlongitude != null
    ) {
      qs.set("minlatitude", String(Number(params.minlatitude)));
      qs.set("maxlatitude", String(Number(params.maxlatitude)));
      qs.set("minlongitude", String(Number(params.minlongitude)));
      qs.set("maxlongitude", String(Number(params.maxlongitude)));
    }
    try {
      const r = await fetch(`${USGS_EQ_API}?${qs.toString()}`);
      if (!r.ok) throw new Error(`usgs ${r.status}`);
      const data = await r.json();
      const events = (data.features || []).map((f) => ({
        id: f.id,
        magnitude: f.properties?.mag,
        magnitudeType: f.properties?.magType,
        place: f.properties?.place,
        time: f.properties?.time ? new Date(f.properties.time).toISOString() : null,
        updated: f.properties?.updated ? new Date(f.properties.updated).toISOString() : null,
        url: f.properties?.url,
        status: f.properties?.status,
        tsunami: f.properties?.tsunami === 1,
        felt: f.properties?.felt,
        cdi: f.properties?.cdi,            // community-decimal intensity (felt)
        mmi: f.properties?.mmi,            // ShakeMap-decimal intensity
        alert: f.properties?.alert,        // pager alert (green/yellow/orange/red)
        sig: f.properties?.sig,            // significance
        longitude: f.geometry?.coordinates?.[0],
        latitude: f.geometry?.coordinates?.[1],
        depthKm: f.geometry?.coordinates?.[2],
      }));
      return {
        ok: true,
        result: {
          events,
          count: events.length,
          sinceHours,
          generated: data.metadata?.generated ? new Date(data.metadata.generated).toISOString() : null,
          source: "usgs-earthquake-catalog",
        },
      };
    } catch (e) {
      return { ok: false, error: `usgs earthquake unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * usgs-seismic-hazard — Real ASCE 7-22 / IBC seismic design
   * parameters for a US location via USGS DESIGNMAPS web service.
   * Returns Ss, S1, MCEr ground motion + site-modified Sds, Sd1
   * for the requested site class. Free, no API key.
   *
   * params: { latitude, longitude, riskCategory?: 1|2|3|4, siteClass?: "A"|"B"|"BC"|"C"|"CD"|"D"|"DE"|"E"|"F" }
   */
  registerLensAction("geology", "usgs-seismic-hazard", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.latitude);
    const lng = Number(params.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: "latitude + longitude required" };
    }
    if (lat < 18 || lat > 72 || lng < -180 || lng > -65) {
      return { ok: false, error: "USGS DESIGNMAPS only covers US territory (lat 18-72, lng -180 to -65)" };
    }
    const riskCategory = [1, 2, 3, 4].includes(Number(params.riskCategory)) ? Number(params.riskCategory) : 2;
    const siteClass = ["A", "B", "BC", "C", "CD", "D", "DE", "E", "F"].includes(params.siteClass) ? params.siteClass : "D";
    const url = `${USGS_DESIGNMAPS}?latitude=${lat}&longitude=${lng}&riskCategory=${riskCategory}&siteClass=${siteClass}&title=Concord+OS+Lookup`;
    try {
      const r = await fetch(url);
      if (!r.ok) {
        if (r.status === 400) return { ok: false, error: "USGS rejected the lookup (location may be outside ASCE 7 coverage)" };
        throw new Error(`usgs designmaps ${r.status}`);
      }
      const data = await r.json();
      const resp = data?.response?.data;
      if (!resp) return { ok: false, error: "USGS returned no design parameters" };
      return {
        ok: true,
        result: {
          location: { lat, lng },
          riskCategory, siteClass,
          ss: resp.ss,                    // 0.2s spectral acceleration (g)
          s1: resp.s1,                    // 1.0s spectral acceleration (g)
          fa: resp.fa,                    // short-period site coefficient
          fv: resp.fv,                    // long-period site coefficient
          sms: resp.sms, sm1: resp.sm1,   // MCE site-modified
          sds: resp.sds, sd1: resp.sd1,   // ASCE 7 design spectrum
          sdc: resp.sdc,                  // seismic design category
          pga: resp.pga,                  // peak ground acceleration
          pgam: resp.pgam,                // site-modified PGA
          tl: resp.tl,                    // long-period transition (s)
          source: "usgs-designmaps-asce7-22",
        },
      };
    } catch (e) {
      return { ok: false, error: `usgs designmaps unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Field observation log (Mindat / field-geology journal) ──────────

  function getGeoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.geologyLens) STATE.geologyLens = {};
    if (!(STATE.geologyLens.observations instanceof Map)) STATE.geologyLens.observations = new Map(); // userId -> Array
    return STATE.geologyLens;
  }
  function saveGeo() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const geoId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const geoActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const geoClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const geoNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const geoObs = (s, userId) => { if (!s.observations.has(userId)) s.observations.set(userId, []); return s.observations.get(userId); };
  const SAMPLE_KINDS = ["rock", "mineral", "fossil", "outcrop", "structure", "other"];

  registerLensAction("geology", "observation-log", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = geoClean(params.name, 160);
    if (!name) return { ok: false, error: "observation name required" };
    const obs = {
      id: geoId("obs"),
      name,
      kind: SAMPLE_KINDS.includes(params.kind) ? params.kind : "rock",
      lat: geoNum(params.lat),
      lon: geoNum(params.lon),
      locationName: geoClean(params.locationName, 160) || null,
      formation: geoClean(params.formation, 120) || null,
      notes: geoClean(params.notes, 2000) || "",
      tags: Array.isArray(params.tags) ? params.tags.map((t) => geoClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
      collectedAt: geoClean(params.collectedAt, 30) || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    geoObs(s, geoActor(ctx)).push(obs);
    saveGeo();
    return { ok: true, result: { observation: obs } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "observation-list", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let obs = [...geoObs(s, geoActor(ctx))];
    if (params.kind) obs = obs.filter((o) => o.kind === params.kind);
    if (params.tag) {
      const t = geoClean(params.tag, 30).toLowerCase();
      obs = obs.filter((o) => o.tags.includes(t));
    }
    const q = geoClean(params.query, 80).toLowerCase();
    if (q) obs = obs.filter((o) => o.name.toLowerCase().includes(q) || (o.notes || "").toLowerCase().includes(q));
    obs.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { observations: obs, count: obs.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "observation-update", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const obs = geoObs(s, geoActor(ctx)).find((o) => o.id === params.id);
    if (!obs) return { ok: false, error: "observation not found" };
    if (params.name != null) obs.name = geoClean(params.name, 160) || obs.name;
    if (params.kind != null && SAMPLE_KINDS.includes(params.kind)) obs.kind = params.kind;
    if (params.notes != null) obs.notes = geoClean(params.notes, 2000);
    if (params.formation != null) obs.formation = geoClean(params.formation, 120) || null;
    if (Array.isArray(params.tags)) obs.tags = params.tags.map((t) => geoClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8);
    saveGeo();
    return { ok: true, result: { observation: obs } };
  });

  registerLensAction("geology", "observation-delete", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = geoObs(s, geoActor(ctx));
    const i = arr.findIndex((o) => o.id === params.id);
    if (i < 0) return { ok: false, error: "observation not found" };
    arr.splice(i, 1);
    saveGeo();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("geology", "field-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const obs = geoObs(s, geoActor(ctx));
    const byKind = {};
    for (const k of SAMPLE_KINDS) byKind[k] = 0;
    for (const o of obs) byKind[o.kind] = (byKind[o.kind] || 0) + 1;
    return {
      ok: true,
      result: {
        totalObservations: obs.length,
        byKind,
        geotagged: obs.filter((o) => o.lat != null && o.lon != null).length,
        formations: [...new Set(obs.map((o) => o.formation).filter(Boolean))].length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest live USGS significant earthquakes as visible DTUs.
  registerLensAction("geology", "feed", async (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
      if (!r.ok) return { ok: false, error: `usgs ${r.status}` };
      const data = await r.json();
      const feats = (data.features || []).slice(0, limit);
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const f of feats) {
        if (s.feedSeen.has(f.id)) { skipped++; continue; }
        const p = f.properties || {};
        const c = f.geometry?.coordinates || [];
        const title = `M${p.mag} earthquake — ${p.place}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nMagnitude: ${p.mag}\nDepth: ${c[2]} km\nTime: ${new Date(p.time).toISOString()}\nUSGS: ${p.url}`,
          tags: ["geology", "feed", "earthquake", "usgs"],
          source: "usgs.earthquake-feed",
          meta: { magnitude: p.mag, place: p.place, time: p.time, lat: c[1], lon: c[0], depthKm: c[2], usgsId: f.id, url: p.url },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(f.id); }
      }
      saveGeo();
      return { ok: true, result: { ingested, skipped, source: "usgs-earthquake-feed", dtuIds } };
    } catch (e) {
      return { ok: false, error: `usgs feed unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── [M] Geologic map overlay — Macrostrat bedrock/age layers ────────
  // Returns the bedrock geologic-map polygons for a bounding box. This is
  // the Macrostrat data behind Rockd's geologic-map overlay.
  registerLensAction("geology", "geologic-map", async (_ctx, _a, params = {}) => {
    const lat = geoNum(params.lat);
    const lon = geoNum(params.lon);
    if (lat == null || lon == null) return { ok: false, error: "lat + lon required" };
    // scale: tiny | small | medium | large — controls map detail.
    const scale = ["tiny", "small", "medium", "large"].includes(params.scale) ? params.scale : "medium";
    try {
      const url = `${MACROSTRAT_API}/geologic_units/map?lat=${lat}&lng=${lon}&scale=${scale}`;
      const data = await fetch(url).then((r) => { if (!r.ok) throw new Error(`macrostrat ${r.status}`); return r.json(); });
      const rows = data?.success?.data || [];
      const units = rows.map((u) => ({
        mapId: u.map_id,
        name: u.name || u.strat_name || "unnamed unit",
        ageTop: u.t_age,
        ageBottom: u.b_age,
        ageInterval: u.b_int_name && u.t_int_name
          ? (u.b_int_name === u.t_int_name ? u.b_int_name : `${u.b_int_name}–${u.t_int_name}`)
          : (u.age || null),
        lithology: u.lith || null,
        description: u.descrip || null,
        comments: u.comments || null,
        color: u.color || null,
        source: u.source_id != null ? `macrostrat#${u.source_id}` : "macrostrat",
      }));
      return { ok: true, result: { lat, lon, scale, units, count: units.length, source: "macrostrat-geologic-map" } };
    } catch (e) {
      return { ok: false, error: `macrostrat unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── [S] Nearby-rock-units lookup at current GPS location ────────────
  // Resolves the bedrock unit(s) underfoot plus the named stratigraphic
  // column at the point — Rockd's "what am I standing on" feature.
  registerLensAction("geology", "rock-units-here", async (_ctx, _a, params = {}) => {
    const lat = geoNum(params.lat);
    const lon = geoNum(params.lon);
    if (lat == null || lon == null) return { ok: false, error: "lat + lon required" };
    try {
      const mapUrl = `${MACROSTRAT_API}/geologic_units/map?lat=${lat}&lng=${lon}`;
      const mapData = await fetch(mapUrl).then((r) => { if (!r.ok) throw new Error(`macrostrat ${r.status}`); return r.json(); });
      const mapRows = mapData?.success?.data || [];
      const bedrock = mapRows.map((u) => ({
        name: u.name || u.strat_name || "unnamed unit",
        lithology: u.lith || null,
        ageInterval: u.b_int_name || u.age || null,
        ageTop: u.t_age,
        ageBottom: u.b_age,
        description: u.descrip || null,
      }));
      // Named stratigraphic units at the point (column reconstruction).
      let columnUnits = [];
      try {
        const colUrl = `${MACROSTRAT_API}/units?lat=${lat}&lng=${lon}&response=long`;
        const colData = await fetch(colUrl).then((r) => (r.ok ? r.json() : null));
        const colRows = colData?.success?.data || [];
        columnUnits = colRows.map((u) => ({
          unitName: u.unit_name || u.strat_name || "unnamed",
          ageInterval: u.b_int_name && u.t_int_name
            ? (u.b_int_name === u.t_int_name ? u.b_int_name : `${u.b_int_name}–${u.t_int_name}`)
            : null,
          ageTop: u.t_age,
          ageBottom: u.b_age,
          lithology: u.lith || null,
          maxThicknessM: u.max_thick,
          minThicknessM: u.min_thick,
        }));
      } catch (_e) { /* column is optional enrichment */ }
      return {
        ok: true,
        result: {
          lat, lon, bedrock, columnUnits,
          bedrockCount: bedrock.length, columnCount: columnUnits.length,
          source: "macrostrat",
        },
      };
    } catch (e) {
      return { ok: false, error: `macrostrat unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── [M] Strike/dip structural measurements (digital compass) ────────
  function ensureStructure(s) {
    if (!(s.measurements instanceof Map)) s.measurements = new Map(); // userId -> Array
    return s.measurements;
  }
  const PLANE_KINDS = ["bedding", "foliation", "joint", "fault", "cleavage", "vein", "contact", "other"];
  const norm360 = (v) => { let n = ((v % 360) + 360) % 360; return n; };

  registerLensAction("geology", "measurement-record", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const strike = geoNum(params.strike);
    const dip = geoNum(params.dip);
    if (strike == null || dip == null) return { ok: false, error: "strike + dip required" };
    if (dip < 0 || dip > 90) return { ok: false, error: "dip must be 0-90 degrees" };
    const map = ensureStructure(s);
    const userId = geoActor(ctx);
    if (!map.has(userId)) map.set(userId, []);
    const strikeN = norm360(strike);
    // Right-hand-rule dip direction is 90° clockwise from strike.
    const dipDirection = norm360(strikeN + 90);
    const m = {
      id: geoId("meas"),
      planeKind: PLANE_KINDS.includes(params.planeKind) ? params.planeKind : "bedding",
      strike: Math.round(strikeN * 10) / 10,
      dip: Math.round(dip * 10) / 10,
      dipDirection: Math.round(dipDirection),
      lat: geoNum(params.lat),
      lon: geoNum(params.lon),
      locationName: geoClean(params.locationName, 160) || null,
      notes: geoClean(params.notes, 1000) || "",
      recordedAt: new Date().toISOString(),
    };
    map.get(userId).push(m);
    saveGeo();
    return { ok: true, result: { measurement: m } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "measurement-list", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const map = ensureStructure(s);
    let rows = [...(map.get(geoActor(ctx)) || [])];
    if (params.planeKind && PLANE_KINDS.includes(params.planeKind)) {
      rows = rows.filter((m) => m.planeKind === params.planeKind);
    }
    rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    // Stereonet-style summary: count per plane kind + mean strike.
    const byKind = {};
    let sumSin = 0, sumCos = 0;
    for (const m of rows) {
      byKind[m.planeKind] = (byKind[m.planeKind] || 0) + 1;
      const rad = (m.strike * Math.PI) / 180;
      sumSin += Math.sin(rad); sumCos += Math.cos(rad);
    }
    const meanStrike = rows.length > 0
      ? Math.round(norm360((Math.atan2(sumSin, sumCos) * 180) / Math.PI) * 10) / 10
      : null;
    return { ok: true, result: { measurements: rows, count: rows.length, byKind, meanStrike } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "measurement-delete", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureStructure(s).get(geoActor(ctx)) || [];
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "measurement not found" };
    arr.splice(i, 1);
    saveGeo();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── [S] Photo capture for rock samples with EXIF geotag ─────────────
  function ensurePhotos(s) {
    if (!(s.photos instanceof Map)) s.photos = new Map(); // userId -> Array
    return s.photos;
  }
  registerLensAction("geology", "photo-attach", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const observationId = geoClean(params.observationId, 80);
    const dataUrl = geoClean(params.dataUrl, 6_000_000);
    if (!observationId) return { ok: false, error: "observationId required" };
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return { ok: false, error: "valid image dataUrl required" };
    // Verify the observation belongs to the caller.
    const userId = geoActor(ctx);
    const obs = geoObs(s, userId).find((o) => o.id === observationId);
    if (!obs) return { ok: false, error: "observation not found" };
    const map = ensurePhotos(s);
    if (!map.has(userId)) map.set(userId, []);
    const photo = {
      id: geoId("photo"),
      observationId,
      dataUrl,
      caption: geoClean(params.caption, 200) || "",
      // EXIF geotag — pulled from the photo metadata client-side, real values only.
      exifLat: geoNum(params.exifLat),
      exifLon: geoNum(params.exifLon),
      exifAltitude: geoNum(params.exifAltitude),
      exifTakenAt: geoClean(params.exifTakenAt, 40) || null,
      cameraModel: geoClean(params.cameraModel, 120) || null,
      attachedAt: new Date().toISOString(),
    };
    map.get(userId).push(photo);
    // Backfill the observation's coords from EXIF if it has none.
    if (obs.lat == null && photo.exifLat != null && photo.exifLon != null) {
      obs.lat = photo.exifLat;
      obs.lon = photo.exifLon;
    }
    saveGeo();
    return { ok: true, result: { photo } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "photo-list", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let rows = [...(ensurePhotos(s).get(geoActor(ctx)) || [])];
    if (params.observationId) {
      const oid = geoClean(params.observationId, 80);
      rows = rows.filter((p) => p.observationId === oid);
    }
    rows.sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
    return {
      ok: true,
      result: { photos: rows, count: rows.length, geotagged: rows.filter((p) => p.exifLat != null).length },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "photo-delete", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensurePhotos(s).get(geoActor(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "photo not found" };
    arr.splice(i, 1);
    saveGeo();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── [S] Checklist / collection — minerals & rocks identified ────────
  function ensureCollection(s) {
    if (!(s.collection instanceof Map)) s.collection = new Map(); // userId -> Array
    return s.collection;
  }
  const COLLECT_KINDS = ["mineral", "rock", "fossil", "gem"];

  registerLensAction("geology", "collection-add", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = geoClean(params.name, 120);
    if (!name) return { ok: false, error: "name required" };
    const map = ensureCollection(s);
    const userId = geoActor(ctx);
    if (!map.has(userId)) map.set(userId, []);
    const arr = map.get(userId);
    const kind = COLLECT_KINDS.includes(params.kind) ? params.kind : "mineral";
    const existing = arr.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.kind === kind);
    if (existing) {
      existing.count += 1;
      existing.lastFoundAt = new Date().toISOString();
      saveGeo();
      return { ok: true, result: { entry: existing, isNew: false } };
    }
    const entry = {
      id: geoId("col"),
      name,
      kind,
      identified: params.identified !== false,
      count: 1,
      locality: geoClean(params.locality, 160) || null,
      notes: geoClean(params.notes, 600) || "",
      firstFoundAt: new Date().toISOString(),
      lastFoundAt: new Date().toISOString(),
    };
    arr.push(entry);
    saveGeo();
    return { ok: true, result: { entry, isNew: true } };
  });

  registerLensAction("geology", "collection-list", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let rows = [...(ensureCollection(s).get(geoActor(ctx)) || [])];
    if (params.kind && COLLECT_KINDS.includes(params.kind)) rows = rows.filter((c) => c.kind === params.kind);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const byKind = {};
    for (const k of COLLECT_KINDS) byKind[k] = 0;
    let totalSpecimens = 0;
    for (const c of rows) { byKind[c.kind] = (byKind[c.kind] || 0) + 1; totalSpecimens += c.count; }
    return {
      ok: true,
      result: {
        collection: rows, uniqueCount: rows.length, totalSpecimens, byKind,
        identifiedCount: rows.filter((c) => c.identified).length,
      },
    };
  });

  registerLensAction("geology", "collection-toggle", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = (ensureCollection(s).get(geoActor(ctx)) || []).find((c) => c.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    entry.identified = !entry.identified;
    saveGeo();
    return { ok: true, result: { entry } };
  });

  registerLensAction("geology", "collection-remove", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureCollection(s).get(geoActor(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "entry not found" };
    arr.splice(i, 1);
    saveGeo();
    return { ok: true, result: { removed: params.id } };
  });

  // ─── [M] Field-trip / outcrop sequencing with notes per stop ─────────
  function ensureTrips(s) {
    if (!(s.fieldTrips instanceof Map)) s.fieldTrips = new Map(); // userId -> Array
    return s.fieldTrips;
  }
  const findTrip = (s, userId, id) => (ensureTrips(s).get(userId) || []).find((t) => t.id === id);

  registerLensAction("geology", "fieldtrip-create", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = geoClean(params.name, 160);
    if (!name) return { ok: false, error: "field trip name required" };
    const map = ensureTrips(s);
    const userId = geoActor(ctx);
    if (!map.has(userId)) map.set(userId, []);
    const trip = {
      id: geoId("trip"),
      name,
      area: geoClean(params.area, 160) || null,
      date: geoClean(params.date, 30) || new Date().toISOString().slice(0, 10),
      summary: geoClean(params.summary, 1000) || "",
      stops: [],
      createdAt: new Date().toISOString(),
    };
    map.get(userId).push(trip);
    saveGeo();
    return { ok: true, result: { fieldTrip: trip } };
  });

  registerLensAction("geology", "fieldtrip-list", (ctx, _a, _params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rows = [...(ensureTrips(s).get(geoActor(ctx)) || [])];
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return {
      ok: true,
      result: { fieldTrips: rows, count: rows.length, totalStops: rows.reduce((n, t) => n + t.stops.length, 0) },
    };
  });

  registerLensAction("geology", "fieldtrip-add-stop", (ctx, _a, params = {}) => {
  try {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = findTrip(s, geoActor(ctx), params.tripId);
    if (!trip) return { ok: false, error: "field trip not found" };
    const name = geoClean(params.name, 160);
    if (!name) return { ok: false, error: "stop name required" };
    const stop = {
      id: geoId("stop"),
      order: trip.stops.length + 1,
      name,
      lat: geoNum(params.lat),
      lon: geoNum(params.lon),
      lithology: geoClean(params.lithology, 160) || null,
      formation: geoClean(params.formation, 160) || null,
      notes: geoClean(params.notes, 2000) || "",
      observationIds: Array.isArray(params.observationIds)
        ? params.observationIds.map((x) => geoClean(x, 80)).filter(Boolean).slice(0, 50)
        : [],
      addedAt: new Date().toISOString(),
    };
    trip.stops.push(stop);
    saveGeo();
    return { ok: true, result: { stop, stopCount: trip.stops.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("geology", "fieldtrip-reorder-stops", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = findTrip(s, geoActor(ctx), params.tripId);
    if (!trip) return { ok: false, error: "field trip not found" };
    const order = Array.isArray(params.stopIds) ? params.stopIds : [];
    if (order.length !== trip.stops.length) return { ok: false, error: "stopIds must list every stop exactly once" };
    const byId = new Map(trip.stops.map((st) => [st.id, st]));
    const reordered = [];
    for (const id of order) {
      const st = byId.get(id);
      if (!st) return { ok: false, error: `unknown stop ${id}` };
      reordered.push(st);
    }
    reordered.forEach((st, i) => { st.order = i + 1; });
    trip.stops = reordered;
    saveGeo();
    return { ok: true, result: { fieldTrip: trip } };
  });

  registerLensAction("geology", "fieldtrip-update-stop", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = findTrip(s, geoActor(ctx), params.tripId);
    if (!trip) return { ok: false, error: "field trip not found" };
    const stop = trip.stops.find((st) => st.id === params.stopId);
    if (!stop) return { ok: false, error: "stop not found" };
    if (params.name != null) stop.name = geoClean(params.name, 160) || stop.name;
    if (params.notes != null) stop.notes = geoClean(params.notes, 2000);
    if (params.lithology != null) stop.lithology = geoClean(params.lithology, 160) || null;
    if (params.formation != null) stop.formation = geoClean(params.formation, 160) || null;
    saveGeo();
    return { ok: true, result: { stop } };
  });

  registerLensAction("geology", "fieldtrip-delete", (ctx, _a, params = {}) => {
    const s = getGeoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ensureTrips(s).get(geoActor(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "field trip not found" };
    arr.splice(i, 1);
    saveGeo();
    return { ok: true, result: { deleted: params.id } };
  });
}
