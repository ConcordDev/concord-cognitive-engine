// Contract tests for server/lib/external-fetch.js — the shared
// live-API helper used by lens feed macros.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchJsonWithTimeout, cachedFetchJson, clearExternalFetchCache, registerLiveFeed,
} from "../lib/external-fetch.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearExternalFetchCache(); });
beforeEach(() => { clearExternalFetchCache(); });

describe("external-fetch", () => {
  it("fetchJsonWithTimeout returns parsed JSON on 2xx", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ v: 1 }) });
    assert.deepEqual(await fetchJsonWithTimeout("https://x/a"), { v: 1 });
  });

  it("fetchJsonWithTimeout throws on non-2xx", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(() => fetchJsonWithTimeout("https://x/b"), /HTTP 503/);
  });

  it("cachedFetchJson serves the second call from cache", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ n: calls }) }; };
    const a = await cachedFetchJson("https://x/c", { ttlMs: 60000 });
    const b = await cachedFetchJson("https://x/c", { ttlMs: 60000 });
    assert.deepEqual(a, b);
    assert.equal(calls, 1, "second call should hit cache, not the network");
  });

  it("cachedFetchJson re-fetches after TTL expiry", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ n: calls }) }; };
    await cachedFetchJson("https://x/d", { ttlMs: 0 });
    await cachedFetchJson("https://x/d", { ttlMs: 0 });
    assert.equal(calls, 2);
  });

  it("registerLiveFeed wraps a fetchFn into the standard ok shape", async () => {
    const macros = new Map();
    registerLiveFeed((d, n, fn) => macros.set(`${d}.${n}`, fn), "demo", "live",
      async () => ({ source: "DemoAPI", rows: [1, 2] }));
    const res = await macros.get("demo.live")({}, {});
    assert.equal(res.ok, true);
    assert.equal(res.source, "DemoAPI");
    assert.ok(typeof res.fetchedAt === "number");
    assert.deepEqual(res.result.rows, [1, 2]);
  });

  it("registerLiveFeed degrades gracefully when the fetchFn throws", async () => {
    const macros = new Map();
    registerLiveFeed((d, n, fn) => macros.set(`${d}.${n}`, fn), "demo", "live",
      async () => { throw new Error("network down"); });
    const res = await macros.get("demo.live")({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "api_unreachable");
  });
});
