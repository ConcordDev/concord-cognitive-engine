// SQLite online backup off the server event loop.
//
// `better-sqlite3`'s db.backup() with a one-step page budget copies the
// whole database inside one native call. On the main thread that froze the
// loop for up to 8.4s (an ~8.9 GB database) in the first minutes after
// restart, and the shedder turned that stall into 503s. The one-step copy
// stays — a small page budget lets concurrent writers restart the backup
// for hours — but it runs in a worker, so the main loop keeps serving.
//
// While that worker is in flight, request admission does not shed
// authenticated or login traffic. Anonymous traffic can still shed.

import { Worker } from "node:worker_threads";

let _running = 0;

/** True while an off-loop SQLite snapshot is in progress. */
export function isSqliteBackupRunning() {
  return _running > 0;
}

/** Test-only. */
export function _setSqliteBackupRunningForTest(on) {
  _running = on ? 1 : 0;
}

/**
 * Copy `dbPath` to `snapPath` via SQLite's online backup API in a worker.
 * Resolves `{ ok: true }` or rejects. `deps.Worker` is for tests.
 *
 * @param {string} dbPath
 * @param {string} snapPath
 * @param {{ Worker?: typeof Worker, workerUrl?: URL }} [deps]
 */
export function backupDatabaseOffLoop(dbPath, snapPath, deps = {}) {
  const WorkerCtor = deps.Worker || Worker;
  const workerUrl = deps.workerUrl || new URL("../workers/sqlite-online-backup.js", import.meta.url);
  _running += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      _running = Math.max(0, _running - 1);
      if (err) reject(err);
      else resolve(value);
    };
    let worker;
    try {
      worker = new WorkerCtor(workerUrl, { workerData: { dbPath, snapPath } });
    } catch (err) {
      finish(err);
      return;
    }
    worker.once("message", (msg) => {
      if (msg?.ok) finish(null, msg);
      else finish(new Error(msg?.error || "sqlite_backup_failed"));
    });
    worker.once("error", (err) => finish(err));
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error(`sqlite backup worker exited ${code}`));
    });
  });
}
