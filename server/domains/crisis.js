// server/domains/crisis.js — Phase V crisis-ops surface for the
// crisis-response game-mode lens.
//
// Macros:
//   crisis.active_for_player  — list active crises in the player's current world
//   crisis.resolve            — mark a crisis resolved by player action
//
// Operational crisis-ops backlog (parity vs Dataminr / Everbridge):
//   crisis.map                — geospatial plot of active incidents (live USGS quakes + NWS alerts + in-game crises)
//   crisis.triage             — severity/priority ranking of active crises
//   crisis.playbook           — predefined response checklist per crisis type
//   crisis.playbook_step      — toggle a checklist step's completion (per-user)
//   crisis.assign             — assign a responder to a crisis with a command role
//   crisis.team               — list the responder roster for a crisis
//   crisis.unassign           — remove a responder from a crisis
//   crisis.log_event          — append a status-log entry to a crisis timeline
//   crisis.timeline           — chronological event record for a crisis
//   crisis.alerts             — push feed: new/escalated crises since a cursor
//   crisis.acknowledge_alert  — mark an alert acknowledged
//   crisis.resources          — list deployable resource inventory (per-user)
//   crisis.resource_upsert    — add/update a deployable resource
//   crisis.resource_deploy    — deploy a resource quantity against a crisis

import crypto from "node:crypto";
import { cachedFetchJson } from "../lib/external-fetch.js";
import { triggerCrisis, CRISIS_TYPES } from "../lib/world-crisis.js";

// Fail-CLOSED numeric guard (parity with server/domains/literary.js):
// returns the first poisoned key (NaN/Infinity/1e308/negative/over-cap) or
// null. Callers reject with { ok:false, reason:"bad_numeric_field" } so the
// macro-assassin's V2 fuzz vector can never push a poisoned number through.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

const USGS_QUAKES =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
const NWS_ALERTS = "https://api.weather.gov/alerts/active?status=actual&limit=200";

// ---- per-user persistent stores (globalThis._concordSTATE) ----------
function stores() {
  if (!globalThis._concordSTATE) globalThis._concordSTATE = {};
  const S = globalThis._concordSTATE;
  if (!S.crisisPlaybookProgress) S.crisisPlaybookProgress = new Map(); // userId -> Map<crisisId, Set<stepId>>
  if (!S.crisisTeams) S.crisisTeams = new Map(); // crisisId -> [{ id, responder, role, assignedBy, assignedAt }]
  if (!S.crisisTimelines) S.crisisTimelines = new Map(); // crisisId -> [{ id, kind, note, by, at }]
  if (!S.crisisAlertAcks) S.crisisAlertAcks = new Map(); // userId -> Set<alertId>
  if (!S.crisisResources) S.crisisResources = new Map(); // userId -> Map<resId, resource>
  return S;
}
function persist() {
  try {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      globalThis._concordSaveStateDebounced();
    }
  } catch { /* best effort */ }
}

// ---- response playbooks (predefined per crisis type) ----------------
const PLAYBOOKS = {
  flood: {
    title: "Flood Response",
    steps: [
      "Confirm flood extent and water level trend",
      "Issue evacuation order for low-lying zones",
      "Deploy water pumps and sandbag teams",
      "Establish shelter and medical triage point",
      "Restore power and potable water",
      "Damage assessment and recovery handoff",
    ],
  },
  wildfire: {
    title: "Wildfire Response",
    steps: [
      "Map fire perimeter and wind vector",
      "Order evacuation of threatened districts",
      "Deploy suppression crews and air support",
      "Cut firebreaks ahead of the leading edge",
      "Stage medical and air-quality monitoring",
      "Confirm containment and reopen safe zones",
    ],
  },
  earthquake: {
    title: "Earthquake Response",
    steps: [
      "Trigger structural damage survey",
      "Search and rescue collapsed structures",
      "Shut off ruptured gas and water lines",
      "Establish triage and field hospital",
      "Assess aftershock risk and cordon unsafe areas",
      "Restore lifelines and begin reconstruction",
    ],
  },
  storm: {
    title: "Severe Storm Response",
    steps: [
      "Track storm path and issue warnings",
      "Pre-position emergency crews",
      "Secure shelters and open warming/cooling centers",
      "Clear debris from critical routes",
      "Restore downed power lines",
      "Stand down and brief recovery teams",
    ],
  },
  outbreak: {
    title: "Disease Outbreak Response",
    steps: [
      "Identify index cases and contact-trace",
      "Establish isolation and testing capacity",
      "Distribute protective equipment",
      "Issue public-health guidance",
      "Coordinate medical surge support",
      "Declare containment and lift restrictions",
    ],
  },
  default: {
    title: "Generic Incident Response",
    steps: [
      "Assess scope and confirm the incident",
      "Establish incident command",
      "Protect life safety — evacuate or shelter",
      "Deploy responders and resources",
      "Stabilize the situation",
      "Demobilize and document the response",
    ],
  },
};

