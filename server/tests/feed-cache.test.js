import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerSource, get, getOrThrow, pool, warmTick, stats,
  configureFeedCache, _resetFeedCacheForTests, flushPersist, loadPersisted,
} from "../lib/feed-cache.js";
import { cachedFetchJson, clearExternalFetchCache } from "../lib/external-fetch.js";

let clock;
const tick = (ms) => { clock += ms; };
beforeEach(() => {
  _resetFeedCacheForTests();
  clock = 1_000_000;
  configureFeedCache({ now: () => clock, log: () => {} });
});

const flush = () => new Promise((r) => setImmediate(r));

test("coalescing: N concurrent gets => one fetch", async () => {
  let calls = 0;
  registerSource("s", { ttlMs: 1000, fetcher: async () => { calls++; await flush(); return { v: 1 }; } });
  const rs = await Promise.all(Array.from({ length: 10 }, () => get("s", "k")));
  assert.equal(calls, 1);
  assert.ok(rs.every((r) => r.status === "fresh" && r.data.v === 1));
  assert.equal((await get("s", "k")).status, "fresh");
  assert.equal(calls, 1);
});

test("stale-while-revalidate: stale returned at once, exactly one background refresh", async () => {
  let calls = 0;
  registerSource("s", { ttlMs: 1000, staleMaxMs: 60_000, fetcher: async () => { calls++; await flush(); return { n: calls }; } });
  await get("s", "k");
  tick(2000);
  const rs = await Promise.all([get("s", "k"), get("s", "k"), get("s", "k")]);
  assert.ok(rs.every((r) => r.status === "stale" && r.stale && r.data.n === 1));
  await flush(); await flush(); await flush();
  assert.equal(calls, 2);
  const after = await get("s", "k");
  assert.equal(after.status, "fresh");
  assert.equal(after.data.n, 2);
});

test("staleMaxMs exceeded => unavailable (never serve ancient data)", async () => {
  let fail = false;
  registerSource("s", { ttlMs: 1000, staleMaxMs: 5000, fetcher: async () => { if (fail) throw new Error("down"); return 1; } });
  await get("s", "k");
  const okAt = clock;
  tick(10_000); fail = true;
  const r = await get("s", "k");
  assert.equal(r.status, "unavailable");
  assert.equal(r.data, null);
  assert.match(r.reason, /upstream_error: down/);
  assert.equal(r.lastOkAt, okAt);
});

test("budget exhaustion serves stale, or unavailable, and never calls the fetcher", async () => {
  let calls = 0;
  registerSource("s", { ttlMs: 1000, staleMaxMs: 600_000, budget: { perMin: 2 }, fetcher: async (k) => { calls++; return k; } });
  await get("s", "a");
  await get("s", "b");
  assert.equal(calls, 2);
  const c = await get("s", "c");
  assert.equal(c.status, "unavailable");
  assert.equal(c.reason, "budget_exhausted");
  assert.equal(c.lastOkAt, clock);
  tick(2000); // 'a' stale, bucket still < 1 token (2/min => 1 token per 30 s)
  const a = await get("s", "a");
  assert.equal(a.status, "stale");
  assert.equal(calls, 2);
  tick(30_000); // a token refilled
  const c2 = await get("s", "c");
  assert.equal(c2.status, "fresh");
  assert.equal(calls, 3);
});

test("minSpacingMs serializes upstream calls", async () => {
  const starts = [];
  registerSource("s", {
    ttlMs: 1000, budget: { minSpacingMs: 40 },
    fetcher: async (k) => { starts.push(Date.now()); return k; },
  });
  configureFeedCache({ sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() });
  await Promise.all([get("s", "a"), get("s", "b"), get("s", "c")]);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 35, `gap1 ${starts[1] - starts[0]}`);
  assert.ok(starts[2] - starts[1] >= 35, `gap2 ${starts[2] - starts[1]}`);
});

