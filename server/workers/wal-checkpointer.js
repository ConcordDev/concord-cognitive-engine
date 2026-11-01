// Worker for server/lib/wal-checkpointer.js.
// A checkpoint copies WAL frames into the main DB file and fsyncs it. SQLite's
// auto-checkpoint does that inside whichever COMMIT crosses wal_autocheckpoint,
// on the server's event loop; this worker does it on its own connection and
// thread instead. PASSIVE never blocks writers, and it does not weaken
// durability (synchronous stays NORMAL on the main connection; the checkpoint
// still fsyncs). Once every frame is checkpointed the next writer restarts the
// WAL from the top, so the file stops growing.

import { parentPort, workerData } from "node:worker_threads";
import { statSync } from "node:fs";
import Database from "better-sqlite3";

const { dbPath, intervalMs, thresholdBytes } = workerData;
const walPath = `${dbPath}-wal`;
let db;
try {
  db = new Database(dbPath, { fileMustExist: true });
  db.pragma("busy_timeout = 2000");
  db.pragma("wal_autocheckpoint = 0"); // this connection never writes; belt and braces
  parentPort.postMessage({ type: "ready" });
} catch (e) {
  parentPort.postMessage({ type: "fatal", error: String(e?.message || e) });
  process.exit(1);
}

let running = false;
function tick() {
  if (running) return;
  running = true;
  try {
    let walBytes = 0;
    try { walBytes = statSync(walPath).size; } catch { /* no WAL yet */ }
    if (walBytes < thresholdBytes) return;
    const t0 = performance.now();
    const [r] = db.pragma("wal_checkpoint(PASSIVE)");
    parentPort.postMessage({
      type: "result",
      ms: Math.round(performance.now() - t0),
      walBytes,
      busy: r?.busy ?? null,
      log: r?.log ?? null,
      checkpointed: r?.checkpointed ?? null,
    });
  } catch (e) {
    parentPort.postMessage({ type: "error", error: String(e?.message || e) });
  } finally {
    running = false;
  }
}
setInterval(tick, intervalMs);
