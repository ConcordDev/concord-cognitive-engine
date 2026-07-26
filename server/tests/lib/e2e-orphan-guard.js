// Kill-signal safety net for the e2e tests that spawn a REAL `server.js`
// child process (the 7 files under tests/e2e/ whose `spawnServer` helper
// shells out to `spawn(process.execPath, [SERVER_JS])`).
//
// ── The leak this closes (measured, not theorised — 2026-07-25) ─────────────
// Those files clean up correctly on the HAPPY path: their `after()` hook
// SIGTERMs the child and rmSync's the mkdtemp data dir. But `after()` does
// not run when the test-file process is killed from the outside, and that
// is exactly what `node --test` does to a file that blows its
// `--test-timeout`. Verified directly with a minimal probe (a test file
// that spawns a long-lived grandchild and then exceeds a 5s file timeout):
//
//   * the runner terminates the timed-out test-FILE process with SIGTERM;
//   * with no SIGTERM listener installed, Node's default action ends the
//     process immediately — `after()` never runs, and `process.on("exit")`
//     never fires either;
//   * the spawned grandchild is therefore ORPHANED and keeps running.
//
// Observed live in this repo while chasing the repair-console-routes
// timeout: an orphaned `server/server.js` was still at ~111% CPU and
// ~5.8 GB RSS SEVEN MINUTES after the test-file process that spawned it had
// died, and seven `/tmp/concord-e2e-repair-console-*` dirs (each a fully
// migrated ~100 MB+ SQLite tree) had accumulated from earlier killed runs.
//
// Both halves matter, and the CPU half is the nastier one: an orphaned
// server burning a core is itself a cause of the event-loop contention that
// makes OTHER concurrently-running test files slower, which makes THEM more
// likely to hit their own timeout — i.e. the leak is self-amplifying across
// a full-suite run. The disk half is the same failure mode that filled this
// container twice on 2026-07-25 (~800 MB of stranded mkdtemp'd SQLite), and
// which those `after()` hooks were added to fix; this closes the remaining
// path by which they are bypassed.
//
// ── Why a signal handler, and why it exits ─────────────────────────────────
// Installing a SIGTERM/SIGINT/SIGHUP listener suppresses Node's default
// terminate-on-signal, so the handler MUST exit the process itself or the
// runner's kill would simply be ignored and the file would hang forever
// instead of dying. Doing so is safe here and does NOT hide a failure:
// the timeout verdict is recorded by the RUNNER process (which is what
// prints `not ok <file> / failureType: testTimeoutFailure`), not by the
// file process being killed — the probe above reported byte-identical
// results with and without this handler installed. This is a signal
// handler, NOT an `after()` hook; the documented failure-swallowing hazard
// in tests/lib/server-clean-exit.js is specifically about calling
// `process.exit()` inside a user `after()` hook, where it pre-empts
// node:test's own reporting path. That hazard does not apply to a process
// that an external signal has already condemned.
//
// Everything the handler does is synchronous and bounded (a SIGKILL, then
// an rmSync), and every step is individually swallowed, so a failure in
// cleanup can never stop the process from exiting.
import { rmSync } from "node:fs";

/** @type {Set<{ child: import("node:child_process").ChildProcess, dataDir: string | null }>} */
const tracked = new Set();
let armed = false;

function cleanupAll() {
  for (const entry of tracked) {
    try {
      if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null) {
        entry.child.kill("SIGKILL");
      }
    } catch { /* best-effort teardown */ }
    try {
      if (entry.dataDir) rmSync(entry.dataDir, { recursive: true, force: true });
    } catch { /* best-effort teardown */ }
  }
  tracked.clear();
}

/**
 * Track a spawned server child (and the temp data dir it was pointed at) so
 * that an externally-killed test-file process still tears both down.
 *
 * Idempotent per process: the signal listeners are installed once, however
 * many children get armed.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {string | null} [dataDir] mkdtemp dir to remove, if any.
 * @returns {() => void} disarm — drops this child from the tracked set. The
 *   normal `after()` teardown does not need to call it (cleanup is
 *   idempotent: an already-exited child is skipped and rmSync uses
 *   `force`), but it exists so a test that deliberately outlives its child
 *   can opt out.
 */
export function armOrphanGuard(child, dataDir) {
  const entry = { child, dataDir: dataDir || null };
  tracked.add(entry);
  // Once the child exits on its own, there is nothing left to guard.
  try { child.once("exit", () => tracked.delete(entry)); } catch { /* best-effort */ }

  if (!armed) {
    armed = true;
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      process.on(sig, () => {
        cleanupAll();
        // Restore the default outcome of the signal we just intercepted:
        // this process was condemned by whoever sent it, and must still die.
        process.exit(1);
      });
    }
    // Belt and braces for the paths that DO run exit hooks (a normal finish
    // where `after()` already cleaned up — cleanupAll is a no-op then — and
    // an uncaught exception, where it is not).
    process.on("exit", cleanupAll);
  }

  return () => tracked.delete(entry);
}
