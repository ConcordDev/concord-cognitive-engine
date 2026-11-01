/**
 * wal-checkpointer: take SQLite WAL checkpoints off the event loop.
 *
 * #1938-#1940's syncIo kept naming whichever write transaction came first after
 * boot: a 10.5 s COMMIT in NPCSimulator._flushPendingPersists (sys CPU 4.7 s,
 * 14 major faults, no BUSY). The NPC flush dirties about one autocheckpoint
 * worth of WAL (measured ~30 MB against wal_autocheckpoint = 8192 pages = 32 MB),
 * so its COMMIT is the one that runs SQLite's synchronous checkpoint on the main
 * thread. A worker thread with its own connection runs PASSIVE checkpoints
 * instead; the main connection then sets wal_autocheckpoint = 0.
 *
 * Safety: the inline auto-checkpoint stays ON until the worker reports ready;
 * if the worker dies, errors, or the WAL passes `hardCapBytes` (checkpointing
 * stays over the cap across STARVE_RUNS consecutive checkpoints that could not
 * finish, i.e. checkpointing is being starved), onFallback fires and the caller turns the inline
 * auto-checkpoint back on, i.e. today's behaviour. Kill switch:
 * CONCORD_WAL_CHECKPOINT_WORKER=0. Off under NODE_ENV=test and for :memory: DBs.
 */
import { Worker } from "node:worker_threads";
import { statSync } from "node:fs";

const STARVE_RUNS = 3;
// The caller may switch the inline auto-checkpoint off BEFORE the worker is ready (see walCheckpointerEnabled).
// If the worker then never reports ready, nothing would checkpoint: give up after this long and fall back.
const DEFAULT_READY_TIMEOUT_MS = 120_000;

/**
 * Would startWalCheckpointer start a worker for this DB? Callers use it to switch the main connection's
 * inline wal_autocheckpoint off at open instead of waiting for onReady: the worker's "ready" message needs an
 * event-loop turn, and boot is synchronous up to listen, so until then the first COMMIT after boot (the
 * dtu-ownership INSERT OR REPLACE, 14.2 s in #1955's syncIo) ran SQLite's inline checkpoint of the whole
 * 64 MB WAL the previous run left behind.
 */
export function walCheckpointerEnabled(dbPath, opts = {}) {
  const env = opts.env || process.env;
  if (env.CONCORD_WAL_CHECKPOINT_WORKER === "0") return false;
  if (!opts.force && (env.NODE_ENV === "test" || env.CONCORD_NO_LISTEN === "true")) return false;
  if (!dbPath || dbPath === ":memory:") return false;
  return true;
}

/**
 * @param {string} dbPath
 * @param {object} opts
 * @param {number} opts.thresholdBytes   checkpoint when the WAL is at least this big
 * @param {number} [opts.intervalMs=10000]
 * @param {number} [opts.hardCapBytes]   fall back to inline checkpointing above this (default 4x threshold)
 * @param {() => void} opts.onReady      worker is up: caller sets wal_autocheckpoint = 0 (idempotent if already 0)
 * @param {number} [opts.readyTimeoutMs=120000] no ready by then: onFallback (inline checkpointing comes back)
 * @param {(info: object) => void} [opts.onResult]
 * @param {(reason: string) => void} opts.onFallback  caller re-enables inline auto-checkpoint
 * @param {object} [opts.env]
 * @param {typeof Worker} [opts.WorkerCtor]
 * @param {URL} [opts.workerUrl]
 * @returns {{ stop(): void } | null}
 */
