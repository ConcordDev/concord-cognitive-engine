// server/emergent/feed.js
// Activity feed for emergent visibility. Persists events to DB and broadcasts via realtimeEmit.

import crypto from "node:crypto";

export const FEED_EVENT_TYPES = Object.freeze({
  emergence:        "New emergent has emerged",
  naming:           "Emergent has been named",
  artifact_created: "Emergent created an artifact",
  observation:      "Emergent recorded an observation",
  communication:    "Emergents communicated",
  deliberation:     "Emergent participated in governance",
  dream:            "Emergent dreamed",
  task_completed:   "Emergent completed a task",
  task_failed:      "Emergent task failed",
});

// Shutdown gate. gracefulShutdown used to close SQLite from the first
// registered callback while minor-agent ticks and feed-manager polls were
// still in flight. Those ticks await a brain call, then emitFeedEvent, so
// the INSERT landed on a handle better-sqlite3 had already closed
// ("The database connection is not open") and the row was dropped.
// shutdownFeedPersistence() seals this after the bounded drain; a late
// emit must not call prepare() on that handle.
let _feedSealed = false;
let _feedDropped = 0;
let _feedSkipWarned = false;
let _feedSkipScheduled = false;
let _feedSkipReason = "shutdown";

/** @type {Set<Promise<unknown>>} in-flight feed jobs (agent ticks, ingest polls) */
const _feedJobs = new Set();

function dbHandleOpen(db) {
  return !!db && db.open !== false;
}

function warnFeedWriteLoss(count, reason) {
  if (_feedSkipWarned || count <= 0) return;
  _feedSkipWarned = true;
  console.warn(`[feed] DB write skipped: ${count} feed event(s) not persisted (${reason})`);
}

function noteFeedWriteSkipped(reason) {
  _feedDropped++;
  _feedSkipReason = reason;
  if (_feedSkipWarned || _feedSkipScheduled) return;
  _feedSkipScheduled = true;
  // Coalesce a burst (the three late ticks seen on every restart) into one line.
  queueMicrotask(() => {
    _feedSkipScheduled = false;
    warnFeedWriteLoss(_feedDropped, _feedSkipReason);
  });
}

/**
 * Track an async feed job so shutdown can wait for its DB write.
 * The tracked promise settles when `work` does; it never rejects.
 * @param {Promise<unknown>} work
 */
export function trackFeedJob(work) {
  const tracked = Promise.resolve(work).finally(() => {
    _feedJobs.delete(tracked);
  });
  _feedJobs.add(tracked);
  return tracked;
}

export function feedWriteStats() {
  return { dropped: _feedDropped, sealed: _feedSealed, pendingJobs: _feedJobs.size };
}

// How many already-queued microtasks we'll let run while a feed job is
// still pending. A job that is one or two `await`s from its INSERT finishes
// here. A job blocked on a timer or socket does not: waiting for it with
// setTimeout queues behind any stall already on the macrotask queue, and
// that stall runs to completion before the deadline callback. Measured
// (Node 22): a 50ms budget took 700ms when a 400ms busy-loop was queued
// first, and db.close never ran. Microtasks run before that queue, so the
// caller can close the database on this turn.
const FEED_DRAIN_IDLE_SPINS = 32;

async function pumpMicrotasks(deadline, isDone) {
  let idle = 0;
  let spins = 0;
  // `spins` is the hard cap. Idle resets when a job finishes so a short
  // await-chain can land, but the cap still stops a job that keeps
  // scheduling more microtasks from burning the whole timeoutMs.
  while (!isDone() && Date.now() < deadline && idle < FEED_DRAIN_IDLE_SPINS && spins < FEED_DRAIN_IDLE_SPINS) {
    spins += 1;
    const pendingBefore = _feedJobs.size;
    await Promise.resolve();
    if (isDone()) return;
    if (Date.now() >= deadline) return;
    if (_feedJobs.size < pendingBefore) idle = 0;
    else idle += 1;
  }
}

async function drainFeedJobs(timeoutMs) {
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const deadline = Date.now() + budget;
  await pumpMicrotasks(deadline, () => _feedJobs.size === 0);
  return { drained: _feedJobs.size === 0, pending: _feedJobs.size };
}

