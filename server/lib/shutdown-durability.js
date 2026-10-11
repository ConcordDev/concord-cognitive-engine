// Durability stretch of graceful shutdown.
//
// #1147 stopped the feed without a dynamic import, but gracefulShutdown still
// awaited the HTTP request drain (setTimeout, up to SHUTDOWN_DRAIN_MS) between
// shutdown_feed_stopped and the db.close callback. That is a macrotask yield.
// A stall already on the queue runs first, and launchd bootout kills a user
// agent in about 5s — the same window — so the log ended at
// shutdown_feed_stopped with the handle still open.
//
// The caller (gracefulShutdown) now stops accept, sets the shutting-down
// guard, and — only when a response is actually in flight — waits on that
// response's finish/close with a single deadline capped at 1.5s
// (lib/shutdown-http.js) BEFORE calling this helper. This helper itself
// does not poll. Order here: flushFeed, then callbacks (seal + db.close),
// then afterClose (the long drain, after the handle is closed). A throw
// in the flush still runs the callbacks. process.exit from another signal
// handler during this stretch runs the callbacks and the caller's onExitRaced
// log before the real exit returns.

import fs from "node:fs";

/**
 * @param {{
 *   flushFeed: () => unknown,
 *   callbacks?: Array<() => unknown>,
 *   afterClose?: () => unknown,
 *   onFlushError?: (err: unknown) => void,
 *   onCallbackError?: (err: unknown) => void,
 *   onExitRaced?: (info: { code: number | undefined, stack: string }) => void,
 *   onFatal?: (err: unknown) => void,
 * }} opts
 */
export async function runShutdownDurability(opts) {
  const callbacks = Array.isArray(opts.callbacks) ? opts.callbacks : [];
  let callbacksRan = false;

  async function runCallbacks() {
    if (callbacksRan) return;
    callbacksRan = true;
    for (const cb of callbacks) {
      try {
        await cb();
      } catch (e) {
        try { opts.onCallbackError?.(e); } catch { /* logging must not skip the rest */ }
      }
    }
  }

  function runCallbacksSync() {
    if (callbacksRan) return;
    callbacksRan = true;
    for (const cb of callbacks) {
      try {
        const ret = cb();
        if (ret && typeof ret.then === "function") {
          const err = new Error("shutdown callback returned a promise during process.exit");
          try { opts.onCallbackError?.(err); } catch { /* */ }
        }
      } catch (e) {
        try { opts.onCallbackError?.(e); } catch { /* */ }
      }
    }
  }

  const origExit = process.exit;
  let exiting = false;
  function guardedExit(code) {
    if (exiting) return origExit.call(process, code);
    exiting = true;
    if (!callbacksRan) {
      const stack = new Error("process.exit during shutdown").stack;
      try { opts.onExitRaced?.({ code, stack }); } catch { /* */ }
      runCallbacksSync();
    }
    return origExit.call(process, code);
  }
  process.exit = guardedExit;

  try {
    try {
      await opts.flushFeed();
    } catch (e) {
      try { opts.onFlushError?.(e); }
      catch (logErr) {
        try { opts.onFatal?.(logErr); } catch { /* */ }
      }
    }
    await runCallbacks();
    if (typeof opts.afterClose === "function") {
      try { await opts.afterClose(); }
      catch (e) { try { opts.onFatal?.(e); } catch { /* */ } }
    }
  } catch (e) {
    try { opts.onFatal?.(e); } catch { /* */ }
    try { await runCallbacks(); } catch { /* */ }
  } finally {
    if (process.exit === guardedExit) process.exit = origExit;
  }
}

/**
 * One shutdown log line, written with fs.writeSync.
 * console.log on a pipe is buffered; process.exit and a kill during a later
 * timer wait drop whatever is still in that buffer. writeSync completes the
 * syscall before it returns, so the line is in the kernel before exit.
 *
 * @param {string} level
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 * @param {{ writeSync?: typeof import('node:fs').writeSync, fd?: number, json?: boolean }} [opts]
 */
export function writeShutdownLine(level, event, data = {}, opts = {}) {
  const writeSync = opts.writeSync || fs.writeSync;
  const fd = opts.fd ?? process.stdout?.fd ?? 1;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "concord-api",
    version: "1.0.0",
    ...data,
  };
  let line;
  if (opts.json === false) {
    const prefix = `[${entry.timestamp}] [${String(level).toUpperCase()}]`;
    const details = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
    line = `${prefix} ${event}${details}\n`;
  } else {
    line = `${JSON.stringify(entry)}\n`;
  }
  writeSync(fd, line);
  return entry;
}