test("no-spacing source runs different keys concurrently; serialize:true opts in", async () => {
  let releaseA; const gateA = new Promise((r) => { releaseA = r; });
  const started = [];
  registerSource("c", { ttlMs: 1000, fetcher: async (k) => { started.push(k); if (k === "a") await gateA; return k; } });
  const pa = get("c", "a");
  const pb = get("c", "b");
  assert.equal((await pb).status, "fresh"); // b finishes while a is still pending
  assert.deepEqual(started, ["a", "b"]);
  releaseA();
  assert.equal((await pa).status, "fresh");

  let releaseS; const gateS = new Promise((r) => { releaseS = r; });
  const startedS = [];
  registerSource("ser", { ttlMs: 1000, serialize: true, fetcher: async (k) => { startedS.push(k); if (k === "a") await gateS; return k; } });
  const sa = get("ser", "a");
  const sb = get("ser", "b");
  await flush(); await flush();
  assert.deepEqual(startedS, ["a"]); // b queued behind a
  releaseS();
  await Promise.all([sa, sb]);
  assert.deepEqual(startedS, ["a", "b"]);
});

test("cachedFetchJson on two different URLs is concurrent", async () => {
  clearExternalFetchCache();
  let release; const gate = new Promise((r) => { release = r; });
  const started = [];
  const slow = async () => { started.push("slow"); await gate; return { ok: true, status: 200, json: async () => ({ s: 1 }) }; };
  const fast = async () => { started.push("fast"); return { ok: true, status: 200, json: async () => ({ f: 1 }) }; };
  const p1 = cachedFetchJson("https://93.184.216.34/slow.json", { opts: { fetchImpl: slow } });
  const p2 = cachedFetchJson("https://93.184.216.34/fast.json", { opts: { fetchImpl: fast } });
  assert.deepEqual(await p2, { f: 1 }); // resolves while slow is still pending
  assert.deepEqual(started, ["slow", "fast"]);
  release();
  assert.deepEqual(await p1, { s: 1 });
});

test("breaker backs off exponentially, never calls upstream while open, then recovers; failures not cached", async () => {
  let calls = 0, healthy = false;
  registerSource("s", {
    ttlMs: 1000, staleMaxMs: 5000,
    fetcher: async () => { calls++; if (!healthy) throw new Error("boom"); return "ok"; },
  });
  let r = await get("s", "k");
  assert.equal(r.status, "unavailable");
  assert.equal(calls, 1);
  r = await get("s", "k");
  assert.equal(r.reason, "upstream_backoff");
  assert.equal(calls, 1);
  assert.equal(stats().s.backoffMs, 60_000);
  tick(60_001);
  await get("s", "k"); // probe fails -> 120 s
  assert.equal(calls, 2);
  assert.equal(stats().s.backoffMs, 120_000);
  tick(119_000);
  assert.equal((await get("s", "k")).reason, "upstream_backoff");
  assert.equal(calls, 2);
  // caps at 10 min
  for (let i = 0; i < 6; i++) { tick(11 * 60_000); await get("s", "k"); }
  assert.equal(stats().s.backoffMs, 600_000);
  // recovery
  healthy = true;
  tick(11 * 60_000);
  r = await get("s", "k");
  assert.equal(r.status, "fresh");
  assert.equal(r.data, "ok");
  assert.equal(stats().s.breaker, "closed");
  assert.equal(stats().s.backoffMs, 0);
});

test("a failed refresh keeps serving the (still in-window) stale copy, not the error", async () => {
  let fail = false;
  registerSource("s", { ttlMs: 1000, staleMaxMs: 60_000, fetcher: async () => { if (fail) throw new Error("x"); return "v1"; } });
  await get("s", "k");
  tick(2000); fail = true;
  const r = await get("s", "k", { force: true });
  assert.equal(r.status, "stale");
  assert.equal(r.data, "v1");
});

test("unavailable shape is honest: reason + lastOkAt, null data", async () => {
  registerSource("s", { fetcher: async () => { throw new Error("nope"); } });
  const r = await get("s", "k");
  assert.deepEqual(Object.keys(r).sort(), ["data", "fetchedAt", "lastOkAt", "reason", "source", "stale", "status"]);
  assert.equal(r.data, null);
  assert.equal(r.lastOkAt, null);
  assert.ok(r.reason.length > 0);
  const u = await get("nope", "k");
  assert.equal(u.status, "unavailable");
  assert.equal(u.reason, "unknown_source");
});

test("timeout aborts and reports unavailable", async () => {
  configureFeedCache({ now: () => Date.now() });
  registerSource("s", { timeoutMs: 20, fetcher: (k, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) });
  const r = await get("s", "k");
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /timeout/);
});

