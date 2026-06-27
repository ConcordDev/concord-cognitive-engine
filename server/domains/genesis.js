// server/domains/genesis.js
//
// Genesis lens — emergent-AI observatory. There is no consumer rival;
// the lens is a genuinely novel window into the platform's emergent AI
// identities. This module provides the depth + navigation surface the
// gap spec (docs/lens-specs/genesis.md) calls for:
//   • identity-detail   — full per-emergent action/decision timeline
//   • roster-search     — filter/search the roster by role/focus/state
//   • relationship-graph— communication graph between emergent identities
//   • feed-filtered     — event-type-filtered live feed
//   • lineage           — naming-origin chain / ancestry view
//   • metrics           — counts, activity-over-time, focus distribution
//
// All reads hit the real emergent-identity tables (emergent_identity,
// emergent_observations, emergent_communications, emergent_activity_feed,
// emergent_tasks). No synthesized / mock data. Per-user saved searches
// persist in globalThis._concordSTATE.
//
// The pure compute functions are also exported by name so the
// /api/emergents REST router (server/routes/emergent-visibility.js — the
// genesis lens's live backend) can serve them without duplicating logic.
//
// Handlers never throw — every body is wrapped in try/catch and returns
// { ok:boolean, result?, error? }.

const SAVED_SEARCH_LIMIT = 30;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // an emergent "active" if seen in last 24h

// ── per-user persistent state ────────────────────────────────────────────────

function genesisState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.genesisSavedSearches || !(STATE.genesisSavedSearches instanceof Map)) {
    STATE.genesisSavedSearches = new Map();
  }
  return STATE;
}

function userId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function persist() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch { /* noop */ }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/**
 * Fail-CLOSED limit clamp. Poisoned query params (`1e308`, `Infinity`,
 * `NaN`, `-5`, `0`) must never reach SQLite's LIMIT as-is — a negative or
 * zero limit makes SQLite return EVERY row (unbounded), a fail-open DoS.
 * Floor at 1, cap at `max`, default to `def` when the value is missing or
 * non-finite. Always returns a safe positive integer in [1, max].
 */
function clampLimit(raw, def, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return Math.min(def, max);
  return Math.min(n, max);
}

function isArtifactObservation(obs) {
  return typeof obs?.observation === "string" && obs.observation.startsWith("[artifact:");
}

/** Resolve the in-memory state object for an emergent (role / active flag). */
function memEmergent(emergentId, STATE) {
  const m = (STATE || globalThis._concordSTATE)?.__emergent?.emergents;
  if (m && typeof m.get === "function") return m.get(emergentId) || {};
  return {};
}

/** Load one identity row merged with in-memory state. */
export function loadIdentity(db, emergentId, STATE) {
  if (!db || !emergentId) return null;
  let row = null;
  try {
    row = db.prepare("SELECT * FROM emergent_identity WHERE emergent_id = ?").get(emergentId);
  } catch { return null; }
  if (!row) {
    // by-name fallback
    try {
      row = db.prepare("SELECT * FROM emergent_identity WHERE LOWER(given_name) = LOWER(?)")
        .get(emergentId);
    } catch { /* noop */ }
  }
  if (!row) return null;
  return { ...row, ...memEmergent(row.emergent_id, STATE), id: row.emergent_id };
}

export function allIdentities(db, STATE) {
  if (!db) return [];
  try {
    const rows = db.prepare(
      "SELECT * FROM emergent_identity WHERE given_name IS NOT NULL ORDER BY last_active_at DESC"
    ).all();
    return rows.map((r) => ({ ...r, ...memEmergent(r.emergent_id, STATE), id: r.emergent_id }));
  } catch { return []; }
}

export function isActive(identity) {
  if (typeof identity?.active === "boolean") return identity.active;
  const la = identity?.last_active_at;
  return Number.isFinite(la) && Date.now() - la < ACTIVE_WINDOW_MS;
}

// ── pure compute functions (shared by macros + REST router) ──────────────────

