// The post-start SQLite snapshot must not run on the server event loop.
// An ~8.9 GB one-step db.backup() on the main thread stalled the loop for
// up to 8.4s and the shedder 503'd login. The copy still uses one native
// step (so concurrent writers cannot restart it between pages) but that
// step lives in a worker. While the worker is in flight, authenticated
// and login traffic stay admitted.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../lib/detectors/command-injection-detector.js";
import {
  backupDatabaseOffLoop,
  isSqliteBackupRunning,
  _setSqliteBackupRunningForTest,
} from "../lib/sqlite-online-backup.js";
import {
  createLoadSheddingMiddleware,
  _resetAdmissionForTest,
  _setStrikesForTest,
} from "../lib/request-admission.js";
import { _setLagMsForTest, stopEventLoopPressureMonitor } from "../lib/event-loop-pressure.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fnBody(needle, endMarker) {
  const raw = readFileSync(path.join(ROOT, "server.js"), "utf8");
  const start = raw.indexOf(needle);
  assert.ok(start > 0, `${needle} not found`);
  const endAt = raw.indexOf(endMarker, start);
  return stripComments(raw.slice(start, endAt > start ? endAt : start + 8000));
}

describe("runBackup — SQLite snapshot is off the main loop", () => {
  const body = fnBody("async function runBackup()", "backup_complete");

  it("does not call db.backup on the server thread", () => {
    assert.ok(!body.includes("_db.backup("), "runBackup still snapshots on the main thread");
    assert.match(body, /backupDatabaseOffLoop\(DB_PATH, snapPath\)/);
  });

  it("keeps the JSON-fallback stream copy", () => {
    assert.match(body, /fs\.existsSync\(DB_PATH\)/);
    assert.match(body, /fs\.createReadStream\(DB_PATH\)/);
  });
});

describe("backupDatabaseOffLoop", () => {
  afterEach(() => {
    _setSqliteBackupRunningForTest(false);
  });

  it("reports in-flight while the worker runs, then clears", async () => {
    let seen = false;
    const fake = class {
      constructor() {
        seen = isSqliteBackupRunning();
        queueMicrotask(() => this._message?.({ ok: true }));
      }
      once(event, fn) {
        if (event === "message") this._message = fn;
      }
    };
    const result = await backupDatabaseOffLoop("/tmp/a.db", "/tmp/a.snap", { Worker: fake, workerUrl: new URL("file:///tmp/unused.js") });
    assert.equal(seen, true);
    assert.deepEqual(result, { ok: true });
    assert.equal(isSqliteBackupRunning(), false);
  });

  it("rejects a worker failure and clears the in-flight flag", async () => {
    const fake = class {
      constructor() {
        queueMicrotask(() => this._message?.({ ok: false, error: "disk full" }));
      }
      once(event, fn) {
        if (event === "message") this._message = fn;
      }
    };
    await assert.rejects(
      () => backupDatabaseOffLoop("/tmp/a.db", "/tmp/a.snap", { Worker: fake, workerUrl: new URL("file:///tmp/unused.js") }),
      /disk full/,
    );
    assert.equal(isSqliteBackupRunning(), false);
  });
});

describe("admission during the startup SQLite backup", () => {
  afterEach(() => {
    _setSqliteBackupRunningForTest(false);
    _setLagMsForTest(0);
    _resetAdmissionForTest();
    stopEventLoopPressureMonitor();
    delete process.env.CONCORD_LOAD_SHED_LAG_MS;
    delete process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED;
  });

  function res() {
    return {
      statusCode: null,
      headers: {},
      body: null,
      set(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }

  it("admits login and an authenticated lens run, and still sheds anonymous traffic", () => {
    process.env.CONCORD_LOAD_SHED_LAG_MS = "300";
    process.env.CONCORD_LOAD_SHED_LAG_MS_PROTECTED = "900";
    _setLagMsForTest(5000);
    _setStrikesForTest(5);
    _setSqliteBackupRunningForTest(true);
    const middleware = createLoadSheddingMiddleware();

    let loginNext = false;
    middleware({ path: "/api/auth/login" }, res(), () => { loginNext = true; });
    assert.equal(loginNext, true);

    let lensNext = false;
    middleware({ path: "/api/lens/run", user: { id: "u1" } }, res(), () => { lensNext = true; });
    assert.equal(lensNext, true);

    let anonNext = false;
    const anon = res();
    middleware({ path: "/api/lens/run" }, anon, () => { anonNext = true; });
    assert.equal(anonNext, false);
    assert.equal(anon.statusCode, 503);
  });
});
