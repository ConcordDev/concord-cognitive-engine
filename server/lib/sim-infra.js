// Readings for the world sim routes that used to ship a fixed population,
// a fake NATS bus, and a plugin store with made-up install counts.
// A missing table or an unmeasured counter stays null with a reason.
// A zero from a real query is a real zero.

import { readOwnBuildings, readOwnCitations } from "./sim-stats.js";

const TABLES = new Set(["worlds", "world_buildings", "dtus", "dtu_citations", "economy_ledger"]);
const OWNER_COLS = new Set(["creator_id", "owner_user_id"]);
const NOTIF_ACTIONS = new Set(["opened", "dismissed", "snoozed"]);
const PRIORITY_KEYS = ["citation", "royalty", "social", "system", "event"];
const PRIORITY_VALUES = new Set(["high", "medium", "low"]);

const notifProfiles = new Map();

export function _resetSimInfraMemory() {
  notifProfiles.clear();
}

function columns(db, table) {
  if (!TABLES.has(table)) return null;
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!rows.length) return null;
    return new Set(rows.map((c) => c.name));
  } catch {
    return null;
  }
}

function ownerColumn(cols) {
  if (!cols) return null;
  if (cols.has("creator_id")) return "creator_id";
  if (cols.has("owner_user_id")) return "owner_user_id";
  return null;
}

function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params).n) || 0;
}

// created_at is a datetime string in the schema. Some writers bind unix seconds.
// A JS number above 2^31 lands in a TEXT column as "1760000000.0", so the
// unix branch accepts that trailing ".0". An ISO date stays on the datetime clock.
// A 13-digit value (>= 1e11) is unix MILLISECONDS and is divided down to seconds;
// left as-is it would compare as far in the future and count as "recent" forever.
function createdWithin24h(column = "created_at") {
  return `(
    (${column} GLOB '????-??-??*' AND ${column} >= datetime('now', '-1 day'))
    OR (
      ${column} GLOB '[0-9]*'
      AND (${column} NOT GLOB '*[^0-9]*' OR ${column} GLOB '[0-9]*.0')
      AND (CASE WHEN CAST(${column} AS INTEGER) >= 100000000000
                THEN CAST(${column} AS INTEGER) / 1000
                ELSE CAST(${column} AS INTEGER) END) >= unixepoch('now', '-1 day')
    )
  )`;
}

// Starter inventory is one row per item (mat_<user>_…). It is not an authored DTU.
function skipStarterInventory(cols) {
  if (!cols?.has("type")) return "";
  return " AND NOT (type = 'material' AND id LIKE 'mat_%')";
}

function clockTime(value) {
  const s = String(value || "");
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

function finiteInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanPriorities(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of PRIORITY_KEYS) {
    const value = raw[key];
    if (PRIORITY_VALUES.has(value)) out[key] = value;
  }
  return out;
}

export function readSimHealth() {
  return {
    ok: true,
    status: "up",
    services: [{
      name: "world-routes",
      status: "up",
      uptimeSec: Math.round(process.uptime()),
      latencyMs: null,
      latencyReason: "not_measured",
    }],
    unavailable: ["api-gateway", "physics-engine", "ai-brain", "marketplace", "social-hub"],
    checkedAt: new Date().toISOString(),
  };
}

