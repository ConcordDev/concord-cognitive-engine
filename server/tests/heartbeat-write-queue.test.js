// Track A/B (event-loop unblocking audit) — regression test for the
// write-queueing shim that fixes a real, live bug: every already-`worker:true`
// heartbeat handler calls `db.prepare(sql).run(...)` directly, and a write
// against a readonly better-sqlite3 connection throws SQLITE_READONLY. This
// pins that (a) the bug is real against a REAL readonly connection (not a
// mock) and (b) the shim fixes it — reads pass through, writes queue instead
// of throwing, and the queued side effects replay correctly against a real
// writable connection.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { makeQueueingDb, WRITE_SQL_RE } from "../workers/heartbeat-write-queue.js";

describe("heartbeat write-queue shim", () => {
  let dbPath;
  let rwDb;
  let roDb;

  before(() => {
    dbPath = path.join(os.tmpdir(), `concord-hb-wq-${process.pid}-${Date.now()}.db`);
    rwDb = new Database(dbPath);
    rwDb.exec(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT, count INTEGER)`);
    rwDb.prepare(`INSERT INTO widgets (id, name, count) VALUES (1, 'seed', 10)`).run();
    roDb = new Database(dbPath, { readonly: true });
  });

  after(() => {
    try { roDb.close(); } catch { /* best-effort */ }
    try { rwDb.close(); } catch { /* best-effort */ }
    try { fs.unlinkSync(dbPath); } catch { /* best-effort */ }
    try { fs.unlinkSync(`${dbPath}-wal`); } catch { /* best-effort */ }
    try { fs.unlinkSync(`${dbPath}-shm`); } catch { /* best-effort */ }
  });

  it("proves the underlying bug: a raw write on a readonly connection throws", () => {
    assert.throws(
      () => roDb.prepare(`UPDATE widgets SET count = count + 1 WHERE id = 1`).run(),
      /readonly/i,
    );
  });

  it("WRITE_SQL_RE detects INSERT/UPDATE/DELETE/REPLACE, tolerates leading whitespace/comments", () => {
    assert.equal(WRITE_SQL_RE.test("INSERT INTO t VALUES (1)"), true);
    assert.equal(WRITE_SQL_RE.test("  \n  update t set x=1"), true);
    assert.equal(WRITE_SQL_RE.test("-- a comment\nDELETE FROM t"), true);
    assert.equal(WRITE_SQL_RE.test("REPLACE INTO t VALUES (1)"), true);
    assert.equal(WRITE_SQL_RE.test("SELECT * FROM t"), false);
    assert.equal(WRITE_SQL_RE.test("WITH x AS (SELECT 1) UPDATE t SET y=1"), false, "CTE-prefixed write is a documented miss — falls through to real stmt");
  });

  it("reads pass straight through to the real readonly statement", () => {
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);
    const row = shimmed.prepare(`SELECT * FROM widgets WHERE id = ?`).get(1);
    assert.equal(row.name, "seed");
    assert.equal(row.count, 10);
    assert.equal(sideEffects.length, 0);
  });

  it("a detected write queues instead of throwing, and returns a safe placeholder", () => {
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);
    const info = shimmed.prepare(`UPDATE widgets SET count = count + 1 WHERE id = ?`).run(1);
    assert.deepEqual(info, { changes: 0, lastInsertRowid: 0 });
    assert.equal(sideEffects.length, 1);
    assert.equal(sideEffects[0].kind, "db-write");
    assert.match(sideEffects[0].sql, /UPDATE widgets/);
    assert.deepEqual(sideEffects[0].params, [1]);
  });

  it("end-to-end: a handler using the shim, replayed against the real writable db, actually persists", () => {
    // Simulates exactly what heartbeat-pool.js's _applySideEffects does.
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);

    // A handler written the normal way, with zero knowledge of queueWrite.
    function fakeHandler({ db }) {
      const row = db.prepare(`SELECT count FROM widgets WHERE id = 1`).get();
      db.prepare(`UPDATE widgets SET count = ? WHERE id = 1`).run(row.count + 5);
      return { ok: true };
    }

    const result = fakeHandler({ db: shimmed });
    assert.equal(result.ok, true);
    assert.equal(sideEffects.length, 1);

    // Before replay, the real row is untouched.
    assert.equal(rwDb.prepare(`SELECT count FROM widgets WHERE id = 1`).get().count, 10);

    // Replay (mirrors heartbeat-pool.js#_applySideEffects).
    for (const eff of sideEffects) {
      if (eff.kind === "db-write") rwDb.prepare(eff.sql).run(...eff.params);
    }

    assert.equal(rwDb.prepare(`SELECT count FROM widgets WHERE id = 1`).get().count, 15);
  });

  it("exec() on a detected write queues a db-exec side effect instead of throwing", () => {
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);
    shimmed.exec(`INSERT INTO widgets (id, name, count) VALUES (2, 'bulk', 0)`);
    assert.equal(sideEffects.length, 1);
    assert.equal(sideEffects[0].kind, "db-exec");
  });

  it("exec() on a non-write statement passes through", () => {
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);
    // A pragma-shaped exec is harmless to run against the real readonly db.
    assert.doesNotThrow(() => shimmed.exec(`PRAGMA user_version`));
    assert.equal(sideEffects.length, 0);
  });

  it("transaction() wraps a function that still queues its inner writes individually", () => {
    const sideEffects = [];
    const shimmed = makeQueueingDb(roDb, sideEffects);
    const txn = shimmed.transaction((ids) => {
      for (const id of ids) {
        shimmed.prepare(`UPDATE widgets SET count = count + 1 WHERE id = ?`).run(id);
      }
    });
    txn([1, 1, 1]);
    assert.equal(sideEffects.length, 3);
    assert.ok(sideEffects.every((e) => e.kind === "db-write"));
  });

  it("returns null when handed a null db (worker DB failed to open)", () => {
    assert.equal(makeQueueingDb(null, []), null);
  });
});