test("pool: rotation via cursor, dedupe across pulls, newest first", async () => {
  let n = 0;
  const pulls = [
    [{ url: "u1", title: "A" }, { url: "u2", title: "B" }, { url: "u3", title: "C" }],
    [{ url: "u4", title: "D" }, { url: "u1", title: "A" }],
  ];
  registerSource("news", { ttlMs: 1000, staleMaxMs: 60_000, fetcher: async () => pulls[n++] });
  const dk = (i) => i.url;
  const w1 = await pool("news", "world", { limit: 2, dedupeKey: dk });
  assert.deepEqual(w1.items.map(dk), ["u1", "u2"]);
  assert.equal(w1.nextCursor, 2);
  tick(2000);
  const w2 = await pool("news", "world", { limit: 2, cursor: 0, dedupeKey: dk }); // triggers bg refresh
  await flush(); await flush(); await flush();
  const w3 = await pool("news", "world", { limit: 2, cursor: 0, dedupeKey: dk });
  assert.deepEqual(w3.items.map(dk), ["u4", "u1"]); // newest pull first, u1 deduped once
  assert.equal(w3.total, 4);
  const w4 = await pool("news", "world", { limit: 2, cursor: w3.nextCursor, dedupeKey: dk });
  assert.deepEqual(w4.items.map(dk), ["u2", "u3"]);
  assert.equal(w4.nextCursor, 0);
  assert.notDeepEqual(w3.items, w4.items);
  assert.equal(w2.status, "stale");
});

test("pool with default dedupe collapses same-url items", async () => {
  registerSource("p", { fetcher: async () => [{ url: "https://x.test/a", title: "T" }, { url: "https://x.test/a", title: "T" }, { url: "https://x.test/b", title: "U" }] });
  const w = await pool("p", "k", { limit: 10 });
  assert.equal(w.items.length, 2);
});

test("pool without data is honestly unavailable", async () => {
  registerSource("p", { fetcher: async () => { throw new Error("e"); } });
  const w = await pool("p", "k");
  assert.equal(w.status, "unavailable");
  assert.deepEqual(w.items, []);
});

test("warmTick: one fetch per source per call, respects gate and everyTicks", async () => {
  const calls = [];
  registerSource("w", { ttlMs: 1000, fetcher: async (k) => { calls.push(k); return k; }, warm: { keys: ["a", "b"], everyTicks: 2 } });
  assert.equal((await warmTick(1, { shouldRun: () => true })).refreshed.length, 0);
  assert.equal((await warmTick(2, { shouldRun: () => false })).ran, false);
  assert.deepEqual(calls, []);
  await warmTick(2, { shouldRun: () => true });
  assert.deepEqual(calls, ["a"]);
  await warmTick(4, { shouldRun: () => true });
  assert.deepEqual(calls, ["a", "b"]);
  await warmTick(6, { shouldRun: () => true });
  assert.deepEqual(calls, ["a", "b"]); // both fresh
  tick(1500);
  await warmTick(8, { shouldRun: () => true });
  assert.deepEqual(calls, ["a", "b", "a"]);
});

test("persistence round-trip, corrupt file tolerated, generic source not persisted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedcache-"));
  try {
    configureFeedCache({ dir });
    registerSource("p", { ttlMs: 1000, staleMaxMs: 600_000, persist: true, fetcher: async () => [{ url: "u1" }] });
    registerSource("np", { fetcher: async () => "secret-ish" });
    await get("p", "k");
    await get("np", "k");
    assert.equal(await flushPersist(), true);
    const file = path.join(dir, "feed-cache.json");
    const txt = fs.readFileSync(file, "utf8");
    assert.ok(txt.includes("u1"));
    assert.ok(!txt.includes("secret-ish"));
    assert.deepEqual(fs.readdirSync(dir), ["feed-cache.json"]); // tmp renamed away

    _resetFeedCacheForTests();
    configureFeedCache({ now: () => clock, dir, log: () => {} });
    let calls = 0;
    registerSource("p", { ttlMs: 1000, staleMaxMs: 600_000, persist: true, fetcher: async () => { calls++; return [{ url: "u2" }]; } });
    const r = await get("p", "k", { allowStale: true });
    assert.equal(r.status, "fresh"); // same fake clock, loaded entry is within ttl
    assert.equal(calls, 0);
    assert.deepEqual(r.data, [{ url: "u1" }]);

    fs.writeFileSync(file, "{ not json");
    _resetFeedCacheForTests();
    configureFeedCache({ now: () => clock, dir, log: () => {} });
    registerSource("p", { persist: true, fetcher: async () => ["fresh"] });
    assert.equal(loadPersisted(), false);
    assert.deepEqual((await get("p", "k")).data, ["fresh"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("non-persist and generic external-fetch sources never write the persist file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedcache-"));
  try {
    configureFeedCache({ dir });
    registerSource("np", { fetcher: async () => ({ x: 1 }) });
    await get("np", "k");
    clearExternalFetchCache();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ y: 2 }) });
    await cachedFetchJson("https://93.184.216.34/np.json", { opts: { fetchImpl } });
    assert.equal(await flushPersist(), false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistence is disabled under NODE_ENV=test unless a dir is configured", async () => {
  registerSource("p", { persist: true, fetcher: async () => 1 });
  await get("p", "k");
  assert.equal(await flushPersist(), false);
});

