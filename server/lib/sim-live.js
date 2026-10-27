// Live reads for the world-sim routes that used to return a scripted world.
// Each function returns stored rows or a configured flag. It does not invent
// a festival, a rollout percent, a citation count, or a brain memory figure.

import { listPublicFlags } from "./feature-flags.js";
import { seasonFor, yearFor, SEASONS } from "./seasons.js";
import { listActiveFestivals } from "./festivals.js";
import { getCurrentSeason } from "./world-progression.js";
import { getActiveBrainConfig, getEndpointStats } from "./brain-config.js";
import { semanticSearchDtus } from "./cross-lens-discovery.js";

function tableExists(db, name) {
  try {
    return !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name);
  } catch {
    return false;
  }
}

function copyPrefValue(value) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 200);
  return undefined;
}

export function copySimPrefs(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== "string" || key.length === 0 || key.length > 64) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      const nested = {};
      for (const [nk, nv] of Object.entries(value)) {
        if (typeof nk !== "string" || nk.length === 0 || nk.length > 64) continue;
        if (nk === "__proto__" || nk === "constructor" || nk === "prototype") continue;
        const copied = copyPrefValue(nv);
        if (copied !== undefined) nested[nk] = copied;
      }
      if (Object.keys(nested).length) out[key] = nested;
    } else {
      const copied = copyPrefValue(value);
      if (copied !== undefined) out[key] = copied;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Calendar season is a function of the clock. A world_seasons row, when the
 * caller names a world, wins over that clock. Festivals and challenges are
 * included only when a row or an open progression season actually holds them.
 */
export function readSeasonalCurrent(db, { worldId = "", now = Date.now() } = {}) {
  const calendar = seasonFor(now);
  let stored = null;
  if (db && worldId && tableExists(db, "world_seasons")) {
    try {
      stored = db.prepare(
        "SELECT season_idx, year_n FROM world_seasons WHERE world_id = ?",
      ).get(worldId);
    } catch {
      stored = null;
    }
  }
  const storedSeason = stored && SEASONS[stored.season_idx] ? SEASONS[stored.season_idx] : null;
  const season = storedSeason ? storedSeason.name : calendar.name;

  const activeFestivals = db && worldId ? listActiveFestivals(db, worldId, now) : [];
  const festival = activeFestivals[0] || null;

  let events = [];
  if (db && worldId && tableExists(db, "season_events")) {
    try {
      events = db.prepare(`
        SELECT id, event_kind, narrative, season_idx, year_n, occurred_at
          FROM season_events
         WHERE world_id = ?
         ORDER BY occurred_at DESC
         LIMIT 20
      `).all(worldId);
    } catch {
      events = [];
    }
  }

  const live = getCurrentSeason();
  const challenge = live?.challenges?.[0] || null;

  const activeEvent = festival
    ? {
        id: festival.festival_id,
        name: festival.name,
        endsAt: new Date(festival.ends_at * 1000).toISOString(),
        source: "festival",
      }
    : null;

  const monthlyChallenge = challenge
    ? {
        id: challenge.id,
        title: challenge.name,
        description: challenge.description || "",
        xpReward: challenge.xpReward,
        source: "season",
      }
    : null;

  return {
    ok: true,
    season,
    seasonSource: storedSeason ? "world_seasons" : "calendar",
    year: stored ? stored.year_n : yearFor(now),
    calendar: { name: calendar.name, idx: calendar.idx },
    progressionSeason: live,
    activeFestivals,
    events,
    activeEvent,
    monthlyChallenge,
    reason: activeEvent || monthlyChallenge || events.length ? null : "no_active_event",
  };
}

export function readSimFlags(env = process.env) {
  return { ok: true, flags: listPublicFlags(env) };
}

let probeFetch = null;
const probeCache = new Map();
const PROBE_TTL_MS = 10_000;

/** Test hook. Pass null to use the global fetch again. */
export function _setSimProbeFetch(fn) {
  probeFetch = typeof fn === "function" ? fn : null;
  probeCache.clear();
}

function modelNames(body) {
  const rows = Array.isArray(body?.models) ? body.models : [];
  return rows.map((m) => m?.name || m?.model).filter((n) => typeof n === "string" && n.length > 0);
}

async function probeOrigin(url, fetchImpl) {
  if (!url || typeof url !== "string") return { reachable: false, reason: "no_url" };
  if (url.startsWith("cloud:") || url.startsWith("cloudflare:")) {
    return { reachable: null, reason: "not_an_ollama_url" };
  }
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { reachable: false, reason: "bad_url" };
  }
  const useCache = fetchImpl === globalThis.fetch;
  const cached = probeCache.get(origin);
  if (useCache && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  try {
    const [tagsRes, psRes] = await Promise.all([
      fetchImpl(`${origin}/api/tags`, { signal: AbortSignal.timeout(500) }),
      fetchImpl(`${origin}/api/ps`, { signal: AbortSignal.timeout(500) }),
    ]);
    const tags = tagsRes?.ok ? await tagsRes.json() : null;
    const ps = psRes?.ok ? await psRes.json() : null;
    const value = !tags
      ? { reachable: false, reason: "unreachable" }
      : {
          reachable: true,
          reason: "tags",
          installed: modelNames(tags),
          running: modelNames(ps),
        };
    if (useCache) probeCache.set(origin, { at: Date.now(), value });
    return value;
  } catch {
    return { reachable: false, reason: "unreachable" };
  }
}

/**
 * Configured models come from the live brain config. Inference counts come
 * from noteEndpointFinish. Reachability is an Ollama /api/tags + /api/ps
 * probe. Memory, latency, and requests-per-minute are not measured here.
 */
export async function readBrainStatus({ probe = true } = {}) {
  const config = getActiveBrainConfig();
  const stats = getEndpointStats();
  const fetchImpl = probeFetch || globalThis.fetch;
  const brains = {};
  let totalInferences = 0;

  for (const [name, cfg] of Object.entries(config)) {
    const endpoints = Array.isArray(stats[name]) ? stats[name] : [];
    let inflight = 0;
    let failures = 0;
    let completed = 0;
    let lastHealthyAt = 0;
    for (const ep of endpoints) {
      inflight += ep.inflight || 0;
      failures += ep.failures || 0;
      completed += (ep.completedOk || 0) + (ep.completedFail || 0);
      if ((ep.lastHealthyAt || 0) > lastHealthyAt) lastHealthyAt = ep.lastHealthyAt;
    }
    totalInferences += completed;

    const urls = (Array.isArray(cfg.urls) && cfg.urls.length ? cfg.urls : [cfg.url]).filter(Boolean);
    let reachable = null;
    let reachReason = probe ? "unreachable" : "not_probed";
    let running = [];
    if (probe && urls.length && typeof fetchImpl === "function") {
      const probes = await Promise.all(urls.map((url) => probeOrigin(url, fetchImpl)));
      const hit = probes.find((p) => p.reachable === true);
      const skipped = probes.find((p) => p.reachable === null);
      if (hit) {
        reachable = true;
        reachReason = hit.reason;
        running = hit.running;
      } else if (skipped && probes.every((p) => p.reachable !== false)) {
        reachable = null;
        reachReason = skipped.reason;
      } else {
        reachable = false;
        reachReason = "unreachable";
      }
    } else if (!urls.length) {
      reachable = false;
      reachReason = "no_url";
    }

    const model = cfg.model || null;
    const modelRunning = !!(model && running.some((n) => n === model || n.startsWith(`${model}:`)));
    let status = "unconfigured";
    if (cfg.url) status = "configured";
    if (reachable === true) status = modelRunning ? "running" : "reachable";

    brains[name] = {
      model,
      configured: Boolean(cfg.url),
      status,
      reachable,
      reachReason,
      inflight,
      failures,
      completed,
      lastHealthyAt: lastHealthyAt || null,
      runningModels: running,
    };
  }

  return {
    ok: true,
    brains,
    totalInferences,
    totalInferences24h: null,
    avgLatencyMs: null,
    reason: "counter_is_process_lifetime",
    probe: probe ? "tags" : "skipped",
  };
}

const SIM_ADMIN_ROLES = new Set(["owner", "admin", "sovereign", "founder"]);

export function isSimAdmin(user) {
  return SIM_ADMIN_ROLES.has(user?.role);
}

// A signed-out caller and a normal member get the three fields a status
// page can show. Counters, running-model lists, and the Ollama probe stay
// on the admin response.
export function publicBrainStatus(full) {
  const brains = {};
  for (const [name, brain] of Object.entries(full?.brains || {})) {
    brains[name] = {
      model: brain?.model ?? null,
      configured: brain?.configured === true,
      status: brain?.status || "unconfigured",
    };
  }
  return { ok: true, brains, probe: "admin_only" };
}

export async function searchSimSemantic(db, { query, limit, requesterId } = {}) {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, status: 400, error: "query required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const result = await semanticSearchDtus(db, q, {
    limit: Number(limit) || 10,
    requesterId: requesterId || null,
  });
  if (!result.ok) {
    const status = result.reason === "query_too_short" || result.reason === "query_too_long" ? 400 : 503;
    return { ok: false, status, error: result.reason || "search_failed" };
  }
  return {
    ok: true,
    status: 200,
    query: result.query,
    semantic: result.semantic === true,
    results: (result.results || []).map((r) => ({
      id: r.id,
      type: r.kind,
      title: r.title,
      score: typeof r.similarity === "number" ? r.similarity : null,
    })),
  };
}

