// FIX-custom-004 — the Gist gallery's Refresh never moved its cache
// timestamp: the gallery re-asked the server, but github-gists-public
// always answered from feed-cache's 30-minute entry and returned its
// original fetchedAt. feed-cache already supports a forced re-fetch
// (budget still applies; a failed forced fetch serves the stale entry
// marked stale) — the flag now threads gallery → action → source.
// Pins drive the real repos action with a mocked transport and a
// controllable clock, the github-other.test.js pattern.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setGithubTransportForTests, _resetGithubFeedForTests } from "../lib/github-feed-sources.js";
import { configureFeedCache } from "../lib/feed-cache.js";
import registerReposActions from "../domains/repos.js";

let calls;
let clock;
let actions;
const realFetch = globalThis.fetch;
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const gist = () => ({ id: "g1", description: "d", html_url: "https://gist.github.com/g1", public: true, files: { "a.js": { filename: "a.js", language: "JavaScript", size: 3, raw_url: "x" } }, owner: { login: "octo", avatar_url: "a" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", comments: 0 });

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  calls = [];
  clock = 1_000_000_000;
  _resetGithubFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  setGithubTransportForTests(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return res([gist()]);
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in github paths"); };
  actions = new Map();
  registerReposActions((d, n, fn) => actions.set(`${d}.${n}`, fn));
});
afterEach(() => {
  setGithubTransportForTests(null);
  globalThis.fetch = realFetch;
  _resetGithubFeedForTests();
});
const act = (name, params) => actions.get(`repos.${name}`)({}, {}, params);

test("gists-public: a plain re-read serves the cache; force:true re-fetches and the timestamp moves", async () => {
  const first = await act("github-gists-public", {});
  assert.equal(first.ok, true);
  assert.equal(calls.length, 1);
  const t0 = first.result.fetchedAt;

  clock += 5 * 60_000; // five minutes later, well inside the 30-minute TTL
  const again = await act("github-gists-public", {});
  assert.equal(calls.length, 1); // cache served, no upstream spend
  assert.equal(again.result.fetchedAt, t0);

  const refreshed = await act("github-gists-public", { force: true });
  assert.equal(refreshed.ok, true);
  assert.equal(calls.length, 2); // Refresh actually fetched
  assert.ok(refreshed.result.fetchedAt > t0, "the freshness timestamp moves on a forced refresh");
  assert.equal(refreshed.result.stale, false);
});

test("gists-public: force must be exactly true — other shapes stay cached reads", async () => {
  await act("github-gists-public", {});
  await act("github-gists-public", { force: "true" });
  await act("github-gists-public", { force: 1 });
  assert.equal(calls.length, 1);
});
