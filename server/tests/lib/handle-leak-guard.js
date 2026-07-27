// Shared teardown for any coverage-smoke-style test file that probes real
// module exports (route-factory functions, lib functions, or module-level
// top-level code) by actually CALLING/IMPORTING them for c8 coverage credit.
//
// Root cause (found 2026-07-27 via async_hooks tracing, same technique
// CLAUDE.md's "Runtime-truth over source-guessing" section documents):
// several router factories and lib modules start a real, persistent
// `setInterval` as a side effect of being called/imported once — entirely
// correct in production (called exactly once at real server boot, meant to
// run for the process's lifetime) but a genuine leak in a smoke-probe file
// that calls the SAME factory repeatedly with several mock arg shapes
// (server/tests/coverage-smoke-routes-lib.test.js's `createAuthRouter`,
// `registerChatRoutes`, `createDisputeRouter`, `world-narrative.js`'s
// per-call interval; server/tests/coverage-smoke.test.js's
// `city-presence.js#startNpcLoop`/`startPresenceBroadcast`, and
// `emergent/developer-sdk.js`'s two module-level intervals fired at import
// time alone). Each leaked interval is a live handle keeping the event loop
// (and therefore the whole test FILE, since node:test can't consider a file
// done while it's non-idle) alive well past its declared subtests all
// reporting `ok` — which is exactly the "141 pass / 0 fail / 1 cancelled"
// shape CLAUDE.md's test-suite section records: every subtest finishes, but
// the file-level wrapper still hits its 300s timeout waiting for an event
// loop that never empties.
//
// This is a TEST bug, not a production one — the leaking functions are
// correct at real single-call-per-boot production use; nothing here changes
// them. The fix is to sweep whatever they left behind after probing ends.
//
// Mirrors tests/lib/server-clean-exit.js's already-audited technique
// (active-handle unref sweep + a DECOUPLED, unref'd watchdog, never a bare
// synchronous process.exit() inside the hook itself — see that file's doc
// comment for the full investigation of why a synchronous exit silently
// swallows a real failure that happened earlier in the same run).
import { after } from "node:test";

export function registerHandleLeakGuard() {
  after(() => {
    try {
      const handles = process._getActiveHandles ? process._getActiveHandles() : [];
      for (const h of handles) {
        if (h && typeof h.unref === "function") h.unref();
      }
    } catch { /* best-effort teardown */ }
    // Decoupled, unref'd watchdog: only force-exits as a last resort if the
    // process is somehow still alive after node:test's own completion path
    // has had a real chance to run — never a synchronous exit inside this
    // hook's own continuation (see server-clean-exit.js for why that
    // silently swallows failures).
    const watchdog = setTimeout(() => { process.exit(process.exitCode ?? 0); }, 200);
    watchdog.unref();
  });
}
