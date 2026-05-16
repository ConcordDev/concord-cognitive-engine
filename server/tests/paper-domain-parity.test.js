// Tier-2 contract test for paper-search → real arXiv export API.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`paper.${name}`);
  if (!fn) throw new Error(`paper.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPaperActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctx = { actor: { userId: "u" }, userId: "u" };

describe("paper.search (arXiv live)", () => {
  it("rejects empty query", async () => {
    const r = await call("search", ctx, { query: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
  });

  it("returns error when network is disabled (hermetic test)", async () => {
    const r = await call("search", ctx, { query: "attention is all you need" });
    assert.equal(r.ok, false);
    assert.match(r.error, /failed|network/);
  });

  it("parses arXiv Atom XML response", async () => {
    globalThis.fetch = async (url) => {
      assert.match(url, /export\.arxiv\.org\/api\/query/);
      assert.match(url, /search_query=all%3Aattention/);
      return {
        ok: true,
        text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v5</id>
    <updated>2017-12-06T19:32:32Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks…</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v5"/>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>`,
      };
    };
    const r = await call("search", ctx, { query: "attention" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "arXiv export API");
    assert.equal(r.result.papers.length, 1);
    assert.equal(r.result.papers[0].title, "Attention Is All You Need");
    assert.equal(r.result.papers[0].authors.length, 2);
    assert.equal(r.result.papers[0].authors[0], "Ashish Vaswani");
    assert.equal(r.result.papers[0].id, "1706.03762v5");
    assert.equal(r.result.papers[0].primaryCategory, "cs.CL");
    assert.match(r.result.papers[0].pdfUrl, /pdf\/1706\.03762/);
  });

  it("returns empty array (not fake fallback) when no matches", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
    });
    const r = await call("search", ctx, { query: "asdfqwerzxcv" });
    assert.equal(r.ok, true);
    assert.equal(r.result.papers.length, 0);
  });
});
