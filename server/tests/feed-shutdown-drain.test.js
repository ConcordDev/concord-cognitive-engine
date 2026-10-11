/**
 * Graceful shutdown used to close SQLite before in-flight feed writes
 * finished. emitFeedEvent then threw "The database connection is not open"
 * and the row was dropped (backend.err: "[feed] DB write failed").
 *
 * shutdownFeedPersistence stops new feed work, waits for tracked jobs, and
 * only then seals the writer. A job that misses the deadline is one counted
 * warning and must not call prepare() on a closed handle.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs tests/feed-shutdown-drain.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

import {
  emitFeedEvent,
  trackFeedJob,
  shutdownFeedPersistence,
  feedWriteStats,
  resetFeedShutdownForTests,
} from "../emergent/feed.js";
import { MinorAgentScheduler } from "../emergent/minor-agent-scheduler.js";

function openFeedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_activity_feed (
    id TEXT PRIMARY KEY,
    emergent_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  const origPrepare = db.prepare.bind(db);
  let prepareWhileClosed = 0;
  db.prepare = (sql) => {
    if (db.open === false) prepareWhileClosed += 1;
    return origPrepare(sql);
  };
  return {
    db,
    prepareWhileClosed: () => prepareWhileClosed,
    count: () => db.prepare("SELECT COUNT(*) AS c FROM emergent_activity_feed").get().c,
  };
}

describe("feed shutdown drain", { concurrency: 1 }, () => {
  let warns;
  let errors;
  let origWarn;
  let origError;

  beforeEach(() => {
    resetFeedShutdownForTests();
    warns = [];
    errors = [];
    origWarn = console.warn;
    origError = console.error;
    console.warn = (...args) => { warns.push(args.map(String).join(" ")); };
    console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  });

  afterEach(() => {
    console.warn = origWarn;
    console.error = origError;
    resetFeedShutdownForTests();
  });

  it("flushes a pending feed write before the handle is closed", async () => {
    const feed = openFeedDb();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const job = trackFeedJob((async () => {
      await gate;
      emitFeedEvent(
        { type: "observation", emergentId: "e1", data: { observation: "kept" } },
        feed.db,
        null,
      );
    })());

    let stopped = false;
    const done = shutdownFeedPersistence({
      stopNewWork: () => { stopped = true; },
      timeoutMs: 1000,
    });

    assert.equal(feed.count(), 0, "write is still in flight");
    release();
    const drain = await done;
    await job;

    assert.equal(stopped, true);
    assert.equal(drain.drained, true);
    assert.equal(drain.pending, 0);
    assert.equal(feed.count(), 1, "row landed while the handle was open");
    assert.equal(warns.length, 0, "a completed write is not reported as loss");
    assert.equal(errors.filter((l) => l.includes("[feed] DB write failed")).length, 0);

    feed.db.close();
    emitFeedEvent({ type: "dream", emergentId: "e1", data: { dream: "late" } }, feed.db, null);
    emitFeedEvent({ type: "dream", emergentId: "e2", data: { dream: "late" } }, feed.db, null);
    emitFeedEvent({ type: "dream", emergentId: "e3", data: { dream: "late" } }, feed.db, null);
    await Promise.resolve();

    assert.equal(feed.prepareWhileClosed(), 0, "no prepare() on a closed handle");
    assert.equal(errors.filter((l) => l.includes("[feed] DB write failed")).length, 0);
    assert.equal(warns.length, 1, "late writes collapse to one warning");
    assert.match(warns[0], /\[feed\] DB write skipped: 3 feed event\(s\) not persisted/);
    assert.equal(feedWriteStats().dropped, 3);
  });

  it("reports a feed job that misses the flush deadline and does not write after close", async () => {
    const feed = openFeedDb();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const job = trackFeedJob((async () => {
      await gate;
      emitFeedEvent(
        { type: "observation", emergentId: "e-late", data: { observation: "missed" } },
        feed.db,
        null,
      );
    })());

    const t0 = process.hrtime.bigint();
    const drain = await shutdownFeedPersistence({
      stopNewWork() {},
      timeoutMs: 30,
    });
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;

    assert.equal(drain.drained, false);
    assert.ok(elapsed >= 20, `deadline miss returned in ${elapsed}ms, timeout is 30ms`);
    assert.equal(drain.pending, 1);
    assert.equal(feed.count(), 0, "the write has not happened yet");
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[feed\] DB write skipped: 1 feed event\(s\) not persisted \(shutdown timeout 30ms elapsed \d+ms pending 1\)/);

    feed.db.close();
    release();
    await job;

    assert.equal(feed.prepareWhileClosed(), 0, "the late write must not touch the closed handle");
    assert.equal(errors.filter((l) => l.includes("[feed] DB write failed")).length, 0);
    assert.equal(warns.length, 1, "the timeout warning is not repeated per dropped row");
    assert.ok(feedWriteStats().dropped >= 1);
  });

  it("does not prepare on a closed handle even if the writer was not sealed", async () => {
    const feed = openFeedDb();
    feed.db.close();
    emitFeedEvent({ type: "observation", emergentId: "e1", data: { observation: "nope" } }, feed.db, null);
    await Promise.resolve();
    assert.equal(feed.prepareWhileClosed(), 0);
    assert.equal(errors.filter((l) => l.includes("[feed] DB write failed")).length, 0);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[feed\] DB write skipped: 1 feed event\(s\) not persisted \(database connection is not open\)/);
  });

  it("scheduler stop ends new ticks and the in-flight tick is drained before seal", async () => {
    const feed = openFeedDb();
    const scheduler = new MinorAgentScheduler(feed.db, null, 20);
    let release;
    let started = 0;
    scheduler.tickAll = () => {
      started += 1;
      scheduler.stop();
      // The interval callback is what calls trackFeedJob — don't wrap again.
      return (async () => {
        await new Promise((resolve) => { release = resolve; });
        emitFeedEvent(
          { type: "task_completed", emergentId: "agent-1", data: { task_id: "t1" } },
          feed.db,
          null,
        );
      })();
    };

    scheduler.start();
    const deadline = Date.now() + 500;
    while (started < 1 && Date.now() < deadline) {
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    assert.equal(started, 1);
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    assert.equal(started, 1, "stop() from the in-flight tick prevents another interval fire");
    assert.equal(feedWriteStats().pendingJobs, 1);

    const done = shutdownFeedPersistence({
      stopNewWork: () => scheduler.stop(),
      timeoutMs: 500,
    });
    assert.equal(feed.count(), 0);
    release();
    const drain = await done;

    assert.equal(drain.drained, true);
    assert.equal(feed.count(), 1);
    feed.db.close();
    emitFeedEvent({ type: "dream", emergentId: "agent-1", data: {} }, feed.db, null);
    await Promise.resolve();
    assert.equal(feed.prepareWhileClosed(), 0);
    scheduler.stop();
  });

  it("does not arm a timer when no feed write is pending", async () => {
    const STALL_MS = 300;
    let stallRan = false;
    setTimeout(() => {
      stallRan = true;
      const end = Date.now() + STALL_MS;
      while (Date.now() < end) {}
    }, 0);

    const t0 = process.hrtime.bigint();
    const drain = await shutdownFeedPersistence({
      stopNewWork() {},
      timeoutMs: 2000,
    });
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;

    assert.equal(stallRan, false, "an empty feed queue must not yield to a queued stall");
    assert.ok(elapsed < 50, `empty flush returned in ${elapsed}ms`);
    assert.equal(drain.drained, true);
    assert.equal(drain.pending, 0);
    assert.equal(drain.sealed, true);
    assert.equal(warns.length, 0);
  });

  it("waits for a slow in-flight feed write and reports drained=false only after the timeout", async () => {
    const msSince = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

    const feed = openFeedDb();
    const SLOW_MS = 200;
    let closedBeforeWrite = false;
    const job = trackFeedJob((async () => {
      await new Promise((resolve) => { setTimeout(resolve, SLOW_MS); });
      closedBeforeWrite = feed.db.open === false;
      emitFeedEvent(
        { type: "observation", emergentId: "e-slow", data: { observation: "kept" } },
        feed.db,
        null,
      );
    })());

    const t0 = process.hrtime.bigint();
    const drain = await shutdownFeedPersistence({
      stopNewWork() {},
      timeoutMs: 2000,
    });
    const elapsed = msSince(t0);

    assert.equal(drain.drained, true);
    assert.equal(drain.pending, 0);
    assert.equal(closedBeforeWrite, false, "the handle was open when the write ran");
    assert.equal(feed.db.open !== false, true, "db.close has not run yet");
    assert.equal(feed.count(), 1, "the row is persisted before db.close");
    assert.ok(elapsed >= SLOW_MS - 40, `flush returned in ${elapsed}ms, before the ${SLOW_MS}ms write`);
    assert.ok(elapsed < 1500, `flush waited ${elapsed}ms, past the write and toward the 2000ms cap`);
    assert.equal(warns.length, 0, "a write that finished inside the cap is a clean drain");

    feed.db.close();
    await job;
    assert.equal(feed.prepareWhileClosed(), 0);

    resetFeedShutdownForTests();
    const late = openFeedDb();
    const WRITE_MS = 800;
    const TIMEOUT_MS = 120;
    const lateJob = trackFeedJob((async () => {
      await new Promise((resolve) => { setTimeout(resolve, WRITE_MS); });
      emitFeedEvent(
        { type: "observation", emergentId: "e-late", data: { observation: "missed" } },
        late.db,
        null,
      );
    })());

    const t1 = process.hrtime.bigint();
    const expired = await shutdownFeedPersistence({
      stopNewWork() {},
      timeoutMs: TIMEOUT_MS,
    });
    const expiredMs = msSince(t1);

    assert.equal(expired.drained, false);
    assert.equal(expired.pending, 1);
    assert.equal(late.count(), 0, "the slow write has not landed");
    assert.equal(late.db.open !== false, true, "caller closes only after the flush returns");
    assert.ok(expiredMs >= TIMEOUT_MS * 0.6, `drained=false after ${expiredMs}ms; timeout is ${TIMEOUT_MS}ms`);
    assert.ok(expiredMs < WRITE_MS, `waited ${expiredMs}ms for a ${WRITE_MS}ms write`);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /shutdown timeout 120ms/);
    assert.match(warns[0], /pending 1/);

    late.db.close();
    await lateJob;
    assert.equal(late.prepareWhileClosed(), 0, "the late write must not prepare on the closed handle");
    assert.equal(errors.filter((line) => line.includes("[feed] DB write failed")).length, 0);
  });

  it("gracefulShutdown does not dynamic-import on the way to db.close", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const start = src.indexOf("async function gracefulShutdown");
    const end = src.indexOf("function _crashMemorySnapshot");
    assert.ok(start > 0 && end > start);
    const body = src.slice(start, end);
    assert.equal(/await\s+import\s*\(/.test(body), false);
    assert.match(body, /shutdown_feed_stopping/);
    assert.match(body, /shutdown_feed_stopped/);
    assert.match(body, /shutdown_feed_flushing/);
    assert.match(body, /shutdown_feed_flushed/);
    assert.match(body, /shutdownFeedPersistence\(/);
    assert.match(body, /stopFeedManager\(/);
    assert.match(src, /shutdown_closing_database/);
    assert.match(src, /db\.close\(\)/);
  });
});
