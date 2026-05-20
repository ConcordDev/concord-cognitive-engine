// server/domains/emergencyservices.js
//
// Emergency-services lens. Field calculators (triage, dispatch
// optimization, incident log, resource readiness) + a per-user
// computer-aided-dispatch substrate (incidents / units) + a real
// USGS earthquake feed. Free public source, no API key.

export default function registerEmergencyServicesActions(registerLensAction) {
  // ─── Field calculators ──────────────────────────────────────────────
  registerLensAction("emergency-services", "triageAssess", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const severity = parseInt(data.severity) || 3; // 1-5, 1 = most severe
    const vitals = data.vitals || {};
    const breathing = vitals.breathing !== false;
    const conscious = vitals.conscious !== false;
    const pulse = parseInt(vitals.pulse) || 80;
    const triageLevel = !breathing ? 1 : !conscious ? 1 : severity <= 2 ? 2 : pulse > 120 || pulse < 50 ? 2 : severity <= 3 ? 3 : 4;
    const colors = { 1: "RED — Immediate", 2: "YELLOW — Delayed", 3: "GREEN — Minor", 4: "GREEN — Walking wounded", 5: "BLACK — Expectant" };
    return { ok: true, result: { triageLevel, triageColor: colors[triageLevel] || colors[3], breathing, conscious, pulse, reportedSeverity: severity, responseTime: triageLevel === 1 ? "Immediate" : triageLevel === 2 ? "< 15 minutes" : "< 60 minutes", actions: triageLevel === 1 ? ["Secure airway", "Control bleeding", "Initiate CPR if needed", "Rapid transport"] : triageLevel === 2 ? ["Assess injuries", "Apply first aid", "Monitor vitals", "Transport when available"] : ["Basic first aid", "Self-care instructions", "Follow-up appointment"] } };
  });
  registerLensAction("emergency-services", "dispatchOptimize", (ctx, artifact, _params) => {
    const units = artifact.data?.units || [];
    const incidents = artifact.data?.incidents || [];
    if (units.length === 0) return { ok: true, result: { message: "Add available units to optimize dispatch." } };
    const available = units.filter(u => u.status === "available" || !u.status);
    const assigned = incidents.map(inc => {
      const priority = parseInt(inc.priority) || 3;
      const nearest = available.sort((a, b) => (parseFloat(a.distanceKm) || 99) - (parseFloat(b.distanceKm) || 99))[0];
      return { incident: inc.description || inc.type, priority, assignedUnit: nearest?.name || "NONE AVAILABLE", eta: nearest ? `${Math.round((parseFloat(nearest.distanceKm) || 5) / 50 * 60)} minutes` : "N/A" };
    });
    return { ok: true, result: { totalUnits: units.length, available: available.length, activeIncidents: incidents.length, assignments: assigned, coverageGap: available.length < incidents.length } };
  });
  registerLensAction("emergency-services", "incidentLog", (ctx, artifact, _params) => {
    const incidents = artifact.data?.incidents || [];
    const now = new Date();
    const last24h = incidents.filter(i => (now.getTime() - new Date(i.timestamp || i.date || 0).getTime()) < 86400000);
    const byType = {};
    for (const i of last24h) { const t = i.type || "other"; byType[t] = (byType[t] || 0) + 1; }
    return { ok: true, result: { total24h: last24h.length, totalAllTime: incidents.length, byType, mostCommon: Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "none", avgResponseMinutes: last24h.length > 0 ? Math.round(last24h.reduce((s, i) => s + (parseFloat(i.responseMinutes) || 10), 0) / last24h.length) : 0, trend: last24h.length > incidents.length / 7 ? "above-average" : "normal" } };
  });
  registerLensAction("emergency-services", "resourceReadiness", (ctx, artifact, _params) => {
    const resources = artifact.data?.resources || {};
    const vehicles = parseInt(resources.vehicles) || 0;
    const vehiclesReady = parseInt(resources.vehiclesReady) || 0;
    const personnel = parseInt(resources.personnel) || 0;
    const personnelOnDuty = parseInt(resources.personnelOnDuty) || 0;
    const suppliesPercent = parseFloat(resources.suppliesPercent) || 100;
    const vehicleReady = vehicles > 0 ? Math.round((vehiclesReady / vehicles) * 100) : 0;
    const personnelReady = personnel > 0 ? Math.round((personnelOnDuty / personnel) * 100) : 0;
    const overall = Math.round((vehicleReady * 0.35 + personnelReady * 0.35 + suppliesPercent * 0.3));
    return { ok: true, result: { vehicleReadiness: vehicleReady, personnelReadiness: personnelReady, suppliesLevel: suppliesPercent, overallReadiness: overall, status: overall >= 80 ? "fully-operational" : overall >= 60 ? "operational" : overall >= 40 ? "limited" : "critical", shortages: [vehicleReady < 70 ? "Vehicles" : null, personnelReady < 70 ? "Personnel" : null, suppliesPercent < 50 ? "Supplies" : null].filter(Boolean) } };
  });

  // ─── Computer-aided-dispatch substrate (per-user, STATE-backed) ─────
  function getEmsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.emergencyServicesLens) STATE.emergencyServicesLens = {};
    const s = STATE.emergencyServicesLens;
    if (!(s.incidents instanceof Map)) s.incidents = new Map(); // userId -> Array
    if (!(s.units instanceof Map)) s.units = new Map();         // userId -> Array
    return s;
  }
  function saveEms() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const emId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const emActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const emClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const emNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const emList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };
  const INCIDENT_KINDS = ["medical", "fire", "police", "rescue", "hazmat", "traffic", "other"];
  const UNIT_KINDS = ["ambulance", "fire_engine", "ladder", "patrol", "rescue", "command", "hazmat"];

  registerLensAction("emergency-services", "incident-create", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const summary = emClean(params.summary, 200);
    if (!summary) return { ok: false, error: "incident summary required" };
    const incident = {
      id: emId("inc"), summary,
      kind: INCIDENT_KINDS.includes(params.kind) ? params.kind : "other",
      priority: Math.min(5, Math.max(1, Math.round(emNum(params.priority)) || 3)),
      location: emClean(params.location, 200) || "",
      status: "open",
      assignedUnitId: null,
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    emList(s.incidents, emActor(ctx)).push(incident);
    saveEms();
    return { ok: true, result: { incident } };
  });

  registerLensAction("emergency-services", "incident-list", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let incidents = emList(s.incidents, emActor(ctx));
    if (params.status) incidents = incidents.filter((i) => i.status === params.status);
    incidents = [...incidents].sort((a, b) => a.priority - b.priority);
    return { ok: true, result: { incidents, count: incidents.length, open: incidents.filter((i) => i.status === "open").length } };
  });

  registerLensAction("emergency-services", "incident-status", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const incident = emList(s.incidents, emActor(ctx)).find((i) => i.id === params.id);
    if (!incident) return { ok: false, error: "incident not found" };
    const status = ["open", "dispatched", "on_scene", "resolved", "cancelled"].includes(params.status) ? params.status : incident.status;
    incident.status = status;
    if (params.assignedUnitId !== undefined) incident.assignedUnitId = params.assignedUnitId || null;
    if (status === "resolved" || status === "cancelled") incident.closedAt = new Date().toISOString();
    saveEms();
    return { ok: true, result: { incident } };
  });

  registerLensAction("emergency-services", "unit-add", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = emClean(params.name, 80);
    if (!name) return { ok: false, error: "unit name required" };
    const unit = {
      id: emId("unit"), name,
      kind: UNIT_KINDS.includes(params.kind) ? params.kind : "patrol",
      status: ["available", "dispatched", "on_scene", "out_of_service"].includes(params.status) ? params.status : "available",
      station: emClean(params.station, 120) || "",
    };
    emList(s.units, emActor(ctx)).push(unit);
    saveEms();
    return { ok: true, result: { unit } };
  });

  registerLensAction("emergency-services", "unit-list", (ctx, _a, _params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const units = emList(s.units, emActor(ctx));
    return { ok: true, result: { units, count: units.length, available: units.filter((u) => u.status === "available").length } };
  });

  registerLensAction("emergency-services", "ems-dashboard", (ctx, _a, _params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const incidents = emList(s.incidents, emActor(ctx));
    const units = emList(s.units, emActor(ctx));
    const byKind = {};
    for (const i of incidents) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
    return {
      ok: true,
      result: {
        incidents: incidents.length,
        openIncidents: incidents.filter((i) => i.status !== "resolved" && i.status !== "cancelled").length,
        units: units.length,
        availableUnits: units.filter((u) => u.status === "available").length,
        byKind,
      },
    };
  });

  // feed — ingest real significant earthquakes (last day) from the USGS
  // earthquake feed as visible DTUs. Free public API, no key.
  registerLensAction("emergency-services", "feed", async (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 15)));
    try {
      const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
      if (!r.ok) return { ok: false, error: `usgs ${r.status}` };
      const data = await r.json();
      const quakes = (Array.isArray(data?.features) ? data.features : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const q of quakes) {
        const id = `quake_${q.id}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const p = q.properties || {};
        const title = `Seismic event: M${p.mag} — ${p.place || "unknown location"}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nMagnitude: ${p.mag}\nLocation: ${p.place || "?"}\nTime: ${p.time ? new Date(p.time).toISOString() : "?"}\nTsunami flag: ${p.tsunami ? "YES" : "no"}\nSource: USGS Earthquake Hazards Program`,
          tags: ["emergency-services", "feed", "earthquake", "usgs"],
          source: "usgs-feed",
          meta: { quakeId: q.id, magnitude: p.mag, place: p.place, time: p.time, tsunami: p.tsunami },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveEms();
      return { ok: true, result: { ingested, skipped, source: "usgs-earthquakes", dtuIds } };
    } catch (e) {
      return { ok: false, error: `usgs unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
