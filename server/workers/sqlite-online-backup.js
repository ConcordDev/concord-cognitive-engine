// Worker for server/lib/sqlite-online-backup.js.
// One native backup step copies the whole file. That blocks this worker,
// not the server event loop. A small page budget on the main thread both
// stalled requests and let concurrent writers restart the backup.

import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

const { dbPath, snapPath } = workerData;
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  await db.backup(snapPath, { progress: () => 0x7fffffff });
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e?.message || e) });
} finally {
  try { db?.close(); } catch { /* already closed */ }
}