function dtuColumn(db, column) {
  try {
    return db.prepare("PRAGMA table_info(dtus)").all().some((row) => row.name === column);
  } catch {
    return false;
  }
}

function loadDtu(db, id) {
  if (!tableExists(db, "dtus")) return null;
  const visibility = dtuColumn(db, "visibility") ? "visibility" : "NULL AS visibility";
  const data = dtuColumn(db, "data") ? "data" : "NULL AS data";
  try {
    return db.prepare(
      `SELECT id, type, title, creator_id, ${visibility}, ${data} FROM dtus WHERE id = ?`,
    ).get(id) || null;
  } catch {
    return null;
  }
}

// Same gate as searchDtus: a personal-scope body is owner-only. A private
// or internal visibility column is owner-only too. A missing row is not
// hidden; there is nothing to leak.
function dtuHidden(row, requesterId) {
  if (!row) return false;
  if (row.creator_id && requesterId && row.creator_id === requesterId) return false;
  if (typeof row.data === "string" && row.data.includes('"scope":"personal"')) return true;
  return row.visibility === "private" || row.visibility === "internal";
}

function nodeFromRow(db, id, requesterId) {
  const row = loadDtu(db, id);
  if (dtuHidden(row, requesterId)) return { id, hidden: true };
  const cited = citationCount(db, id);
  return {
    id,
    type: row?.type || null,
    label: row?.title || null,
    creatorId: row?.creator_id || null,
    citations: cited.citations,
    citationsReason: cited.citationsReason,
    recorded: cited.recorded,
  };
}

