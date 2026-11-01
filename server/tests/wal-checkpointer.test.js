// The first big COMMIT after boot (NPC flush) ran SQLite's synchronous
// auto-checkpoint on the event loop: 10.5 s in #1940's syncIo. wal-checkpointer
// moves checkpoints to a worker connection; these pin that it really checkpoints,
// that the main connection no longer does, and every fallback path.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { startWalCheckpointer, walCheckpointerEnabled } from "../lib/wal-checkpointer.js";

const wal = (p) => { try { return statSync(`${p}-wal`).size; } catch { return 0; } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 25)); } };

function bigWrite(db, rows = 4000) {
  db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = db.prepare("INSERT OR REPLACE INTO t VALUES (?, ?)");
  db.transaction(() => { for (let i = 0; i < rows; i++) ins.run(i, "x".repeat(1500)); })();
}

describe("startWalCheckpointer gating", () => {
  it("is off with the kill switch, under test env, and for :memory:", () => {
    const o = { thresholdBytes: 1, onReady() {}, onFallback() {} };
    assert.equal(startWalCheckpointer("/x/db", { ...o, env: { CONCORD_WAL_CHECKPOINT_WORKER: "0" } }), null);
    assert.equal(startWalCheckpointer("/x/db", { ...o, env: { NODE_ENV: "test" } }), null);
    assert.equal(startWalCheckpointer(":memory:", { ...o, env: {}, force: true }), null);
  });
});

