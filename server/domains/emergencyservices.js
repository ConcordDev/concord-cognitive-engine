// server/domains/emergencyservices.js
//
// Emergency-services lens. Field calculators (triage, dispatch
// optimization, incident log, resource readiness) + a computer-aided-
// dispatch substrate (incidents / units, per-user OR per-agency) + a real
// cross-org mutual-aid incident-share primitive + a real USGS earthquake
// feed. Free public source, no API key.
//
// WAVE4 (emergency-services): an AGENCY is an org (server/lib/world-
// organizations.js), the same reusable roster/role substrate the
// supplychain and command-center lenses already build "team" collaboration
// on top of — consumed here, never modified. Every CAD macro below still
// defaults to the original PER-USER path byte-for-byte when no `orgId` is
// supplied; supplying a real `orgId` the caller is a member of routes the
// SAME state (incidents/units/event log) into a SHARED `org:${orgId}`
// slot instead of a personal one, gated by an EMS role derived from the
// org's own 4-tier role ladder (see EMS_ROLE_BY_ORG_ROLE below).
//
// On top of that, this file adds the genuinely-new primitive: real
// cross-org MUTUAL AID — agency A can share one of its own real incidents
// with agency B (a real record keyed by both org ids), and B can commit
// one of ITS OWN real units to help. Both agencies see the share + the
// commitment live via the existing `org:${orgId}` realtime room (see
// `realtimeEmit(event, payload, {orgId})` / the `org:${orgId}` socket-room
// convention used elsewhere in the codebase, e.g. server/domains/
// commandcenter.js, server/domains/supplychain.js).
//
// GATED / documented-external (never fabricated): real SMS text-paging,
// radio dispatch over an actual RF network, or CAD-hardware/911-console
// integration are genuinely external systems this codebase has no
// credentials or hardware for. Nothing in this file ever claims a real
// page, radio call, or 911-console message was sent — mutual-aid sharing
// and unit commitment are real in-Concord records + a real realtime
// broadcast to members already viewing the lens, and stop there.