export function readSimMetrics(db) {
  if (!db) return { ok: false, status: 503, error: "stats_unavailable", reason: "no_database" };
  const metrics = {
    processUptimeSec: Math.round(process.uptime()),
    processHeapUsedMB: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
  };
  const unavailable = {
    activePlayers: "not_recorded",
    citationsIssued24h: "not_windowed",
    physicsValidations24h: "not_recorded",
    avgValidationMs: "not_recorded",
    cacheHitRate: "no_cache_stats",
    eventBusMessages24h: "no_event_bus",
    errorRate: "not_recorded",
    p99LatencyMs: "not_measured",
  };
  if (columns(db, "worlds")) metrics.worldCount = count(db, "SELECT COUNT(*) AS n FROM worlds");
  else unavailable.worldCount = "no_worlds_table";
  if (columns(db, "world_buildings")) metrics.buildingCount = count(db, "SELECT COUNT(*) AS n FROM world_buildings");
  else unavailable.buildingCount = "no_building_table";
  const dtuCols = columns(db, "dtus");
  if (dtuCols?.has("created_at")) {
    metrics.dtusCreated24h = count(
      db,
      `SELECT COUNT(*) AS n FROM dtus WHERE ${createdWithin24h()}${skipStarterInventory(dtuCols)}`,
    );
  } else {
    unavailable.dtusCreated24h = dtuCols ? "no_created_at" : "no_dtu_table";
  }
  return { ok: true, metrics, unavailable, timestamp: new Date().toISOString() };
}

export function readEventBusStatus() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "no_event_bus",
    missing: "No message bus is attached to this process. In-process socket emits are not counted here.",
  };
}

export function readJobQueueStatus() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "no_job_queue",
    missing: "No external job queue is running in this process.",
  };
}

export function readCacheStatus() {
  const heap = process.memoryUsage();
  return {
    ok: true,
    provider: null,
    reason: "no_redis_stats",
    processHeapUsedMB: Math.round(heap.heapUsed / (1024 * 1024)),
    processRssMB: Math.round(heap.rss / (1024 * 1024)),
    hitRate: null,
    missRate: null,
    evictions24h: null,
    keysTotal: null,
  };
}

export function readConcordiaHub(db) {
  if (!db) return { ok: false, status: 503, error: "stats_unavailable", reason: "no_database" };
  const worldsCols = columns(db, "worlds");
  if (!worldsCols) return { ok: false, status: 503, error: "stats_unavailable", reason: "no_worlds_table" };
  const concordia = {
    name: "Concordia",
    worldCount: count(db, "SELECT COUNT(*) AS n FROM worlds"),
    districts: null,
    districtsReason: "no_district_table",
    activeUsers: null,
    activeUsersReason: "not_recorded",
  };
  concordia.population = worldsCols.has("population")
    ? count(db, "SELECT COALESCE(SUM(population), 0) AS n FROM worlds")
    : null;
  if (!worldsCols.has("population")) concordia.populationReason = "no_population_column";
  concordia.totalVisits = worldsCols.has("total_visits")
    ? count(db, "SELECT COALESCE(SUM(total_visits), 0) AS n FROM worlds")
    : null;
  if (!worldsCols.has("total_visits")) concordia.totalVisitsReason = "no_visits_column";
  if (columns(db, "world_buildings")) {
    concordia.buildingCount = count(db, "SELECT COUNT(*) AS n FROM world_buildings");
  } else {
    concordia.buildingCount = null;
    concordia.buildingReason = "no_building_table";
  }
  return { ok: true, concordia };
}

export function readDistrictLeaderboard(db, districtId) {
  const id = String(districtId || "").slice(0, 80);
  if (!id) return { ok: false, status: 400, error: "district_required" };
  if (!db) return { ok: false, status: 503, error: "stats_unavailable", reason: "no_database" };
  const body = {
    ok: true,
    districtId: id,
    scope: "global",
    scopeReason: "citations_are_not_stored_per_district",
    mostCitedCreator: null,
    highestHabitability: null,
    habitabilityReason: "not_recorded",
  };
  const dtuCols = columns(db, "dtus");
  const citeCols = columns(db, "dtu_citations");
  const ownerCol = ownerColumn(dtuCols);
  if (!dtuCols || !citeCols?.has("citation_count") || !ownerCol) {
    body.mostCitedReason = !dtuCols || !citeCols ? "no_citation_table" : "no_creator_column";
    return body;
  }
  if (!OWNER_COLS.has(ownerCol)) {
    body.mostCitedReason = "no_creator_column";
    return body;
  }
  const rows = db.prepare(`
    SELECT d.${ownerCol} AS userId, SUM(c.citation_count) AS score
    FROM dtus d
    JOIN dtu_citations c ON c.dtu_id = d.id
    WHERE d.${ownerCol} IS NOT NULL
    GROUP BY d.${ownerCol}
    HAVING SUM(c.citation_count) > 0
    ORDER BY score DESC
    LIMIT 5
  `).all();
  body.mostCitedCreator = rows.map((row, i) => ({
    userId: row.userId,
    displayName: null,
    score: Number(row.score) || 0,
    metric: "citations",
    rank: i + 1,
  }));
  return body;
}

