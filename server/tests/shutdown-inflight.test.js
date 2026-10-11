/**
 * PR #1154 review: db.close must not turn an in-flight write into a 500
 * or a partial commit, and it must still run inside launchd's ~5s kill.
 *
 *   (a) a request that finishes inside the window commits before close
 *   (b) a request still running past the window gets 503, not 500, and
 *       the open transaction is rolled back
 *   (c) a new request after shutdown begins gets 503 shutting_down
 *   (d) a stuck request count cannot push db.close past a 5s kill
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs tests/shutdown-inflight.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import express from "express";
import Database from "better-sqlite3";

import {
  beginShutdownHttp,
  getInflightResponses,
  resetShutdownHttpForTests,
  sealDatabaseWrites,
  SHUTDOWN_INFLIGHT_BUDGET_MS,
  SHUTDOWN_RETRY_AFTER_S,
  shutdownHttpMiddleware,
  trySendShutdownError,
  waitForInflight,
} from "../lib/shutdown-http.js";
import { httpMetricsMiddleware } from "../lib/http-metrics.js";
import { serverError } from "../lib/http-errors.js";
import { concordErrorHandler } from "../lib/errors.js";
import { createErrorMiddleware } from "../lib/async-handler.js";

function mockRes() {
  const headers = {};
  return {
    headersSent: false,
    statusCode: 0,
    body: null,
    headers,
    req: { method: "POST", originalUrl: "/write" },
    set(name, value) { headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.headersSent = true; return this; },
  };
}

async function withServer(mount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shutdown-inflight-"));
  const dbPath = path.join(dir, "t.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE rows (id INTEGER PRIMARY KEY)");
  const order = [];
  const app = express();
  app.use((req, res, next) => {
    res.on("finish", () => order.push("finish"));
    next();
  });
  app.use(shutdownHttpMiddleware);
  app.use(httpMetricsMiddleware);
  mount({ app, db, order });
  app.use((err, req, res, _next) => {
    if (trySendShutdownError(err, res)) return;
    res.status(500).json({ ok: false, error: String(err?.message || err), code: "INTERNAL_ERROR" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return {
    db, dbPath, dir, order, port, server,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
      try { if (db.open) db.close(); } catch { /* already closed */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  resetShutdownHttpForTests();
});

