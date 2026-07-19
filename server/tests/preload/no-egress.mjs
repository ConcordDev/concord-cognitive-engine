// Test-only preload (wired via `node --test --import`).
//
// ── Per-process DB_PATH isolation ─────────────────────────────────────────────
// `node --test` with a glob (tests/**/*.test.js) runs each test FILE in its own
// child process, and by default many run concurrently. server.js's DB_PATH
// defaults to the single on-disk `server/data/concord.db` (server.js:5109) with
// no per-process suffix — unlike STATE_PATH, which tests/depth/_harness.js
// already isolates per-process for depth tests specifically. Without isolation,
// every concurrently-booting test-file process shares ONE on-disk SQLite file:
// two processes racing to create+migrate it on a fresh checkout produces
// `no such table: X` (one process's later migration hasn't landed when another
// reads); once created, fixed-label test ctxs (`depthCtx("some-label")`, which
// map to a deterministic userId) accumulate rows ACROSS files that happen to
// reuse a label, corrupting exact-value assertions non-deterministically run to
// run. Root-caused 2026-07-19 chasing a real "structural-audits" CI failure
// (staking-behavior / ops-substrate-admin-gate / quest-moral-branch tests
// failing in the full suite but passing clean in isolation with a fresh DB).
// Give every test-file process its own throwaway DB, same pattern as
// STATE_PATH — but only when the caller hasn't already pinned one (some scripts,
// e.g. test:depth:raw, deliberately share one DB_PATH across depth files).
if (String(process.env.NODE_ENV).toLowerCase() === "test" && !process.env.DB_PATH) {
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.DB_PATH = path.join(os.tmpdir(), `concord-test-db-${process.pid}-${Date.now()}.db`);
}
//
// NOTE on --test-force-exit (server/package.json): the runner has used it
// because booting the live server leaves REF'd handles open that would
// otherwise block a clean exit. Runtime introspection (getActiveResourcesInfo +
// an async_hooks TCPWRAP construction trace, 2026-07-02) identified all of
// them precisely: ~57 raw module-scope timers (now test-mode .unref()'d at
// their sites), 4 pooled worker threads (macro/heartbeat/cognitive — .unref()'d
// under NODE_ENV=test), and TCP sockets which the trace proved are ALL undici
// global-fetch KEEP-ALIVE POOL connections (Client.connect via Socket.connect —
// boot-time fetches leave pooled sockets REF'd). The undici guard below closes
// that class wholesale. A prior attempt to globally monkeypatch setInterval/
// setTimeout here was reverted: too blunt (interacts with node:test's own
// internal timers); the per-site convention is used instead.
//
// ── Undici keep-alive guard (the TCP-socket half of clean exit) ──────────────
// Test-only: shrink the global fetch dispatcher's keep-alive to ~instant so a
// completed request's socket closes immediately instead of sitting REF'd in
// the pool. Requests behave identically (each still opens/uses a connection);
// only pooling between requests is disabled. Production untouched.
// The npm `undici` package is NOT installed — global fetch uses Node's bundled
// undici, reachable only through the well-known global symbol. The dispatcher
// is created lazily on first fetch, so: touch fetch (pre-aborted — no network),
// then rebuild the dispatcher via its own constructor with tiny keep-alive.
// Technique verified on this Node (v22): symbol holds an Agent after touch.
if (String(process.env.NODE_ENV).toLowerCase() === "test") {
  try {
    const sym = Symbol.for("undici.globalDispatcher.1");
    const ac = new AbortController();
    ac.abort();
    await fetch("http://127.0.0.1:1/", { signal: ac.signal }).catch(() => {});
    const cur = globalThis[sym];
    if (cur?.constructor) {
      globalThis[sym] = new cur.constructor({ keepAliveTimeout: 10, keepAliveMaxTimeout: 10 });
    }
  } catch { /* leave the default dispatcher — force-exit still covers it */ }
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
