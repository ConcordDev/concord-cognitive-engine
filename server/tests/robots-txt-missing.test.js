// checkRobotsTxt: a missing robots.txt (404 / 410) means "no rules" under RFC 9309 and is
// allowed (feeds.npr.org has none, so NPR was skipped). 5xx, 401/403/429 and network
// errors stay conservative (skip). Parsed rules are still honoured. No network: fetch is stubbed.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { checkRobotsTxt } from "../emergent/entity-web-exploration.js";

const realFetch = globalThis.fetch;
const calls = [];
const byHost = {
  "missing404.test": () => new Response("Not found", { status: 404 }),
  "gone410.test": () => new Response("", { status: 410 }),
  "err500.test": () => new Response("oops", { status: 500 }),
  "err503.test": () => new Response("busy", { status: 503 }),
  "forbidden403.test": () => new Response("no", { status: 403 }),
  "ratelimited429.test": () => new Response("slow", { status: 429 }),
  "neterr.test": () => { throw new TypeError("fetch failed"); },
  "rules.test": () => new Response("User-agent: *\nDisallow: /private\n", { status: 200 }),
};

before(() => {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url)); calls.push(u.href);
    const h = byHost[u.hostname]; if (!h) throw new Error("unexpected host " + u.hostname);
    return h();
  };
});
after(() => { globalThis.fetch = realFetch; });

describe("checkRobotsTxt missing-file handling", () => {
  it("404 robots.txt => allowed, and cached (asked once)", async () => {
    assert.equal(await checkRobotsTxt("https://missing404.test/1001/rss.xml"), true);
    assert.equal(await checkRobotsTxt("https://missing404.test/1004/rss.xml"), true);
    assert.equal(calls.filter((c) => c.includes("missing404.test")).length, 1);
  });
  it("410 robots.txt => allowed", async () => {
    assert.equal(await checkRobotsTxt("https://gone410.test/feed"), true);
  });
  for (const h of ["err500.test", "err503.test", "forbidden403.test", "ratelimited429.test", "neterr.test"]) {
    it(`${h} => conservative skip`, async () => {
      assert.equal(await checkRobotsTxt(`https://${h}/feed`), false);
    });
  }
  it("a real robots.txt is still honoured", async () => {
    assert.equal(await checkRobotsTxt("https://rules.test/public/feed.xml"), true);
    assert.equal(await checkRobotsTxt("https://rules.test/private/feed.xml"), false);
  });
});