function playbookFor(type = "") {
  const t = String(type).toLowerCase();
  for (const key of Object.keys(PLAYBOOKS)) {
    if (key !== "default" && t.includes(key)) return { key, ...PLAYBOOKS[key] };
  }
  return { key: "default", ...PLAYBOOKS.default };
}

const COMMAND_ROLES = [
  "incident_commander",
  "operations_chief",
  "logistics_chief",
  "planning_chief",
  "safety_officer",
  "responder",
];

// ---- severity / priority triage scoring -----------------------------
const TYPE_WEIGHT = {
  earthquake: 1.0, outbreak: 0.95, wildfire: 0.9, flood: 0.8,
  storm: 0.7, default: 0.55,
};
function typeWeight(type = "") {
  const t = String(type).toLowerCase();
  for (const k of Object.keys(TYPE_WEIGHT)) {
    if (k !== "default" && t.includes(k)) return TYPE_WEIGHT[k];
  }
  return TYPE_WEIGHT.default;
}
function triageScore(crisis, nowSec) {
  const started = Number(crisis.started_at) || nowSec;
  const ageHours = Math.max(0, (nowSec - started) / 3600);
  // Urgency decays slowly: fresh crises score high; >48h crises plateau.
  const urgency = Math.max(0.2, 1 - Math.min(1, ageHours / 48) * 0.6);
  const impact = typeWeight(crisis.type);
  const raw = impact * 0.6 + urgency * 0.4;
  const score = Math.round(raw * 100);
  let priority = "low";
  if (score >= 80) priority = "critical";
  else if (score >= 60) priority = "high";
  else if (score >= 40) priority = "moderate";
  return { score, priority, impact: Math.round(impact * 100), urgency: Math.round(urgency * 100), ageHours: Math.round(ageHours) };
}