import {
  createOrganization, getOrganization, joinOrganization, leaveOrganization,
  setMemberRole, getOrgMembers, getOrgsForUser, listOrganizations,
} from "../lib/world-organizations.js";

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

  // ─── Computer-aided-dispatch substrate (per-user OR per-agency, STATE-backed) ─
  function getEmsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.emergencyServicesLens) STATE.emergencyServicesLens = {};
    const s = STATE.emergencyServicesLens;
    if (!(s.incidents instanceof Map)) s.incidents = new Map(); // key -> Array<incident> (key = userId OR `org:${orgId}`)
    if (!(s.units instanceof Map)) s.units = new Map();         // key -> Array<unit>     (key = userId OR `org:${orgId}`)
    if (!Array.isArray(s.mutualAid)) s.mutualAid = [];          // global list of cross-org mutual-aid share records
    if (!(s.mutualAidConsent instanceof Set)) s.mutualAidConsent = new Set(); // orgIds that opted in to receiving mutual aid
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

  // ── Agency scope (WAVE4) — reuses the existing org/roster substrate
  // (server/lib/world-organizations.js) the same additive way the
  // supplychain/command-center Wave-3/4 units did: an "agency" IS an org.
  // Not restricted to a single org type (mirrors command-center's
  // teamListMine design) — a caller's existing department/firm/crew org can
  // double as their dispatch agency, or they can mint a fresh one via
  // agency-create (which mints type "department", same convention
  // command-center and supplychain already use for team-shaped orgs).
  //
  // emScope(ctx, params, writeTiers) resolves the storage key + EMS role
  // for a call:
  //   - no params.orgId  -> legacy per-user scope, unchanged, tier:null.
  //   - params.orgId set -> verifies REAL membership via getOrgMembers,
  //     derives an EMS tier from the org role, and (when writeTiers is
  //     given) rejects tiers not in that list. Honest failures only, never
  //     throws: org_not_found / not_a_member / insufficient_role.
  const EMS_ROLE_BY_ORG_ROLE = Object.freeze({ leader: "chief", officer: "supervisor", member: "responder", apprentice: "trainee" });
  // Reverse mapping used only by agency-set-role so a caller can request an
  // EMS-facing role name; "chief" is intentionally excluded (a second
  // "leader" can't be minted by a role-change, same rule supplychain's
  // SC_ROLE_TO_ORG_ROLE and command-center's teamSetRole follow).
  const EMS_ROLE_TO_ORG_ROLE = Object.freeze({ supervisor: "officer", responder: "member", trainee: "apprentice" });
  const EMS_WRITE_TIERS = ["chief", "supervisor", "responder"]; // trainee is read-only (observer/probationary seat)

  function emScope(ctx, params, writeTiers) {
    const userId = emActor(ctx);
    const orgId = params && params.orgId ? emClean(params.orgId, 100) : null;
    if (!orgId) return { ok: true, key: userId, scope: "user", tier: null, userId, orgId: null };
    const org = getOrganization(orgId);
    if (!org) return { ok: false, error: "org_not_found" };
    const membership = getOrgMembers(orgId).find((m) => m.userId === userId);
    if (!membership) return { ok: false, error: "not_a_member" };
    const tier = EMS_ROLE_BY_ORG_ROLE[membership.role] || "trainee";
    if (writeTiers && !writeTiers.includes(tier)) return { ok: false, error: "insufficient_role" };
    return { ok: true, key: `org:${orgId}`, scope: "org", tier, orgRole: membership.role, userId, orgId };
  }

  // Best-effort fan-out to every socket subscribed to `org:${orgId}` (the
  // same `org:${orgId}` room convention used by server/domains/
  // commandcenter.js and server/domains/supplychain.js). Only called when a
  // macro was actually invoked with a real orgId. This is the REAL close
  // for "shared incident visibility": teammates already viewing the lens
  // see the update live. Real SMS/radio/CAD-hardware paging is
  // intentionally NOT implemented here — that requires an external
  // provider/hardware this codebase does not have credentials or drivers
  // for. This function only ever fans out an in-Concord realtime event; it
  // never claims a real page, radio call, or 911-console message was sent.
  function emitOrgRealtime(event, payload, orgId) {
    if (!orgId) return;
    try {
      const fn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof fn === "function") fn(event, payload, { orgId });
    } catch (_e) { /* realtime is best-effort */ }
  }

  registerLensAction("emergency-services", "incident-create", (ctx, _a, params = {}) => {
  try {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, EMS_WRITE_TIERS);
    if (!scope.ok) return scope;
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
      orgId: scope.orgId,
    };
    emList(s.incidents, scope.key).push(incident);
    saveEms();
    return { ok: true, result: { incident } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("emergency-services", "incident-list", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, null);
    if (!scope.ok) return scope;
    let incidents = emList(s.incidents, scope.key);
    if (params.status) incidents = incidents.filter((i) => i.status === params.status);
    incidents = [...incidents].sort((a, b) => a.priority - b.priority);
    return { ok: true, result: { incidents, count: incidents.length, open: incidents.filter((i) => i.status === "open").length } };
  });

  registerLensAction("emergency-services", "incident-status", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, EMS_WRITE_TIERS);
    if (!scope.ok) return scope;
    const incident = emList(s.incidents, scope.key).find((i) => i.id === params.id);
    if (!incident) return { ok: false, error: "incident not found" };
    const status = ["open", "dispatched", "on_scene", "resolved", "cancelled"].includes(params.status) ? params.status : incident.status;
    incident.status = status;
    if (params.assignedUnitId !== undefined) incident.assignedUnitId = params.assignedUnitId || null;
    if (status === "resolved" || status === "cancelled") incident.closedAt = new Date().toISOString();
    saveEms();
    emitOrgRealtime("ems:incident-status", { incident }, scope.orgId);
    return { ok: true, result: { incident } };
  });

  registerLensAction("emergency-services", "unit-add", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, EMS_WRITE_TIERS);
    if (!scope.ok) return scope;
    const name = emClean(params.name, 80);
    if (!name) return { ok: false, error: "unit name required" };
    const unit = {
      id: emId("unit"), name,
      kind: UNIT_KINDS.includes(params.kind) ? params.kind : "patrol",
      status: ["available", "dispatched", "on_scene", "out_of_service"].includes(params.status) ? params.status : "available",
      station: emClean(params.station, 120) || "",
      orgId: scope.orgId,
    };
    emList(s.units, scope.key).push(unit);
    saveEms();
    return { ok: true, result: { unit } };
  });

  registerLensAction("emergency-services", "unit-list", (ctx, _a, params = {}) => {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, null);
    if (!scope.ok) return scope;
    const units = emList(s.units, scope.key);
    return { ok: true, result: { units, count: units.length, available: units.filter((u) => u.status === "available").length } };
  });

  registerLensAction("emergency-services", "ems-dashboard", (ctx, _a, params = {}) => {
  try {
    const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const scope = emScope(ctx, params, null);
    if (!scope.ok) return scope;
    const incidents = emList(s.incidents, scope.key);
    const units = emList(s.units, scope.key);
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
      const scope = emScope(ctx, params, EMS_WRITE_TIERS);
      if (!scope.ok) return scope;
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
        orgId: scope.orgId,
      };
      emList(s.incidents, scope.key).push(incident);
      emPushEvent(s, scope.key, incident.id, "created", `${incident.kind} · ${PRIORITY_LABEL[incident.priority]}`);
      const alert = incident.priority <= 2
        ? { fired: true, level: incident.priority === 1 ? "critical" : "high", message: `${PRIORITY_LABEL[incident.priority]} incident: ${summary}` }
        : { fired: false };
      if (alert.fired) emPushEvent(s, scope.key, incident.id, "alert", alert.message);
      saveEms();
      emitOrgRealtime("ems:incident-created", { incident, alert }, scope.orgId);
      return { ok: true, result: { incident, alert } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // unit-position — set/update a unit's map position so it shows on the
  // live map and feeds nearest-unit recommendation.
  registerLensAction("emergency-services", "unit-position", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, EMS_WRITE_TIERS);
      if (!scope.ok) return scope;
      const unit = emList(s.units, scope.key).find((u) => u.id === params.id);
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
  registerLensAction("emergency-services", "map-state", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const incidents = emList(s.incidents, scope.key);
      const units = emList(s.units, scope.key);
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
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const incident = emList(s.incidents, scope.key).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      if (!emHasGeo(incident)) return { ok: false, error: "incident has no map position" };
      const iLat = incident.lat, iLng = emLngOf(incident);
      const candidates = emList(s.units, scope.key)
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
      const scope = emScope(ctx, params, EMS_WRITE_TIERS);
      if (!scope.ok) return scope;
      const incident = emList(s.incidents, scope.key).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      const unit = emList(s.units, scope.key).find((u) => u.id === params.unitId);
      if (!unit) return { ok: false, error: "unit not found" };
      if (unit.status !== "available") return { ok: false, error: `unit is ${unit.status}, not available` };
      unit.status = "dispatched";
      unit.assignedIncidentId = incident.id;
      incident.status = "dispatched";
      incident.assignedUnitId = unit.id;
      const distance = emHasGeo(incident) && emHasGeo(unit)
        ? Math.round(emHaversine(incident.lat, emLngOf(incident), unit.lat, emLngOf(unit)) * 100) / 100
        : null;
      emPushEvent(s, scope.key, incident.id, "dispatched", `${unit.name} assigned${distance != null ? ` (${distance} km)` : ""}`);
      saveEms();
      emitOrgRealtime("ems:unit-dispatched", { incident, unit, distanceKm: distance }, scope.orgId);
      return { ok: true, result: { incident, unit, distanceKm: distance } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // unit-status-advance — drive the unit status lifecycle through its
  // legal transitions (available→dispatched→en_route→on_scene→clear).
  registerLensAction("emergency-services", "unit-status-advance", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, EMS_WRITE_TIERS);
      if (!scope.ok) return scope;
      const unit = emList(s.units, scope.key).find((u) => u.id === params.id);
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
        incident = emList(s.incidents, scope.key).find((i) => i.id === incidentId) || null;
        if (incident) {
          if (next === "en_route") incident.status = "dispatched";
          else if (next === "on_scene") incident.status = "on_scene";
          else if (next === "transporting") incident.status = "on_scene";
          else if (next === "clear") {
            incident.status = "resolved";
            incident.closedAt = new Date().toISOString();
          }
        }
        emPushEvent(s, scope.key, incidentId, "unit_status", `${unit.name}: ${prev}→${next}`);
      }
      if (next === "clear" || next === "available") {
        unit.assignedIncidentId = null;
        if (next === "clear") unit.status = "available";
      }
      saveEms();
      emitOrgRealtime("ems:unit-status", { unit, incident, transition: { from: prev, to: unit.status } }, scope.orgId);
      return { ok: true, result: { unit, incident, transition: { from: prev, to: unit.status } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // triage-queue — priority-ordered queue of open incidents with an
  // auto-computed dispatch score (priority + age + assignment state).
  registerLensAction("emergency-services", "triage-queue", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const now = Date.now();
      const open = emList(s.incidents, scope.key).filter(
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
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const incident = emList(s.incidents, scope.key).find((i) => i.id === params.incidentId);
      if (!incident) return { ok: false, error: "incident not found" };
      const events = emLog(s, scope.key)
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
  registerLensAction("emergency-services", "readiness-rollup", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const units = emList(s.units, scope.key);
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
  registerLensAction("emergency-services", "active-alerts", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const scope = emScope(ctx, params, null);
      if (!scope.ok) return scope;
      const now = Date.now();
      const alerts = emList(s.incidents, scope.key)
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

  // ─── Agency lifecycle — an agency IS an org (server/lib/world- ────────
  //     organizations.js), same reuse pattern as supplychain.js's
  //     orgCreate/orgJoin/... and commandcenter.js's teamCreate/teamJoin/...
  //     Thin wrappers only; this domain owns none of the roster state.
  const EMS_ORG_TYPE = "department"; // same type convention commandcenter.js's teamCreate + supplychain.js's orgCreate already use for team-shaped orgs

  registerLensAction("emergency-services", "agency-create", (ctx, _a, params = {}) => {
    try {
      const leaderId = emActor(ctx);
      const name = emClean(params.name, 120);
      if (!name) return { ok: false, error: "name_required" };
      const res = createOrganization({
        name, type: EMS_ORG_TYPE, leaderId,
        description: emClean(params.description, 500),
        districtId: params.districtId ? emClean(params.districtId, 100) : null,
        purpose: emClean(params.purpose, 300) || "Mutual-aid emergency response agency",
      });
      if (!res.ok) return res;
      return { ok: true, result: { organization: res.organization, role: "chief", orgRole: "leader" } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-join", (ctx, _a, params = {}) => {
    try {
      const userId = emActor(ctx);
      const orgId = emClean(params.orgId, 100);
      if (!orgId) return { ok: false, error: "orgId_required" };
      // Never let a joiner grant themselves a privileged role — only
      // "member" or "apprentice" are self-selectable on join. Promotion to
      // officer/leader (EMS "supervisor"/"chief") requires an existing
      // supervisor+ to call agency-set-role.
      const requested = params.role === "apprentice" ? "apprentice" : "member";
      const res = joinOrganization(orgId, userId, requested);
      if (!res.ok) return res;
      return { ok: true, result: { role: res.role, emsRole: EMS_ROLE_BY_ORG_ROLE[res.role] || "trainee" } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-leave", (ctx, _a, params = {}) => {
    try {
      const userId = emActor(ctx);
      const orgId = emClean(params.orgId, 100);
      if (!orgId) return { ok: false, error: "orgId_required" };
      return leaveOrganization(orgId, userId);
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-members", (ctx, _a, params = {}) => {
    try {
      const orgId = emClean(params.orgId, 100);
      if (!orgId) return { ok: false, error: "orgId_required" };
      const scope = emScope(ctx, { orgId }, null);
      if (!scope.ok) return scope;
      const org = getOrganization(orgId);
      const members = getOrgMembers(orgId).map((m) => ({ ...m, emsRole: EMS_ROLE_BY_ORG_ROLE[m.role] || "trainee" }));
      return { ok: true, result: { organization: org, members, myRole: scope.tier, myOrgRole: scope.orgRole } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-set-role", (ctx, _a, params = {}) => {
    try {
      const actorId = emActor(ctx);
      const orgId = emClean(params.orgId, 100);
      const targetUserId = emClean(params.targetUserId, 200);
      if (!orgId || !targetUserId) return { ok: false, error: "orgId_and_targetUserId_required" };
      // Accept either a native org role (leader/officer/member/apprentice)
      // or an EMS-facing role name (chief/supervisor/responder/trainee);
      // EMS_ROLE_TO_ORG_ROLE resolves the latter. setMemberRole() itself
      // enforces "only leader/officer may change roles" — not duplicated here.
      const requested = params.role;
      const newRole = EMS_ROLE_TO_ORG_ROLE[requested] || requested;
      const res = setMemberRole(orgId, targetUserId, newRole, actorId);
      if (!res.ok) return res;
      return { ok: true, result: { role: res.role, emsRole: EMS_ROLE_BY_ORG_ROLE[res.role] || "trainee" } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-mine", (ctx, _a, _params = {}) => {
    try {
      const userId = emActor(ctx);
      // NOT filtered to type:"department" — mirrors command-center's
      // teamListMine: any org the caller already belongs to (firm, crew,
      // guild, ...) doubles as their dispatch agency the moment they start
      // passing its orgId into these macros.
      const orgs = getOrgsForUser(userId)
        .map((m) => {
          const org = getOrganization(m.orgId);
          return org ? { ...org, myRole: m.role, myEmsRole: EMS_ROLE_BY_ORG_ROLE[m.role] || "trainee" } : null;
        })
        .filter(Boolean);
      return { ok: true, result: { organizations: orgs } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "agency-list", (ctx, _a, params = {}) => {
    try {
      const orgs = listOrganizations({
        type: EMS_ORG_TYPE,
        districtId: params.districtId,
        limit: Math.min(intOr(params.limit, 50), 100),
      });
      return { ok: true, result: { organizations: orgs } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Mutual aid — real cross-org incident sharing between agencies ───
  //
  // A "shared incident" is a real record: it references a REAL incident
  // that genuinely exists on the SOURCE agency's own org-scoped incident
  // board, and a REAL target agency (an org that genuinely exists AND has
  // opted in to receiving mutual aid). Sharing to a nonexistent agency, a
  // source the caller isn't really a member of, or a target that hasn't
  // consented is an honest `{ok:false, error:...}` failure — never a
  // silent success against a made-up id. Committing a unit consumes a REAL
  // unit from the target agency's own roster and runs it through the SAME
  // available→dispatched transition dispatch-unit uses — it is not a
  // fabricated pledge with no substrate behind it.
  //
  // GATED (documented, never faked): this primitive is the real in-Concord
  // close for cross-org incident visibility + unit commitment. It does NOT
  // send a real SMS page, radio call, or 911-console message — those are
  // genuinely external systems (a paging provider, RF hardware, CAD
  // integration) this codebase has no credentials/hardware for. The only
  // "notification" that happens is a realtime broadcast to `org:${orgId}`
  // rooms, i.e. teammates already looking at the lens see it live.

  registerLensAction("emergency-services", "agency-mutual-aid-consent", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const orgId = emClean(params.orgId, 100);
      if (!orgId) return { ok: false, error: "orgId_required" };
      if (!getOrganization(orgId)) return { ok: false, error: "org_not_found" };
      const membership = getOrgMembers(orgId).find((m) => m.userId === userId);
      if (!membership) return { ok: false, error: "not_a_member" };
      const tier = EMS_ROLE_BY_ORG_ROLE[membership.role] || "trainee";
      if (tier !== "chief" && tier !== "supervisor") return { ok: false, error: "insufficient_role" };
      const enabled = params.enabled !== false;
      if (enabled) s.mutualAidConsent.add(orgId); else s.mutualAidConsent.delete(orgId);
      saveEms();
      return { ok: true, result: { orgId, mutualAidEnabled: enabled } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  const MAX_MUTUAL_AID = 5000; // backstop cap on the global share log

  registerLensAction("emergency-services", "mutual-aid-share", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const sourceOrgId = emClean(params.sourceOrgId, 100);
      const targetOrgId = emClean(params.targetOrgId, 100);
      const incidentId = emClean(params.incidentId, 100);
      if (!sourceOrgId || !targetOrgId || !incidentId) return { ok: false, error: "sourceOrgId_targetOrgId_incidentId_required" };
      if (sourceOrgId === targetOrgId) return { ok: false, error: "cannot_share_with_own_agency" };
      const sourceOrg = getOrganization(sourceOrgId);
      if (!sourceOrg) return { ok: false, error: "source_agency_not_found" };
      const membership = getOrgMembers(sourceOrgId).find((m) => m.userId === userId);
      if (!membership) return { ok: false, error: "not_a_member" };
      const tier = EMS_ROLE_BY_ORG_ROLE[membership.role] || "trainee";
      if (!EMS_WRITE_TIERS.includes(tier)) return { ok: false, error: "insufficient_role" };
      const targetOrg = getOrganization(targetOrgId);
      if (!targetOrg) return { ok: false, error: "target_agency_not_found" };
      if (!s.mutualAidConsent.has(targetOrgId)) return { ok: false, error: "target_agency_not_accepting_mutual_aid" };
      // The incident must be a REAL record on the source agency's own
      // org-scoped incident board — never a client-supplied fiction.
      const incident = emList(s.incidents, `org:${sourceOrgId}`).find((i) => i.id === incidentId);
      if (!incident) return { ok: false, error: "incident_not_found_in_source_agency" };
      const dup = s.mutualAid.find((r) => r.incidentId === incidentId && r.targetOrgId === targetOrgId && r.status === "active");
      if (dup) return { ok: false, error: "already_shared", result: { share: dup } };
      const share = {
        id: emId("ma"), incidentId,
        sourceOrgId, sourceOrgName: sourceOrg.name,
        targetOrgId, targetOrgName: targetOrg.name,
        sharedBy: userId, note: emClean(params.note, 300),
        status: "active",
        sharedAt: new Date().toISOString(),
        recalledAt: null,
        committedUnits: [],
      };
      s.mutualAid.push(share);
      if (s.mutualAid.length > MAX_MUTUAL_AID) s.mutualAid.splice(0, s.mutualAid.length - MAX_MUTUAL_AID);
      emPushEvent(s, `org:${sourceOrgId}`, incident.id, "mutual_aid_shared", `Shared with ${targetOrg.name}`);
      saveEms();
      emitOrgRealtime("mutual-aid:shared", { share }, sourceOrgId);
      emitOrgRealtime("mutual-aid:shared", { share }, targetOrgId);
      return { ok: true, result: { share } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "mutual-aid-list", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const orgId = emClean(params.orgId, 100);
      if (!orgId) return { ok: false, error: "orgId_required" };
      if (!getOrganization(orgId)) return { ok: false, error: "org_not_found" };
      const membership = getOrgMembers(orgId).find((m) => m.userId === userId);
      if (!membership) return { ok: false, error: "not_a_member" };
      // Resolve a LIVE snapshot of each referenced incident from the
      // source agency's own board (status may have moved since sharing) —
      // never a stale copy frozen at share time.
      const enrich = (r) => ({ ...r, incident: emList(s.incidents, `org:${r.sourceOrgId}`).find((i) => i.id === r.incidentId) || null });
      const sharedByUs = s.mutualAid.filter((r) => r.sourceOrgId === orgId).map(enrich);
      const sharedWithUs = s.mutualAid.filter((r) => r.targetOrgId === orgId).map(enrich);
      return {
        ok: true,
        result: { sharedByUs, sharedWithUs, mutualAidEnabled: s.mutualAidConsent.has(orgId) },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "mutual-aid-commit-unit", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const shareId = emClean(params.shareId, 100);
      const unitId = emClean(params.unitId, 100);
      if (!shareId || !unitId) return { ok: false, error: "shareId_and_unitId_required" };
      const share = s.mutualAid.find((r) => r.id === shareId);
      if (!share) return { ok: false, error: "share_not_found" };
      if (share.status !== "active") return { ok: false, error: `share_is_${share.status}` };
      // Caller must be a REAL member of the TARGET agency (the one being
      // asked for aid) — not the source, and not an outsider.
      const membership = getOrgMembers(share.targetOrgId).find((m) => m.userId === userId);
      if (!membership) return { ok: false, error: "not_a_member" };
      const tier = EMS_ROLE_BY_ORG_ROLE[membership.role] || "trainee";
      if (!EMS_WRITE_TIERS.includes(tier)) return { ok: false, error: "insufficient_role" };
      // The committed unit must be a REAL unit on the target agency's own
      // roster and genuinely available — this is a real dispatch (same
      // available→dispatched transition dispatch-unit uses), not a
      // pledge on paper.
      const targetUnits = emList(s.units, `org:${share.targetOrgId}`);
      const unit = targetUnits.find((u) => u.id === unitId);
      if (!unit) return { ok: false, error: "unit_not_found_in_target_agency" };
      if (unit.status !== "available") return { ok: false, error: `unit_is_${unit.status}_not_available` };
      unit.status = "dispatched";
      unit.assignedIncidentId = share.incidentId;
      unit.mutualAidShareId = share.id;
      const commitment = {
        unitId: unit.id, unitName: unit.name, unitKind: unit.kind,
        unitOrgId: share.targetOrgId, committedBy: userId,
        committedAt: new Date().toISOString(),
      };
      share.committedUnits.push(commitment);
      emPushEvent(s, `org:${share.sourceOrgId}`, share.incidentId, "mutual_aid_unit_committed", `${unit.name} (${share.targetOrgName}) committed`);
      emPushEvent(s, `org:${share.targetOrgId}`, share.incidentId, "mutual_aid_unit_committed", `${unit.name} committed to ${share.sourceOrgName}'s incident`);
      saveEms();
      emitOrgRealtime("mutual-aid:unit-committed", { share, commitment }, share.sourceOrgId);
      emitOrgRealtime("mutual-aid:unit-committed", { share, commitment }, share.targetOrgId);
      return { ok: true, result: { share, commitment, unit } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("emergency-services", "mutual-aid-recall", (ctx, _a, params = {}) => {
    try {
      const s = getEmsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = emActor(ctx);
      const shareId = emClean(params.shareId, 100);
      if (!shareId) return { ok: false, error: "shareId_required" };
      const share = s.mutualAid.find((r) => r.id === shareId);
      if (!share) return { ok: false, error: "share_not_found" };
      // Only the SOURCE agency (the one that shared it) can recall.
      const membership = getOrgMembers(share.sourceOrgId).find((m) => m.userId === userId);
      if (!membership) return { ok: false, error: "not_a_member" };
      const tier = EMS_ROLE_BY_ORG_ROLE[membership.role] || "trainee";
      if (!EMS_WRITE_TIERS.includes(tier)) return { ok: false, error: "insufficient_role" };
      if (share.status !== "active") return { ok: false, error: `share_is_already_${share.status}` };
      share.status = "recalled";
      share.recalledAt = new Date().toISOString();
      saveEms();
      emitOrgRealtime("mutual-aid:recalled", { share }, share.sourceOrgId);
      emitOrgRealtime("mutual-aid:recalled", { share }, share.targetOrgId);
      return { ok: true, result: { share } };
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
