/**
 * slow-sync-io — names the synchronous fs call that blocked the event loop.
 *
 * #1931's event_loop_block attribution showed the boot-window `jobs:[]` blocks
 * are mostly kernel time on the main thread (cpuSys ~3.8 s, cpuUser 59 ms, one
 * major fault): blocking syscalls, not JS, GC or swap. A syscall leaves no
 * loopJobs entry and no timer tag, so nothing named it. This wraps the
 * synchronous fs entry points; a call that takes >= thresholdMs is recorded
 * with the function, its target path and the caller's stack, and the next
 * event_loop_block carries the entries from its window as `syncIo`.
 *
 * Cost per call is one hrtime pair; the stack is only captured for a slow call.
 * It sees fs.*Sync only (not better-sqlite3, not fs.writeSync, which the
 * logger itself uses). It must be imported before the modules whose named
 * `import { readFileSync } from "fs"` bindings it should reach.
 */
import nodeFs from "node:fs";
import nodeModule from "node:module";

const WRAPPED = Symbol.for("concord.slowSyncIo.wrapped");
const METHODS = [
  "readFileSync", "writeFileSync", "appendFileSync", "readdirSync", "statSync", "lstatSync",
  "existsSync", "copyFileSync", "renameSync", "unlinkSync", "rmSync", "mkdirSync",
  "fsyncSync", "truncateSync", "openSync", "readlinkSync", "realpathSync",
];
const RING_MAX = 50;

const ring = [];
let reporter = null;
let reporting = false;
let installed = null;

function targetOf(arg) {
  if (typeof arg === "string") return arg.length > 200 ? `${arg.slice(0, 200)}…` : arg;
  if (arg && typeof arg === "object" && typeof arg.pathname === "string") return arg.pathname.slice(0, 200);
  if (Buffer.isBuffer(arg)) return arg.toString("utf8", 0, 200);
  if (typeof arg === "number") return `fd:${arg}`;
  return null;
}

function callerFrames() {
  const lines = String(new Error().stack || "").split("\n").slice(1);
  return lines
    .map((l) => l.trim().replace(/^at /, ""))
    .filter((l) => l && !l.includes("slow-sync-io.js") && !l.startsWith("node:"))
    .slice(0, 4);
}

function record(fn, target, ms, now) {
  const entry = { at: now, fn, target, ms: Math.round(ms), frames: callerFrames() };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  if (reporter && !reporting) {
    reporting = true;
    try { reporter(entry); } catch { /* informational */ } finally { reporting = false; }
  }
}

/**
 * Wrap the sync fs methods of `fsObj` (default: node:fs). Idempotent; returns
 * { uninstall } so tests can restore the originals.
 */
export function installSlowSyncIo(fsObj = nodeFs, { thresholdMs = 150, now = Date.now, hr = () => Number(process.hrtime.bigint()) / 1e6 } = {}) {
  const originals = new Map();
  for (const name of METHODS) {
    const orig = fsObj[name];
    if (typeof orig !== "function" || orig[WRAPPED]) continue;
    const wrapped = function slowSyncIoWrapper(...args) {
      const t0 = hr();
      try {
        return orig.apply(this, args);
      } finally {
        const ms = hr() - t0;
        if (ms >= thresholdMs) {
          try { record(name, targetOf(args[0]), ms, now()); } catch { /* informational */ }
        }
      }
    };
    wrapped[WRAPPED] = true;
    Object.defineProperty(wrapped, "name", { value: name });
    fsObj[name] = wrapped;
    originals.set(name, orig);
  }
  if (fsObj === nodeFs) { try { nodeModule.syncBuiltinESMExports(); } catch { /* informational */ } }
  return {
    uninstall() {
      for (const [name, orig] of originals) fsObj[name] = orig;
      if (fsObj === nodeFs) { try { nodeModule.syncBuiltinESMExports(); } catch { /* informational */ } }
      originals.clear();
    },
  };
}

/** Install on node:fs once (module-evaluation side effect target for server.js). */
export function installSlowSyncIoOnce(env = process.env) {
  if (installed) return installed;
  if (env.CONCORD_SLOW_SYNC_IO === "0") return null;
  const thresholdMs = Number(env.CONCORD_SLOW_SYNC_IO_MS) > 0 ? Number(env.CONCORD_SLOW_SYNC_IO_MS) : 150;
  installed = installSlowSyncIo(nodeFs, { thresholdMs });
  return installed;
}

/** Entries recorded at or after `sinceMs` (epoch ms), oldest first. */
export function slowSyncIoSince(sinceMs) {
  return ring.filter((e) => e.at >= sinceMs);
}

/** Receive each entry as it happens (server.js logs it as `slow_sync_io`). */
export function setSlowSyncIoReporter(fn) {
  reporter = typeof fn === "function" ? fn : null;
  if (reporter) for (const e of ring) { try { reporter(e); } catch { /* informational */ } }
}

export function _resetSlowSyncIoForTest() { ring.length = 0; reporter = null; reporting = false; }