export default function registerCrisisMacros(register) {
  // ---- existing macros (unchanged) ----------------------------------
  register("crisis", "active_for_player", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    const { worldId } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    try {
      const rows = db.prepare(`
        SELECT id, type, description, origin_world_id, started_at
          FROM world_crises
         WHERE origin_world_id = ?
           AND (resolved_at IS NULL OR resolved_at = 0)
         ORDER BY started_at DESC
         LIMIT 25
      `).all(worldId);
      let suggestions = [];
      try {
        if (userId) {
          suggestions = db.prepare(`
            SELECT skill_id, level FROM user_skills
             WHERE user_id = ? ORDER BY level DESC LIMIT 6
          `).all(userId);
        }
      } catch { /* table may not exist */ }
      return { ok: true, crises: rows, suggestions };
    } catch (err) {
      return { ok: false, reason: "query_failed", err: String(err?.message || err) };
    }
  }, { note: "List active crises in the player's current world plus skill suggestions." });

  register("crisis", "resolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_db_or_actor" };
    const { crisisId } = input || {};
    if (!crisisId) return { ok: false, reason: "missing_crisis_id" };
    try {
      const result = db.prepare(`
        UPDATE world_crises
           SET resolved_at = unixepoch(),
               resolved_by = ?
         WHERE id = ? AND (resolved_at IS NULL OR resolved_at = 0)
      `).run(userId, crisisId);
      if (!result.changes) return { ok: false, reason: "not_found_or_already_resolved" };
      // append to timeline
      try {
        const S = stores();
        const tl = S.crisisTimelines.get(crisisId) || [];
        tl.push({ id: crypto.randomUUID(), kind: "resolved", note: "Crisis marked resolved", by: userId, at: Date.now() });
        S.crisisTimelines.set(crisisId, tl);
        persist();
      } catch { /* best effort */ }
      try {
        if (globalThis?.__CONCORD_REALTIME__?.io) {
          globalThis.__CONCORD_REALTIME__.io.emit("world:crisis-resolved", { crisisId, userId });
        }
      } catch { /* sockets optional */ }
      return { ok: true, crisisId, resolvedBy: userId };
    } catch (err) {
      return { ok: false, reason: "update_failed", err: String(err?.message || err) };
    }
  }, { note: "Mark a crisis resolved by the calling player." });

  // ---- declare a civilization-level crisis --------------------------
  // The crisis-ops "create" verb. Delegates to the real world-crisis lib
  // (triggerCrisis → INSERT INTO world_crises + emit world:crisis). No
  // duplicated INSERT logic here — the lib owns the row shape, the 72h TTL,
  // and the realtime emit. type must be one of CRISIS_TYPES.
  register("crisis", "declare", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { type, worldId } = input || {};
    if (!type) return { ok: false, reason: "missing_type" };
    if (!CRISIS_TYPES[type]) {
      return { ok: false, reason: "unknown_crisis_type", types: Object.keys(CRISIS_TYPES) };
    }
    const wid = String(worldId || "concordia-hub").slice(0, 80);
    try {
      const emit = (name, payload) => {
        try { globalThis?.__CONCORD_REALTIME__?.io?.emit?.(name, payload); } catch { /* sockets optional */ }
      };
      const res = triggerCrisis(db, type, wid, emit);
      if (!res?.ok) return { ok: false, reason: res?.error || "declare_failed", id: res?.id };
      // UNIT NORMALIZATION (real-bug fix): the world-crisis lib writes
      // started_at in MILLISECONDS (Date.now()), but every crisis-ops read
      // macro (active_for_player/triage/alerts/timeline) treats started_at as
      // SECONDS (the canonical convention — see tests/depth/crisis-behavior).
      // Left as-is, a declared crisis' age math + timeline head land ~1000×
      // off. Re-stamp started_at to seconds (ends_at stays ms — the lib's own
      // expiry sweep reads it). Best-effort.
      try {
        db.prepare(`UPDATE world_crises SET started_at = ? WHERE id = ?`)
          .run(Math.floor(Date.now() / 1000), res.id);
      } catch { /* best effort */ }
      // seed the timeline head so the command deck has an opening entry
      try {
        const S = stores();
        const tl = S.crisisTimelines.get(res.id) || [];
        tl.push({ id: crypto.randomUUID(), kind: "started", note: `Crisis declared (${type})`, by: userId, at: Date.now() });
        S.crisisTimelines.set(res.id, tl);
        persist();
      } catch { /* best effort */ }
      return { ok: true, result: { crisisId: res.id, type, worldId: wid, description: CRISIS_TYPES[type] } };
    } catch (err) {
      return { ok: false, reason: "declare_failed", err: String(err?.message || err) };
    }
  }, { note: "Declare a civilization-level crisis (delegates to world-crisis lib)." });

  // ---- crisis map: geospatial plot of active incidents --------------
  // Pulls live USGS earthquakes + NWS active alerts (free, no-key APIs)
  // and merges them into a single marker layer for the ops map.
  register("crisis", "map", async (_ctx, input = {}) => {
    try {
      const out = { incidents: [], sources: {} };
      // USGS earthquakes (M2.5+ past day)
      try {
        const usgs = await cachedFetchJson(USGS_QUAKES, { ttlMs: 5 * 60 * 1000 });
        const feats = Array.isArray(usgs?.features) ? usgs.features : [];
        out.sources.usgs = feats.length;
        for (const f of feats.slice(0, 120)) {
          const c = f?.geometry?.coordinates || [];
          const mag = Number(f?.properties?.mag) || 0;
          out.incidents.push({
            id: `usgs:${f.id}`,
            kind: "earthquake",
            label: f?.properties?.title || `M${mag} earthquake`,
            lat: Number(c[1]),
            lon: Number(c[0]),
            magnitude: mag,
            // 0..1 intensity — M2.5 floor, M8 ceiling
            intensity: Math.max(0, Math.min(1, (mag - 2.5) / 5.5)),
            severity: mag >= 6 ? "critical" : mag >= 4.5 ? "high" : "moderate",
            time: f?.properties?.time || null,
            url: f?.properties?.url || null,
          });
        }
      } catch (e) { out.sources.usgsError = String(e?.message || e); }
      // NWS active weather alerts
      try {
        const nws = await cachedFetchJson(NWS_ALERTS, { ttlMs: 5 * 60 * 1000 });
        const feats = Array.isArray(nws?.features) ? nws.features : [];
        out.sources.nws = feats.length;
        const sevRank = { Extreme: 1, Severe: 0.8, Moderate: 0.55, Minor: 0.3, Unknown: 0.2 };
        for (const f of feats.slice(0, 120)) {
          const p = f?.properties || {};
          // alert geometry is often a polygon — derive a centroid
          let lat = null, lon = null;
          const g = f?.geometry;
          if (g?.type === "Point") { lon = g.coordinates?.[0]; lat = g.coordinates?.[1]; }
          else if (g?.type === "Polygon" && Array.isArray(g.coordinates?.[0])) {
            const ring = g.coordinates[0];
            lon = ring.reduce((a, c) => a + c[0], 0) / ring.length;
            lat = ring.reduce((a, c) => a + c[1], 0) / ring.length;
          }
          if (lat == null || lon == null) continue;
          out.incidents.push({
            id: `nws:${p.id || f.id}`,
            kind: "weather_alert",
            label: p.event || "Weather alert",
            lat: Number(lat),
            lon: Number(lon),
            intensity: sevRank[p.severity] ?? 0.4,
            severity: p.severity === "Extreme" ? "critical"
              : p.severity === "Severe" ? "high"
              : p.severity === "Moderate" ? "moderate" : "low",
            headline: p.headline || null,
            area: p.areaDesc || null,
            time: p.sent || null,
          });
        }
      } catch (e) { out.sources.nwsError = String(e?.message || e); }
      out.count = out.incidents.length;
      return { ok: true, result: out };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Geospatial incident layer: live USGS quakes + NWS alerts." });

  // ---- severity / priority triage -----------------------------------
  register("crisis", "triage", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const { worldId } = input || {};
    if (!worldId) return { ok: false, error: "missing_world_id" };
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const rows = db.prepare(`
        SELECT id, type, description, origin_world_id, started_at
          FROM world_crises
         WHERE origin_world_id = ?
           AND (resolved_at IS NULL OR resolved_at = 0)
         ORDER BY started_at DESC
         LIMIT 50
      `).all(worldId);
      const ranked = rows
        .map((c) => ({ ...c, triage: triageScore(c, nowSec) }))
        .sort((a, b) => b.triage.score - a.triage.score);
      const summary = {
        critical: ranked.filter((r) => r.triage.priority === "critical").length,
        high: ranked.filter((r) => r.triage.priority === "high").length,
        moderate: ranked.filter((r) => r.triage.priority === "moderate").length,
        low: ranked.filter((r) => r.triage.priority === "low").length,
      };
      return { ok: true, result: { ranked, summary, total: ranked.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Rank active crises by severity + urgency." });

  // ---- response playbooks -------------------------------------------
  register("crisis", "playbook", async (ctx, input = {}) => {
    try {
      const { crisisType, crisisId } = input || {};
      if (!crisisType) return { ok: false, error: "missing_crisis_type" };
      const pb = playbookFor(crisisType);
      let done = new Set();
      const userId = ctx?.actor?.userId;
      if (userId && crisisId) {
        const S = stores();
        done = S.crisisPlaybookProgress.get(userId)?.get(crisisId) || new Set();
      }
      const steps = pb.steps.map((label, i) => ({
        id: `step_${i}`,
        order: i + 1,
        label,
        done: done.has(`step_${i}`),
      }));
      const completed = steps.filter((s) => s.done).length;
      return {
        ok: true,
        result: {
          playbookKey: pb.key,
          title: pb.title,
          steps,
          completed,
          total: steps.length,
          progressPct: steps.length ? Math.round((completed / steps.length) * 100) : 0,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Predefined response checklist for a crisis type." });

  register("crisis", "playbook_step", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const { crisisId, stepId, done } = input || {};
      if (!crisisId || !stepId) return { ok: false, error: "missing_crisis_or_step" };
      const S = stores();
      let perUser = S.crisisPlaybookProgress.get(userId);
      if (!perUser) { perUser = new Map(); S.crisisPlaybookProgress.set(userId, perUser); }
      let set = perUser.get(crisisId);
      if (!set) { set = new Set(); perUser.set(crisisId, set); }
      if (done === false) set.delete(stepId);
      else set.add(stepId);
      persist();
      return { ok: true, result: { crisisId, stepId, done: set.has(stepId), completed: set.size } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Toggle completion of a playbook checklist step." });

  // ---- team assignment + command roles ------------------------------
  register("crisis", "assign", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const { crisisId, responder, role } = input || {};
      if (!crisisId || !responder) return { ok: false, error: "missing_crisis_or_responder" };
      const useRole = COMMAND_ROLES.includes(role) ? role : "responder";
      const S = stores();
      const team = S.crisisTeams.get(crisisId) || [];
      // incident_commander is singular — demote any prior IC
      if (useRole === "incident_commander") {
        for (const m of team) if (m.role === "incident_commander") m.role = "operations_chief";
      }
      const entry = {
        id: crypto.randomUUID(),
        responder: String(responder).slice(0, 80),
        role: useRole,
        assignedBy: userId,
        assignedAt: Date.now(),
      };
      team.push(entry);
      S.crisisTeams.set(crisisId, team);
      // log it
      const tl = S.crisisTimelines.get(crisisId) || [];
      tl.push({ id: crypto.randomUUID(), kind: "assignment", note: `${entry.responder} assigned as ${useRole}`, by: userId, at: Date.now() });
      S.crisisTimelines.set(crisisId, tl);
      persist();
      return { ok: true, result: { entry, teamSize: team.length, roles: COMMAND_ROLES } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Assign a responder to a crisis with a command role." });

  register("crisis", "team", async (_ctx, input = {}) => {
    try {
      const { crisisId } = input || {};
      if (!crisisId) return { ok: false, error: "missing_crisis_id" };
      const S = stores();
      const team = S.crisisTeams.get(crisisId) || [];
      const byRole = {};
      for (const r of COMMAND_ROLES) byRole[r] = team.filter((m) => m.role === r);
      return { ok: true, result: { crisisId, team, byRole, roles: COMMAND_ROLES, count: team.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "List the responder roster for a crisis." });

  register("crisis", "unassign", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      const { crisisId, entryId } = input || {};
      if (!crisisId || !entryId) return { ok: false, error: "missing_crisis_or_entry" };
      const S = stores();
      const team = S.crisisTeams.get(crisisId) || [];
      const removed = team.find((m) => m.id === entryId);
      const next = team.filter((m) => m.id !== entryId);
      S.crisisTeams.set(crisisId, next);
      if (removed) {
        const tl = S.crisisTimelines.get(crisisId) || [];
        tl.push({ id: crypto.randomUUID(), kind: "assignment", note: `${removed.responder} removed from roster`, by: userId || "system", at: Date.now() });
        S.crisisTimelines.set(crisisId, tl);
      }
      persist();
      return { ok: true, result: { crisisId, removed: !!removed, teamSize: next.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Remove a responder from a crisis roster." });

  // ---- timeline / status log ----------------------------------------
  register("crisis", "log_event", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const { crisisId, kind, note } = input || {};
      if (!crisisId || !note) return { ok: false, error: "missing_crisis_or_note" };
      const S = stores();
      const tl = S.crisisTimelines.get(crisisId) || [];
      const entry = {
        id: crypto.randomUUID(),
        kind: String(kind || "update").slice(0, 32),
        note: String(note).slice(0, 500),
        by: userId,
        at: Date.now(),
      };
      tl.push(entry);
      S.crisisTimelines.set(crisisId, tl);
      persist();
      return { ok: true, result: { entry, count: tl.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Append a status-log entry to a crisis timeline." });

  register("crisis", "timeline", async (ctx, input = {}) => {
    try {
      const db = ctx?.db;
      const { crisisId } = input || {};
      if (!crisisId) return { ok: false, error: "missing_crisis_id" };
      const S = stores();
      const events = (S.crisisTimelines.get(crisisId) || []).slice().sort((a, b) => a.at - b.at);
      // seed the timeline head with the crisis "started" event from DB
      let started = null;
      if (db) {
        try {
          const row = db.prepare(`SELECT type, started_at, resolved_at FROM world_crises WHERE id = ?`).get(crisisId);
          if (row && row.started_at) {
            started = { id: `start_${crisisId}`, kind: "started", note: `Crisis declared (${row.type || "incident"})`, by: "system", at: Number(row.started_at) * 1000 };
          }
        } catch { /* best effort */ }
      }
      const full = started ? [started, ...events] : events;
      return { ok: true, result: { crisisId, events: full, count: full.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Chronological event record for a crisis." });

  // ---- alerting + notifications -------------------------------------
  // Returns crises that appeared after `sinceMs`, plus an escalation
  // flag from the triage score. Frontend polls this on an interval.
  register("crisis", "alerts", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    try {
      const userId = ctx?.actor?.userId;
      const badNum = badNumericField(input, ["sinceMs"]);
      if (badNum) return { ok: false, reason: "bad_numeric_field", field: badNum };
      const { worldId, sinceMs } = input || {};
      const since = Number(sinceMs) || 0;
      const sinceSec = Math.floor(since / 1000);
      const nowSec = Math.floor(Date.now() / 1000);
      const params = [];
      let where = "(resolved_at IS NULL OR resolved_at = 0)";
      if (worldId) { where += " AND origin_world_id = ?"; params.push(worldId); }
      const rows = db.prepare(`
        SELECT id, type, description, origin_world_id, started_at
          FROM world_crises
         WHERE ${where}
         ORDER BY started_at DESC
         LIMIT 50
      `).all(...params);
      const S = stores();
      const acks = userId ? (S.crisisAlertAcks.get(userId) || new Set()) : new Set();
      const alerts = rows
        .map((c) => {
          const triage = triageScore(c, nowSec);
          const isNew = Number(c.started_at) >= sinceSec;
          return {
            alertId: `alert:${c.id}`,
            crisisId: c.id,
            type: c.type,
            description: c.description,
            worldId: c.origin_world_id,
            startedAt: Number(c.started_at) * 1000,
            priority: triage.priority,
            score: triage.score,
            isNew,
            escalated: triage.priority === "critical" || triage.priority === "high",
            acknowledged: acks.has(`alert:${c.id}`),
          };
        })
        .filter((a) => a.isNew || a.escalated);
      return {
        ok: true,
        result: {
          alerts,
          unacknowledged: alerts.filter((a) => !a.acknowledged).length,
          cursor: Date.now(),
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Push feed of new / escalated crises since a cursor." });

  register("crisis", "acknowledge_alert", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const { alertId } = input || {};
      if (!alertId) return { ok: false, error: "missing_alert_id" };
      const S = stores();
      let set = S.crisisAlertAcks.get(userId);
      if (!set) { set = new Set(); S.crisisAlertAcks.set(userId, set); }
      set.add(alertId);
      persist();
      return { ok: true, result: { alertId, acknowledged: true } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Mark an alert acknowledged for the calling user." });

  // ---- resource inventory -------------------------------------------
  register("crisis", "resources", async (ctx, _input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const S = stores();
      const map = S.crisisResources.get(userId);
      const resources = map ? [...map.values()] : [];
      const totals = {
        total: resources.reduce((a, r) => a + (r.quantity || 0), 0),
        deployed: resources.reduce((a, r) => a + (r.deployed || 0), 0),
        available: resources.reduce((a, r) => a + Math.max(0, (r.quantity || 0) - (r.deployed || 0)), 0),
        kinds: resources.length,
      };
      return { ok: true, result: { resources, totals } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "List the player's deployable resource inventory." });

  register("crisis", "resource_upsert", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const badNum = badNumericField(input, ["quantity"]);
      if (badNum) return { ok: false, error: "bad_numeric_field", field: badNum };
      const { resourceId, name, category, quantity, unit } = input || {};
      if (!name) return { ok: false, error: "missing_name" };
      const S = stores();
      let map = S.crisisResources.get(userId);
      if (!map) { map = new Map(); S.crisisResources.set(userId, map); }
      const id = resourceId && map.has(resourceId) ? resourceId : crypto.randomUUID();
      const prior = map.get(id) || { deployed: 0, createdAt: Date.now() };
      const resource = {
        id,
        name: String(name).slice(0, 80),
        category: String(category || "general").slice(0, 40),
        quantity: Math.max(0, Math.floor(Number(quantity) || 0)),
        unit: String(unit || "units").slice(0, 20),
        deployed: Math.min(prior.deployed || 0, Math.max(0, Math.floor(Number(quantity) || 0))),
        createdAt: prior.createdAt,
        updatedAt: Date.now(),
      };
      map.set(id, resource);
      persist();
      return { ok: true, result: { resource } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Add or update a deployable resource." });

  register("crisis", "resource_deploy", async (ctx, input = {}) => {
    try {
      const userId = ctx?.actor?.userId;
      if (!userId) return { ok: false, error: "no_actor" };
      const { resourceId, crisisId, amount } = input || {};
      if (!resourceId) return { ok: false, error: "missing_resource_id" };
      // amount may be negative (recall) — guard magnitude/finiteness only.
      if (amount !== undefined && amount !== null) {
        const a = Number(amount);
        if (!Number.isFinite(a) || Math.abs(a) > 1e6) {
          return { ok: false, error: "bad_numeric_field", field: "amount" };
        }
      }
      const S = stores();
      const map = S.crisisResources.get(userId);
      const resource = map?.get(resourceId);
      if (!resource) return { ok: false, error: "resource_not_found" };
      const delta = Math.floor(Number(amount) || 0);
      const available = resource.quantity - resource.deployed;
      if (delta > 0 && delta > available) return { ok: false, error: "insufficient_available" };
      resource.deployed = Math.max(0, Math.min(resource.quantity, resource.deployed + delta));
      resource.updatedAt = Date.now();
      map.set(resourceId, resource);
      if (crisisId) {
        const tl = S.crisisTimelines.get(crisisId) || [];
        tl.push({
          id: crypto.randomUUID(),
          kind: "resource",
          note: `${delta > 0 ? "Deployed" : "Recalled"} ${Math.abs(delta)} ${resource.unit} of ${resource.name}`,
          by: userId,
          at: Date.now(),
        });
        S.crisisTimelines.set(crisisId, tl);
      }
      persist();
      return { ok: true, result: { resource, available: resource.quantity - resource.deployed } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Deploy (or recall) a resource quantity against a crisis." });
}
