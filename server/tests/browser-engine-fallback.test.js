/**
 * browse_url used to throw `getBrowserEngine is not a function` on every
 * path, and a box without Playwright Chromium had no other way to read a
 * page. These tests pin the export and the labeled fetch fallback.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __setEnsureBrowserForTests,
  browserEngine,
  extractReadableText,
  fetchHtmlFallback,
  getBrowserEngine,
} from "../lib/browser-engine.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { executeToolCall, formatToolResults } from "../lib/chat-agent.js";

const HTML = `<!doctype html><html><head><title>Example &amp; Co</title>
<style>body{color:red}</style></head>
<body><script>window.secret = 1</script><p>Hello &amp; welcome &#33;</p>
<div>Second &#x21; line</div></body></html>`;

afterEach(() => {
  __setEnsureBrowserForTests(null);
  __setPublicFetchTestTransport(null);
});

describe("getBrowserEngine", () => {
  it("returns the shared engine instance", () => {
    const eng = getBrowserEngine();
    assert.equal(typeof getBrowserEngine, "function");
    assert.equal(eng, browserEngine);
    assert.equal(typeof eng.fetchRenderedPage, "function");
  });
});

describe("extractReadableText", () => {
  it("drops script, style, and head chrome and decodes entities", () => {
    const { title, text } = extractReadableText(HTML);
    assert.equal(title, "Example & Co");
    assert.match(text, /Hello & welcome !/);
    assert.match(text, /Second ! line/);
    assert.doesNotMatch(text, /secret|color:red|<p>|style/);
  });

  it("drops script and style when the closing tag is uppercase or has space before >", () => {
    const html = [
      "<TITLE>Case</TITLE>",
      "<body>",
      "<SCRIPT>window.secret = 1</ScRiPt >",
      "<p>Visible</p>",
      "<style>color:red</STYLE >",
      "<script>hidden</script>",
      "</body>",
    ].join("");
    const { title, text } = extractReadableText(html);
    assert.equal(title, "Case");
    assert.match(text, /Visible/);
    assert.doesNotMatch(text, /secret|hidden|color:red/i);
  });
});

describe("fetchHtmlFallback", () => {
  it("returns readable text labeled as a fetch fallback", async () => {
    const page = await fetchHtmlFallback("https://example.com/docs", {
      fetchImpl: async () => new Response(HTML, { status: 200, headers: { "content-type": "text/html" } }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.fallback, "fetch");
    assert.equal(page.label, "fetch fallback");
    assert.equal(page.title, "Example & Co");
    assert.match(page.text, /Hello & welcome/);
    assert.equal(page.provenance.via, "fetch-fallback");
    assert.equal(page.provenance.rendered, false);
    assert.equal(page.provenance.label, "fetch fallback");
    assert.equal(page.truncated, false);
  });

  it("caps the body at maxBytes and marks the result truncated", async () => {
    const big = `<html><body>${"A".repeat(200)}</body></html>`;
    const page = await fetchHtmlFallback("https://example.com/big", {
      maxBytes: 32,
      fetchImpl: async () => new Response(big, { status: 200 }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.truncated, true);
    assert.ok(page.html.length <= 32);
    assert.equal(page.provenance.truncated, true);
  });

  it("reads a body that has no stream reader", async () => {
    const page = await fetchHtmlFallback("https://example.com/buf", {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from("<html><title>Buf</title><body>from buffer</body></html>"),
      }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.title, "Buf");
    assert.match(page.text, /from buffer/);
    assert.equal(page.truncated, false);
  });

  it("reports an HTTP error as a fetch fallback failure", async () => {
    const page = await fetchHtmlFallback("https://example.com/missing", {
      fetchImpl: async () => new Response("nope", { status: 404 }),
    });
    assert.equal(page.ok, false);
    assert.match(page.error, /fetch fallback HTTP 404/);
    assert.equal(page.label, "fetch fallback");
  });

  it("times out when the response never arrives", async () => {
    const page = await fetchHtmlFallback("https://example.com/slow", {
      timeout: 30,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
    });
    assert.equal(page.ok, false);
    assert.match(page.error, /fetch fallback timeout/);
  });

  it("refuses a private address instead of fetching it", async () => {
    const page = await fetchHtmlFallback("http://169.254.169.254/latest/meta-data/");
    assert.equal(page.ok, false);
    assert.equal(page.label, "fetch fallback");
    assert.match(page.error, /private|reserved|metadata|blocked/i);
  });

  it("caps a huge timeout and maxBytes at the fallback ceilings", async () => {
    const originalSetTimeout = global.setTimeout;
    const delays = [];
    global.setTimeout = (fn, delay, ...rest) => {
      if (typeof delay === "number") delays.push(delay);
      const capped = typeof delay === "number" ? Math.min(delay, 40) : delay;
      return originalSetTimeout(fn, capped, ...rest);
    };
    try {
      const stalled = await fetchHtmlFallback("https://example.com/stall", {
        timeout: 1e15,
        fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
      });
      assert.equal(stalled.ok, false);
      assert.match(stalled.error, /timeout after 10000ms/);
      assert.ok(delays.includes(10_000), `armed delays were ${delays.join(",")}`);
      assert.ok(delays.every((d) => d <= 10_000), `unbounded delay in ${delays.join(",")}`);
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    const big = `B`.repeat(1_600_000);
    const page = await fetchHtmlFallback("https://example.com/huge", {
      timeout: 1e15,
      maxBytes: 1e15,
      fetchImpl: async () => new Response(big, { status: 200 }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.truncated, true);
    assert.ok(page.html.length <= 1_500_000, `kept ${page.html.length} chars`);
    assert.ok(page.html.length > 1_000_000, `kept only ${page.html.length} chars`);
  });
});

describe("fetchRenderedPage Chromium fallback", () => {
  it("uses the fetch fallback when Chromium is not installed", async () => {
    __setEnsureBrowserForTests(async () => {
      throw new Error("browserType.launch: Executable doesn't exist at /ms-playwright/chromium");
    });
    const page = await getBrowserEngine().fetchRenderedPage("https://example.com/", {
      fetchImpl: async () => new Response(HTML, { status: 200 }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.label, "fetch fallback");
    assert.match(page.text, /Hello & welcome/);
  });

  it("does not fetch when the browser fails for some other reason", async () => {
    let called = false;
    __setEnsureBrowserForTests(async () => { throw new Error("disk full"); });
    const page = await getBrowserEngine().fetchRenderedPage("https://example.com/", {
      fetchImpl: async () => { called = true; return new Response(HTML); },
    });
    assert.equal(page.ok, false);
    assert.match(page.error, /disk full/);
    assert.equal(called, false);
    assert.equal(page.fallback, undefined);
  });

  it("treats a missing Playwright install as Chromium unavailable", async () => {
    __setEnsureBrowserForTests(async () => {
      throw new Error("Playwright is not available: Cannot find package 'playwright'");
    });
    const page = await getBrowserEngine().fetchRenderedPage("https://example.com/", {
      fetchImpl: async () => new Response("<html><title>T</title><body>body text</body></html>", { status: 200 }),
    });
    assert.equal(page.ok, true);
    assert.equal(page.title, "T");
    assert.match(page.text, /body text/);
    assert.equal(page.provenance.via, "fetch-fallback");
  });
});

describe("browse_url tool", () => {
  it("reads a page through the fetch fallback and labels it", async () => {
    __setEnsureBrowserForTests(async () => {
      throw new Error("browserType.launch: Executable doesn't exist at /ms-playwright/chromium");
    });
    __setPublicFetchTestTransport(async () => new Response(HTML, { status: 200 }));
    const result = await executeToolCall({}, () => null, new Map(), {
      tool: "browse_url",
      params: { url: "https://example.com/" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, "fetch");
    assert.equal(result.label, "fetch fallback");
    assert.equal(result.title, "Example & Co");
    assert.match(result.text, /Hello & welcome/);
    assert.doesNotMatch(result.text, /secret/);
    const rendered = formatToolResults([result]);
    assert.match(rendered, /fetch fallback/);
    assert.match(rendered, /Example & Co/);
  });

  it("returns the fetch error instead of getBrowserEngine is not a function", async () => {
    __setEnsureBrowserForTests(async () => {
      throw new Error("Playwright is not available: Cannot find package 'playwright'");
    });
    __setPublicFetchTestTransport(async () => { throw new Error("network down"); });
    const result = await executeToolCall({}, () => null, new Map(), {
      tool: "browse_url",
      params: { url: "https://example.com/down" },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /network down/);
    assert.doesNotMatch(result.error, /getBrowserEngine/);
  });
});
