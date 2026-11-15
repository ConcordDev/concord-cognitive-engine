// SB-07 — fetchPublicPage (chat web search) and the robots fetch go
// through the SB-01 SSRF guard.
//
// Pristine behaviour: fetchPublicPage checked the URL against a
// string-pattern list (content policy — it cannot see a DNS answer)
// and fetched with the raw fetch; checkRobotsTxt's scheduler fetched
// robots.txt the same raw way. A loopback page was fetched and its
// content returned.
//
// Pins (failure paths first), against a real local HTTP server:
//   (1) fetchPublicPage of a 127.0.0.1 page returns null (pristine:
//       the page's content). The 10 s timeout and 3,000-char extract
//       are untouched — they simply never get a response to extract.
//   (2) checkRobotsTxt of a 127.0.0.1 origin returns false: its
//       robots fetch is refused by the guard, and a refused robots
//       fetch stays the conservative skip it already was for network
//       errors (pristine: true — the local robots allows all).
//   (3) the allowed path still works: with the guard module's test
//       transport serving a public page + robots, fetchPublicPage
//       returns the extracted text and title.
// Run: node --test server/tests/conscious-web-search-ssrf.test.js
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { fetchPublicPage } from "../emergent/conscious-web-search.js";
import { checkRobotsTxt } from "../emergent/entity-web-exploration.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";

const PAGE_HTML = "<html><head><title>Local Secret Page</title></head><body><p>This loopback content must never be returned by the web-search fetch path, ever.</p></body></html>";
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end("User-agent: *\nAllow: /\n"); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { __setPublicFetchTestTransport(null); await new Promise((r) => server.close(r)); });

describe("SB-07 guarded fetchPublicPage + robots", () => {
  it("(1) a loopback page returns null, not its content", async () => {
    const out = await fetchPublicPage(`${base}/page`);
    assert.equal(out, null);
  });

  it("(2) a loopback robots fetch is refused → checkRobotsTxt stays conservative (false)", async () => {
    const allowed = await checkRobotsTxt(`${base}/page`);
    assert.equal(allowed, false);
  });

  it("(3) the public path still extracts (guard test transport)", async () => {
    __setPublicFetchTestTransport(async (url) => {
      const body = String(url).endsWith("/robots.txt")
        ? "User-agent: *\nAllow: /\n"
        : "<html><head><title>Public Page</title></head><body><p>A perfectly public page body, long enough to extract and return to the chat context builder.</p></body></html>";
      return { ok: true, status: 200, text: async () => body, headers: { get: () => "text/html" } };
    });
    try {
      const out = await fetchPublicPage("https://public.example.test/article");
      assert.ok(out, "a public page still returns content");
      assert.equal(out.title, "Public Page");
      assert.match(out.text, /perfectly public page body/);
      assert.ok(out.text.length <= 3000, "the 3,000-char extract cap is kept");
    } finally {
      __setPublicFetchTestTransport(null);
    }
  });
});