/**
 * Stop new feed work, give in-flight jobs one microtask window to write,
 * then seal the writer. Call this before db.close().
 *
 * `timeoutMs` is a wall-clock cap on that window, not a timer wait. Jobs
 * still blocked on I/O when the cap (or the idle-spin limit) hits are
 * counted in one warning and must not touch the handle afterwards — waiting
 * on the event loop lets an in-flight heartbeat stall run first, and launchd
 * bootout SIGKILLs a user agent in about 5s (a plist ExitTimeOut can raise
 * that; this path does not depend on it).
 * @param {{ stopNewWork?: () => unknown, timeoutMs?: number }} [opts]
 */
export async function shutdownFeedPersistence({ stopNewWork, timeoutMs = 2000 } = {}) {
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 2000;
  const deadline = Date.now() + budget;
  try {
    const stop = stopNewWork?.();
    if (stop && typeof stop.then === "function") {
      let failed = null;
      let settled = false;
      Promise.resolve(stop).then(
        () => { settled = true; },
        (err) => { settled = true; failed = err; },
      );
      await pumpMicrotasks(deadline, () => settled);
      if (failed) throw failed;
    }
  } catch (e) {
    console.warn("[feed] failed to stop new feed work:", e?.message);
  }
  const drain = await drainFeedJobs(Math.max(0, deadline - Date.now()));
  _feedSealed = true;
  if (!drain.drained) {
    warnFeedWriteLoss(Math.max(drain.pending, _feedDropped), `shutdown timeout ${timeoutMs}ms`);
  }
  return { ...drain, dropped: _feedDropped, sealed: true };
}

/** Test-only. Production shutdown does not reopen the writer. */
export function resetFeedShutdownForTests() {
  _feedSealed = false;
  _feedDropped = 0;
  _feedSkipWarned = false;
  _feedSkipScheduled = false;
  _feedSkipReason = "shutdown";
  _feedJobs.clear();
}

/**
 * Emit a feed event: persist to DB + broadcast via WebSocket.
 *
 * @param {{
 *   type: string,
 *   emergentId?: string,
 *   emergent?: object,
 *   data: object
 * }} event
 * @param {object} db - better-sqlite3
 * @param {Function} realtimeEmit - from server.js
 */
export function emitFeedEvent(event, db, realtimeEmit) {
  const id = `evt_${crypto.randomBytes(6).toString("hex")}`;
  const now = Date.now();
  const emergentId = event.emergentId || event.emergent?.id || null;

  // Persist to DB. Skip the prepare entirely once shutdown has sealed the
  // writer or the handle is already closed — attempting it throws
  // "The database connection is not open" and the row is lost.
  if (db) {
    if (_feedSealed || !dbHandleOpen(db)) {
      noteFeedWriteSkipped(_feedSealed ? "shutdown" : "database connection is not open");
    } else {
      try {
        db.prepare(`
          INSERT INTO emergent_activity_feed (id, emergent_id, event_type, event_data, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, emergentId, event.type, JSON.stringify(event.data || {}), now);
      } catch (e) {
        const msg = e?.message || String(e);
        if (_feedSealed || /not open/i.test(msg)) noteFeedWriteSkipped(msg);
        else console.error("[feed] DB write failed:", msg);
      }
    }
  }

  // Broadcast via realtimeEmit (Socket.IO / native WS)
  if (typeof realtimeEmit === "function") {
    try {
      realtimeEmit("emergent:activity", {
        id,
        type: event.type,
        emergent: event.emergent || null,
        data: event.data || {},
        timestamp: now,
      });
    } catch (e) {
      console.error("[feed] realtimeEmit failed:", e?.message);
    }
  }

  return { id, type: event.type, timestamp: now };
}

/**
 * Fetch recent feed events from DB.
 * @param {object} db
 * @param {{ limit?: number, emergentId?: string, since?: number }} opts
 * @returns {object[]}
 */
export function getFeedEvents(db, { limit = 50, emergentId, since } = {}) {
  if (!db) return [];
  try {
    // @select-star-ok: emergent_activity_feed admin list — caller renders every column
    let sql = "SELECT * FROM emergent_activity_feed";
    const args = [];
    const clauses = [];
    if (emergentId) { clauses.push("emergent_id = ?"); args.push(emergentId); }
    if (since) { clauses.push("created_at > ?"); args.push(since); }
    if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT ?";
    args.push(limit);
    return db.prepare(sql).all(...args).map(row => ({
      ...row,
      data: (() => { try { return JSON.parse(row.event_data); } catch { return {}; } })(),
    }));
  } catch { return []; }
}
