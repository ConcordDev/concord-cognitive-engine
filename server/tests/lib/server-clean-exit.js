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
    process.exit(0);
  });
}