test("re-registering replaces config but keeps entries", async () => {
  registerSource("s", { ttlMs: 1000, fetcher: async () => 1 });
  await get("s", "k");
  registerSource("s", { ttlMs: 5000, fetcher: async () => 2 });
  assert.equal((await get("s", "k")).data, 1);
  tick(3000);
  assert.equal((await get("s", "k")).status, "fresh");
});

test("maxKeys caps the entry map", async () => {
  registerSource("s", { maxKeys: 3, fetcher: async (k) => k });
  for (const k of ["a", "b", "c", "d"]) await get("s", k);
  assert.equal(stats().s.keys, 3);
});

test("stats reports counters, budget and breaker", async () => {
  registerSource("s", { ttlMs: 1000, budget: { perMin: 5 }, fetcher: async () => 1 });
  await get("s", "k"); await get("s", "k");
  const s = stats().s;
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.budget.perMin, 4);
  assert.equal(s.breaker, "closed");
  assert.equal(s.keys, 1);
});

// ── cachedFetchJson delegation keeps the legacy contract ────────────────────

const okFetch = (counter, body = { a: 1 }) => async () => {
  counter.n++;
  return { ok: true, status: 200, json: async () => body };
};

test("cachedFetchJson: caches by URL, coalesces concurrent calls, throws on failure, no stale on error", async () => {
  configureFeedCache({ now: () => Date.now() });
  clearExternalFetchCache();
  const c = { n: 0 };
  const fetchImpl = async () => { c.n++; await flush(); return { ok: true, status: 200, json: async () => ({ a: 1 }) }; };
  const url = "https://93.184.216.34/x.json";
  const rs = await Promise.all([1, 2, 3].map(() => cachedFetchJson(url, { opts: { fetchImpl } })));
  assert.equal(c.n, 1);
  assert.deepEqual(rs, [{ a: 1 }, { a: 1 }, { a: 1 }]);
  await cachedFetchJson(url, { opts: { fetchImpl } });
  assert.equal(c.n, 1);
  clearExternalFetchCache();
  await cachedFetchJson(url, { opts: { fetchImpl } });
  assert.equal(c.n, 2);

  const bad = "https://93.184.216.34/bad.json";
  const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => cachedFetchJson(bad, { opts: { fetchImpl: failing } }), /HTTP 503/);
  // failure not cached and no breaker: next call goes upstream again and succeeds
  const c2 = { n: 0 };
  assert.deepEqual(await cachedFetchJson(bad, { opts: { fetchImpl: okFetch(c2, { ok: 1 }) } }), { ok: 1 });
  assert.equal(c2.n, 1);
});

test("cachedFetchJson: ttlMs honored per call", async () => {
  clearExternalFetchCache();
  const c = { n: 0 };
  const url = "https://93.184.216.34/ttl.json";
  await cachedFetchJson(url, { ttlMs: 1000, opts: { fetchImpl: okFetch(c) } });
  tick(500);
  await cachedFetchJson(url, { ttlMs: 1000, opts: { fetchImpl: okFetch(c) } });
  assert.equal(c.n, 1);
  tick(600);
  await cachedFetchJson(url, { ttlMs: 1000, opts: { fetchImpl: okFetch(c) } });
  assert.equal(c.n, 2);
});

test("getOrThrow throws the original upstream error", async () => {
  registerSource("s", { fetcher: async () => { throw new TypeError("kaboom"); } });
  await assert.rejects(() => getOrThrow("s", "k"), (e) => e instanceof TypeError && e.message === "kaboom");
});
