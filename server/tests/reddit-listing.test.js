// Community Reddit listings are fetched on the server from an allowlisted
// subreddit template. Callers cannot supply a URL. No live Reddit egress:
// every upstream call is a fake fetchImpl.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  ALLOWED_SUBREDDITS,
  REDDIT_LISTING_ORIGIN,
  REDDIT_USER_AGENT,
  buildRedditListingUrl,
  clearRedditListingCache,
  loadRedditListing,
} from "../lib/reddit-listing.js";
import { createRedditListingRouter } from "../routes/reddit-listing.js";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "concord-frontend");

function listingBody(posts) {
  return { data: { children: posts.map((data) => ({ data })) } };
}

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return { fetchImpl, calls };
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const post = {
  id: "abc123",
  title: "Morning pages that stuck",
  permalink: "/r/Journaling/comments/abc123/morning_pages/",
  author: "ada",
  score: 42,
  num_comments: 7,
  link_flair_text: "Discussion",
  created_utc: 1_700_000_000,
};

test("buildRedditListingUrl only emits the allowlisted template", () => {
  assert.equal(
    buildRedditListingUrl({ sub: "Journaling", window: "week", sort: "top", limit: 25 }),
    `${REDDIT_LISTING_ORIGIN}/r/Journaling/top.json?t=week&limit=25`,
  );
  assert.equal(
    buildRedditListingUrl({ sub: "Design", window: "week", sort: "hot", limit: 100 }),
    `${REDDIT_LISTING_ORIGIN}/r/Design/hot.json?t=week&limit=25`,
  );
  assert.throws(() => buildRedditListingUrl({ sub: "https://evil.example/secret" }), (err) => err.code === "invalid_subreddit");
  assert.throws(() => buildRedditListingUrl({ sub: "Journaling/../private" }), (err) => err.code === "invalid_subreddit");
  assert.throws(() => buildRedditListingUrl({ sub: "not-a-real-panel-sub" }), (err) => err.code === "invalid_subreddit");
  assert.throws(() => buildRedditListingUrl({ sub: "Journaling", window: "week;curl" }), (err) => err.code === "invalid_window");
  assert.throws(() => buildRedditListingUrl({ sub: "Journaling", sort: "top/../../" }), (err) => err.code === "invalid_sort");
});

test("loadRedditListing does not fetch when the subreddit is not allowlisted", async () => {
  let called = false;
  const result = await loadRedditListing(
    { sub: "https://169.254.169.254/latest/meta-data", window: "week" },
    { fetchImpl: async () => { called = true; return jsonRes(200, listingBody([post])); }, cache: new Map(), sleep: async () => {} },
  );
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_subreddit");
  assert.equal(result.posts, undefined);
});