/** Full chronologically-sorted action/decision timeline for one emergent. */
export function computeIdentityDetail(db, target, opts = {}) {
  const STATE = opts.STATE;
  const identity = loadIdentity(db, target, STATE);
  if (!identity) return { ok: false, error: "emergent_not_found" };
  const eid = identity.emergent_id;
  const limit = clampLimit(opts.limit, 120, 400);

  const observations = db.prepare(
    "SELECT * FROM emergent_observations WHERE emergent_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(eid, limit);
  const comms = db.prepare(
    `SELECT * FROM emergent_communications
     WHERE from_emergent_id = ? OR to_emergent_id = ?
     ORDER BY initiated_at DESC LIMIT ?`
  ).all(eid, eid, limit);
  let tasks = [];
  try {
    tasks = db.prepare(
      "SELECT * FROM emergent_tasks WHERE emergent_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(eid, limit);
  } catch { tasks = []; }

  const timeline = [];
  for (const o of observations) {
    const artifact = isArtifactObservation(o);
    timeline.push({
      id: `obs_${o.id}`,
      kind: artifact ? "artifact" : "observation",
      label: artifact ? o.observation.replace(/^\[artifact:[^\]]*]\s*/, "") : o.observation,
      detail: typeof o.context === "string" ? o.context : "",
      time: o.created_at,
    });
  }
  for (const c of comms) {
    const outbound = c.from_emergent_id === eid;
    timeline.push({
      id: `comm_${c.id}`,
      kind: "communication",
      label: outbound ? `Reached out to ${c.to_emergent_id}` : `Contacted by ${c.from_emergent_id}`,
      detail: c.intent || "",
      status: c.status,
      time: c.initiated_at,
    });
  }
  for (const t of tasks) {
    timeline.push({
      id: `task_${t.id}`,
      kind: t.status === "completed" ? "decision" : "task",
      label: `${t.task_type} (${t.status})`,
      detail: typeof t.result === "string" ? t.result.slice(0, 200) : "",
      time: t.completed_at || t.started_at || t.created_at,
    });
  }
  timeline.sort((a, b) => (b.time || 0) - (a.time || 0));

  return {
    ok: true,
    result: {
      emergent: {
        id: eid,
        given_name: identity.given_name,
        naming_origin: identity.naming_origin,
        current_focus: identity.current_focus,
        last_active_at: identity.last_active_at,
        role: identity.role || null,
        active: isActive(identity),
      },
      timeline: timeline.slice(0, limit),
      counts: {
        observations: observations.filter((o) => !isArtifactObservation(o)).length,
        artifacts: observations.filter(isArtifactObservation).length,
        communications: comms.length,
        tasks: tasks.length,
      },
    },
  };
}

/** Roster filtered by query / role / focus / activity-state. */
export function computeRosterSearch(db, params = {}) {
  const STATE = params.STATE;
  const q = String(params.query || params.q || "").trim().toLowerCase();
  const roleFilter = params.role ? String(params.role).toLowerCase() : null;
  const state = params.state ? String(params.state).toLowerCase() : null;
  const focusFilter = params.focus ? String(params.focus).toLowerCase() : null;

  const all = allIdentities(db, STATE);
  let rows = all;
  if (q) {
    rows = rows.filter((r) =>
      [r.given_name, r.naming_origin, r.current_focus, r.role]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  if (roleFilter) rows = rows.filter((r) => String(r.role || "").toLowerCase() === roleFilter);
  if (focusFilter) {
    rows = rows.filter((r) => String(r.current_focus || "").toLowerCase().includes(focusFilter));
  }
  if (state === "active") rows = rows.filter(isActive);
  else if (state === "dormant") rows = rows.filter((r) => !isActive(r));

  const roster = rows.map((r) => ({
    emergent_id: r.emergent_id,
    id: r.emergent_id,
    given_name: r.given_name,
    naming_origin: r.naming_origin,
    current_focus: r.current_focus,
    last_active_at: r.last_active_at,
    role: r.role || null,
    active: isActive(r),
  }));

  return {
    ok: true,
    result: {
      roster,
      total: roster.length,
      matchedOf: all.length,
      availableRoles: [...new Set(all.map((r) => r.role).filter(Boolean))].sort(),
      availableOrigins: [...new Set(all.map((r) => r.naming_origin).filter(Boolean))].sort(),
    },
  };
}

/** Undirected weighted communication graph between emergent identities. */
export function computeRelationshipGraph(db, params = {}) {
  const STATE = params.STATE;
  const limit = clampLimit(params.limit, 500, 2000);
  let comms = [];
  try {
    comms = db.prepare(
      `SELECT from_emergent_id, to_emergent_id, intent, status, initiated_at
       FROM emergent_communications ORDER BY initiated_at DESC LIMIT ?`
    ).all(limit);
  } catch { comms = []; }

  const identities = allIdentities(db, STATE);
  const nameById = new Map(identities.map((i) => [i.emergent_id, i.given_name || i.emergent_id]));

  const edgeMap = new Map();
  const nodeDegree = new Map();
  for (const c of comms) {
    const a = c.from_emergent_id;
    const b = c.to_emergent_id;
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().join("→");
    const e = edgeMap.get(key) || { source: a, target: b, weight: 0, lastAt: 0 };
    e.weight += 1;
    e.lastAt = Math.max(e.lastAt, c.initiated_at || 0);
    edgeMap.set(key, e);
    nodeDegree.set(a, (nodeDegree.get(a) || 0) + 1);
    nodeDegree.set(b, (nodeDegree.get(b) || 0) + 1);
  }

  const connectedIds = new Set();
  for (const e of edgeMap.values()) { connectedIds.add(e.source); connectedIds.add(e.target); }
  const nodes = [...connectedIds].map((id) => ({
    id,
    label: nameById.get(id) || id,
    degree: nodeDegree.get(id) || 0,
  }));

  return {
    ok: true,
    result: {
      nodes,
      edges: [...edgeMap.values()],
      isolated: identities.filter((i) => !connectedIds.has(i.emergent_id)).length,
      totalCommunications: comms.length,
    },
  };
}

/** Event-type-filtered activity feed + type breakdown. */
export function computeFeedFiltered(db, params = {}) {
  const STATE = params.STATE;
  const limit = clampLimit(params.limit, 80, 300);
  const types = Array.isArray(params.types)
    ? params.types.map((t) => String(t))
    : params.type ? [String(params.type)] : null;
  const since = Number.isFinite(parseInt(params.since, 10)) ? parseInt(params.since, 10) : null;

  let rows = [];
  try {
    const where = [];
    const args = [];
    if (types && types.length) {
      where.push(`event_type IN (${types.map(() => "?").join(",")})`);
      args.push(...types);
    }
    if (since) { where.push("created_at > ?"); args.push(since); }
    const sql = `SELECT * FROM emergent_activity_feed
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY created_at DESC LIMIT ?`;
    args.push(limit);
    rows = db.prepare(sql).all(...args);
  } catch { rows = []; }

  const identities = allIdentities(db, STATE);
  const idMap = new Map(identities.map((i) => [i.emergent_id, i]));
  const events = rows.map((r) => {
    const em = r.emergent_id ? idMap.get(r.emergent_id) : null;
    return {
      id: r.id,
      type: r.event_type,
      emergent: em ? { emergent_id: em.emergent_id, given_name: em.given_name } : null,
      data: parseJson(r.event_data, {}),
      timestamp: r.created_at,
    };
  });

  let breakdown = {};
  try {
    const counts = db.prepare(
      `SELECT event_type, COUNT(*) AS n FROM emergent_activity_feed
       GROUP BY event_type ORDER BY n DESC`
    ).all();
    breakdown = Object.fromEntries(counts.map((c) => [c.event_type, c.n]));
  } catch { breakdown = {}; }

  return { ok: true, result: { events, total: events.length, typeBreakdown: breakdown } };
}

/** Naming-origin ancestry chain, descendants, and same-origin cohort. */
export function computeLineage(db, target, opts = {}) {
  const STATE = opts.STATE;
  const root = loadIdentity(db, target, STATE);
  if (!root) return { ok: false, error: "emergent_not_found" };

  const all = allIdentities(db, STATE);
  const byId = new Map(all.map((i) => [i.emergent_id, i]));
  const byName = new Map(
    all.filter((i) => i.given_name).map((i) => [String(i.given_name).toLowerCase(), i])
  );

  function parentOf(identity) {
    const meta = parseJson(identity.naming_metadata, {});
    const ref = meta.parent || meta.parentId || meta.lineage
      || meta.inspiredBy || meta.derivedFrom || meta.ancestor;
    if (!ref) return null;
    const refStr = String(ref);
    return byId.get(refStr) || byName.get(refStr.toLowerCase()) || null;
  }

  const ancestry = [];
  const seen = new Set([root.emergent_id]);
  let cur = parentOf(root);
  while (cur && !seen.has(cur.emergent_id) && ancestry.length < 25) {
    seen.add(cur.emergent_id);
    ancestry.push({
      id: cur.emergent_id,
      given_name: cur.given_name,
      naming_origin: cur.naming_origin,
    });
    cur = parentOf(cur);
  }

  const descendants = all
    .filter((i) => {
      const p = parentOf(i);
      return p && p.emergent_id === root.emergent_id;
    })
    .map((i) => ({ id: i.emergent_id, given_name: i.given_name, naming_origin: i.naming_origin }));

  const cohort = root.naming_origin
    ? all
        .filter((i) => i.naming_origin === root.naming_origin && i.emergent_id !== root.emergent_id)
        .map((i) => ({ id: i.emergent_id, given_name: i.given_name }))
    : [];

  return {
    ok: true,
    result: {
      root: {
        id: root.emergent_id,
        given_name: root.given_name,
        naming_origin: root.naming_origin,
        naming_metadata: parseJson(root.naming_metadata, {}),
      },
      ancestry,
      descendants,
      cohort,
      depth: ancestry.length,
    },
  };
}

/** Counts, activity-over-time, focus distribution, top contributors. */
export function computeMetrics(db, params = {}) {
  const STATE = params.STATE;
  const days = Math.min(Math.max(parseInt(params.days, 10) || 14, 1), 90);
  const now = Date.now();
  const windowStart = now - days * 86_400_000;

  const identities = allIdentities(db, STATE);
  const activeCount = identities.filter(isActive).length;

  const focusMap = new Map();
  for (const i of identities) {
    const f = (i.current_focus || "unfocused").trim() || "unfocused";
    focusMap.set(f, (focusMap.get(f) || 0) + 1);
  }
  const focusDistribution = [...focusMap.entries()]
    .map(([focus, count]) => ({ focus, count }))
    .sort((a, b) => b.count - a.count);

  const dayBuckets = new Map();
  for (let d = 0; d < days; d++) {
    const key = new Date(windowStart + d * 86_400_000).toISOString().slice(0, 10);
    dayBuckets.set(key, 0);
  }
  let feedRows = [];
  try {
    feedRows = db.prepare(
      "SELECT created_at FROM emergent_activity_feed WHERE created_at > ?"
    ).all(windowStart);
  } catch { feedRows = []; }
  for (const r of feedRows) {
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    if (dayBuckets.has(key)) dayBuckets.set(key, dayBuckets.get(key) + 1);
  }
  const activityOverTime = [...dayBuckets.entries()].map(([date, count]) => ({ date, count }));

  let eventTypeTotals = {};
  try {
    const rows = db.prepare(
      `SELECT event_type, COUNT(*) AS n FROM emergent_activity_feed
       WHERE created_at > ? GROUP BY event_type ORDER BY n DESC`
    ).all(windowStart);
    eventTypeTotals = Object.fromEntries(rows.map((r) => [r.event_type, r.n]));
  } catch { eventTypeTotals = {}; }

  let topContributors = [];
  try {
    const rows = db.prepare(
      `SELECT emergent_id, COUNT(*) AS n FROM emergent_activity_feed
       WHERE created_at > ? AND emergent_id IS NOT NULL
       GROUP BY emergent_id ORDER BY n DESC LIMIT 10`
    ).all(windowStart);
    const nameMap = new Map(identities.map((i) => [i.emergent_id, i.given_name]));
    topContributors = rows.map((r) => ({
      emergent_id: r.emergent_id,
      given_name: nameMap.get(r.emergent_id) || r.emergent_id,
      events: r.n,
    }));
  } catch { topContributors = []; }

  let totalCommunications = 0;
  try {
    totalCommunications = db.prepare(
      "SELECT COUNT(*) AS n FROM emergent_communications"
    ).get()?.n || 0;
  } catch { /* noop */ }
  let totalObservations = 0;
  try {
    totalObservations = db.prepare(
      "SELECT COUNT(*) AS n FROM emergent_observations"
    ).get()?.n || 0;
  } catch { /* noop */ }

  return {
    ok: true,
    result: {
      windowDays: days,
      summary: {
        totalEmergents: identities.length,
        activeEmergents: activeCount,
        dormantEmergents: identities.length - activeCount,
        totalCommunications,
        totalObservations,
        feedEventsInWindow: feedRows.length,
      },
      focusDistribution,
      activityOverTime,
      eventTypeTotals,
      topContributors,
    },
  };
}

// ── registration ─────────────────────────────────────────────────────────────

export default function registerGenesisActions(registerLensAction) {
  // ── Identity detail — full timeline of an emergent's actions/decisions ──────
  registerLensAction("genesis", "identity-detail", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const target = params.emergentId || params.id || params.name;
      if (!target) return { ok: false, error: "emergentId required" };
      return computeIdentityDetail(db, target, { limit: params.limit });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Roster search — filter the roster by role / focus / activity state ─────
  registerLensAction("genesis", "roster-search", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      return computeRosterSearch(db, params);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Relationship graph — communication graph between emergent identities ───
  registerLensAction("genesis", "relationship-graph", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      return computeRelationshipGraph(db, params);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feed (event-type filtered) — live activity feed with type filtering ────
  registerLensAction("genesis", "feed-filtered", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      return computeFeedFiltered(db, params);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Lineage — naming-origin chain / ancestry view ──────────────────────────
  registerLensAction("genesis", "lineage", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      const target = params.emergentId || params.id || params.name;
      if (!target) return { ok: false, error: "emergentId required" };
      return computeLineage(db, target, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Metrics — counts, activity over time, focus distribution ───────────────
  registerLensAction("genesis", "metrics", (ctx, _artifact, params = {}) => {
    try {
      const db = ctx?.db;
      if (!db) return { ok: false, error: "no_db" };
      return computeMetrics(db, params);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Saved searches — persist a user's roster filter presets ────────────────
  registerLensAction("genesis", "search-save", (ctx, _artifact, params = {}) => {
    try {
      const STATE = genesisState();
      if (!STATE) return { ok: false, error: "no_state" };
      const uid = userId(ctx);
      const label = String(params.label || "").trim();
      if (!label) return { ok: false, error: "label required" };

      const list = STATE.genesisSavedSearches.get(uid) || [];
      const entry = {
        id: `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        filters: {
          query: params.query || "",
          role: params.role || "",
          state: params.state || "all",
          focus: params.focus || "",
        },
        createdAt: Date.now(),
      };
      const next = [entry, ...list.filter((s) => s.label !== label)]
        .slice(0, SAVED_SEARCH_LIMIT);
      STATE.genesisSavedSearches.set(uid, next);
      persist();
      return { ok: true, result: { saved: entry, searches: next } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("genesis", "search-list", (ctx, _artifact, _params = {}) => {
    try {
      const STATE = genesisState();
      if (!STATE) return { ok: false, error: "no_state" };
      const uid = userId(ctx);
      return { ok: true, result: { searches: STATE.genesisSavedSearches.get(uid) || [] } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("genesis", "search-delete", (ctx, _artifact, params = {}) => {
    try {
      const STATE = genesisState();
      if (!STATE) return { ok: false, error: "no_state" };
      const uid = userId(ctx);
      const id = String(params.id || "");
      if (!id) return { ok: false, error: "id required" };
      const list = STATE.genesisSavedSearches.get(uid) || [];
      const next = list.filter((s) => s.id !== id);
      STATE.genesisSavedSearches.set(uid, next);
      persist();
      return { ok: true, result: { searches: next, removed: list.length - next.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