export function startWalCheckpointer(dbPath, opts) {
  if (!walCheckpointerEnabled(dbPath, opts)) return null;
  const intervalMs = opts.intervalMs || 10_000;
  const hardCapBytes = opts.hardCapBytes || opts.thresholdBytes * 4;
  const WorkerCtor = opts.WorkerCtor || Worker;
  const workerUrl = opts.workerUrl || new URL("../workers/wal-checkpointer.js", import.meta.url);

  let worker;
  let active = false;
  let done = false;
  let starved = 0;
  let readyTimer = null;
  const fallback = (reason) => {
    if (done) return;
    done = true;
    clearTimeout(readyTimer);
    try { worker?.terminate?.(); } catch { /* already gone */ }
    try { opts.onFallback(reason); } catch { /* informational */ }
  };
  try {
    worker = new WorkerCtor(workerUrl, { workerData: { dbPath, intervalMs, thresholdBytes: opts.thresholdBytes } });
  } catch (e) {
    fallback(`spawn_failed: ${e?.message || e}`);
    return null;
  }
  worker.unref?.();
  readyTimer = setTimeout(() => { if (!active) fallback(`ready_timeout_${opts.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS}ms`); }, opts.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS);
  readyTimer.unref?.();
  worker.on("message", (msg) => {
    if (!msg || done) return;
    if (msg.type === "ready" && !active) {
      active = true;
      clearTimeout(readyTimer);
      try { opts.onReady(); } catch (e) { fallback(`ready_failed: ${e?.message || e}`); }
    } else if (msg.type === "result") {
      try { opts.onResult?.(msg); } catch { /* informational */ }
      // A big WAL alone is not starvation (a fresh boot's migrations leave one and
      // the first checkpoint clears it). Starved = over the cap AND the checkpoint
      // could not copy every frame, STARVE_RUNS times running.
      if (msg.walBytes > hardCapBytes && msg.log !== msg.checkpointed) starved += 1; else starved = 0;
      if (starved >= STARVE_RUNS) fallback(`wal_starved: ${msg.walBytes} bytes, ${msg.checkpointed}/${msg.log} frames`);
    } else if (msg.type === "fatal") {
      fallback(`worker_fatal: ${msg.error}`);
    } else if (msg.type === "error") {
      try { opts.onResult?.({ ...msg, failed: true }); } catch { /* informational */ }
    }
  });
  worker.on("error", (e) => fallback(`worker_error: ${e?.message || e}`));
  worker.on("exit", (code) => { if (!done) fallback(`worker_exit_${code}`); });
  return { stop() { done = true; clearTimeout(readyTimer); try { worker.terminate(); } catch { /* already gone */ } } };
}

/**
 * Empty the WAL during graceful shutdown, so the next boot starts with nothing to checkpoint.
 *
 * Why: since #1941 a second (worker) connection is open when the main connection closes, so SQLite's
 * close-time checkpoint (which only runs for the LAST connection) does not happen: `shutdown_database_closed`
 * took 22 ms with a 64-88 MB WAL left behind. The next boot then had to checkpoint it while serving: the
 * worker's first pass took 14.1 s and the first main-thread write after listen blocked 11.4 s behind it
 * (#1958 boot, macro_call_log INSERT; sys CPU 4.8 s, 22,890 voluntary context switches, i.e. reads queued
 * behind the checkpoint's writes). Doing that copy here, on a quiet disk with nothing serving, moves the I/O
 * out of the boot window. A truncated WAL also makes the first write after boot free (measured locally 0 ms
 * vs ~400 ms for a 124 MB WAL).
 *
 * Safe to call on a sealed connection (better-sqlite3's pragma() uses the native handle, not the patched
 * prepare/exec). Bounded wait: busy_timeout is lowered so a still-running worker checkpoint cannot hold
 * shutdown; a busy or failed TRUNCATE just leaves the WAL as it is today. Never throws.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ busyTimeoutMs?: number, walPath?: string }} [opts]
 * @returns {{ ok: boolean, ms: number, busy?: number, log?: number, checkpointed?: number, walBytes?: number, error?: string }}
 */
export function truncateWalForShutdown(db, opts = {}) {
  const t0 = performance.now();
  try {
    if (!db || db.open === false || db.memory === true) return { ok: false, ms: 0, error: "not_applicable" };
    try { db.pragma(`busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 3000))}`); } catch { /* keep the existing timeout */ }
    const [r] = db.pragma("wal_checkpoint(TRUNCATE)");
    let walBytes;
    try { walBytes = statSync(opts.walPath || `${db.name}-wal`).size; } catch { walBytes = 0; }
    return { ok: (r?.busy ?? 1) === 0, ms: Math.round(performance.now() - t0), busy: r?.busy, log: r?.log, checkpointed: r?.checkpointed, walBytes };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: String(e?.message || e) };
  }
}
