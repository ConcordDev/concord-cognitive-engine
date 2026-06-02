// Test-only preload (wired via `node --test --import`).
//
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
