// HTTP half of graceful shutdown.
//
// server.close() stops accept, but a request already inside the app can
// still be between statements. Closing SQLite under it used to surface as
// a 500 ("The database connection is not open") or, worse, commit the
// statements that had already autocommitted. The order is:
//
//   1. beginShutdownHttp() — new requests that reach the app get 503
//      { ok:false, reason:"shutting_down" } and Retry-After.
//   2. server.close() — stop accept (caller's job, already first).
//   3. If any response is still in flight, wait for its own finish/close,
//      capped by one monotonic deadline (<= 1.5s). No polling loop.
//      Zero in flight: do not schedule that deadline.
//   4. Log shutdown_inflight_drained, flush, seal writes (roll back an
//      open multi-statement transaction), db.close().
//
// A statement that starts after the seal throws shutting_down before SQL.
// better-sqlite3 transactions are synchronous, so one that has entered
// db.transaction() finishes or hasn't started before this code runs. An
// explicit BEGIN left open across an await is rolled back here, not
// committed. The closed-handle error class is also a 503, via
// trySendShutdownError, for a statement object already prepared.

/** Restart is about 10–20s. Clients honor this on idempotent GETs. */
export const SHUTDOWN_RETRY_AFTER_S = 20;

/** Hard cap. launchd bootout kills a user agent in about 5s. */
export const SHUTDOWN_INFLIGHT_BUDGET_MS = 1500;

const SEALED = new WeakSet();
const inflight = new Set();
let httpShuttingDown = false;

export function isHttpShuttingDown() {
  return httpShuttingDown;
}

export function beginShutdownHttp() {
  httpShuttingDown = true;
}

export function resetShutdownHttpForTests() {
  httpShuttingDown = false;
  inflight.clear();
}

export function shuttingDownBody() {
  return { ok: false, reason: "shutting_down" };
}

export function shuttingDownError() {
  // Error has no code/reason/statusCode in the lib typings. Object.assign
  // returns the intersection so checkJs can see the fields the callers read.
  return Object.assign(new Error("shutting_down"), {
    code: "shutting_down",
    reason: "shutting_down",
    statusCode: 503,
  });
}

export function isShutdownDbError(err) {
  if (!err || typeof err !== "object") {
    return typeof err === "string" && /database connection is not open/i.test(err);
  }
  if (err.code === "shutting_down" || err.reason === "shutting_down") return true;
  const msg = String(err.message || "");
  if (/database connection is not open/i.test(msg)) return true;
  if (err.cause && err.cause !== err) return isShutdownDbError(err.cause);
  return false;
}

/**
 * @param {import("express").Response | import("node:http").ServerResponse} res
 */
export function sendShuttingDown(res) {
  const body = shuttingDownBody();
  if (res.headersSent) return res;
  // The param is Express Response | node ServerResponse. Narrow through a
  // cast: reading `.status` on the union is a TS2339 even inside typeof.
  const expressRes = /** @type {import("express").Response} */ (res);
  if (typeof expressRes.status === "function" && typeof expressRes.set === "function" && typeof expressRes.json === "function") {
    expressRes.set("Retry-After", String(SHUTDOWN_RETRY_AFTER_S));
    return expressRes.status(503).json(body);
  }
  res.statusCode = 503;
  if (typeof res.setHeader === "function") {
    res.setHeader("Retry-After", String(SHUTDOWN_RETRY_AFTER_S));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(body));
  return res;
}

/**
 * Express error-handler step. Returns true when the response was sent as
 * 503 shutting_down (the caller must not also send a 500).
 */
export function trySendShutdownError(err, res) {
  if (!res || res.headersSent) return false;
  if (!isShutdownDbError(err)) return false;
  sendShuttingDown(res);
  return true;
}

export function shutdownHttpMiddleware(req, res, next) {
  if (!httpShuttingDown) return next();
  sendShuttingDown(res);
}

/**
 * Track a response until it finishes or the socket closes. The drain
 * waits on these events; the active-request counter alone cannot.
 * @param {import("node:events").EventEmitter} res
 */