function citationCount(db, id) {
  if (!tableExists(db, "dtu_citations")) {
    return { citations: null, citationsReason: "no_citation_table", recorded: false };
  }
  try {
    const row = db.prepare("SELECT citation_count FROM dtu_citations WHERE dtu_id = ?").get(id);
    if (!row) return { citations: 0, citationsReason: null, recorded: false };
    return { citations: Number(row.citation_count) || 0, citationsReason: null, recorded: true };
  } catch {
    return { citations: null, citationsReason: "citation_read_failed", recorded: false };
  }
}

function neighborEdges(db, id, edgeType) {
  const edges = [];
  if ((!edgeType || edgeType === "cites") && tableExists(db, "royalty_lineage")) {
    try {
      const rows = db.prepare(`
        SELECT child_id, parent_id FROM royalty_lineage
         WHERE child_id = ? OR parent_id = ?
      `).all(id, id);
      for (const row of rows) {
        edges.push({ from: row.child_id, to: row.parent_id, type: "cites" });
      }
    } catch { /* table shape differs; skip */ }
  }
  if (tableExists(db, "dtu_causal_edges")) {
    try {
      const rows = db.prepare(`
        SELECT parent_id, child_id, edge_type, confidence
          FROM dtu_causal_edges
         WHERE parent_id = ? OR child_id = ?
      `).all(id, id);
      for (const row of rows) {
        if (edgeType && row.edge_type !== edgeType) continue;
        edges.push({
          from: row.parent_id,
          to: row.child_id,
          type: row.edge_type,
          confidence: row.confidence,
        });
      }
    } catch { /* skip */ }
  }
  return edges;
}

