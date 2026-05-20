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

export default function registerGeologyActions(registerLensAction) {
  registerLensAction("geology", "rockClassify", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const hardness = parseFloat(data.mohsHardness) || 0;
    const luster = (data.luster || "").toLowerCase();
    const color = data.color || "";
    const texture = (data.texture || "").toLowerCase();
    const rockType = texture.includes("crystal") || texture.includes("foliat") ? "metamorphic" : texture.includes("vesicul") || texture.includes("porphyr") ? "igneous" : texture.includes("clastic") || texture.includes("fossil") ? "sedimentary" : "unclassified";
    return { ok: true, result: { specimen: data.name || artifact.title, rockType, mohsHardness: hardness, luster, color, texture, durability: hardness >= 7 ? "highly-durable" : hardness >= 5 ? "moderate" : "soft", commonUses: hardness >= 7 ? ["construction", "countertops", "monuments"] : hardness >= 4 ? ["building stone", "crushed aggregate"] : ["carving", "talc", "filler"] } };
  });
  registerLensAction("geology", "seismicRisk", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const lat = parseFloat(data.latitude) || 37;
    const lon = parseFloat(data.longitude) || -122;
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
    const properties = { hardness: parseFloat(data.hardness) || 0, streak: data.streak || "", cleavage: data.cleavage || "", fracture: data.fracture || "", specific_gravity: parseFloat(data.specificGravity) || 0 };
    const score = (properties.hardness > 0 ? 25 : 0) + (properties.streak ? 20 : 0) + (properties.cleavage ? 20 : 0) + (properties.specific_gravity > 0 ? 20 : 0) + (data.color ? 15 : 0);
    return { ok: true, result: { specimen: data.name || artifact.title, properties, identificationConfidence: score, testsPerformed: Object.values(properties).filter(v => v && v !== 0).length, testsRecommended: score < 60 ? ["streak test", "acid test", "hardness test", "specific gravity"].filter(t => !properties[t.split(" ")[0]]) : [], classification: properties.hardness >= 7 ? "silicate-likely" : properties.hardness >= 3 ? "carbonate-or-sulfate" : "clay-or-evaporite" } };
  });
  registerLensAction("geology", "stratigraphicColumn", (ctx, artifact, _params) => {
    const layers = artifact.data?.layers || [];
    if (layers.length === 0) return { ok: true, result: { message: "Add geological layers with thickness and age." } };
    let cumulativeDepth = 0;
    const column = layers.map(l => { const thick = parseFloat(l.thickness) || 1; cumulativeDepth += thick; return { formation: l.name || l.formation, lithology: l.lithology || l.rockType || "unknown", thickness: thick, depthTop: cumulativeDepth - thick, depthBottom: cumulativeDepth, age: l.age || "unknown", fossils: l.fossils || [] }; });
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
  });

  registerLensAction("geology", "observation-list", (ctx, _a, params = {}) => {
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
}
