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

describe("feed shutdown drain", () => {
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

    const drain = await shutdownFeedPersistence({
      stopNewWork() {},
      timeoutMs: 30,
    });

    assert.equal(drain.drained, false);
    assert.equal(drain.pending, 1);
    assert.equal(feed.count(), 0, "the write has not happened yet");
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[feed\] DB write skipped: 1 feed event\(s\) not persisted \(shutdown timeout 30ms\)/);

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

  it("closes the database inside the budget while the event loop is stalled and a feed job is still in flight", async () => {
    const feed = openFeedDb();
    // Longer than the close budget. Queued before shutdown, so any
    // setTimeout/import yield runs this busy-loop before db.close.
    const STALL_MS = 300;
    const BUDGET_MS = 150;
    let stallRan = false;
    let releaseStall;
    const stallDone = new Promise((resolve) => { releaseStall = resolve; });
    setTimeout(() => {
      stallRan = true;
      const end = Date.now() + STALL_MS;
      while (Date.now() < end) {}
      releaseStall();
    }, 0);

    // Stop itself must not wait on a macrotask either.
    let releaseStop;
    const stopGate = new Promise((resolve) => { releaseStop = resolve; });

    const job = trackFeedJob((async () => {
      await new Promise((resolve) => { setTimeout(resolve, 80); });
      emitFeedEvent(
        { type: "observation", emergentId: "e-busy", data: { observation: "after-close" } },
        feed.db,
        null,
      );
    })());

    const t0 = Date.now();
    const drain = await shutdownFeedPersistence({
      stopNewWork: () => stopGate,
      timeoutMs: 2000,
    });
    feed.db.close();
    const elapsed = Date.now() - t0;

    assert.equal(stallRan, false, "a queued stall must not run before db.close");
    assert.ok(elapsed < BUDGET_MS, `db.close ran in ${elapsed}ms; budget is ${BUDGET_MS}ms`);
    assert.equal(drain.sealed, true);
    assert.equal(drain.drained, false, "a timer-blocked feed job is not flushed");
    assert.equal(feed.prepareWhileClosed(), 0);

    releaseStop();
    await stallDone;
    await job;

    assert.equal(stallRan, true);
    assert.equal(feed.prepareWhileClosed(), 0, "the late write must not prepare on the closed handle");
    assert.equal(errors.filter((line) => line.includes("[feed] DB write failed")).length, 0);
    assert.equal(warns.length, 1, "dropped in-flight writes are one warning");
    assert.match(warns[0], /\[feed\] DB write skipped: 1 feed event\(s\) not persisted \(shutdown timeout 2000ms\)/);
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
