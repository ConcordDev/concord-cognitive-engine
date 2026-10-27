// Writes that race the shutdown DB close.
//
// On SIGTERM the server stops accepting, drains requests and feed writes,
// then closes the DB. Background work already in flight (a heartbeat tick, an
// LLM reply that lands late) could still create a DTU and its lens artifacts
// after the close; better-sqlite3 then threw "The database connection is not
// open" and the write was lost (11 lens-artifact saves at the 2026-10-27
// 15:03 ET restart, recurring since 2026-10-23).
//
// Three parts:
//   1. noteDbWrite() + waitForWriteQuiet(): shutdown waits (bounded) until no
//      store write has happened for a short quiet window before closing.
//   2. spillWrite(): a write that still arrives after the close is appended
//      to a JSONL spill file instead of failing (logged; counted).
//   3. replaySpill(): on the next boot the spill is applied through the
//      stores' own set() (skipping anything newer), then renamed.
import fs from "node:fs";
import path from "node:path";

let _lastWriteAt = 0;
let _spillPath = null;
let _log = () => {};
const _stats = { spilled: 0, dropped: 0 };

export function configureWriteSpill({ spillPath = null, log = null } = {}) {
  _spillPath = spillPath || null;
  if (typeof log === "function") _log = log;
}

export function noteDbWrite(now = Date.now()) { _lastWriteAt = now; }
export function lastDbWriteAt() { return _lastWriteAt; }
export function spillStats() { return { ..._stats, spillPath: _spillPath }; }

/** better-sqlite3 handle that has been closed (db.open === false). */
export function dbIsClosed(db) { return !!db && db.open === false; }
export function isClosedDbError(e) {
  return e?.code === "shutting_down" || /database connection is not open/i.test(String(e?.message || e || ""));
}

/** Append a write that could not reach the DB. Returns true when saved. */
export function spillWrite(kind, id, payload) {
  try {
    if (!_spillPath) throw new Error("no spill path configured");
    fs.mkdirSync(path.dirname(_spillPath), { recursive: true });
    fs.appendFileSync(_spillPath, `${JSON.stringify({ kind, id: String(id ?? ""), at: new Date().toISOString(), payload })}\n`);
    _stats.spilled++;
    _log("warn", "shutdown_write_spilled", { kind, id: String(id ?? "") });
    return true;
  } catch (e) {
    _stats.dropped++;
    _log("error", "shutdown_write_dropped", { kind, id: String(id ?? ""), error: e?.message });
    return false;
  }
}

/**
 * Wait until no store write has happened for `quietMs`, at most `budgetMs`.
 * Returns { waitedMs, quiet }.
 */
export async function waitForWriteQuiet({ quietMs = 400, budgetMs = 1500, now = Date.now, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = {}) {
  const start = now();
  for (;;) {
    const since = now() - _lastWriteAt;
    if (since >= quietMs) return { waitedMs: now() - start, quiet: true };
    if (now() - start >= budgetMs) return { waitedMs: now() - start, quiet: false };
    await sleep(Math.min(quietMs - since, Math.max(1, budgetMs - (now() - start))));
  }
}

/**
 * Apply a spill file. `apply(kind, id, payload)` returns "applied" | "skipped".
 * The file is renamed to <path>.replayed-<ts> afterwards so it runs once.
 */
export function replaySpill({ spillPath = _spillPath, apply, log = _log } = {}) {
  const out = { replayed: 0, skipped: 0, failed: 0, lines: 0 };
  if (!spillPath || !fs.existsSync(spillPath)) return out;
  const text = fs.readFileSync(spillPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    out.lines++;
    try {
      const e = JSON.parse(line);
      const r = apply(e.kind, e.id, e.payload);
      if (r === "applied") out.replayed++; else out.skipped++;
    } catch (err) {
      out.failed++;
      log("error", "shutdown_spill_replay_failed", { error: err?.message });
    }
  }
  try { fs.renameSync(spillPath, `${spillPath}.replayed-${Date.now()}`); } catch { /* keep: idempotent apply */ }
  log("info", "shutdown_spill_replayed", out);
  return out;
}

/** Newer-wins guard used by the replay: skip when memory is newer. */
export function spilledIsNewer(current, spilled) {
  if (!current) return true;
  return String(spilled?.updatedAt || "") >= String(current?.updatedAt || "");
}
