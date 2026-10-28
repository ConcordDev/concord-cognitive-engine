// GitHub topic search behind the server (feed-cache phase 8a). No network: the module's
// test transport replaces fetchPublicUrl, and the global fetch throws so a surviving bare
// fetch() fails loudly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureFeedCache } from "../lib/feed-cache.js";
import {
  githubTopicSearch, githubSearchKey, setGithubTransportForTests, _resetGithubFeedForTests, TOPIC_ALLOWLIST,
} from "../lib/github-feed-sources.js";
import registerReposActions from "../domains/repos.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const realFetch = globalThis.fetch;
const realToken = process.env.GITHUB_TOKEN;
const SECRET = "ghp_SECRET_TOKEN_VALUE_123";

const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const repo = (n) => ({ id: n, full_name: `o/r${n}`, html_url: `https://github.com/o/r${n}`, description: "d", stargazers_count: 100 - n, forks_count: 1, open_issues_count: 0, language: "Go", license: { spdx_id: "MIT" }, pushed_at: "2026-10-01T00:00:00Z" });

let calls;
let clock;
let route;
let actions;

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  calls = [];
  clock = 1_000_000_000;
  route = () => res({ items: [repo(1), repo(2)] });
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

const act = (params) => actions.get("repos.github-topic-search")({}, {}, params);

test("topic outside the allowlist is rejected with no fetch", async () => {
  for (const topic of ["not-a-real-topic", "robotics user:evil", "robotics&q=x", "../../etc", "", undefined, 5, "https://evil.example"]) {
    const r = await act({ topic });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("allowlisted topic: fixed URL, perPage clamped 1..25, sort stars desc", async () => {
  const r = await act({ topic: "robotics", perPage: 999 });
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 2);
  assert.equal(r.result.stale, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/search/repositories?q=topic%3Arobotics&sort=stars&order=desc&per_page=25");
  await act({ topic: "robotics", perPage: 0 });
  assert.match(calls[1].url, /per_page=1$/);
  // non-numeric perPage falls back to 25, which is already cached from the first call
  await act({ topic: "robotics", perPage: "abc" });
  assert.equal(calls.length, 2);
  assert.equal(githubSearchKey({ topic: "Robotics ", perPage: 20 }), "robotics|20");
  assert.ok(TOPIC_ALLOWLIST.has("database") && TOPIC_ALLOWLIST.has("zero-trust"));
});

test("cache hit: second call (and a different caller) cost no upstream request", async () => {
  await act({ topic: "mesh-network" });
  const again = await act({ topic: "mesh-network" });
  const direct = await githubTopicSearch({ topic: "mesh-network", perPage: 25 });
  assert.equal(calls.length, 1);
  assert.equal(again.ok, true);
  assert.equal(direct.ok, true);
  assert.equal(direct.items.length, 2);
  // different perPage is a different key
  await act({ topic: "mesh-network", perPage: 20 });
  assert.equal(calls.length, 2);
});

test("headers: UA always, Authorization only with GITHUB_TOKEN", async () => {
  await act({ topic: "p2p" });
  assert.equal(calls[0].init.headers["User-Agent"], "concord-code-lens");
  assert.equal(calls[0].init.headers.Accept, "application/vnd.github+json");
  assert.equal("Authorization" in calls[0].init.headers, false);

  process.env.GITHUB_TOKEN = SECRET;
  _resetGithubFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  setGithubTransportForTests(async (url, init) => { calls.push({ url: String(url), init }); return route(String(url)); });
  await act({ topic: "libp2p" });
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${SECRET}`);
});

test("token is never echoed in results, errors or logs", async () => {
  process.env.GITHUB_TOKEN = SECRET;
  _resetGithubFeedForTests();
  const logs = [];
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: (...a) => logs.push(a.join(" ")), logUpstream: (l) => logs.push(String(l)) });
  setGithubTransportForTests(async (url, init) => {
    calls.push({ url: String(url), init });
    return route(String(url));
  });
  const ok = await act({ topic: "wireguard" });
  route = () => res({ message: `Bad credentials ${SECRET}` }, 401);
  const bad = await act({ topic: "lora" });
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  const blob = JSON.stringify([ok, bad, logs]);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes("Bearer"), false);
});

test("upstream failure with no cache -> honest unavailable, never fake data", async () => {
  route = () => res({}, 403);
  const r = await act({ topic: "sdr" });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /rate_limited/);
  assert.equal(r.result, undefined);
});

test("after the TTL a failing upstream serves stale data, flagged", async () => {
  const fresh = await act({ topic: "slam" });
  assert.equal(fresh.ok, true);
  clock += 7 * HOUR; // past ttl (6h), inside staleMax (7d)
  route = () => res({}, 500);
  const stale = await act({ topic: "slam" });
  assert.equal(stale.ok, true);
  assert.equal(stale.result.stale, true);
  assert.equal(stale.result.items.length, 2);
  assert.equal(stale.result.fetchedAt, fresh.result.fetchedAt);
});

test("unauthenticated budget (8/min) exhausted -> stale or unavailable, no extra fetch", async () => {
  const topics = ["arduino", "kicad", "pcb", "fpga", "gpu", "sdr", "lora", "slam", "ros", "lte"];
  const out = [];
  for (const t of topics) out.push(await act({ topic: t }));
  assert.equal(calls.length, 8);
  assert.equal(out.slice(0, 8).every((r) => r.ok), true);
  for (const r of out.slice(8)) {
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
  }
});

// ── static: components no longer call GitHub search from the browser ────────
const here = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(here, "../../concord-frontend/components");
const NEEDLE = "search/repositories?q=topic:";

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Phase 8a-2 (second half, alphabetically by path) is still to be converted; this list only
// shrinks. When it is empty the assertion below becomes "no component calls it at all".
const PENDING_8A2 = new Set([
  "ops/OpsRepos.tsx", "platform/PlatformRepos.tsx", "productivity/ProductivityRepos.tsx", "projects/ProjectMgmtRepos.tsx",
  "queue/QueueRepos.tsx", "questmarket/BountiesFeed.tsx", "robotics/RoboticsRepos.tsx", "sandbox/SandboxRepos.tsx",
  "schema/SchemaRepos.tsx", "sim/SimRepos.tsx", "sponsorship/SponsorRepos.tsx", "srs/SrsRepos.tsx",
  "studio/StudioRepos.tsx", "sub-worlds/MetaverseRepos.tsx", "sync/SyncRepos.tsx", "telecommunications/TelcoRepos.tsx",
  "temporal/TemporalRepos.tsx", "tools/ToolsRepos.tsx", "transfer/TransferRepos.tsx", "ux-suite/UxRepos.tsx",
  "voice/VoiceRepos.tsx", "whiteboard/WhiteboardRepos.tsx",
]);

test("static: converted components no longer fetch GitHub topic search from the browser", () => {
  const offenders = walk(COMPONENTS)
    .filter((f) => fs.readFileSync(f, "utf8").includes(NEEDLE))
    .map((f) => path.relative(COMPONENTS, f).split(path.sep).join("/"))
    .filter((rel) => !PENDING_8A2.has(rel));
  assert.deepEqual(offenders, []);
});

test("static: converted components call the server action", () => {
  const converted = walk(COMPONENTS).filter((f) => fs.readFileSync(f, "utf8").includes("'github-topic-search'"));
  assert.ok(converted.length >= 22, `expected >=22 converted components, got ${converted.length}`);
  for (const f of converted) assert.equal(fs.readFileSync(f, "utf8").includes("api.github.com/search"), false, f);
});
