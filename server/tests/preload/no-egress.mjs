// Test-only preload (wired via `node --test --import`).
//
// ── Clean-exit timer hygiene (replaces the --test-force-exit crutch) ──────────
// Booting the live server starts ~90 module-level setInterval/setTimeout cycles
// (governor heartbeat, GC sweeps, cache cleanups, …) that keep the event loop
// alive forever, so the runner needed --test-force-exit — which also MASKS real
// handle leaks. A preload runs BEFORE any server/module code, so patching the
// global timer constructors here to auto-.unref() catches EVERY timer (server.js
// body + all imported libs). unref'd timers still FIRE while the loop is alive
// (awaited delays in tests keep working) — they simply stop BLOCKING process
// exit once the suite finishes, letting `node --test` exit on its own. Test-only
// (this preload is only loaded by the test runner); production timers untouched.
// A leak that is NOT a timer (an open socket/DB handle) now surfaces as a hang
// instead of being force-killed — which is the point: real leaks stay visible.
if (String(process.env.NODE_ENV).toLowerCase() === "test") {
  for (const name of ["setInterval", "setTimeout"]) {
    const orig = globalThis[name];
    if (typeof orig === "function") {
      globalThis[name] = function autoUnref(...args) {
        const t = orig.apply(this, args);
        try { t?.unref?.(); } catch { /* primitive timer id (unlikely) */ }
        return t;
      };
    }
  }
}
//
// ── No-egress fetch guard ─────────────────────────────────────────────────────
// The behavior smoke suite + many integration tests boot the live server, which
// fires outbound fetches from numerous subsystems — RSS feeds, entity-web-
// exploration (robots.txt probes), the oracle/LLM brain, embeddings init, and
// external-API macros (wiki/aic/apod/...). In CI's no-egress sandbox a host that
// resolves but won't connect blocks each fetch to its multi-second AbortSignal
// timeout; concurrently that spikes event-loop lag and starves node:test until
// the run dies with no clean summary.
//
// Block external (non-loopback) fetch under NODE_ENV=test so every such call
// fails INSTANTLY and the caller takes its graceful "fetch failed" branch (which
// these subsystems already handle). Loopback is preserved so in-process HTTP
// (the test server, a local Ollama) still works. Tests don't assert on live
// external contents — they assert the macro returns a well-formed shape, which a
// fast rejection still produces.
if (String(process.env.NODE_ENV).toLowerCase() === "test"
    && String(process.env.CONCORD_ALLOW_TEST_EGRESS).toLowerCase() !== "true") {
  const realFetch = globalThis.fetch;
  if (typeof realFetch === "function") {
    const isLoopback = (u) =>
      /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1)([:/?]|$)/i.test(u) ||
      /^https?:\/\/[^/]*\.local([:/?]|$)/i.test(u);
    globalThis.fetch = function patchedFetch(input, init) {
      let url = "";
      try {
        url = typeof input === "string" ? input
            : (input && typeof input.url === "string") ? input.url
            : String(input || "");
      } catch { url = ""; }
      if (/^https?:\/\//i.test(url) && !isLoopback(url)) {
        return Promise.reject(new Error(`external fetch blocked under test (no-egress): ${url.slice(0, 120)}`));
      }
      return realFetch.call(this, input, init);
    };
  }
}