export function readDistrictTimeline(districtId) {
  const id = String(districtId || "").slice(0, 80);
  if (!id) return { ok: false, status: 400, error: "district_required" };
  return {
    ok: true,
    districtId: id,
    snapshots: [],
    reason: "no_snapshot_store",
  };
}

export function readStressTest() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "no_structural_model",
    missing: "No stored building model is connected to this route, so a seismic pass cannot run.",
  };
}

export function readScene(districtId, district) {
  const weather = district?.weather && typeof district.weather === "object" ? district.weather : null;
  const infrastructure = district?.infrastructure && typeof district.infrastructure === "object"
    ? district.infrastructure
    : null;
  return {
    ok: true,
    scene: {
      districtId: String(districtId || "").slice(0, 80),
      terrain: null,
      terrainReason: "no_heightmap",
      buildings: Array.isArray(district?.buildings) ? district.buildings : [],
      infrastructure,
      infrastructureReason: infrastructure ? null : "not_recorded",
      npcs: null,
      npcReason: "not_attached",
      weather,
      weatherReason: weather ? null : "no_weather_sample",
      timeOfDay: null,
      timeReason: "no_world_clock",
    },
  };
}

export function readPluginSurface() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "no_plugin_registry",
    missing: "There is no plugin registry. Install counts and ratings are not measured.",
  };
}

export function readNotifProfile(userId) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  const profile = notifProfiles.get(userId);
  if (!profile) {
    return {
      ok: false,
      status: 501,
      error: "not_wired",
      reason: "no_saved_profile",
      missing: "No notification profile is stored for this user.",
    };
  }
  return { ok: true, profile };
}

export function writeNotifProfile(userId, body) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  const prev = notifProfiles.get(userId);
  const profile = {
    quietHoursStart: clockTime(body?.quietHoursStart),
    quietHoursEnd: clockTime(body?.quietHoursEnd),
    batchingEnabled: body?.batchingEnabled === true,
    batchIntervalMs: finiteInt(body?.batchInterval, 0, 86_400_000),
    priorities: cleanPriorities(body?.priorities),
    learningEnabled: body?.learningEnabled === true,
    dismissPatterns: Array.isArray(body?.dismissPatterns)
      ? body.dismissPatterns.map((item) => String(item).slice(0, 80)).filter(Boolean).slice(0, 50)
      : [],
    signals: prev?.signals || [],
    updatedAt: new Date().toISOString(),
    durable: false,
  };
  notifProfiles.set(userId, profile);
  return { ok: true, profile };
}

export function recordNotifSignal(userId, body) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  const profile = notifProfiles.get(userId);
  if (!profile) {
    return {
      ok: false,
      status: 501,
      error: "not_wired",
      reason: "no_saved_profile",
      missing: "Save a notification profile before recording a signal. Nothing was stored.",
    };
  }
  const notificationType = String(body?.type || "").slice(0, 40);
  const action = NOTIF_ACTIONS.has(body?.action) ? body.action : null;
  if (!notificationType || !action) return { ok: false, status: 400, error: "type_and_action_required" };
  const signal = {
    notificationType,
    action,
    timeToActionMs: finiteInt(body?.timeToAction, 0, 86_400_000),
    at: new Date().toISOString(),
  };
  profile.signals = [...(profile.signals || []), signal].slice(-50);
  profile.updatedAt = signal.at;
  notifProfiles.set(userId, profile);
  return { ok: true, signal, durable: false };
}