test("loadRedditListing returns upstream posts, caches them, and labels the cache", async () => {
  const { fetchImpl, calls } = fakeFetch(async () => jsonRes(200, listingBody([
    post,
    { id: "bad", title: "nope", permalink: "https://evil.example/phish", author: "x", score: 1, num_comments: 0 },
    { id: "rel", title: "rel", permalink: "//evil.example/phish", author: "x", score: 1, num_comments: 0 },
  ])));
  const cache = new Map();
  let now = 1_000_000;
  const deps = { fetchImpl, cache, now: () => now, sleep: async () => {}, ttlMs: 60_000 };
  const first = await loadRedditListing({ sub: "Journaling", window: "week" }, deps);
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.equal(first.stale, false);
  assert.equal(first.posts.length, 1);
  assert.equal(first.posts[0].title, "Morning pages that stuck");
  assert.equal(first.posts[0].permalink, "/r/Journaling/comments/abc123/morning_pages/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${REDDIT_LISTING_ORIGIN}/r/Journaling/top.json?t=week&limit=25`);
  assert.equal(calls[0].init.headers["User-Agent"], REDDIT_USER_AGENT);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(String(calls[0].url).includes("evil.example"), false);

  now += 1_000;
  const second = await loadRedditListing({ sub: "Journaling", window: "week" }, deps);
  assert.equal(calls.length, 1);
  assert.equal(second.cached, true);
  assert.equal(second.stale, false);
  assert.equal(second.posts[0].title, "Morning pages that stuck");
});

test("loadRedditListing retries a transient failure at most three times", async () => {
  const { fetchImpl, calls } = fakeFetch(async () => jsonRes(503, { message: "down" }));
  const cache = new Map();
  let now = 5_000_000;
  const result = await loadRedditListing(
    { sub: "Journaling", window: "week" },
    { fetchImpl, cache, now: () => now, sleep: async () => {}, maxAttempts: 3 },
  );
  assert.equal(calls.length, 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "community_feed_unavailable");
  assert.equal(result.posts, undefined);

  now += 1_000;
  await loadRedditListing({ sub: "Journaling", window: "week" }, { fetchImpl, cache, now: () => now, sleep: async () => {} });
  assert.equal(calls.length, 3, "a failed pull is not retried again inside the cooldown");
});

test("a failed refresh serves the previous posts labeled stale, and does not invent any", async () => {
  let mode = "ok";
  const { fetchImpl, calls } = fakeFetch(async () => {
    if (mode === "ok") return jsonRes(200, listingBody([post]));
    return jsonRes(403, { message: "Forbidden", error: 403 });
  });
  const cache = new Map();
  let now = 9_000_000;
  const deps = { fetchImpl, cache, now: () => now, sleep: async () => {}, ttlMs: 1_000 };
  const first = await loadRedditListing({ sub: "BulletJournal", window: "day" }, deps);
  assert.equal(first.posts[0].title, "Morning pages that stuck");
  mode = "fail";
  now += 5_000;
  const stale = await loadRedditListing({ sub: "BulletJournal", window: "day" }, deps);
  assert.equal(stale.ok, true);
  assert.equal(stale.cached, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.posts.length, 1);
  assert.equal(stale.posts[0].title, "Morning pages that stuck");
  assert.equal(calls.length, 2);

  now += 500;
  const held = await loadRedditListing({ sub: "BulletJournal", window: "day" }, deps);
  assert.equal(held.stale, true);
  assert.equal(calls.length, 2);
});

test("a Reddit error body is not cached as an empty success", async () => {
  const { fetchImpl, calls } = fakeFetch(async () => jsonRes(200, { message: "Forbidden", error: 403 }));
  const result = await loadRedditListing(
    { sub: "Journaling", window: "month" },
    { fetchImpl, cache: new Map(), sleep: async () => {} },
  );
  assert.equal(calls.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "community_feed_unavailable");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("every panel subreddit is allowlisted and no client file fetches reddit.com", () => {
  assert.equal(ALLOWED_SUBREDDITS.has("Journaling"), true);
  const files = walk(join(FRONTEND, "components")).concat(walk(join(FRONTEND, "app")), walk(join(FRONTEND, "lib")));
  const fetchReddit = /fetch\s*\(\s*[`'"]https?:\/\/(?:www\.|old\.|api\.|oauth\.)?reddit\.com/;
  const offenders = [];
  const subs = new Set();
  let panels = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (fetchReddit.test(text)) offenders.push(file);
    if (text.includes("fetchRedditListing")) {
      panels += 1;
      for (const id of text.matchAll(/\{\s*id:\s*'([^']+)'/g)) subs.add(id[1]);
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(panels >= 37, `expected the copied panels to call fetchRedditListing, saw ${panels}`);
  for (const sub of subs) {
    assert.equal(ALLOWED_SUBREDDITS.has(sub), true, sub);
  }
});

test("clearRedditListingCache drops the shared cache", async () => {
  clearRedditListingCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonRes(200, listingBody([post]));
  };
  await loadRedditListing({ sub: "philosophy", window: "week" }, { fetchImpl, sleep: async () => {} });
  await loadRedditListing({ sub: "philosophy", window: "week" }, { fetchImpl, sleep: async () => {} });
  assert.equal(calls, 1);
  clearRedditListingCache();
  await loadRedditListing({ sub: "philosophy", window: "week" }, { fetchImpl, sleep: async () => {} });
  assert.equal(calls, 2);
});

async function withApp(router, fn) {
  const app = express();
  app.use("/api/community", router);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    server.close();
    await once(server, "close");
  }
}

test("GET /api/community/reddit-listing rejects a caller-supplied URL and does not call load", async () => {
  let called = false;
  const router = createRedditListingRouter({
    load: async () => { called = true; return { ok: true, posts: [], cached: false, stale: false, fetchedAt: 1 }; },
  });
  await withApp(router, async (base) => {
    const res = await fetch(`${base}/api/community/reddit-listing?sub=Journaling&t=week&url=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`);
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.reason, "url_not_accepted");
    assert.equal(body.posts, undefined);
  });
  assert.equal(called, false);
});

test("GET /api/community/reddit-listing returns real posts and an honest failure", async () => {
  const router = createRedditListingRouter({
    load: async (input) => {
      assert.equal(input.sub, "Journaling");
      assert.equal(input.window, "week");
      assert.equal(input.url, undefined);
      if (input.sort === "new") return { ok: false, reason: "community_feed_unavailable" };
      return {
        ok: true,
        posts: [{ id: "abc123", title: "Morning pages that stuck", permalink: "/r/Journaling/comments/abc123/morning_pages/", author: "ada", score: 42, num_comments: 7 }],
        cached: true,
        stale: false,
        fetchedAt: 123,
      };
    },
  });
  await withApp(router, async (base) => {
    const okRes = await fetch(`${base}/api/community/reddit-listing?sub=Journaling&t=week`);
    const okBody = await okRes.json();
    assert.equal(okRes.status, 200);
    assert.equal(okBody.ok, true);
    assert.equal(okBody.cached, true);
    assert.equal(okBody.stale, false);
    assert.equal(okBody.posts.length, 1);
    assert.equal(okBody.posts[0].title, "Morning pages that stuck");

    const bad = await fetch(`${base}/api/community/reddit-listing?sub=Journaling&t=week&sort=new`);
    const badBody = await bad.json();
    assert.equal(bad.status, 503);
    assert.deepEqual(badBody, { ok: false, reason: "community_feed_unavailable" });
  });
});
