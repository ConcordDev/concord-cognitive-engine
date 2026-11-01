import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  installSlowSqlite, installSlowChildProcess, installSlowNativeOnce,
  slowSyncIoSince, _resetSlowSyncIoForTest,
} from "../lib/slow-sync-io.js";

// Fake clock: every wrapped call "takes" `step` ms (hr is read twice per call).
function clock(step) { let t = 0, n = 0; return () => (n++ % 2 === 0 ? t : (t += step)); }

describe("installSlowSqlite", () => {
  let h;
  afterEach(() => { h?.uninstall(); h = null; _resetSlowSyncIoForTest(); });

  it("records a slow statement by SQL head, never the bound values", () => {
    h = installSlowSqlite(Database, { thresholdMs: 100, hr: clock(250) });
    const db = new Database(":memory:");
    db.exec("CREATE TABLE users (id TEXT, token TEXT)");
    db.prepare("INSERT INTO users (id, token) VALUES (?, ?)").run("u1", "SECRET-VALUE-123");
    const rows = slowSyncIoSince(0);
    const fns = rows.map((r) => r.fn);
    assert.ok(fns.includes("sqlite.exec"));
    assert.ok(fns.includes("sqlite.prepare"));
    const run = rows.find((r) => r.fn === "sqlite.run");
    assert.match(run.target, /^INSERT INTO users \(id, token\) VALUES \(\?, \?\)$/);
    assert.ok(!JSON.stringify(rows).includes("SECRET-VALUE-123"));
    assert.ok(rows.every((r) => r.ms >= 250 && Array.isArray(r.frames)));
  });

  it("times get/all/iterate/pragma too and still returns the real results", () => {
    h = installSlowSqlite(Database, { thresholdMs: 100, hr: clock(250) });
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    assert.deepEqual(db.prepare("SELECT a FROM t").get(), { a: 1 });
    assert.equal(db.prepare("SELECT a FROM t").all().length, 1);
    assert.equal([...db.prepare("SELECT a FROM t").iterate()].length, 1);
    db.pragma("user_version = 3");
    const fns = new Set(slowSyncIoSince(0).map((r) => r.fn));
    for (const f of ["sqlite.get", "sqlite.all", "sqlite.iterate", "sqlite.pragma"]) assert.ok(fns.has(f), f);
  });

  it("transaction COMMIT is caught through Statement.run", () => {
    h = installSlowSqlite(Database, { thresholdMs: 100, hr: clock(250) });
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    db.transaction(() => db.prepare("INSERT INTO t VALUES (1)").run())();
    assert.ok(slowSyncIoSince(0).some((r) => r.fn === "sqlite.run" && /COMMIT/i.test(r.target)));
  });

  it("records nothing under the threshold", () => {
    h = installSlowSqlite(Database, { thresholdMs: 100, hr: clock(1) });
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (a INTEGER)");
    db.prepare("SELECT 1").get();
    assert.equal(slowSyncIoSince(0).length, 0);
  });

  it("uninstall restores the originals and install is idempotent", () => {
    const before = Database.prototype.prepare;
    h = installSlowSqlite(Database, { thresholdMs: 100 });
    const second = installSlowSqlite(Database, { thresholdMs: 100 });
    assert.notEqual(Database.prototype.prepare, before);
    second.uninstall(); // no-op: nothing of its own was wrapped
    assert.notEqual(Database.prototype.prepare, before);
    h.uninstall(); h = null;
    assert.equal(Database.prototype.prepare, before);
  });
});

describe("installSlowChildProcess", () => {
  it("records the command name only, not args or a shell string's tail", () => {
    _resetSlowSyncIoForTest();
    const cp = {
      spawnSync() { return { status: 0 }; },
      execSync() { return ""; },
      execFileSync() { return ""; },
    };
    const h = installSlowChildProcess(cp, { thresholdMs: 100, hr: clock(250) });
    cp.spawnSync("sh", ["-c", "echo TOPSECRET"]);
    cp.execSync("pgrep -f token=TOPSECRET");
    cp.execFileSync("git", ["log"]);
    const rows = slowSyncIoSince(0);
    assert.deepEqual(rows.map((r) => `${r.fn}:${r.target}`),
      ["child_process.spawnSync:sh", "child_process.execSync:pgrep", "child_process.execFileSync:git"]);
    assert.ok(!JSON.stringify(rows).includes("TOPSECRET"));
    h.uninstall();
    _resetSlowSyncIoForTest();
  });
});

describe("kill switch + wiring", () => {
  it("CONCORD_SLOW_SYNC_IO=0 installs nothing", () => {
    assert.equal(installSlowNativeOnce(Database, { CONCORD_SLOW_SYNC_IO: "0" }), null);
  });
  it("server.js installs it right after better-sqlite3 loads", () => {
    const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    assert.match(src, /Database = \(await import\("better-sqlite3"\)\)\.default;[^\n]*\ninstallSlowNativeOnce\(Database\);/);
    assert.match(src, /import \{ installSlowSyncIoOnce, installSlowNativeOnce,/);
  });
});
