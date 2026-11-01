// Readings for the world sim routes that used to ship a fixed population,
// a fake NATS bus, and a plugin store with made-up install counts.
// A missing table or an unmeasured counter stays null with a reason.
// A zero from a real query is a real zero.

import { runDistrictStressTest, loadStandingBuildings } from "../domains/world.js";
import { listDistrictSnapshots } from "../domains/district.js";
import { listGallery } from "./plugin-gallery.js";
import { readOwnBuildings, readOwnCitations, readOwnListings, readOwnRoyalties } from "./sim-stats.js";
import { recentEvents, unregisteredEventStats } from "./runtime/event-bus.js";
import { stats as eventTimelineStats } from "./event-timeline.js";
import { getPoolStats as getMacroPoolStats } from "../workers/macro-pool.js";
import { getPoolStats as getHeartbeatPoolStats } from "../workers/heartbeat-pool.js";
import { podJobs } from "./pod-jobs.js";
import { podJobsEnabled } from "../routes/pod-jobs.js";
import { runLensAction, lensErrorStatus } from "./sim-lens-bridge.js";

// runtime/event-bus.js keeps its last 500 events (RECENT_MAX); asking for
// that many returns the whole ring.
const RECENT_RING_MAX = 500;

const TABLES = new Set(["worlds", "world_buildings", "dtus", "dtu_citations", "economy_ledger", "districts"]);
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
    const rows = db.prepare("SELECT name FROM pragma_table_info(?)").all(table);
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

