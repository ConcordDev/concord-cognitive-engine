/**
 * board.live_hot — BGG hot list proxy. fetch is stubbed.
 *
 * Run: node --test --test-concurrency=1 server/tests/board-live-hot.test.js
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerBoardLiveMacros, { parseBggHot, BGG_HOT_URL } from "../domains/board-live.js";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item id="224517" rank="1">
    <thumbnail value="https://cf.geekdo-images.com/a.jpg" />
    <name value="Brass: Birmingham" />
    <yearpublished value="2018" />
  </item>
  <item id="167791" rank="2">
    <name value="Terraforming Mars &amp; Co" />
  </item>
  <item rank="3"><name value="no id" /></item>
</items>`;

function handler() {
  const map = new Map();
  registerBoardLiveMacros((d, n, fn) => map.set(`${d}.${n}`, fn));
  return map.get("board.live_hot");
}

describe("parseBggHot", () => {
  it("parses ranked items, decodes entities, skips malformed items", () => {
    const games = parseBggHot(XML);
    assert.equal(games.length, 2);
    assert.deepEqual(games[0], {
      id: "224517", rank: 1, name: "Brass: Birmingham",
      yearPublished: "2018", thumbnail: "https://cf.geekdo-images.com/a.jpg",
    });
    assert.equal(games[1].name, "Terraforming Mars & Co");
    assert.equal(games[1].yearPublished, undefined);
    assert.equal(games[1].thumbnail, undefined);
  });
  it("returns [] for empty or garbage input", () => {
    assert.deepEqual(parseBggHot(""), []);
    assert.deepEqual(parseBggHot(null), []);
    assert.deepEqual(parseBggHot("<html>nope</html>"), []);
  });
});

describe("board.live_hot", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("fetches the fixed BGG URL and returns parsed games", async () => {
    const seen = [];
    globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(XML, { status: 200 }); };
    const r = await handler()({}, { url: "http://evil.example" });
    assert.deepEqual(seen, [BGG_HOT_URL]);
    assert.equal(r.ok, true);
    assert.equal(r.total, 2);
    assert.equal(r.games[0].rank, 1);
  });

  it("returns upstream_unavailable on HTTP error", async () => {
    globalThis.fetch = async () => new Response("x", { status: 401 });
    const r = await handler()({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_unavailable");
  });

  it("returns upstream_unavailable on network failure and on empty feed", async () => {
    globalThis.fetch = async () => { throw new Error("boom"); };
    assert.equal((await handler()({}, {})).reason, "upstream_unavailable");
    globalThis.fetch = async () => new Response("<items></items>", { status: 200 });
    const r = await handler()({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_unavailable");
  });
});
