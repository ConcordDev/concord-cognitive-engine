// server/domains/emergencyservices.js
//
// Emergency-services lens. Field calculators (triage, dispatch
// optimization, incident log, resource readiness) + a per-user
// computer-aided-dispatch substrate (incidents / units) + a real
// USGS earthquake feed. Free public source, no API key.

export default function registerEmergencyServicesActions(registerLensAction) {
  // Fail-CLOSED numeric coercion. parseInt/parseFloat happily yield Infinity
  // (parseFloat("Infinity") / parseFloat("1e999") === Infinity), which would
  // otherwise leak straight into a triage/dispatch/readiness number — e.g. an
  // ETA of "Infinity minutes" or a readiness of Infinity%. For safety-relevant
  // emergency math a poisoned value must collapse to the intended default,
  // never propagate. Coerce via Number() (NOT parseInt/parseFloat) so
  // exponent-poison like "1e999" becomes Infinity and fails the finite check,
  // rather than parseInt("1e999") silently truncating to 1. Blank/null →
  // default; intOr additionally truncates to an integer.
  const finOr = (v, def) => {
    if (v === "" || v == null) return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const intOr = (v, def) => {
    const n = finOr(v, NaN);
    return Number.isFinite(n) ? Math.trunc(n) : def;
  };

  // ─── Field calculators ──────────────────────────────────────────────
  registerLensAction("emergency-services", "triageAssess", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const severity = intOr(data.severity, 3); // 1-5, 1 = most severe
    const vitals = data.vitals || {};
    const breathing = vitals.breathing !== false;
    const conscious = vitals.conscious !== false;
    const pulse = intOr(vitals.pulse, 80);
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
      const priority = intOr(inc.priority, 3);
      const nearest = available.sort((a, b) => finOr(a.distanceKm, 99) - finOr(b.distanceKm, 99))[0];
      return { incident: inc.description || inc.type, priority, assignedUnit: nearest?.name || "NONE AVAILABLE", eta: nearest ? `${Math.round(finOr(nearest.distanceKm, 5) / 50 * 60)} minutes` : "N/A" };
    });
    return { ok: true, result: { totalUnits: units.length, available: available.length, activeIncidents: incidents.length, assignments: assigned, coverageGap: available.length < incidents.length } };
  });
  registerLensAction("emergency-services", "incidentLog", (ctx, artifact, _params) => {
    const incidents = artifact.data?.incidents || [];
    const now = new Date();
    const last24h = incidents.filter(i => (now.getTime() - new Date(i.timestamp || i.date || 0).getTime()) < 86400000);
    const byType = {};
    for (const i of last24h) { const t = i.type || "other"; byType[t] = (byType[t] || 0) + 1; }
    return { ok: true, result: { total24h: last24h.length, totalAllTime: incidents.length, byType, mostCommon: Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || "none", avgResponseMinutes: last24h.length > 0 ? Math.round(last24h.reduce((s, i) => s + finOr(i.responseMinutes, 10), 0) / last24h.length) : 0, trend: last24h.length > incidents.length / 7 ? "above-average" : "normal" } };
  });
  registerLensAction("emergency-services", "resourceReadiness", (ctx, artifact, _params) => {
    const resources = artifact.data?.resources || {};
    const vehicles = intOr(resources.vehicles, 0);
    const vehiclesReady = intOr(resources.vehiclesReady, 0);
    const personnel = intOr(resources.personnel, 0);
    const personnelOnDuty = intOr(resources.personnelOnDuty, 0);
    const suppliesPercent = Math.max(0, Math.min(100, finOr(resources.suppliesPercent, 100)));
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── CAD operational layer (live map, dispatch lifecycle, triage ────
  //     queue, incident timeline, nearest-unit, readiness, alerting) ───

  const UNIT_STATUS_FLOW = {
    available: ["dispatched"],
    dispatched: ["en_route", "available"],
    en_route: ["on_scene", "available"],
    on_scene: ["clear", "transporting"],
    transporting: ["clear"],
    clear: ["available"],
    out_of_service: ["available"],
  };
  const PRIORITY_LABEL = { 1: "P1 — Critical", 2: "P2 — Emergency", 3: "P3 — Urgent", 4: "P4 — Routine", 5: "P5 — Non-urgent" };

  // distance in km between two lat/lon points (haversine)
  function emHaversine(aLat, aLon, bLat, bLon) {
    const R = 6371;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function emLog(s, userId) {
    if (!(s.eventLog instanceof Map)) s.eventLog = new Map();
    if (!s.eventLog.has(userId)) s.eventLog.set(userId, []);
    return s.eventLog.get(userId);
  }
  function emPushEvent(s, userId, incidentId, kind, detail) {
    const log = emLog(s, userId);
    const ev = { id: emId("ev"), incidentId, kind, detail: emClean(detail, 240), at: new Date().toISOString() };
    log.push(ev);
    if (log.length > 2000) log.splice(0, log.length - 2000);
    return ev;
  }
  function emHasGeo(o) {
    return o && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng ?? o.lon));
  }
  function emLngOf(o) {
    return Number(o.lng ?? o.lon);
  }

  // incident-create-geo — create an incident with a map position so it
  // can drive the live map + nearest-unit dispatch. Logs an event.
  registerLensAction("emergency-services", "incident-create-geo", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const summary = emClean(params.summary, 200);
      if (!summary) return { ok: false, error: "incident summary required" };
      const lat = Number(params.lat), lng = Number(params.lng ?? params.lon);
      const incident = {
        id: emId("inc"), summary,
        kind: INCIDENT_KINDS.includes(params.kind) ? params.kind : "other",
        priority: Math.min(5, Math.max(1, Math.round(emNum(params.priority)) || 3)),
        location: emClean(params.location, 200) || "",
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        status: "open",
        assignedUnitId: null,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      const userId = emActor(ctx);
      emList(s.incidents, userId).push(incident);
      emPushEvent(s, userId, incident.id, "created", `${incident.kind} · ${PRIORITY_LABEL[incident.priority]}`);
      const alert = incident.priority <= 2
        ? { fired: true, level: incident.priority === 1 ? "critical" : "high", message: `${PRIORITY_LABEL[incident.priority]} incident: ${summary}` }
        : { fired: false };
      if (alert.fired) emPushEvent(s, userId, incident.id, "alert", alert.message);
      saveEms();
      return { ok: true, result: { incident, alert } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // unit-position — set/update a unit's map position so it shows on the
  // live map and feeds nearest-unit recommendation.
  registerLensAction("emergency-services", "unit-position", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const unit = emList(s.units, emActor(ctx)).find((u) => u.id === params.id);
      if (!unit) return { ok: false, error: "unit not found" };
      const lat = Number(params.lat), lng = Number(params.lng ?? params.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "lat/lng required" };
      unit.lat = lat;
      unit.lng = lng;
      saveEms();
      return { ok: true, result: { unit } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // map-state — every incident pin + unit position for the live map.
  registerLensAction("emergency-services", "map-state", (ctx, _a, _params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const incidents = emList(s.incidents, userId);
      const units = emList(s.units, userId);
      const incidentPins = incidents
        .filter((i) => emHasGeo(i) && i.status !== "resolved" && i.status !== "cancelled")
        .map((i) => ({ id: i.id, lat: i.lat, lng: emLngOf(i), summary: i.summary, kind: i.kind, priority: i.priority, status: i.status, assignedUnitId: i.assignedUnitId }));
      const unitPins = units
        .filter((u) => emHasGeo(u))
        .map((u) => ({ id: u.id, lat: u.lat, lng: emLngOf(u), name: u.name, kind: u.kind, status: u.status }));
      return { ok: true, result: { incidentPins, unitPins, incidentCount: incidentPins.length, unitCount: unitPins.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // nearest-unit — recommend the closest available unit to an incident,
  // ranked by haversine distance + ETA at 50 km/h.
  registerLensAction("emergency-services", "nearest-unit", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const incident = emList(s.incidents, userId).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      if (!emHasGeo(incident)) return { ok: false, error: "incident has no map position" };
      const iLat = incident.lat, iLng = emLngOf(incident);
      const candidates = emList(s.units, userId)
        .filter((u) => u.status === "available" && emHasGeo(u))
        .map((u) => {
          const distKm = emHaversine(iLat, iLng, u.lat, emLngOf(u));
          return { id: u.id, name: u.name, kind: u.kind, station: u.station, distanceKm: Math.round(distKm * 100) / 100, etaMinutes: Math.max(1, Math.round((distKm / 50) * 60)) };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);
      return { ok: true, result: { incidentId: incident.id, recommended: candidates[0] || null, ranked: candidates, candidateCount: candidates.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // dispatch-unit — assign a unit to an incident: moves the unit into
  // the dispatch lifecycle and the incident to "dispatched". Logs it.
  registerLensAction("emergency-services", "dispatch-unit", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const incident = emList(s.incidents, userId).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      const unit = emList(s.units, userId).find((u) => u.id === params.unitId);
      if (!unit) return { ok: false, error: "unit not found" };
      if (unit.status !== "available") return { ok: false, error: `unit is ${unit.status}, not available` };
      unit.status = "dispatched";
      unit.assignedIncidentId = incident.id;
      incident.status = "dispatched";
      incident.assignedUnitId = unit.id;
      const distance = emHasGeo(incident) && emHasGeo(unit)
        ? Math.round(emHaversine(incident.lat, emLngOf(incident), unit.lat, emLngOf(unit)) * 100) / 100
        : null;
      emPushEvent(s, userId, incident.id, "dispatched", `${unit.name} assigned${distance != null ? ` (${distance} km)` : ""}`);
      saveEms();
      return { ok: true, result: { incident, unit, distanceKm: distance } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // unit-status-advance — drive the unit status lifecycle through its
  // legal transitions (available→dispatched→en_route→on_scene→clear).
  registerLensAction("emergency-services", "unit-status-advance", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const unit = emList(s.units, userId).find((u) => u.id === params.id);
      if (!unit) return { ok: false, error: "unit not found" };
      const next = emClean(params.status, 24);
      const allowed = UNIT_STATUS_FLOW[unit.status] || [];
      if (!allowed.includes(next)) {
        return { ok: false, error: `illegal transition ${unit.status}→${next}`, result: { allowed } };
      }
      const prev = unit.status;
      unit.status = next;
      const incidentId = unit.assignedIncidentId || null;
      let incident = null;
      if (incidentId) {
        incident = emList(s.incidents, userId).find((i) => i.id === incidentId) || null;
        if (incident) {
          if (next === "en_route") incident.status = "dispatched";
          else if (next === "on_scene") incident.status = "on_scene";
          else if (next === "transporting") incident.status = "on_scene";
          else if (next === "clear") {
            incident.status = "resolved";
            incident.closedAt = new Date().toISOString();
          }
        }
        emPushEvent(s, userId, incidentId, "unit_status", `${unit.name}: ${prev}→${next}`);
      }
      if (next === "clear" || next === "available") {
        unit.assignedIncidentId = null;
        if (next === "clear") unit.status = "available";
      }
      saveEms();
      return { ok: true, result: { unit, incident, transition: { from: prev, to: unit.status } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // triage-queue — priority-ordered queue of open incidents with an
  // auto-computed dispatch score (priority + age + assignment state).
  registerLensAction("emergency-services", "triage-queue", (ctx, _a, _params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const now = Date.now();
      const open = emList(s.incidents, emActor(ctx)).filter(
        (i) => i.status !== "resolved" && i.status !== "cancelled"
      );
      const queue = open
        .map((i) => {
          const ageMinutes = Math.max(0, Math.round((now - new Date(i.createdAt).getTime()) / 60000));
          const priorityWeight = (6 - i.priority) * 20; // P1→100, P5→20
          const ageWeight = Math.min(40, ageMinutes); // 1 pt/min, cap 40
          const unassignedPenalty = i.assignedUnitId ? 0 : 25;
          const score = priorityWeight + ageWeight + unassignedPenalty;
          return {
            id: i.id, summary: i.summary, kind: i.kind, priority: i.priority,
            priorityLabel: PRIORITY_LABEL[i.priority], status: i.status,
            assignedUnitId: i.assignedUnitId, ageMinutes, dispatchScore: score,
            slaBreached: i.priority <= 2 && !i.assignedUnitId && ageMinutes > 5,
          };
        })
        .sort((a, b) => b.dispatchScore - a.dispatchScore);
      return {
        ok: true,
        result: {
          queue, depth: queue.length,
          unassigned: queue.filter((q) => !q.assignedUnitId).length,
          slaBreaches: queue.filter((q) => q.slaBreached).length,
          topPriority: queue[0] || null,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // incident-timeline — full chronological event log for one incident.
  registerLensAction("emergency-services", "incident-timeline", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const incident = emList(s.incidents, userId).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      const events = emLog(s, userId)
        .filter((e) => e.incidentId === incident.id)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      let durationMinutes = null;
      if (events.length >= 2) {
        durationMinutes = Math.round(
          (new Date(events[events.length - 1].at).getTime() - new Date(events[0].at).getTime()) / 60000
        );
      }
      return { ok: true, result: { incidentId: incident.id, summary: incident.summary, events, eventCount: events.length, durationMinutes } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // readiness-rollup — resource readiness derived from the live unit
  // roster (no manual numbers — counts the real units by status/kind).
  registerLensAction("emergency-services", "readiness-rollup", (ctx, _a, _params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const units = emList(s.units, emActor(ctx));
      const total = units.length;
      const byStatus = {};
      const byKind = {};
      for (const u of units) {
        byStatus[u.status] = (byStatus[u.status] || 0) + 1;
        byKind[u.kind] = (byKind[u.kind] || 0) + 1;
      }
      const available = byStatus.available || 0;
      const committed = total - available - (byStatus.out_of_service || 0);
      const outOfService = byStatus.out_of_service || 0;
      const readinessPct = total > 0 ? Math.round((available / total) * 100) : 0;
      const status = total === 0 ? "no-roster"
        : readinessPct >= 60 ? "fully-operational"
        : readinessPct >= 30 ? "operational"
        : readinessPct > 0 ? "limited" : "critical";
      const kindGaps = UNIT_KINDS.filter(
        (k) => (byKind[k] || 0) > 0 && !units.some((u) => u.kind === k && u.status === "available")
      );
      return {
        ok: true,
        result: { totalUnits: total, available, committed, outOfService, readinessPct, status, byStatus, byKind, kindCoverageGaps: kindGaps },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // active-alerts — open high-priority (P1/P2) incidents that need a
  // dispatcher's attention, with SLA-breach flags.
  registerLensAction("emergency-services", "active-alerts", (ctx, _a, _params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const now = Date.now();
      const alerts = emList(s.incidents, emActor(ctx))
        .filter((i) => i.priority <= 2 && i.status !== "resolved" && i.status !== "cancelled")
        .map((i) => {
          const ageMinutes = Math.max(0, Math.round((now - new Date(i.createdAt).getTime()) / 60000));
          return {
            incidentId: i.id, summary: i.summary, kind: i.kind, priority: i.priority,
            level: i.priority === 1 ? "critical" : "high", status: i.status,
            assignedUnitId: i.assignedUnitId, ageMinutes,
            slaBreached: !i.assignedUnitId && ageMinutes > 5,
          };
        })
        .sort((a, b) => a.priority - b.priority || b.ageMinutes - a.ageMinutes);
      return {
        ok: true,
        result: { alerts, count: alerts.length, critical: alerts.filter((a) => a.level === "critical").length, slaBreaches: alerts.filter((a) => a.slaBreached).length },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
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
