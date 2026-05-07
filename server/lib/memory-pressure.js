/**
 * Memory Pressure Watchdog
 *
 * Monitors heap usage and takes progressive shedding actions to prevent OOM.
 * Thresholds are relative to --max-old-space-size (default 3584MB via PM2).
 *
 * Levels:
 *   normal  (<70%)  — no action
 *   warn    (70-80%) — log warning, force GC if available
 *   shed    (80-90%) — evict old sessions, pause background work
 *   critical (>90%) — aggressive eviction, prepare for graceful restart
 */

import logger from "../logger.js";

const POLL_INTERVAL_MS = 15_000;
const HEAP_LIMIT_MB = Number(process.env.MAX_OLD_SPACE_SIZE || 3584);
const WARN_RATIO = 0.70;
const SHED_RATIO = 0.80;
const CRITICAL_RATIO = 0.90;

// Session age threshold for eviction under pressure (1 hour)
const SESSION_EVICT_AGE_MS = 60 * 60 * 1000;

let _level = "normal";
let _timer = null;
let _lastGcAt = 0;

/**
 * @returns {"normal"|"warn"|"shed"|"critical"}
 */
export function getMemoryPressureLevel() {
  return _level;
}

/**
 * Initialize the memory watchdog. Call once after STATE is ready.
 * @param {object} STATE - global state object
 * @returns {{ stop: () => void }}
 */
export function initMemoryWatchdog(STATE) {
  if (_timer) clearInterval(_timer);

  _timer = setInterval(() => {
    try {
      _tick(STATE);
    } catch (e) {
      logger.log("warn", "lib", "memory_watchdog_error", { error: e?.message });
    }
  }, POLL_INTERVAL_MS);

  // Don't block process exit
  if (_timer.unref) _timer.unref();

  logger.log("info", "lib", "memory_watchdog_started", { heapLimitMB: HEAP_LIMIT_MB });

  return {
    stop() {
      if (_timer) { clearInterval(_timer); _timer = null; }
    }
  };
}

function _tick(STATE) {
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / (1024 * 1024);
  const ratio = heapUsedMB / HEAP_LIMIT_MB;
  const prevLevel = _level;

  if (ratio >= CRITICAL_RATIO) {
    _level = "critical";
  } else if (ratio >= SHED_RATIO) {
    _level = "shed";
  } else if (ratio >= WARN_RATIO) {
    _level = "warn";
  } else {
    _level = "normal";
  }

  // Log on level change
  if (_level !== prevLevel) {
    logger.log(_level === "normal" ? "info" : "warn", "lib", "memory_pressure_change", {
      from: prevLevel,
      to: _level,
      heapUsedMB: Math.round(heapUsedMB),
      heapLimitMB: HEAP_LIMIT_MB,
      ratio: Math.round(ratio * 100),
    });
  }

  // Actions by level
  if (_level === "warn" || _level === "shed" || _level === "critical") {
    _tryGC();
  }

  if (_level === "shed" || _level === "critical") {
    _evictOldSessions(STATE);
    _pauseBackgroundWork(STATE);
  }

  if (_level === "critical") {
    _aggressiveEviction(STATE);
  }

  // Unpause background work when pressure drops
  if (_level === "normal" && prevLevel !== "normal") {
    _resumeBackgroundWork(STATE);
  }
}

function _tryGC() {
  const now = Date.now();
  // Rate-limit GC to once per 30s
  if (now - _lastGcAt < 30_000) return;
  if (typeof global.gc === "function") {
    global.gc();
    _lastGcAt = now;
    logger.log("info", "lib", "memory_watchdog_gc", { forced: true });
  }
}

function _evictOldSessions(STATE) {
  if (!STATE?.sessions || typeof STATE.sessions.forEach !== "function") return;

  const now = Date.now();
  let evicted = 0;

  STATE.sessions.forEach((session, id) => {
    const age = now - (session.createdAt || session.startedAt || 0);
    if (age > SESSION_EVICT_AGE_MS) {
      STATE.sessions.delete(id);
      // Clean up orphaned styleVectors for this session
      if (STATE.styleVectors && typeof STATE.styleVectors.delete === "function") {
        STATE.styleVectors.delete(id);
      }
      evicted++;
    }
  });

  if (evicted > 0) {
    logger.log("info", "lib", "memory_watchdog_session_evict", { evicted });
  }
}