describe("worker checkpoints off the main connection", () => {
  it("main with autocheckpoint=0 keeps a big WAL; the worker then checkpoints it fully", async () => {
    const dir = mkdtempSync(join(tmpdir(), "walck-"));
    const p = join(dir, "t.db");
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL");
    bigWrite(db, 10); // create file + WAL
    let ready = false; const results = [];
    const h = startWalCheckpointer(p, {
      env: {}, force: true, thresholdBytes: 256 * 1024, intervalMs: 100,
      onReady: () => { ready = true; db.pragma("wal_autocheckpoint = 0"); },
      onResult: (r) => results.push(r),
      onFallback: (why) => { throw new Error(`unexpected fallback ${why}`); },
    });
    try {
      await until(() => ready);
      bigWrite(db, 4000); // ~6 MB of WAL, no inline checkpoint now
      assert.ok(wal(p) > 1024 * 1024, "main commit did not checkpoint inline");
      await until(() => results.some((r) => r.busy === 0 && r.log > 0 && r.log === r.checkpointed));
      const r = results.find((x) => x.log === x.checkpointed);
      assert.ok(r.walBytes >= 256 * 1024 && r.ms >= 0);
      const before = wal(p);
      bigWrite(db, 4000); // WAL restarts from the top once fully checkpointed
      assert.ok(wal(p) <= before * 1.2, "WAL file is reused, not growing without bound");
      assert.equal(db.prepare("SELECT count(*) c FROM t").get().c, 4000, "no data lost");
    } finally { h?.stop(); db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("fallbacks re-enable the inline checkpoint", () => {
  const mkWorker = () => { const w = new EventEmitter(); w.unref = () => {}; w.terminate = () => { w.terminated = true; }; return w; };

  it("worker error, early exit, fatal message and spawn failure all fall back once", () => {
    const run = (trigger) => {
      const w = mkWorker(); const calls = [];
      startWalCheckpointer("/x/db", { env: {}, force: true, thresholdBytes: 10, onReady() {}, onFallback: (r) => calls.push(r), WorkerCtor: function () { return w; } });
      trigger(w); trigger(w);
      return { calls, w };
    };
    assert.match(run((w) => w.emit("error", new Error("boom"))).calls[0], /worker_error: boom/);
    assert.match(run((w) => w.emit("exit", 1)).calls[0], /worker_exit_1/);
    assert.match(run((w) => w.emit("message", { type: "fatal", error: "cannot open" })).calls[0], /worker_fatal: cannot open/);
    const r = run((w) => w.emit("error", new Error("x")));
    assert.equal(r.calls.length, 1, "only once");
    assert.equal(r.w.terminated, true);
    const calls = [];
    startWalCheckpointer("/x/db", { env: {}, force: true, thresholdBytes: 10, onReady() {}, onFallback: (x) => calls.push(x), WorkerCtor: function () { throw new Error("no threads"); } });
    assert.match(calls[0], /spawn_failed: no threads/);
  });

  it("a big WAL that checkpoints fully is not starvation; three incomplete runs over the cap are", () => {
    const w = mkWorker(); const calls = [];
    startWalCheckpointer("/x/db", { env: {}, force: true, thresholdBytes: 100, hardCapBytes: 1000, onReady() {}, onFallback: (r) => calls.push(r), WorkerCtor: function () { return w; } });
    const big = (log, checkpointed) => w.emit("message", { type: "result", ms: 5, walBytes: 1500, busy: 0, log, checkpointed });
    big(500, 500); big(500, 500); big(500, 500); big(500, 500); // fresh-boot WAL, fully checkpointed each time
    assert.equal(calls.length, 0);
    big(500, 100); big(500, 100); // two incomplete
    big(500, 500); // a complete run resets the count
    big(500, 100); big(500, 100);
    assert.equal(calls.length, 0);
    big(500, 100);
    assert.match(calls[0], /wal_starved: 1500 bytes, 100\/500 frames/);
  });

  it("ready fires onReady exactly once", () => {
    const w = mkWorker(); let n = 0;
    startWalCheckpointer("/x/db", { env: {}, force: true, thresholdBytes: 1, onReady: () => n++, onFallback() {}, WorkerCtor: function () { return w; } });
    w.emit("message", { type: "ready" }); w.emit("message", { type: "ready" });
    assert.equal(n, 1);
  });
});

describe("server.js wiring", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  it("inline autocheckpoint is only switched off from onReady and restored on fallback", () => {
    assert.match(src, /_walCheckpointer = startWalCheckpointer\(DB_PATH, \{[\s\S]*?onReady: \(\) => \{ db\.pragma\("wal_autocheckpoint = 0"\)/);
    assert.match(src, /onFallback: \(reason\) => \{ try \{ db\.pragma\(`wal_autocheckpoint = \$\{walPages\}`\)/);
    assert.match(src, /_walCheckpointer\?\.stop\(\);[\s\S]*?structuredLog\("info", "shutdown_closing_database"/);
    assert.match(src, /db\.pragma\("analysis_limit = 1000"\);/);
  });
});

describe("walCheckpointerEnabled mirrors the start gating", () => {
  it("agrees with startWalCheckpointer for the kill switch, test env, :memory: and force", () => {
    assert.equal(walCheckpointerEnabled("/x/db", { env: { CONCORD_WAL_CHECKPOINT_WORKER: "0" } }), false);
    assert.equal(walCheckpointerEnabled("/x/db", { env: { NODE_ENV: "test" } }), false);
    assert.equal(walCheckpointerEnabled("/x/db", { env: { CONCORD_NO_LISTEN: "true" } }), false);
    assert.equal(walCheckpointerEnabled(":memory:", { env: {}, force: true }), false);
    assert.equal(walCheckpointerEnabled("", { env: {} }), false);
    assert.equal(walCheckpointerEnabled("/x/db", { env: {} }), true);
    assert.equal(walCheckpointerEnabled("/x/db", { env: { NODE_ENV: "test" }, force: true }), true);
  });
});

describe("inline checkpoint stays off until the worker is up, and comes back if it never is", () => {
  const fakeWorker = (sendReady) => class extends EventEmitter {
    constructor() { super(); if (sendReady) setTimeout(() => this.emit("message", { type: "ready" }), 5); }
    terminate() {} unref() {}
  };
  it("no ready within readyTimeoutMs -> onFallback('ready_timeout_...'), so the caller re-enables inline checkpointing", async () => {
    let reason = null; let ready = false;
    startWalCheckpointer("/x/db", { thresholdBytes: 1, env: {}, readyTimeoutMs: 40, WorkerCtor: fakeWorker(false), onReady() { ready = true; }, onFallback(r) { reason = r; } });
    await until(() => reason !== null, 2000);
    assert.match(reason, /^ready_timeout_40ms$/);
    assert.equal(ready, false);
  });
  it("a ready worker cancels the timeout (no late fallback)", async () => {
    let reason = null; let ready = false;
    startWalCheckpointer("/x/db", { thresholdBytes: 1, env: {}, readyTimeoutMs: 60, WorkerCtor: fakeWorker(true), onReady() { ready = true; }, onFallback(r) { reason = r; } });
    await until(() => ready, 2000);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(reason, null);
  });
});

describe("the first write after reopening a big WAL (the dtu-ownership boot INSERT, 14 s live)", () => {
  // A child writes ~30 MB into the WAL with autocheckpoint off and SIGKILLs itself, leaving an unclean WAL
  // exactly like a restart of the live server (64 MB WAL, nothing backfilled).
  function leaveBigWal() {
    const dir = mkdtempSync(join(tmpdir(), "walfirst-"));
    const p = join(dir, "t.db");
    const code = `const D=require(${JSON.stringify(createRequireTarget())});const db=new D(process.argv[1]);
      db.pragma("journal_mode=WAL");db.pragma("wal_autocheckpoint=0");db.pragma("synchronous=NORMAL");
      db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");const i=db.prepare("INSERT INTO t VALUES(?,?)");
      db.transaction(()=>{for(let n=0;n<10000;n++)i.run(n,"x".repeat(3000))})();process.kill(process.pid,"SIGKILL");`;
    spawnSync(process.execPath, ["-e", code, p]);
    return p;
  }
  function createRequireTarget() { return new URL("../node_modules/better-sqlite3", import.meta.url).pathname; }
  const dbSize = (p) => statSync(p).size;

  it("with the inline auto-checkpoint on (autocheckpoint 8192 pages = the old setting) the first COMMIT backfills the WAL synchronously", () => {
    const p = leaveBigWal();
    assert.ok(wal(p) > 8 * 1024 * 1024, `unclean WAL left behind: ${wal(p)}`);
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 8192");
    const before = dbSize(p);
    db.prepare("INSERT OR REPLACE INTO t VALUES (?, ?)").run(5, "y");
    assert.ok(dbSize(p) > before + 1024 * 1024, "the first write ran the checkpoint inline (main db file grew by the backfilled pages)");
    db.close(); rmSync(p.replace(/t\.db$/, ""), { recursive: true, force: true });
  });

  it("with wal_autocheckpoint = 0 from open (what server.js now sets when the worker will run) the first COMMIT does no checkpoint work", () => {
    const p = leaveBigWal();
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 0");
    const before = dbSize(p);
    db.prepare("INSERT OR REPLACE INTO t VALUES (?, ?)").run(5, "y");
    assert.equal(dbSize(p), before, "no backfill into the main db file on the main thread");
    db.close(); rmSync(p.replace(/t\.db$/, ""), { recursive: true, force: true });
  });
});

describe("server.js opens with the inline checkpoint already off when the worker will run", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  it("wal_autocheckpoint is derived from walCheckpointerEnabled at open", () => {
    assert.match(src, /const _walWorkerOn = walCheckpointerEnabled\(DB_PATH\);\s*\n\s*db\.pragma\(`wal_autocheckpoint = \$\{_walWorkerOn \? 0 : walPages\}`\);/);
  });
});

describe("boot window: the worker copies the boot's WAL in small slices, not one multi-second burst", () => {
  // The #1961 boot wrote ~20k frames (80 MB) with the main connection's inline checkpoint off; one checkpoint 10 s
  // in copied it all in one go (8.5 s), and the main thread's reads queued behind it (7.3 s and 11.4 s blocks).
  async function run(workerOpts) {
    const dir = mkdtempSync(join(tmpdir(), "walboot-"));
    const p = join(dir, "t.db");
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL"); db.pragma("wal_autocheckpoint = 0");
    bigWrite(db, 10);
    const results = [];
    const h = startWalCheckpointer(p, {
      thresholdBytes: 1, force: true, env: {}, ...workerOpts,
      onReady() {}, onFallback() {}, onResult: (r) => results.push(r),
    });
    const end = Date.now() + 2600;
    let i = 0;
    while (Date.now() < end) { // a boot-like writer: steady ~150 frames per 100 ms
      db.transaction(() => { const ins = db.prepare("INSERT OR REPLACE INTO t VALUES (?, ?)"); for (let k = 0; k < 400; k++) ins.run((i++) % 9000, "x".repeat(1500)); })();
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    h.stop(); db.close(); rmSync(dir, { recursive: true, force: true });
    return results.filter((r) => typeof r.log === "number");
  }
  it("fast boot cadence keeps each checkpoint to a slice of what a single late checkpoint copies", async () => {
    const slow = await run({ intervalMs: 1500, bootWindowMs: 0 });          // old behaviour: first checkpoint at the interval
    const fast = await run({ intervalMs: 1500, bootIntervalMs: 100, bootWindowMs: 60_000 });
    const max = (rs) => Math.max(...rs.map((r) => r.log));
    assert.ok(slow.length >= 1 && fast.length >= 5, `slow=${slow.length} fast=${fast.length}`);
    assert.ok(max(fast) * 3 < max(slow), `largest single slice: fast ${max(fast)} frames vs one late checkpoint ${max(slow)}`);
    assert.ok(fast.every((r) => r.busy === 0), "never busy: PASSIVE does not block the writer");
    assert.ok(fast.every((r) => r.early === true) && slow.every((r) => r.early === false), "results are tagged early only inside the boot window");
  });
});

describe("shutdown does no synchronous checkpoint (the launchd stop window is ~5 s)", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  it("the shutdown callback never runs wal_checkpoint, and early fast results are not logged unless slow", () => {
    const cb = src.slice(src.indexOf("registerShutdownCallback(() => {\n    if (_shutdownDbClosed) return;"), src.indexOf('structuredLog("info", "shutdown_database_closed"'));
    assert.ok(cb.length > 200, "found the db shutdown callback");
    assert.doesNotMatch(cb, /wal_checkpoint|truncateWalForShutdown/);
    assert.match(cb, /db\.close\(\);/);
    assert.match(src, /if \(r\.early && !r\.forced && !r\.failed && !r\.busy && r\.ms < 100\) return;/);
  });
});

describe("shutdown drain: checkpointNow() empties the backlog off the main thread", () => {
  async function leftBehind(askNow) {
    const dir = mkdtempSync(join(tmpdir(), "waldrain-"));
    const p = join(dir, "t.db");
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL"); db.pragma("wal_autocheckpoint = 0");
    bigWrite(db, 6000); // ~9 MB of frames, all un-backfilled: main db file is still tiny
    const base = statSync(p).size;
    const results = [];
    const h = startWalCheckpointer(p, {
      thresholdBytes: 1_000_000_000, // the periodic tick would NOT checkpoint (below threshold) ...
      intervalMs: 600_000, bootWindowMs: 0, force: true, env: {},
      onReady() {}, onFallback() {}, onResult: (r) => results.push(r),
    });
    await new Promise((r) => setTimeout(r, 300)); // worker up
    const t0 = Date.now();
    if (askNow) h.checkpointNow(); // ... but a shutdown drain request must, regardless of the threshold
    let grew = false;
    while (Date.now() - t0 < 3000) { if (statSync(p).size > base + 1024 * 1024) { grew = true; break; } await new Promise((r) => setTimeout(r, 25)); }
    const drainedMs = Date.now() - t0;
    h.stop(); db.close(); rmSync(dir, { recursive: true, force: true });
    return { grew, drainedMs, results };
  }
  it("a drain request backfills the WAL into the main db file (even below the periodic threshold); without it nothing happens", async () => {
    const control = await leftBehind(false);
    assert.equal(control.grew, false, "control: no request, no checkpoint");
    const drained = await leftBehind(true);
    assert.equal(drained.grew, true, "the worker checkpointed on request");
    assert.ok(drained.drainedMs < 2500, `drained in ${drained.drainedMs} ms, off the caller's thread`);
    assert.ok(drained.results.some((r) => r.forced === true && r.busy === 0), "reported as a forced result");
  });
  it("checkpointNow is a no-op after stop() and never throws", () => {
    const fake = class extends EventEmitter { postMessage() { throw new Error("gone"); } terminate() {} unref() {} };
    const h = startWalCheckpointer("/x/db", { thresholdBytes: 1, env: {}, WorkerCtor: fake, onReady() {}, onFallback() {} });
    h.checkpointNow(); // postMessage throws: swallowed
    h.stop(); h.checkpointNow();
  });
  it("server.js asks for the drain right after the final state save, before the feed-flush wait, and never checkpoints synchronously", () => {
    const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    assert.match(src, /"shutdown_state_saved", \{\}\);[\s\S]*?\} catch \(e\) \{\s*\n\s*console\.error\("\[Shutdown\] State save failed:", e\.message\);\s*\n\s*\}\s*\n[\s\S]*?try \{ _walCheckpointer\?\.checkpointNow\?\.\(\); \} catch/);
    const cb = src.slice(src.indexOf("registerShutdownCallback(() => {\n    if (_shutdownDbClosed) return;"), src.indexOf('structuredLog("info", "shutdown_database_closed"'));
    assert.doesNotMatch(cb, /wal_checkpoint/);
  });
});

describe("the worker reports what the previous process left un-copied", () => {
  it("a database with an un-backfilled WAL yields a backlog message (log > checkpointed) before ready, and copies nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "walbl-"));
    const p = join(dir, "t.db");
    const db = new Database(p);
    db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 0");
    bigWrite(db, 3000);
    const base = statSync(p).size;
    let backlog = null; let ready = false; let order = "";
    const h = startWalCheckpointer(p, {
      thresholdBytes: 1_000_000_000, intervalMs: 600_000, bootWindowMs: 0, force: true, env: {},
      onBacklog: (b) => { backlog = b; order += "b"; }, onReady() { ready = true; order += "r"; }, onFallback() {},
    });
    await until(() => ready, 4000);
    h.stop();
    assert.ok(backlog && backlog.log > 100 && backlog.checkpointed === 0, JSON.stringify(backlog));
    assert.equal(order, "br", "backlog is reported before ready");
    assert.equal(statSync(p).size, base, "the probe copied nothing");
    db.close(); rmSync(dir, { recursive: true, force: true });
  });
  it("server.js logs it as wal_boot_backlog", () => {
    assert.match(readFileSync(new URL("../server.js", import.meta.url), "utf8"), /onBacklog: \(b\) => structuredLog\("info", "wal_boot_backlog"/);
  });
});
