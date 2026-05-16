import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerNewsActions from "../domains/news.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) { return ACTIONS.get(`news.${name}`)(ctx, { id: null, data: {}, meta: {} }, params); }
before(() => { registerNewsActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };

describe("news parity macros (real GDELT)", () => {
  it("headlines returns error when network is disabled (hermetic test)", async () => {
    const r = await call("headlines", ctxA, { category: "tech", limit: 10 });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("headlines parses GDELT response shape", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
      assert.match(url, /technology/);
      return {
        ok: true,
        json: async () => ({
          articles: [
            {
              title: "AI breakthrough announced",
              url: "https://example.com/ai",
              domain: "techcrunch.com",
              language: "English",
              sourcecountry: "US",
              seendate: "20260516T103045Z",
              socialimage: "https://example.com/img.jpg",
            },
          ],
        }),
      };
    };
    const r = await call("headlines", ctxA, { category: "tech", limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "GDELT Project (real-time global news, no key required)");
    assert.equal(r.result.headlines.length, 1);
    assert.equal(r.result.headlines[0].title, "AI breakthrough announced");
    assert.equal(r.result.headlines[0].source, "techcrunch.com");
    assert.equal(r.result.headlines[0].category, "tech");
  });

  it("unknown category falls back to top", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ articles: [] }) };
    };
    await call("headlines", ctxA, { category: "fake_category" });
    assert.match(capturedUrl, /world|breaking/);
  });

  it("daily-briefing makes 4 parallel GDELT calls", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ articles: [{ title: `Story ${calls}`, url: "https://x.com", domain: "x.com" }] }),
      };
    };
    const r = await call("daily-briefing", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(calls, 4);
    assert.ok(r.result.topStories.bullets.length >= 1);
    assert.ok(r.result.closing);
  });
});
