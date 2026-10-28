// GitHub "other" reads behind the server (feed-cache phase 8b): trending,
// repo releases/forks, public gists, global advisories. No network: the
// module's test transport replaces fetchPublicUrl, and the global fetch
// throws so a surviving bare fetch() fails loudly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureFeedCache } from "../lib/feed-cache.js";
import {
  setGithubTransportForTests, _resetGithubFeedForTests,
} from "../lib/github-feed-sources.js";
import registerReposActions from "../domains/repos.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const realFetch = globalThis.fetch;
const realToken = process.env.GITHUB_TOKEN;
const SECRET = "ghp_SECRET_TOKEN_VALUE_123";

const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const repoItem = (n) => ({ id: n, full_name: `o/r${n}`, html_url: `https://github.com/o/r${n}`, description: "d", stargazers_count: 100 - n, forks_count: 1, open_issues_count: 0, language: "Go", license: { spdx_id: "MIT" }, pushed_at: "2026-10-01T00:00:00Z" });
const release = () => ({ id: 7, tag_name: "v1.0.0", name: "One", draft: false, prerelease: true, published_at: "2026-09-01T00:00:00Z", html_url: "https://github.com/facebook/react/releases/tag/v1.0.0", author: { login: "gaearon", avatar_url: "x" }, body: "b".repeat(5000), assets: [1, 2, 3] });
const fork = () => ({ id: 8, full_name: "someone/react", html_url: "https://github.com/someone/react", description: null, stargazers_count: 5, forks_count: 0, pushed_at: "2026-10-02T00:00:00Z", owner: { login: "someone", avatar_url: "x" }, watchers: 9 });
const gist = () => ({ id: "g1", description: "hi", html_url: "https://gist.github.com/g1", public: true, files: { "a.js": { filename: "a.js", language: "JavaScript", size: 42, raw_url: "https://gist.githubusercontent.com/raw" } }, owner: { login: "octo", avatar_url: "https://avatars.example/o" }, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", comments: 2, forks: [] });
const advisory = () => ({ ghsa_id: "GHSA-xxxx", cve_id: "CVE-2026-0001", summary: "s".repeat(900), severity: "high", published_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/advisories/GHSA-xxxx", type: "reviewed", cvss: { score: 7.5, vector_string: "CVSS:3.1/AV:N" }, vulnerabilities: [{ package: { ecosystem: "npm", name: "pkg" }, vulnerable_version_range: "< 1.0" }], description: "long text that must be dropped" });

let calls;
let clock;
let route;
let actions;

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  calls = [];
  clock = 1_000_000_000;
  route = (url) => {
    if (url.includes("/search/repositories")) return res({ items: [repoItem(1), repoItem(2)] });
    if (url.includes("/releases?")) return res([release()]);
    if (url.includes("/forks?")) return res([fork()]);
    if (url.includes("/gists/public")) return res([gist()]);
    if (url.includes("/advisories")) return res([advisory()]);
    return res({}, 404);
  };
  _resetGithubFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  setGithubTransportForTests(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in github paths"); };
  actions = new Map();
  registerReposActions((d, n, fn) => actions.set(`${d}.${n}`, fn));
});
afterEach(() => {
  setGithubTransportForTests(null);
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = realToken;
  _resetGithubFeedForTests();
});

const act = (name, params) => actions.get(`repos.${name}`)({}, {}, params);

test("invalid params are rejected with a 400 and no fetch", async () => {
  const bad = [
    ["github-trending", { sinceDays: 90 }],
    ["github-trending", { sinceDays: "abc" }],
    ["github-trending", {}],
    ["github-trending", { sinceDays: 7, lang: "C#" }],
    ["github-trending", { sinceDays: 7, lang: "language:rust" }],
    ["github-repo-meta", { owner: "facebook", repo: "react", kind: "issues" }],
    ["github-repo-meta", { owner: "face/book", repo: "react", kind: "releases" }],
    ["github-repo-meta", { owner: "facebook", repo: "../etc", kind: "forks" }],
    ["github-repo-meta", { owner: "", repo: "react", kind: "forks" }],
    ["github-repo-meta", { owner: "facebook", repo: "react\n", kind: "forks" }],
    ["github-advisories", { ecosystem: "bitbucket" }],
    ["github-advisories", { severity: "severe" }],
    ["github-advisories", { severity: "HIGH" }],
  ];
  for (const [name, params] of bad) {
    const r = await act(name, params);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(params)}`);
    assert.equal(r.status, 400, `${name} ${JSON.stringify(params)}`);
  }
  assert.equal(calls.length, 0);
});

test("trending: created-since search URL with optional allowlisted language", async () => {
  const r = await act("github-trending", { sinceDays: 7, lang: "Rust" });
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 2);
  assert.equal(r.result.stale, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/search\/repositories\?q=created%3A%3E\d{4}-\d{2}-\d{2}%20language%3ARust&sort=stars&order=desc&per_page=25$/);
  const plain = await act("github-trending", { sinceDays: 1 });
  assert.equal(plain.ok, true);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].url, /language/);
});

test("repo-meta releases: fixed URL, payload trimmed to the widget's fields", async () => {
  const r = await act("github-repo-meta", { owner: "facebook", repo: "react", kind: "releases" });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://api.github.com/repos/facebook/react/releases?per_page=30");
  const item = r.result.items[0];
  assert.equal(item.tag_name, "v1.0.0");
  assert.equal(item.body.length, 2000);
  assert.deepEqual(item.author, { login: "gaearon" });
  assert.equal("assets" in item, false);
});

test("repo-meta forks: stargazer sort, owner trimmed to login", async () => {
  const r = await act("github-repo-meta", { owner: "vercel", repo: "next.js", kind: "forks" });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://api.github.com/repos/vercel/next.js/forks?sort=stargazers&per_page=30");
  assert.deepEqual(r.result.items[0].owner, { login: "someone" });
  assert.equal("watchers" in r.result.items[0], false);
});

test("gists-public: fixed URL, file map preserved, extra fields dropped", async () => {
  const r = await act("github-gists-public", {});
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://api.github.com/gists/public?per_page=30");
  const g = r.result.items[0];
  assert.equal(g.files["a.js"].language, "JavaScript");
  assert.equal(g.owner.login, "octo");
  assert.equal("forks" in g, false);
});

test("advisories: severity becomes a query param; summary capped; description dropped", async () => {
  const r = await act("github-advisories", { severity: "high" });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://api.github.com/advisories?per_page=30&severity=high");
  const a = r.result.items[0];
  assert.equal(a.summary.length, 500);
  assert.equal("description" in a, false);
  const all = await act("github-advisories", {});
  assert.equal(all.ok, true);
  assert.equal(calls[1].url, "https://api.github.com/advisories?per_page=30");
});

test("cache: identical calls cost one upstream request; different params are different keys", async () => {
  await act("github-repo-meta", { owner: "facebook", repo: "react", kind: "releases" });
  await act("github-repo-meta", { owner: "facebook", repo: "react", kind: "releases" });
  await act("github-gists-public", {});
  await act("github-gists-public", {});
  assert.equal(calls.length, 2);
  await act("github-repo-meta", { owner: "facebook", repo: "react", kind: "forks" });
  assert.equal(calls.length, 3);
});

test("headers: UA always, Authorization only with GITHUB_TOKEN, token never echoed", async () => {
  await act("github-gists-public", {});
  assert.equal(calls[0].init.headers["User-Agent"], "concord-code-lens");
  assert.equal("Authorization" in calls[0].init.headers, false);

  process.env.GITHUB_TOKEN = SECRET;
  _resetGithubFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  setGithubTransportForTests(async (url, init) => { calls.push({ url: String(url), init }); return route(String(url)); });
  await act("github-gists-public", {});
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${SECRET}`);

  route = () => res({ message: `Bad credentials ${SECRET}` }, 401);
  const bad = await act("github-advisories", { severity: "low" });
  assert.equal(bad.ok, false);
  assert.equal(JSON.stringify(bad).includes(SECRET), false);
  assert.equal(JSON.stringify(bad).includes("Bearer"), false);
});

test("upstream failure with no cache -> honest unavailable, never fake data", async () => {
  route = () => res({}, 403);
  const r = await act("github-trending", { sinceDays: 30 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /rate_limited/);
  assert.equal(r.result, undefined);
});

test("after the TTL a failing upstream serves stale data, flagged (gists 30m TTL)", async () => {
  const fresh = await act("github-gists-public", {});
  assert.equal(fresh.ok, true);
  clock += 31 * MIN; // past the 30m gists TTL, inside staleMax (7d)
  route = () => res({}, 500);
  const stale = await act("github-gists-public", {});
  assert.equal(stale.ok, true);
  assert.equal(stale.result.stale, true);
  assert.equal(stale.result.items.length, 1);
  assert.equal(stale.result.fetchedAt, fresh.result.fetchedAt);
});

// ── static: the phase-8b components no longer call GitHub from the browser ──
const here = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(here, "../../concord-frontend/components");
const CONVERTED_8B = {
  "code/GithubTrending.tsx": "github-trending",
  "repos/TrendingRepos.tsx": "github-trending",
  "security/SecurityAdvisories.tsx": "github-advisories",
  "bounties/GhsaAdvisories.tsx": "github-advisories",
  "custom/PublicGistGallery.tsx": "github-gists-public",
  "code-quality/ReleaseCadence.tsx": "github-repo-meta",
};

test("static: converted 8b components call the server actions and never fetch", () => {
  for (const [rel, action] of Object.entries(CONVERTED_8B)) {
    const src = fs.readFileSync(path.join(COMPONENTS, rel), "utf8");
    assert.ok(src.includes(`'${action}'`), `${rel} should call repos.${action} via lensRun`);
    assert.equal(src.includes("fetch("), false, `${rel} must not call fetch() directly`);
    assert.equal(src.includes("api.github.com/gists"), false, rel);
    assert.equal(src.includes("api.github.com/advisories"), false, rel);
    assert.equal(src.includes("api.github.com/repos/"), false, rel);
  }
});
