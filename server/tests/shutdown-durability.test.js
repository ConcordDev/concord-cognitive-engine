/**
 * INC-24 follow-up (2026-10-11). After #1147 the shutdown log could still
 * stop at shutdown_feed_stopped: the HTTP drain awaited setTimeout (up to
 * 5s) before feed flush and db.close. A queued stall, a throw, or
 * process.exit from another signal handler then ended the process with
 * the handle open and no error line.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs tests/shutdown-durability.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { runShutdownDurability, writeShutdownLine } from "../lib/shutdown-durability.js";

describe("shutdown durability", { concurrency: 1 }, () => {
  it("closes the database before a queued macrotask stall, and drains only after that", async () => {
    const STALL_MS = 250;
    let stallRan = false;
    setTimeout(() => {
      stallRan = true;
      const end = Date.now() + STALL_MS;
      while (Date.now() < end) { /* the stall #1147 measured in front of db.close */ }
    }, 0);

    const order = [];
    const t0 = Date.now();
    await runShutdownDurability({
      async flushFeed() {
        order.push("flush");
        await Promise.resolve();
      },
      callbacks: [() => {
        order.push("close");
        assert.equal(stallRan, false, "a queued stall must not run before db.close");
        assert.ok(Date.now() - t0 < STALL_MS, "close must not wait out the stall");
      }],
      async afterClose() {
        order.push("drain");
        await new Promise((r) => { setTimeout(r, 20); });
      },
    });

    assert.deepEqual(order, ["flush", "close", "drain"]);
    assert.equal(stallRan, true, "the stall is the drain's problem, after the handle is closed");
  });

  it("logs a throw between feed stop and flush, with stack, and still closes", async () => {
    const events = [];
    const writeSync = (_fd, line) => { events.push(JSON.parse(line)); };
    let closed = false;
    const boom = new Error("between stop and flush");

    await runShutdownDurability({
      flushFeed() { throw boom; },
      onFlushError(e) {
        writeShutdownLine("error", "shutdown_feed_flush_failed", {
          error: e.message,
          stack: e.stack,
        }, { writeSync, fd: 1 });
      },
      callbacks: [() => {
        closed = true;
        writeShutdownLine("info", "shutdown_database_closed", { ms: 1 }, { writeSync, fd: 1 });
      }],
      onCallbackError(e) {
        writeShutdownLine("error", "shutdown_database_close_failed", {
          error: e.message,
          stack: e.stack,
        }, { writeSync, fd: 1 });
      },
    });

    assert.equal(closed, true);
    const fail = events.find((e) => e.event === "shutdown_feed_flush_failed");
    assert.ok(fail, "flush failure is logged");
    assert.equal(fail.error, "between stop and flush");
    assert.match(fail.stack, /between stop and flush/);
    const failAt = events.findIndex((e) => e.event === "shutdown_feed_flush_failed");
    const closeAt = events.findIndex((e) => e.event === "shutdown_database_closed");
    assert.ok(closeAt > failAt, "close is logged after the flush error");
  });

  it("logs the close error and stack when db.close throws, and does not claim the handle closed", async () => {
    const events = [];
    const writeSync = (_fd, line) => { events.push(JSON.parse(line)); };

    await runShutdownDurability({
      flushFeed() {},
      callbacks: [() => { const err = new Error("The database connection is not open"); throw err; }],
      onCallbackError(e) {
        writeShutdownLine("error", "shutdown_database_close_failed", {
          error: e.message,
          stack: e.stack,
        }, { writeSync, fd: 1 });
      },
    });

    const fail = events.find((e) => e.event === "shutdown_database_close_failed");
    assert.ok(fail);
    assert.match(fail.stack, /database connection is not open/);
    assert.equal(events.some((e) => e.event === "shutdown_database_closed"), false);
  });

  it("a competing process.exit closes the database and sync-writes the reason before exit returns", async () => {
    const lines = [];
    const writeSync = (_fd, line) => { lines.push(line); };
    let closes = 0;
    const realExit = process.exit;
    let atExit = null;
    process.exit = (code) => {
      atExit = { code, closes, text: lines.join("") };
    };

    try {
      await runShutdownDurability({
        flushFeed() {
          process.exit(0);
        },
        onExitRaced({ code, stack }) {
          writeShutdownLine("error", "shutdown_exit_raced", { code, stack }, { writeSync, fd: 1 });
        },
        callbacks: [() => {
          closes += 1;
          writeShutdownLine("info", "shutdown_database_closed", { ms: 4 }, { writeSync, fd: 1 });
        }],
      });
    } finally {
      process.exit = realExit;
    }

    assert.ok(atExit, "process.exit ran");
    assert.equal(atExit.code, 0);
    assert.equal(atExit.closes, 1, "close runs inside the exit, once");
    assert.match(atExit.text, /shutdown_exit_raced/);
    assert.match(atExit.text, /process\.exit during shutdown/);
    assert.match(atExit.text, /shutdown_database_closed/);
    assert.ok(
      atExit.text.indexOf("shutdown_exit_raced") < atExit.text.indexOf("shutdown_database_closed"),
    );
    assert.equal(closes, 1, "the normal callback pass does not close again");
  });

  it("writeShutdownLine is already in the sink when a buffered console line is not", () => {
    const sink = [];
    const buffer = [];
    writeShutdownLine("info", "shutdown_database_closed", { ms: 2 }, {
      writeSync(_fd, line) { sink.push(line); },
      fd: 1,
    });
    buffer.push('{"event":"shutdown_feed_flushed"}\n');
    const atExit = sink.join("");
    assert.match(atExit, /"event":"shutdown_database_closed"/);
    assert.equal(atExit.includes("shutdown_feed_flushed"), false);
    assert.equal(buffer.length, 1, "an unflushed console buffer is the line the exit drops");
  });

  it("gracefulShutdown drains only after durability, and shutdown logs use writeSync", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const start = src.indexOf("async function gracefulShutdown");
    const end = src.indexOf("function _crashMemorySnapshot");
    assert.ok(start > 0 && end > start);
    const body = src.slice(start, end);
    const call = body.indexOf("runShutdownDurability(");
    const loop = body.indexOf("while (getActiveRequests()");
    const guard = body.indexOf("beginShutdownHttp(");
    const stopAccept = body.indexOf("httpServer.close(");
    const inflightLog = body.indexOf("shutdown_inflight_drained");
    assert.ok(call > 0, "durability helper is on the shutdown path");
    assert.ok(loop > call, "the long request-drain timer is after db.close, not before flush");
    assert.ok(guard > 0 && guard < stopAccept && stopAccept < inflightLog && inflightLog < call,
      "guard and stop-accept, then the inflight log, then db.close");
    assert.match(body, /if \(inflight\.length > 0\)/);
    assert.match(body, /waitForInflight\(/);
    assert.equal(
      /await\s+new\s+Promise/.test(body.slice(0, call)),
      false,
      "no timer wait before the durability stretch",
    );
    assert.match(body, /shutdown_exit_raced/);
    assert.match(body, /shutdown_feed_flush_failed/);
    assert.match(body, /shutdown_drain_deferred/);
    assert.match(body, /shutdown_callback_failed/);
    assert.match(src, /shutdown_database_close_failed/);

    const logStart = src.indexOf("function structuredLog");
    const logEnd = src.indexOf("function requestLoggerMiddleware");
    const logBody = src.slice(logStart, logEnd);
    assert.match(logBody, /isShuttingDown/);
    assert.match(logBody, /writeShutdownLine/);
  });
});