export function readMobileDashboard(db, userId) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  if (!db) return { ok: false, status: 503, error: "stats_unavailable", reason: "no_database" };
  const quickStats = {
    dtuCount: null,
    citationCount: null,
    royalties: null,
    friendsOnline: null,
    friendsReason: "not_recorded",
  };
  const dtuCols = columns(db, "dtus");
  const ownerCol = ownerColumn(dtuCols);
  if (!dtuCols) quickStats.dtuReason = "no_dtu_table";
  else if (!ownerCol || !OWNER_COLS.has(ownerCol)) quickStats.dtuReason = "no_creator_column";
  else {
    // Starter inventory is one row per item (mat_<user>_…). It is not an authored DTU.
    const skipStarter = dtuCols.has("type")
      ? " AND NOT (type = 'material' AND id LIKE 'mat_%')"
      : "";
    const skipStarterJoin = dtuCols.has("type")
      ? " AND NOT (d.type = 'material' AND d.id LIKE 'mat_%')"
      : "";
    quickStats.dtuCount = count(db, `SELECT COUNT(*) AS n FROM dtus WHERE ${ownerCol} = ?${skipStarter}`, userId);
    const citeCols = columns(db, "dtu_citations");
    if (!citeCols?.has("citation_count")) quickStats.citationReason = "no_citation_table";
    else {
      quickStats.citationCount = count(db, `
        SELECT COALESCE(SUM(c.citation_count), 0) AS n
        FROM dtus d
        LEFT JOIN dtu_citations c ON c.dtu_id = d.id
        WHERE d.${ownerCol} = ?${skipStarterJoin}
      `, userId);
    }
  }
  const ledCols = columns(db, "economy_ledger");
  if (!ledCols?.has("to_user_id") || !ledCols.has("net") || !ledCols.has("type")) {
    quickStats.royaltyReason = "no_ledger";
  } else {
    const statusSql = ledCols.has("status") ? "AND status = 'complete'" : "";
    quickStats.royalties = count(db, `
      SELECT COALESCE(SUM(net), 0) AS n FROM economy_ledger
      WHERE to_user_id = ? AND type = 'ROYALTY_PAYOUT' ${statusSql}
    `, userId);
  }
  return {
    ok: true,
    dashboard: {
      overnightChanges: [],
      overnightReason: "no_event_feed",
      quickStats,
      remoteViewAvailable: false,
      remoteViewReason: "not_recorded",
    },
  };
}

const READ_ACTIONS = new Set(["check-builds", "view-citations"]);
const UNWIRED_ACTIONS = {
  "manage-inventory": "No inventory read is wired to this route; inventory changes are not run from here.",
  "quick-chat": "Sending a chat message is a write and no chat send is wired to this route.",
  "toggle-notifications": "Notification settings are only held in memory per process; this route does not change them.",
};

// Answers read-only quick actions for the signed-in caller from stored rows.
// Anything that would write, or has no backing read, stays an honest 501.
export function runQuickAction(db, userId, body) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  const action = typeof body?.action === "string" ? body.action : "";
  if (!READ_ACTIONS.has(action) && !(action in UNWIRED_ACTIONS)) {
    return {
      ok: false,
      status: 400,
      error: "unknown_action",
      action: action.slice(0, 40),
      allowed: [...READ_ACTIONS, ...Object.keys(UNWIRED_ACTIONS)],
    };
  }
  if (!READ_ACTIONS.has(action)) {
    return {
      ok: false,
      status: 501,
      error: "not_wired",
      reason: "action_not_wired",
      action,
      missing: UNWIRED_ACTIONS[action],
    };
  }
  const read = action === "check-builds" ? readOwnBuildings(db, userId) : readOwnCitations(db, userId);
  if (!read.ok) {
    if (read.status) return read;
    return {
      ok: false,
      status: 501,
      error: "not_wired",
      reason: read.reason,
      action,
      missing: action === "check-builds"
        ? "Buildings cannot be attributed to a user from the world_buildings table as stored."
        : "DTU or citation tables are missing or unreadable.",
    };
  }
  const { ok, ...rest } = read;
  return { ok, status: 200, action, ...rest };
}