// Admin-only readings of the in-process runtime. Every dependency is
// injectable so tests can exercise the "not initialised" paths; the defaults
// are the live singletons server.js already runs.
export function readEventBusStatus({
  db = null,
  getRealtimeClients = null,
  bus = { recentEvents, unregisteredEventStats },
  timeline = eventTimelineStats,
} = {}) {
  const ring = bus.recentEvents(RECENT_RING_MAX);
  const perType = new Map();
  for (const ev of ring) perType.set(ev.name, (perType.get(ev.name) || 0) + 1);
  const ringChannels = [...perType.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  // recentEvents() is newest-first.
  const newestTs = ring.length ? ring[0].ts : null;
  const oldestTs = ring.length ? ring[ring.length - 1].ts : null;

  let clients = null;
  let clientsReason = "realtime_not_attached";
  if (typeof getRealtimeClients === "function") {
    try {
      const n = getRealtimeClients();
      if (Number.isInteger(n)) { clients = n; clientsReason = null; }
      else clientsReason = "socket_server_not_started";
    } catch {
      clientsReason = "socket_server_unreadable";
    }
  }

  let timelineSection = { available: false, reason: "no_database" };
  if (db) {
    const t = timeline(db);
    timelineSection = t?.ok
      ? {
          available: true,
          source: "event_timeline_log",
          window: "last_24h",
          sinceTs: t.sinceTs,
          total: t.total,
          channels: t.channels,
        }
      : { available: false, reason: t?.reason || "stats_failed" };
  }

  return {
    ok: true,
    provider: "in-process",
    runtimeBus: {
      window: "recent_ring",
      ringCapacity: RECENT_RING_MAX,
      eventsInRing: ring.length,
      oldestTs,
      newestTs,
      channels: ringChannels,
      unregisteredEvents: bus.unregisteredEventStats(50),
      unregisteredWindow: "since_start",
    },
    timeline: timelineSection,
    connectedClients: clients,
    connectedClientsReason: clientsReason,
    consumers: null,
    consumersReason: "not_measured_by_in_process_bus",
    lagMs: null,
    lagMsReason: "not_measured_by_in_process_bus",
    deadLetter: null,
    deadLetterReason: "no_dead_letter_queue_in_process_bus",
    checkedAt: new Date().toISOString(),
  };
}

function poolSection(getStats) {
  let s;
  try { s = getStats(); } catch { return { initialised: false, reason: "stats_unreadable" }; }
  if (!s?.ready) return { initialised: false, reason: "pool_not_started" };
  return { initialised: true, window: "since_start", ...s };
}

export function readJobQueueStatus({
  macroStats = getMacroPoolStats,
  heartbeatStats = getHeartbeatPoolStats,
  podEnabled = podJobsEnabled,
  podStats = () => podJobs.stats(),
} = {}) {
  let podSection = { enabled: false, reason: "CONCORD_POD_JOBS_not_enabled" };
  if (podEnabled()) {
    try {
      podSection = { enabled: true, window: "since_start", ...podStats() };
    } catch {
      podSection = { enabled: true, reason: "stats_unreadable" };
    }
  }
  return {
    ok: true,
    provider: "in-process",
    macroPool: poolSection(macroStats),
    heartbeatPool: poolSection(heartbeatStats),
    podJobs: podSection,
    checkedAt: new Date().toISOString(),
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
  if (columns(db, "districts")) {
    concordia.districts = count(db, "SELECT COUNT(*) AS n FROM districts");
    delete concordia.districtsReason;
  }
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

const TIMELINE_MAX = 500;

// Real recorded snapshots (domains/district.js store, written by the
// district-snapshot heartbeat and the district.snapshot-record action),
// oldest -> newest. power / water / environmentalScore are not recorded
// anywhere, so they stay null with a reason. activeUsers is null on
// heartbeat snapshots (not measured there).
export function readDistrictTimeline(districtId, { limit } = {}) {
  const id = String(districtId || "").slice(0, 80);
  if (!id) return { ok: false, status: 400, error: "district_required" };
  const lim = Number(limit);
  const cap = Number.isFinite(lim) && lim > 0 ? Math.min(Math.floor(lim), TIMELINE_MAX) : TIMELINE_MAX;
  const listed = listDistrictSnapshots(id, { limit: cap });
  if (!listed.ok) {
    return { ok: false, status: 500, error: "unavailable", reason: "snapshot_store_error" };
  }
  const snapshots = listed.result.snapshots;
  const body = {
    ok: true,
    districtId: id,
    snapshots,
    count: snapshots.length,
    power: null,
    powerReason: "not_recorded: no power telemetry is stored per district snapshot",
    water: null,
    waterReason: "not_recorded: no water telemetry is stored per district snapshot",
    environmentalScore: null,
    environmentalScoreReason: "not_recorded: no environmental score is stored per district snapshot",
  };
  if (!snapshots.length) body.reason = "no_snapshots_recorded_yet";
  return body;
}

export function readStressTest(db, body = {}) {
  const worldId = String(body?.districtId || body?.worldId || "").slice(0, 80);
  if (!worldId) return { ok: false, status: 400, error: "district_required" };
  if (!db) return { ok: false, status: 503, error: "unavailable", reason: "no_database", message: "No database is connected." };
  let rows;
  try {
    rows = loadStandingBuildings(db, worldId);
  } catch {
    return {
      ok: false, status: 503, error: "unavailable", reason: "no_building_table",
      missing: "The world_buildings table (with material, floors and health_pct columns) is not present.",
    };
  }
  if (!rows.length) {
    return { ok: false, status: 404, error: "no_standing_buildings", districtId: worldId, message: "No standing buildings are stored for this world id." };
  }
  const out = runDistrictStressTest(rows, String(body?.scenario || ""), body?.magnitude);
  if (!out.ok) return { ok: false, status: 400, error: "invalid_stress_input", message: out.error };
  return { ok: true, districtId: worldId, ...out.result };
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

function publicPlugin(p) {
  return {
    pluginId: p.pluginId,
    name: p.name,
    description: p.description ?? "",
    version: p.version,
    authorId: p.authorId,
    trusted: !!p.trusted,
    trustDescription: p.trustDescription ?? null,
    installs: Number(p.installs) || 0,
    rating: p.rating ?? { up: 0, down: 0 },
    publishedAt: p.publishedAt ?? null,
    declaredCapabilities: p.declaredCapabilities ?? [],
  };
}

// Catalog = plugin_gallery rows (migration 085/393) that are not delisted,
// overlaid by the live in-memory gallery. Source code, signature and hash
// are never returned.
export function readPluginCatalog(db) {
  const byId = new Map();
  let dbReason = null;
  if (db) {
    try {
      const cols = new Set(db.prepare("PRAGMA table_info(plugin_gallery)").all().map((c) => c.name));
      if (!cols.size) {
        dbReason = "no_plugin_gallery_table";
      } else {
        const where = cols.has("delisted_at") ? "WHERE delisted_at IS NULL" : "";
        const rows = db.prepare(`SELECT plugin_id, author_id, name, description, version, trusted, installs, upvotes, downvotes, published_at FROM plugin_gallery ${where} ORDER BY installs DESC LIMIT 200`).all();
        for (const r of rows) {
          byId.set(r.plugin_id, {
            pluginId: r.plugin_id, authorId: r.author_id, name: r.name, description: r.description,
            version: r.version, trusted: !!r.trusted, installs: Number(r.installs) || 0,
            rating: { up: Number(r.upvotes) || 0, down: Number(r.downvotes) || 0 },
            publishedAt: r.published_at,
          });
        }
      }
    } catch {
      dbReason = "plugin_gallery_read_failed";
    }
  } else {
    dbReason = "no_database";
  }
  for (const p of listGallery({ limit: 200 }).plugins) byId.set(p.pluginId, p);
  const plugins = [...byId.values()].map(publicPlugin).sort((a, b) => b.installs - a.installs);
  const body = { ok: true, plugins, total: plugins.length, source: "plugin_gallery" };
  if (dbReason) body.unavailable = { databaseRows: dbReason };
  return body;
}

export function readInstalledPlugins() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "no_per_user_install_record",
    missing: "Per-user installs are held only in the plugin gallery's in-memory roster, which has no read API. The plugin_installs table is not written by any code path.",
  };
}

export function readPluginInstallWrite() {
  return {
    ok: false,
    status: 501,
    error: "not_wired",
    reason: "install_needs_sandbox_runtime",
    missing: "The sandboxed plugin installer (installFromGallery, needing the server's STATE and macro registry) was not provided to the world routes, so no install is recorded.",
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

const READ_ACTIONS = new Set(["check-builds", "view-citations", "view-marketplace", "view-royalties"]);
const WIRED_ACTIONS = ["manage-inventory", "quick-chat", "toggle-notifications"];
const READ_OPS = new Set(["get", "read", "view", "list"]);
const QUICK_CHAT_MAX = 4000;
// Per-user send limit for quick-chat (sliding window, in memory per process).
export const QUICK_CHAT_RATE = { max: 10, windowMs: 60_000 };
const _quickChatSends = new Map(); // userId -> [timestamps]
let _qcNow = () => Date.now();
export function __resetQuickChatRateForTests({ now } = {}) {
  _quickChatSends.clear();
  _qcNow = typeof now === "function" ? now : () => Date.now();
}
function quickChatAllowed(userId) {
  const t = _qcNow();
  const recent = (_quickChatSends.get(userId) || []).filter((x) => t - x < QUICK_CHAT_RATE.windowMs);
  if (recent.length >= QUICK_CHAT_RATE.max) {
    _quickChatSends.set(userId, recent);
    return { ok: false, retryAfterMs: QUICK_CHAT_RATE.windowMs - (t - recent[0]) };
  }
  recent.push(t);
  _quickChatSends.set(userId, recent);
  if (_quickChatSends.size > 5000) _quickChatSends.delete(_quickChatSends.keys().next().value);
  return { ok: true };
}

// Sends text to a DM through the message lens action, so validation and
// persistence are the ones the message lens uses. Finds the caller's existing DM
// with the recipient, or creates it with channels-create.
function quickChat(db, userId, body) {
  const fail = (status, error, extra = {}) => ({ ok: false, status, error, action: "quick-chat", ...extra });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "empty_text");
  if (text.length > QUICK_CHAT_MAX) return fail(400, "text_too_long", { max: QUICK_CHAT_MAX });
  const to = typeof body?.toUserId === "string" ? body.toUserId.trim() : "";
  if (!to) return fail(400, "recipient_required");
  const me = String(userId);
  if (to === me) return fail(400, "cannot_message_self");
  if (!db) return fail(501, "not_wired", { reason: "no_database" });
  const rl = quickChatAllowed(me);
  if (!rl.ok) return fail(429, "rate_limited", { retryAfterMs: rl.retryAfterMs, limit: QUICK_CHAT_RATE.max, windowMs: QUICK_CHAT_RATE.windowMs });
  let known;
  try {
    known = db.prepare("SELECT 1 AS n FROM users WHERE id = ?").get(to);
  } catch {
    return fail(501, "not_wired", { reason: "no_user_table" });
  }
  if (!known) return fail(404, "recipient_not_found");

  const list = runLensAction("message", "channels-list", userId, {});
  if (!list.ok) return fail(lensErrorStatus(list), list.error);
  let channel = (list.result?.channels || []).find((c) => {
    if (c.kind !== "dm" || c.archived || !Array.isArray(c.participants) || c.participants.length !== 2) return false;
    const members = c.participants.map(String);
    return members.includes(to) && members.includes(me);
  });
  if (!channel) {
    const made = runLensAction("message", "channels-create", userId, {
      name: `dm-${[me, to].sort().join("-")}`,
      kind: "dm",
      participants: [to],
    });
    if (!made.ok) return fail(lensErrorStatus(made), made.error);
    channel = made.result.channel;
  }
  const sent = runLensAction("message", "messages-send", userId, { channelId: channel.id, body: text });
  if (!sent.ok) return fail(lensErrorStatus(sent), sent.error);
  return { ok: true, status: 200, action: "quick-chat", channelId: channel.id, message: sent.result.message };
}

// Read-only inventory view with the shape of world.inventory-get. Add, remove
// and equip belong to the full world UI and are refused here.
function manageInventory(userId, body) {
  const op = body?.op ?? body?.operation ?? body?.mode;
  const writeKeys = ["itemId", "item", "slot", "quantity"].some((k) => body?.[k] !== undefined);
  if (writeKeys || (op !== undefined && !READ_OPS.has(String(op).toLowerCase()))) {
    return {
      ok: false,
      status: 400,
      error: "read_only",
      action: "manage-inventory",
      message: "Mobile shows the inventory only. Add, remove and equip are done in the world.",
    };
  }
  const inv = runLensAction("world", "inventory-get", userId, {});
  if (!inv.ok) return { ok: false, status: lensErrorStatus(inv), error: inv.error, action: "manage-inventory" };
  return { ok: true, status: 200, action: "manage-inventory", ...inv.result };
}

// Answers quick actions for the signed-in caller. Reads come from stored rows;
// chat and inventory delegate to the message and world lens actions.
export function runQuickAction(db, userId, body) {
  if (!userId) return { ok: false, status: 401, error: "sign_in_required" };
  const action = typeof body?.action === "string" ? body.action : "";
  if (!READ_ACTIONS.has(action) && !WIRED_ACTIONS.includes(action)) {
    return {
      ok: false,
      status: 400,
      error: "unknown_action",
      action: action.slice(0, 40),
      allowed: [...READ_ACTIONS, ...WIRED_ACTIONS],
    };
  }
  if (action === "quick-chat") return quickChat(db, userId, body);
  if (action === "manage-inventory") return manageInventory(userId, body);
  if (action === "toggle-notifications") {
    return {
      ok: false,
      status: 410,
      error: "retired",
      action,
      use: "companion.push-prefs-set",
      message: "Notification settings are saved per account by companion push-prefs-set; this route does not change them.",
    };
  }
  const read = action === "check-builds" ? readOwnBuildings(db, userId)
    : action === "view-citations" ? readOwnCitations(db, userId)
    : action === "view-marketplace" ? readOwnListings(db, userId)
    : readOwnRoyalties(db, userId);
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
        : action === "view-marketplace"
          ? "Marketplace listings table is missing or unreadable."
          : action === "view-royalties"
            ? "Economy ledger is missing or unreadable."
            : "DTU or citation tables are missing or unreadable.",
    };
  }
  const { ok, ...rest } = read;
  return { ok, status: 200, action, ...rest };
}
