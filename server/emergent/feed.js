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

// stopNewWork is synchronous in production. A stop promise is only given
// this many already-queued microtasks: waiting on it with a timer would
// spend the write budget before drainFeedJobs awaits the INSERT. Idle
// spins are not the write drain. That drain used to be this same pump,
// which returns after 32 turns with the job still in _feedJobs. Bootout
// 2026-10-11 11:02:53Z logged drained=false pending=1 timeoutMs=2000
// ms=1.276, then db.close, and the in-flight feed write was dropped.
const FEED_DRAIN_IDLE_SPINS = 32;

async function pumpMicrotasks(deadlineNs, isDone) {
  let idle = 0;
  let spins = 0;
  while (!isDone() && process.hrtime.bigint() < deadlineNs && idle < FEED_DRAIN_IDLE_SPINS && spins < FEED_DRAIN_IDLE_SPINS) {
    spins += 1;
    const pendingBefore = _feedJobs.size;
    await Promise.resolve();
    if (isDone()) return;
    if (process.hrtime.bigint() >= deadlineNs) return;
    if (_feedJobs.size < pendingBefore) idle = 0;
    else idle += 1;
  }
}

/**
 * Await the promises in `_feedJobs` until each has settled or `timeoutMs`
 * has elapsed on a monotonic clock. `drained` is false only when that
 * deadline passed with a job still pending — never because the microtask
 * queue went idle. One deadline timer. If it fires before `hrtime` reaches
 * the deadline, the remainder is waited once; a late wake does not arm
 * another wait. A synchronous stall already queued on the macrotask queue
 * still runs before the timer (same thread), so elapsed can include it.
 * @param {number} timeoutMs
 */
async function drainFeedJobs(timeoutMs) {
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const deadlineNs = process.hrtime.bigint() + BigInt(Math.round(budget * 1e6));
  if (_feedJobs.size === 0) return { drained: true, pending: 0 };
  if (process.hrtime.bigint() >= deadlineNs) {
    return { drained: false, pending: _feedJobs.size };
  }

  let timer = null;
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, budget);
  });
  try {
    while (_feedJobs.size > 0 && !timedOut) {
      // Snapshot so a job that starts another tracked job during this wait
      // is picked up on the next turn, still under the same deadline.
      await Promise.race([Promise.allSettled([..._feedJobs]), timeout]);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (_feedJobs.size > 0 && process.hrtime.bigint() < deadlineNs) {
    const leftMs = Number(deadlineNs - process.hrtime.bigint()) / 1e6;
    if (leftMs > 0) {
      await Promise.race([
        Promise.allSettled([..._feedJobs]),
        new Promise((resolve) => { timer = setTimeout(resolve, leftMs); }),
      ]);
      if (timer) clearTimeout(timer);
    }
  }

  const pending = _feedJobs.size;
  return { drained: pending === 0, pending };
}

/**
 * Stop new feed work, wait for in-flight feed writes, then seal the writer.
 * Call this before db.close().
 *
 * `timeoutMs` is a monotonic cap (`process.hrtime`) on that wait. The drain
 * awaits the tracked job promises. It reports drained=false only when that
 * deadline has passed and a write is still pending. A job that settles
 * inside the cap is persisted before this function returns, so the caller's
 * db.close runs after the row. A job still pending at the deadline is one
 * warning (pending count and elapsed ms) and must not call prepare() after
 * the seal.
 * @param {{ stopNewWork?: () => unknown, timeoutMs?: number }} [opts]
 */
export async function shutdownFeedPersistence({ stopNewWork, timeoutMs = 2000 } = {}) {
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 2000;
  const startNs = process.hrtime.bigint();
  const deadlineNs = startNs + BigInt(Math.round(budget * 1e6));
  try {
    const stop = stopNewWork?.();
    if (stop && typeof stop.then === "function") {
      let failed = null;
      let settled = false;
      Promise.resolve(stop).then(
        () => { settled = true; },
        (err) => { settled = true; failed = err; },
      );
      await pumpMicrotasks(deadlineNs, () => settled);
      if (failed) throw failed;
    }
  } catch (e) {
    console.warn("[feed] failed to stop new feed work:", e?.message);
  }
  const remainingMs = Math.max(0, Number(deadlineNs - process.hrtime.bigint()) / 1e6);
  const drain = await drainFeedJobs(remainingMs);
  _feedSealed = true;
  const elapsedMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1e6);
  if (!drain.drained) {
    warnFeedWriteLoss(
      Math.max(drain.pending, _feedDropped),
      `shutdown timeout ${timeoutMs}ms elapsed ${elapsedMs}ms pending ${drain.pending}`,
    );
  }
  return { ...drain, dropped: _feedDropped, sealed: true, elapsedMs };
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
