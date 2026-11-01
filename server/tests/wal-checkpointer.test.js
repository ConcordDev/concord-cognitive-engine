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
import { startWalCheckpointer } from "../lib/wal-checkpointer.js";

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
    assert.match(src, /_walCheckpointer\?\.stop\(\);[^\n]*\n\s*structuredLog\("info", "shutdown_closing_database"/);
    assert.match(src, /db\.pragma\("analysis_limit = 1000"\);/);
  });
});
