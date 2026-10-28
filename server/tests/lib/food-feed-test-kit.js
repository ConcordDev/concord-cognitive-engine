// Shared offline kit for the phase-5 food/cooking feed-cache tests.
// No network: fetchPublicUrl's module test transport is replaced, and the
// global fetch is a stub that throws so a surviving bare fetch() fails loudly.
import { __setPublicFetchTestTransport } from "../../lib/public-fetch.js";
import { configureFeedCache, _resetFeedCacheForTests } from "../../lib/feed-cache.js";
import { _resetFoodFeedForTests } from "../../lib/food-feed-sources.js";

const realFetch = globalThis.fetch;

export function res(body, { status = 200, headers = {} } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Fresh clock + transport. `route(url, init) -> Response-like` ; returns { calls, tick, bareFetch }. */
export function setupFoodFeedTest(route) {
  _resetFeedCacheForTests();
  _resetFoodFeedForTests();
  const kit = { calls: [], bareFetch: [], clock: 1_000_000_000 };
  configureFeedCache({ now: () => kit.clock, sleep: async () => {}, log: () => {}, logUpstream: null });
  __setPublicFetchTestTransport(async (url, init) => {
    kit.calls.push({ url: String(url), init: init || {} });
    return route(String(url), init || {});
  });
  globalThis.fetch = (...a) => { kit.bareFetch.push(String(a[0])); throw new Error("bare fetch() is forbidden in food/cooking paths"); };
  kit.tick = (ms) => { kit.clock += ms; };
  return kit;
}

export function teardownFoodFeedTest() {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  _resetFeedCacheForTests();
}

/** Load a domain module (path relative to server/tests/, e.g. "../domains/food.js") and collect handlers by "domain.action". */
export async function loadActions(modulePath) {
  const mod = await import(new URL(modulePath, new URL("../", import.meta.url)).href);
  const actions = new Map();
  mod.default((domain, name, fn) => { actions.set(`${domain}.${name}`, fn); });
  return actions;
}
