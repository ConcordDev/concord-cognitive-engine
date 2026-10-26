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
import { getHeapLimitMB, getMemorySnapshot } from "./heap-limit.js";

const POLL_INTERVAL_MS = 15_000;
// G2.3 / INC-149 — the ceiling is V8's real heap_size_limit (which reflects
// --max-old-space-size). The old env-var default (32 GB when unset) made the
// watchdog believe a 3 GB process had 32 GB, so it never shed before the OOM.
// MAX_OLD_SPACE_SIZE can only LOWER the limit (see lib/heap-limit.js).
const HEAP_LIMIT_MB = getHeapLimitMB();
const WARN_RATIO = 0.70;
const SHED_RATIO = 0.80;
const CRITICAL_RATIO = 0.90;

// Session age threshold for eviction under pressure (1 hour)
const SESSION_EVICT_AGE_MS = 60 * 60 * 1000;

const RESTART_RATIO = 0.95;
const RESTART_AFTER_TICKS = 8; // 8 × 15 s ≈ 2 min
const AUTO_RESTART = process.env.CONCORD_MEM_AUTORESTART !== "0";
let _restartStreak = 0;
let _restartRequested = false;

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

// INC-149: a census line every ~10 min (40 watchdog ticks) so heap growth is
// visible in backend.log with the sizes of the biggest STATE collections —
// enough to see WHICH store grows between restarts without a heap snapshot.
const CENSUS_EVERY_TICKS = Number(process.env.CONCORD_MEM_CENSUS_TICKS) || 40;
let _censusTick = 0;
function _sizeOf(v) {
  if (!v || typeof v !== "object") return 0;
  if (v instanceof Map || v instanceof Set) return v.size;
  if (Array.isArray(v)) return v.length;
  return 0;
}
export function memoryCensus(STATE, top = 10) {
  const sizes = [];
  if (STATE && typeof STATE === "object") {
    for (const k of Object.keys(STATE)) {
      let v; try { v = STATE[k]; } catch { continue; }
      const n = _sizeOf(v);
      if (n > 0) sizes.push([k, n]);
      if (v && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v)) {
        let keys; try { keys = Object.keys(v); } catch { keys = []; }
        if (keys.length <= 64) {
          for (const k2 of keys) { const n2 = _sizeOf(v[k2]); if (n2 > 0) sizes.push([`${k}.${k2}`, n2]); }
        }
      }
    }
  }
  sizes.sort((a, b) => b[1] - a[1]);
  return { ...getMemorySnapshot(), top: Object.fromEntries(sizes.slice(0, top)) };
}

function _tick(STATE) {
  if (++_censusTick >= CENSUS_EVERY_TICKS) {
    _censusTick = 0;
    try { logger.log("info", "lib", "memory_census", memoryCensus(STATE)); } catch { /* diagnostic only */ }
  }
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

  // INC-149: if eviction + GC can't pull the heap back and it sits at >=95% of
  // the real limit for ~2 min, restart cleanly (SIGTERM → the normal graceful
  // shutdown that saves state; launchd KeepAlive brings it back) instead of a
  // V8 "heap out of memory" abort that loses in-flight writes.
  if (ratio >= RESTART_RATIO) {
    _restartStreak++;
    if (_restartStreak >= RESTART_AFTER_TICKS && AUTO_RESTART && !_restartRequested) {
      _restartRequested = true;
      logger.log("error", "lib", "memory_critical_restart", { heapUsedMB: Math.round(heapUsedMB), heapLimitMB: HEAP_LIMIT_MB, ratio: Math.round(ratio * 100) });
      try { process.kill(process.pid, "SIGTERM"); } catch { /* best effort */ }
    }
  } else {
    _restartStreak = 0;
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

// Exported for testing the watchdog's LRU map-trim (G2.2). Safe to call
// directly; it's the same routine the watchdog runs under critical pressure.
export function _aggressiveEviction(STATE) {
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
    // G2.2 fix — STATE.shadowDtus had a documented cap (CONCORD_MAX_SHADOWS,
    // default 50000) that was only enforced inside the ShadowGraph class, not
    // on the raw STATE.shadowDtus Map that the social-NPC bridge + context
    // engine .set() into unboundedly → OOM/scale risk. The watchdog now
    // LRU-trims it like every other unbounded Map.
    ["shadowDtus", Number(process.env.CONCORD_MAX_SHADOWS) || 50000],
    // STATE.qualia — the QualiaEngine's per-entity store (`get _store()` in
    // server/existential/engine.js). Each state's HISTORY is bounded
    // (HISTORY_MAX=50), but the NUMBER of states was uncapped — the last
    // unbounded Map in this list, at OOM/scale risk since the qualia hooks
    // (hookDTUCreation / hookDreamSynthesis / hookAutogen) create a state per
    // entity under high-volume interaction. LRU-trim it like the rest; the
    // engine returns `entity_not_found`/null for an evicted id and recreates it
    // on the next hook, so eviction is safe (the hooks are fire-and-forget).
    ["qualia", Number(process.env.CONCORD_MAX_QUALIA_STATES) || 50000],
    // Idle-heap-leak audit (2026-07-25) — a read-only durability audit found
    // ~20 STATE maps absent from this cap list. Each was verified against its
    // writers before deciding; most turned out to hold irreplaceable user/
    // governance data (STATE.dtus, wrappers, layers, personas, users, orgs,
    // apiKeys, papers, lensArtifacts, userUniverses, entities, assessments,
    // wallets, councilVotes, globalIndex — see docs note below) and are
    // deliberately NOT added here. Two genuinely are rebuildable/discardable
    // telemetry with no correctness dependency on their contents surviving:
    //
    // STATE.mlJobs — synchronous ML request tracking records (`/api/ml/infer`,
    // `/api/ml/train`, server.js#ensureMlState). Every result is already
    // returned to the caller in the HTTP response; the Map entry is only a
    // historical "this ran" record, exactly the same shape as STATE.jobs
    // (which this file already prunes above by completed/failed status).
    // Evicting the oldest entries loses only that history, never in-flight
    // work.
    ["mlJobs", Number(process.env.CONCORD_MAX_ML_JOBS) || 5000],
    // STATE.notifications — user-facing notification records
    // (server.js /api/notifications*). Already has a ONE-TIME boot trim to
    // 2000 entries (`_capMap(STATE.notifications, 2000)` right after STATE
    // loads) — i.e. the codebase already decided 2000 is an acceptable
    // ceiling for this field; that trim just never recurs after boot. This
    // makes the same decision ongoing instead of one-shot, at the same
    // threshold.
    ["notifications", Number(process.env.CONCORD_MAX_NOTIFICATIONS) || 2000],
    // STATE._rateLimits — per-user rolling call-timestamp windows for
    // `checkRateLimit()` (server.js, "#85: RATE LIMITER & COST GOVERNOR").
    // Already has its own periodic sweep (kernelTick, every 2000 ticks) that
    // deletes entries whose `calls` array has aged out entirely, but that
    // sweep only removes *empty* entries — it never bounds the number of
    // distinct users tracked. Evicting the oldest-seen entries here just
    // resets that user's rate-limit window early (fail-open on throttling
    // strictness, not a data-loss or auth bug), so it's safe to LRU-trim as a
    // hard ceiling under memory pressure.
    ["_rateLimits", Number(process.env.CONCORD_MAX_RATE_LIMIT_ENTRIES) || 10000],
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