function _pauseBackgroundWork(STATE) {
  if (!STATE?.settings) return;
  if (!STATE._memoryPausedFeatures) {
    STATE._memoryPausedFeatures = {};
    const features = ["autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled", "heartbeatEnabled"];
    for (const f of features) {
      if (STATE.settings[f] === true) {
        STATE._memoryPausedFeatures[f] = true;
        STATE.settings[f] = false;
      }
    }
    if (Object.keys(STATE._memoryPausedFeatures).length > 0) {
      logger.log("warn", "lib", "memory_watchdog_paused_background", {
        paused: Object.keys(STATE._memoryPausedFeatures),
      });
    }
  }
}

function _resumeBackgroundWork(STATE) {
  if (!STATE?.settings || !STATE._memoryPausedFeatures) return;
  for (const [f, was] of Object.entries(STATE._memoryPausedFeatures)) {
    if (was) STATE.settings[f] = true;
  }
  logger.log("info", "lib", "memory_watchdog_resumed_background", {
    resumed: Object.keys(STATE._memoryPausedFeatures),
  });
  delete STATE._memoryPausedFeatures;
}

function _aggressiveEviction(STATE) {
  // Evict ALL sessions older than 10 minutes under critical pressure
  if (!STATE?.sessions || typeof STATE.sessions.forEach !== "function") return;

  const now = Date.now();
  const SHORT_AGE = 10 * 60 * 1000;
  let evicted = 0;

  STATE.sessions.forEach((session, id) => {
    const age = now - (session.createdAt || session.startedAt || 0);
    if (age > SHORT_AGE) {
      STATE.sessions.delete(id);
      if (STATE.styleVectors && typeof STATE.styleVectors.delete === "function") {
        STATE.styleVectors.delete(id);
      }
      evicted++;
    }
  });

  // Trim crawl queue
  if (STATE.crawlQueue?.length > 0) {
    const trimmed = STATE.crawlQueue.length;
    STATE.crawlQueue.length = 0;
    logger.log("warn", "lib", "memory_watchdog_crawl_queue_cleared", { trimmed });
  }

  // Trim logs
  if (STATE.logs?.length > 1000) {
    STATE.logs.splice(0, STATE.logs.length - 500);
  }

  // Trim unbounded queues
  if (STATE.queues?.notifications?.length > 500) {
    STATE.queues.notifications.splice(0, STATE.queues.notifications.length - 200);
  }
  if (STATE.queues?.macroProposals?.length > 200) {
    STATE.queues.macroProposals.splice(0, STATE.queues.macroProposals.length - 100);
  }
  if (STATE.queues?.synthesis?.length > 200) {
    STATE.queues.synthesis.splice(0, STATE.queues.synthesis.length - 100);
  }

  // Trim globalThread queues
  if (STATE.globalThread?.councilQueue?.length > 200) {
    // Keep only pending + most recent 100 resolved
    const pending = STATE.globalThread.councilQueue.filter(s => s.status === "pending");
    const resolved = STATE.globalThread.councilQueue.filter(s => s.status !== "pending").slice(-100);
    STATE.globalThread.councilQueue = [...pending, ...resolved];
  }
  if (STATE.globalThread?.acceptedContributions?.length > 500) {
    STATE.globalThread.acceptedContributions = STATE.globalThread.acceptedContributions.slice(-200);
  }

  // Prune completed/failed jobs
  if (STATE.jobs && typeof STATE.jobs.forEach === "function") {
    const toPrune = [];
    STATE.jobs.forEach((j, id) => {
      if (j && (j.status === "succeeded" || j.status === "failed")) toPrune.push(id);
    });
    for (const id of toPrune) STATE.jobs.delete(id);
    if (toPrune.length > 0) {
      logger.log("warn", "lib", "memory_watchdog_jobs_pruned", { pruned: toPrune.length });
    }
  }

  // Cap large Maps that grow without bound
  const mapCaps = [
    ["sources", 5000],
    ["transactions", 10000],
    ["listings", 5000],
    ["entitlements", 5000],
    ["styleVectors", 500],
  ];
  for (const [field, cap] of mapCaps) {
    const m = STATE[field];
    if (m && typeof m.size === "number" && m.size > cap && typeof m.delete === "function") {
      // Delete oldest entries (Maps iterate in insertion order)
      const excess = m.size - Math.floor(cap * 0.8);
      const iter = m.keys();
      for (let i = 0; i < excess; i++) {
        const k = iter.next();
        if (k.done) break;
        m.delete(k.value);
      }
      logger.log("warn", "lib", `memory_watchdog_${field}_capped`, { before: m.size + excess, after: m.size });
    }
  }

  if (evicted > 0) {
    logger.log("warn", "lib", "memory_watchdog_aggressive_evict", { evicted });
  }
}
