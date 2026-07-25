// Shared clean-exit teardown for any test file that boots server.js
// directly via `await import("../server.js")` (tests/depth/_harness.js has
// its own copy of this, since depth files share one harness module).
//
// Root cause + full investigation: server.js's __TEST__.terminateAllWorkersForTest
// doc comment. Short version: every file that boots the real server leaves
// long-lived resources in place (4 pooled worker threads + dozens of
// staggered background intervals). Terminating the workers and clearing
// (not just unref'ing) the tracked intervals is real, verified cleanup —
// but even after both, `node --test`'s own file-completion tracking still
// does not consider the file done without an explicit exit, despite the
// process being genuinely idle by every introspection tool available
// (process.getActiveResourcesInfo/_getActiveHandles/_getActiveRequests,
// and OS-level /proc/<pid>/status + /proc/<pid>/fd). Forcing exit here is
// the same shape as --test-force-exit (server/package.json's test:main),
// just scoped to this confirmed-clean per-file teardown instead of applied
// blanket across the whole suite.
//
// Failure-masking bug fixed 2026-07-25 (this file had drifted out of sync
// with tests/depth/_harness.js's 2026-07-11 fix for the exact same shape).
// This file used to call `process.exit(0)` SYNCHRONOUSLY inside the
// after() hook's own continuation. Minimal reproduction (node --test
// against a single `assert.equal(1, 2)` wrapped in exactly this
// after()+exit() shape, no server involved): calling process.exit() from
// within a user-registered after() hook — no matter how long it's delayed
// first — pre-empts node:test's own internal completion path before it can
// emit the `not ok`/`# fail` lines for a failure that already happened, or
// set a non-zero process.exitCode. The failure doesn't just get a wrong
// summary; it never reaches stdout at all, and the run exits 0 — identical
// to a genuine pass. Verified against this exact file's shape 2026-07-25:
// `process.exit(0)` synchronously in after() → `pass 1 / fail 0 / exit 0`
// for a deliberately failing assertion; replacing it with an unref'd
// setTimeout(…, 200).unref() watchdog (decoupled from the hook's own
// synchronous continuation, giving node:test's real completion/reporting
// path a chance to run first) → correctly reports `not ok 1` / `fail 1` /
// exit 1. All 13 current callers (grep `registerServerCleanExit` under
// tests/) get the fix automatically since they all go through this one
// shared helper.
import { after } from "node:test";

/**
 * @param {() => Promise<object>} getTestSurface — returns the server's
 *   `__TEST__` object (or a promise for the already-imported module's
 *   `__TEST__`). Called lazily inside the after() hook.
 */
export function registerServerCleanExit(getTestSurface) {
  after(async () => {
    try {
      const t = await getTestSurface();
      await t?.terminateAllWorkersForTest?.();
      t?.clearActiveTimersForTest?.();
    } catch { /* best-effort teardown */ }
    // Same handle-unref sweep as tests/depth/_harness.js: neutralize
    // anything still open (stale undici keep-alive sockets from failed
    // brain/LLM calls during boot, etc.) so it can't keep the loop alive on
    // its own, without forcing a synchronous exit that would race node:test's
    // own failure reporting.
    try {
      const handles = process._getActiveHandles ? process._getActiveHandles() : [];
      for (const h of handles) { if (h && typeof h.unref === "function") h.unref(); }
    } catch { /* best-effort teardown */ }
    // Decoupled, unref'd watchdog: only force-exits as a last resort if the
    // process is still alive after node:test's own completion/reporting path
    // has had a real chance to run. See doc comment above for why this must
    // NOT be a synchronous process.exit() inside the hook itself.
    const watchdog = setTimeout(() => { process.exit(process.exitCode ?? 0); }, 200);
    watchdog.unref();
  });
}