describe("shutdown inflight window", { concurrency: 1 }, () => {
  const servers = [];
  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop();
      try { await s.close(); } catch { /* */ }
    }
    resetShutdownHttpForTests();
  });

  it("(a) in-flight request finishes inside the window before db.close", async () => {
    let release;
    const hold = new Promise((r) => { release = r; });
    let entered;
    const started = new Promise((r) => { entered = r; });
    const ctx = await withServer(({ app, db }) => {
      app.post("/write", (req, res, next) => {
        (async () => {
          try {
            db.exec("BEGIN");
            db.prepare("INSERT INTO rows (id) VALUES (1)").run();
            db.prepare("INSERT INTO rows (id) VALUES (2)").run();
            entered();
            await hold;
            db.exec("COMMIT");
            res.status(200).json({ ok: true });
          } catch (err) { next(err); }
        })();
      });
    });
    servers.push(ctx);

    const pending = fetch(`http://127.0.0.1:${ctx.port}/write`, { method: "POST" });
    await started;
    const inflight = getInflightResponses();
    assert.equal(inflight.length, 1);
    beginShutdownHttp();
    ctx.server.close();
    const drainP = waitForInflight(inflight, { budgetMs: SHUTDOWN_INFLIGHT_BUDGET_MS });
    release();
    const drain = await drainP;
    assert.equal(drain.skipped, false);
    assert.equal(drain.remaining, 0);
    assert.ok(drain.waited_ms < SHUTDOWN_INFLIGHT_BUDGET_MS);
    assert.equal(ctx.db.inTransaction, false);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM rows").get().c, 2);
    const sealed = sealDatabaseWrites(ctx.db);
    assert.equal(sealed.rolledBack, false);
    ctx.order.push("close");
    ctx.db.close();
    assert.deepEqual(ctx.order, ["finish", "close"]);
    const res = await pending;
    assert.equal(res.status, 200);
    const db2 = new Database(ctx.dbPath);
    try {
      assert.equal(db2.prepare("SELECT COUNT(*) AS c FROM rows").get().c, 2);
    } finally {
      db2.close();
    }
  });

  it("(b) a request still running past the window gets 503 and no partial write", async () => {
    let release;
    const hold = new Promise((r) => { release = r; });
    let entered;
    const started = new Promise((r) => { entered = r; });
    const ctx = await withServer(({ app, db }) => {
      app.post("/write", (req, res, next) => {
        (async () => {
          try {
            db.exec("BEGIN");
            db.prepare("INSERT INTO rows (id) VALUES (1)").run();
            entered();
            await hold;
            db.prepare("INSERT INTO rows (id) VALUES (2)").run();
            db.exec("COMMIT");
            res.status(200).json({ ok: true });
          } catch (err) { next(err); }
        })();
      });
    });
    servers.push(ctx);

    const pending = fetch(`http://127.0.0.1:${ctx.port}/write`, { method: "POST" });
    await started;
    beginShutdownHttp();
    ctx.server.close();
    const drain = await waitForInflight(getInflightResponses(), { budgetMs: 40 });
    assert.equal(drain.remaining, 1);
    assert.ok(drain.waited_ms < 5000);
    assert.ok(drain.waited_ms <= SHUTDOWN_INFLIGHT_BUDGET_MS);

    const origPrepare = ctx.db.prepare.bind(ctx.db);
    const count = () => Number(origPrepare("SELECT COUNT(*) AS c FROM rows").get().c);
    assert.equal(ctx.db.inTransaction, true);
    assert.equal(count(), 1);
    let startedLate = false;
    const sealed = sealDatabaseWrites(ctx.db);
    assert.equal(sealed.rolledBack, true);
    assert.equal(count(), 0, "the open transaction is rolled back before close");
    assert.throws(() => ctx.db.transaction(() => { startedLate = true; })(), (err) => {
      assert.equal(err.reason, "shutting_down");
      return true;
    });
    assert.equal(startedLate, false, "a multi-statement write does not start after the window");
    ctx.order.push("close");
    ctx.db.close();
    release();
    const res = await pending;
    assert.equal(res.status, 503);
    assert.notEqual(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, reason: "shutting_down" });
    assert.equal(res.headers.get("retry-after"), String(SHUTDOWN_RETRY_AFTER_S));
    assert.equal(ctx.order[0], "close");
    const db2 = new Database(ctx.dbPath);
    try {
      assert.equal(db2.prepare("SELECT COUNT(*) AS c FROM rows").get().c, 0);
    } finally {
      db2.close();
    }
  });

  it("(c) a new request after shutdown begins gets 503", async () => {
    let handlerRan = false;
    const ctx = await withServer(({ app }) => {
      app.get("/ping", (req, res) => {
        handlerRan = true;
        res.status(200).json({ ok: true });
      });
    });
    servers.push(ctx);
    beginShutdownHttp();
    const res = await fetch(`http://127.0.0.1:${ctx.port}/ping`);
    assert.equal(handlerRan, false);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, reason: "shutting_down" });
    assert.equal(res.headers.get("retry-after"), String(SHUTDOWN_RETRY_AFTER_S));
  });

  it("(d) db.close runs before a simulated 5s kill when the request count is stuck", async () => {
    const res = new EventEmitter();
    let closed = false;
    let killed = false;
    const kill = setTimeout(() => { killed = true; }, 5000);
    const calls = [];
    const t0 = process.hrtime.bigint();
    const drain = await waitForInflight([res], {
      budgetMs: 80,
      schedule(fn, ms) {
        calls.push(ms);
        const timer = setTimeout(fn, ms);
        if (typeof timer.unref === "function") timer.unref();
        return timer;
      },
    });
    closed = true;
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
    clearTimeout(kill);
    assert.equal(closed, true);
    assert.equal(killed, false, "the 5s kill has not fired");
    assert.deepEqual(calls, [80], "one deadline timer, not a poll");
    assert.equal(drain.remaining, 1);
    assert.ok(elapsed < 5000);
    assert.ok(drain.waited_ms < 5000);
    assert.ok(drain.waited_ms <= SHUTDOWN_INFLIGHT_BUDGET_MS);
  });

  it("(d) a budget above 1.5s is clamped so close stays inside the 5s kill", async () => {
    const res = new EventEmitter();
    let now = 0n;
    const scheduled = [];
    const drain = await waitForInflight([res], {
      budgetMs: 10_000,
      now: () => now,
      schedule(fn, ms) {
        scheduled.push(ms);
        now += BigInt(ms) * 1_000_000n;
        fn();
      },
    });
    assert.deepEqual(scheduled, [SHUTDOWN_INFLIGHT_BUDGET_MS]);
    assert.equal(drain.remaining, 1);
    assert.ok(drain.waited_ms <= SHUTDOWN_INFLIGHT_BUDGET_MS + 1);
    assert.ok(Number(now) / 1e6 < 5000);
  });

  it("skips the window entirely when no request is active", async () => {
    let scheduled = false;
    let stallRan = false;
    setTimeout(() => {
      stallRan = true;
      const end = Date.now() + 20;
      while (Date.now() < end) { /* queued stall must not run before a zero-inflight return */ }
    }, 0);
    const drain = await waitForInflight([], {
      schedule() { scheduled = true; },
    });
    assert.equal(scheduled, false);
    assert.equal(drain.skipped, true);
    assert.equal(drain.waited_ms, 0);
    assert.equal(drain.remaining, 0);
    assert.equal(stallRan, false);
  });

  it("maps a closed database handle to 503 shutting_down, not 500", () => {
    const err = new Error("The database connection is not open");
    const res = mockRes();
    assert.equal(trySendShutdownError(err, res), true);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { ok: false, reason: "shutting_down" });
    assert.equal(res.headers["Retry-After"], String(SHUTDOWN_RETRY_AFTER_S));

    const viaHelper = mockRes();
    serverError(viaHelper, err);
    assert.equal(viaHelper.statusCode, 503);
    assert.deepEqual(viaHelper.body, { ok: false, reason: "shutting_down" });

    const viaConcord = mockRes();
    concordErrorHandler(err, { method: "POST", path: "/write" }, viaConcord, () => {});
    assert.equal(viaConcord.statusCode, 503);
    assert.deepEqual(viaConcord.body, { ok: false, reason: "shutting_down" });

    const logs = [];
    const viaAsync = mockRes();
    createErrorMiddleware((level, event) => { logs.push({ level, event }); })(
      err, { method: "POST", path: "/write", id: "r1" }, viaAsync, () => {},
    );
    assert.equal(viaAsync.statusCode, 503);
    assert.deepEqual(viaAsync.body, { ok: false, reason: "shutting_down" });
    assert.equal(logs.some((l) => l.event === "request_error" && l.level === "error"), false);

    const generic = mockRes();
    assert.equal(trySendShutdownError(new Error("nope"), generic), false);
    assert.equal(generic.statusCode, 0);
  });

  it("gracefulShutdown seals before close and both error handlers map the closed handle", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const seal = src.indexOf("sealDatabaseWrites(db)");
    const closing = src.indexOf("shutdown_closing_database", seal);
    const close = src.indexOf("db.close()", closing);
    assert.ok(seal > 0 && closing > seal && close > closing);
    const asyncWrap = src.indexOf("trySendShutdownError(err, res)");
    assert.ok(asyncWrap > 0, "async wrapper maps the closed handle");
    const handlers = fs.readFileSync(new URL("../lib/route-error-handlers.js", import.meta.url), "utf8");
    const first = handlers.indexOf("trySendShutdownError(err, res)");
    const second = handlers.indexOf("trySendShutdownError(err, res)", first + 1);
    assert.ok(first > 0 && second > first, "both error handlers map the closed handle");
    assert.match(src, /createEarlyRouteErrorHandler\(/);
    assert.match(src, /createLateRouteErrorHandler\(/);
    assert.match(src, /app\.use\(shutdownHttpMiddleware\)/);
  });
});