export function querySimKnowledge(db, { startId, edgeType, depth, requesterId } = {}) {
  if (!db) return { ok: false, status: 503, error: "no_db" };
  const id = String(startId ?? "").trim();
  if (!id) return { ok: false, status: 400, error: "startId required" };
  const depthN = Math.min(3, Math.max(1, Number.isFinite(Number(depth)) ? Number(depth) : 1));
  const wantEdge = typeof edgeType === "string" && edgeType.trim() ? edgeType.trim() : "";
  const viewer = requesterId || null;

  const nodes = new Map();
  const edges = [];
  const seenEdge = new Set();
  const queue = [id];
  const seen = new Set();

  function remember(cur) {
    if (nodes.has(cur)) return nodes.get(cur);
    const node = nodeFromRow(db, cur, viewer);
    nodes.set(cur, node);
    return node;
  }

  function addEdge(edge) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push(edge);
    for (const other of [edge.from, edge.to]) {
      if (!seen.has(other)) queue.push(other);
      remember(other);
    }
  }

  for (let d = 0; d < depthN && queue.length; d++) {
    const layer = queue.splice(0, queue.length);
    for (const cur of layer) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = remember(cur);
      // A hidden node is an id only. Do not walk its neighbours.
      if (node.hidden) continue;
      if (d === depthN - 1) continue;
      for (const edge of neighborEdges(db, cur, wantEdge)) addEdge(edge);
    }
  }

  // Depth 1 still needs the start node's own edges, without walking further.
  const startNode = remember(id);
  if (depthN === 1 && !startNode.hidden) {
    for (const edge of neighborEdges(db, id, wantEdge)) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push(edge);
      for (const other of [edge.from, edge.to]) remember(other);
    }
  }

  const start = nodes.get(id);
  const missing = !start?.hidden && !start?.label && !start?.type && !start?.recorded && edges.length === 0;
  const publicNodes = [...nodes.values()].map(({ recorded: _recorded, ...node }) => node);
  return {
    ok: true,
    status: 200,
    graph: { nodes: publicNodes, edges },
    depth: depthN,
    reason: missing ? "not_found" : null,
  };
}

const SENSITIVE_DETAIL = /secret|token|password|authorization|api[_-]?key/i;

function publicDetails(raw) {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (SENSITIVE_DETAIL.test(key)) continue;
      if (typeof value === "string") out[key] = value.slice(0, 200);
      else if (typeof value === "number" || typeof value === "boolean" || value == null) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function readSimAudit(db, { userId, limit } = {}) {
  if (!userId) return { ok: false, status: 401, error: "Authentication required" };
  if (!db) return { ok: false, status: 503, error: "no_db" };
  if (!tableExists(db, "audit_log")) {
    return { ok: false, status: 503, error: "audit_log_missing" };
  }
  const cap = Math.min(100, Math.max(1, Number(limit) || 50));
  try {
    const rows = db.prepare(`
      SELECT id, timestamp, category, action, path, method, status_code, details
        FROM audit_log
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ?
    `).all(userId, cap);
    const totalRow = db.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?",
    ).get(userId);
    const logs = rows.map((row) => ({
      id: row.id,
      event: row.category ? `${row.category}.${row.action}` : row.action,
      action: row.action,
      category: row.category,
      actor: userId,
      path: row.path || null,
      method: row.method || null,
      statusCode: row.status_code ?? null,
      timestamp: row.timestamp,
      details: publicDetails(row.details),
    }));
    return { ok: true, status: 200, logs, total: totalRow?.n || 0 };
  } catch {
    return { ok: false, status: 500, error: "audit_read_failed" };
  }
}

export function readSimPrefs(db, userId, kind) {
  if (!db) return { ok: false, status: 503, error: "no_db" };
  if (!tableExists(db, "sim_user_prefs")) {
    return { ok: false, status: 503, error: "prefs_table_missing" };
  }
  try {
    const row = db.prepare(
      "SELECT prefs_json FROM sim_user_prefs WHERE user_id = ? AND kind = ?",
    ).get(userId, kind);
    if (!row) {
      return { ok: false, status: 501, error: "unavailable", reason: "no_saved_settings" };
    }
    return { ok: true, status: 200, settings: JSON.parse(row.prefs_json) };
  } catch {
    return { ok: false, status: 500, error: "prefs_read_failed" };
  }
}

export function writeSimPrefs(db, userId, kind, body) {
  if (!db) return { ok: false, status: 503, error: "no_db" };
  if (!tableExists(db, "sim_user_prefs")) {
    return { ok: false, status: 503, error: "prefs_table_missing" };
  }
  const settings = copySimPrefs(body);
  if (!settings) return { ok: false, status: 400, error: "settings required" };
  try {
    db.prepare(`
      INSERT INTO sim_user_prefs (user_id, kind, prefs_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        prefs_json = excluded.prefs_json,
        updated_at = excluded.updated_at
    `).run(userId, kind, JSON.stringify(settings), new Date().toISOString());
    return { ok: true, status: 200, settings };
  } catch {
    return { ok: false, status: 500, error: "prefs_write_failed" };
  }
}