export function noteInflightResponse(res) {
  if (!res || typeof res.on !== "function" || inflight.has(res)) return;
  inflight.add(res);
  const done = () => {
    if (typeof res.removeListener === "function") {
      res.removeListener("finish", done);
      res.removeListener("close", done);
    }
    inflight.delete(res);
  };
  res.on("finish", done);
  res.on("close", done);
}

export function getInflightResponses() {
  return [...inflight];
}

/**
 * Wait until every response emits finish or close, or until one deadline.
 * budgetMs is clamped to SHUTDOWN_INFLIGHT_BUDGET_MS. An empty list
 * resolves immediately and does not schedule.
 *
 * @param {Array<{ on: Function, removeListener?: Function }>} responses
 * @param {{
 *   budgetMs?: number,
 *   now?: () => bigint,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 * }} [opts]
 * @returns {Promise<{ waited_ms: number, remaining: number, skipped: boolean }>}
 */
export function waitForInflight(responses, opts = {}) {
  const list = Array.isArray(responses) ? responses.filter(Boolean) : [];
  const now = typeof opts.now === "function" ? opts.now : () => process.hrtime.bigint();
  const t0 = now();
  if (list.length === 0) {
    return Promise.resolve({ waited_ms: 0, remaining: 0, skipped: true });
  }

  const requested = Number(opts.budgetMs ?? SHUTDOWN_INFLIGHT_BUDGET_MS);
  const budget = Math.min(
    SHUTDOWN_INFLIGHT_BUDGET_MS,
    Math.max(0, Number.isFinite(requested) ? requested : SHUTDOWN_INFLIGHT_BUDGET_MS),
  );
  if (budget === 0) {
    return Promise.resolve({ waited_ms: 0, remaining: list.length, skipped: false });
  }

  const schedule = typeof opts.schedule === "function"
    ? opts.schedule
    : (fn, ms) => {
      const timer = setTimeout(fn, ms);
      if (timer && typeof timer.unref === "function") timer.unref();
      return timer;
    };

  return new Promise((resolve) => {
    const pending = new Set(list);
    let settled = false;
    const offs = [];

    const finish = () => {
      if (settled) return;
      settled = true;
      for (const off of offs) {
        try { off(); } catch { /* listener already gone */ }
      }
      const waited_ms = Number(now() - t0) / 1e6;
      resolve({
        waited_ms,
        remaining: pending.size,
        skipped: false,
      });
    };

    for (const res of list) {
      const onDone = () => {
        pending.delete(res);
        if (pending.size === 0) finish();
      };
      res.on("finish", onDone);
      res.on("close", onDone);
      offs.push(() => {
        if (typeof res.removeListener === "function") {
          res.removeListener("finish", onDone);
          res.removeListener("close", onDone);
        }
      });
    }

    // One deadline. Not a poll. If this fires late because the loop was
    // busy, we stop at this fire — we never schedule another wait.
    schedule(finish, budget);
  });
}

/**
 * Undo a multi-statement write left open across an await. Does not seal
 * the handle — shutdown's own snapshot and feed flush still need SQL.
 * @param {import("better-sqlite3").Database} db
 * @returns {boolean} true when a transaction was rolled back
 */
export function rollbackOpenWrite(db) {
  if (!db || db.open === false) return false;
  try {
    if (!db.inTransaction) return false;
    db.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse new SQL, and roll back a multi-statement write that is still
 * open so close cannot commit a prefix of it. Statements that already
 * ran inside the open transaction are undone. A write that has not
 * started hits the wrapper and throws before SQL.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {{ rolledBack: boolean, already: boolean }}
 */
export function sealDatabaseWrites(db) {
  if (!db || SEALED.has(db)) return { rolledBack: false, already: true };
  let rolledBack = false;
  const origExec = typeof db.exec === "function" ? db.exec.bind(db) : null;
  try {
    if (db.open !== false && db.inTransaction && origExec) {
      origExec("ROLLBACK");
      rolledBack = true;
    }
  } catch {
    rolledBack = false;
  }
  const refuse = () => {
    throw shuttingDownError();
  };
  for (const name of ["prepare", "exec", "transaction"]) {
    if (typeof db[name] === "function") db[name] = refuse;
  }
  SEALED.add(db);
  return { rolledBack, already: false };
}
