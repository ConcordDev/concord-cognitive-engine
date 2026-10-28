// One CoinGecko cache: the 60 s poller, the crypto lens and feed-manager share ONE upstream request per
// (path + sorted query) per TTL (lib/market-feed-sources.js on feed-cache). No network: fetchPublicUrl's
// module test transport is replaced, and the global fetch throws so a surviving bare fetch() fails loudly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { configureFeedCache, stats } from "../lib/feed-cache.js";
import {
  getCoinGecko, coingeckoJson, coingeckoKey, getMarketUpstream, COINGECKO_TOP10_URL,
  COINGECKO_ATTRIBUTION, _resetMarketFeedForTests,
} from "../lib/market-feed-sources.js";

const realFetch = globalThis.fetch;
const SECRET = "CG-test-secret-key-123";
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });
const PRICES = { bitcoin: { usd: 100, usd_24h_change: 1.5, usd_market_cap: 2e9 }, ethereum: { usd: 10, usd_24h_change: -0.5, usd_market_cap: 1e9 } };

let calls;
let clock;
let logs;
let route;

beforeEach(() => {
  calls = [];
  logs = [];
  clock = 1_000_000_000;
  route = () => res(PRICES);
  delete process.env.COINGECKO_DEMO_API_KEY;
  _resetMarketFeedForTests();
  configureFeedCache({ now: () => clock, sleep: async () => {}, log: (...a) => logs.push(a.join(" ")), logUpstream: (l) => logs.push(l) });
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("bare fetch() is forbidden in market paths"); };
});
afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  delete process.env.COINGECKO_DEMO_API_KEY;
  _resetMarketFeedForTests();
});

test("the 60 s poller URL and a user search for the same coins make ONE upstream call", async () => {
  const poller = await getMarketUpstream(COINGECKO_TOP10_URL);
  // same request, different param order and id order, as a lens macro would build it
  const user = await getCoinGecko("/simple/price?vs_currencies=usd&include_market_cap=true&include_24hr_change=true&ids=solana,bitcoin,ripple,polkadot,cardano,dogecoin,chainlink,avalanche-2,ethereum,polygon-ecosystem-token");
  const again = await coingeckoJson("/simple/price?ids=polygon-ecosystem-token,ripple,solana,polkadot,ethereum,dogecoin,chainlink,cardano,bitcoin,avalanche-2&include_24hr_change=true&include_market_cap=true&vs_currencies=usd");
  assert.equal(calls.length, 1, "fresh cache => no further upstream call");
  assert.equal(poller.ok, true);
  assert.equal(user.ok, true);
  assert.deepEqual(again, PRICES);
  assert.equal(calls[0].url, COINGECKO_TOP10_URL, "the URL sent upstream is the canonical poller URL");
});

test("fresh read inside the TTL is a hit; after the TTL it refetches", async () => {
  await getCoinGecko("/search/trending");
  clock += 119_000;
  await getCoinGecko("/search/trending");
  assert.equal(calls.length, 1);
  clock += 5_000;
  const r = await getCoinGecko("/search/trending", { allowStale: false });
  assert.equal(calls.length, 2);
  assert.equal(r.stale, false);
});

test("keyless budget is 4/min: the 5th distinct request is served stale (if cached) or honestly unavailable", async () => {
  // A is cached early; B..E use the whole minute budget; A expires; the refetch is refused => stale A.
  await getCoinGecko("/coins/markets?vs_currency=usd&page=1");           // A at t0
  clock += 116_000;
  for (const p of [2, 3, 4, 5]) assert.equal((await getCoinGecko(`/coins/markets?vs_currency=usd&page=${p}`)).ok, true);
  assert.equal(calls.length, 5);
  const none = await getCoinGecko("/coins/markets?vs_currency=usd&page=6");
  assert.equal(none.ok, false);
  assert.equal(none.status, "unavailable");
  assert.equal(none.reason, "budget_exhausted");
  assert.equal(none.lastOkAt === null || typeof none.lastOkAt === "number", true);
  assert.equal(calls.length, 5, "no upstream call past the budget");
  clock += 5_000; // A (t0) is now older than the 120 s TTL; the bucket has refilled only ~0.3 token
  const stale = await getCoinGecko("/coins/markets?vs_currency=usd&page=1");
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(typeof stale.fetchedAt, "number");
  assert.equal(calls.length, 5);
});

test("Demo key: header only when the env is set; never in a URL, cache key, log line or stats", async () => {
  await getCoinGecko("/search?query=btc");
  assert.equal(calls[0].init.headers["x-cg-demo-api-key"], undefined, "no header without a key");
  assert.equal(stats().coingecko.budget.perMin <= 4, true);

  process.env.COINGECKO_DEMO_API_KEY = SECRET;
  await getCoinGecko("/search?query=eth");
  assert.equal(calls[1].init.headers["x-cg-demo-api-key"], SECRET);
  assert.equal(calls[1].url.includes(SECRET), false, "key is a header, not a query param");
  assert.equal(coingeckoKey("/search?query=eth").includes(SECRET), false);
  assert.equal(stats().coingecko.budget.perMin > 4, true, "Demo budget (60/min) replaces the keyless 4/min");
  assert.equal(JSON.stringify(stats()).includes(SECRET), false);
  assert.equal(logs.join("\n").includes(SECRET), false, "no log line carries the key");
  assert.equal(stats().coingecko.license, "keyed-display-ok");

  delete process.env.COINGECKO_DEMO_API_KEY;
  await getCoinGecko("/search?query=sol");
  assert.equal(calls[2].init.headers["x-cg-demo-api-key"], undefined, "key removed => header removed");
});

test("a 404 for an unknown coin is a definitive answer, not a source outage", async () => {
  route = (url) => (url.includes("/coins/nope/") ? res({ error: "not found" }, 404) : res(PRICES));
  const bad = await getCoinGecko("/coins/nope/ohlc?vs_currency=usd&days=30");
  assert.equal(bad.ok, false);
  assert.equal(bad.status, "unavailable");
  assert.equal(bad.reason, "http_404");
  assert.equal(bad.httpStatus, 404);
  await assert.rejects(() => coingeckoJson("/coins/nope/ohlc?vs_currency=usd&days=30"), /coingecko http_404/);
  const good = await getCoinGecko("/simple/price?ids=bitcoin&vs_currencies=usd");
  assert.equal(good.ok, true, "one bad coin must not open the breaker for everyone");
});

test("an upstream failure is never cached as data and never invents a price", async () => {
  route = () => res({}, 503);
  const r = await getCoinGecko("/simple/price?ids=bitcoin&vs_currencies=usd");
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /upstream_error/);
  assert.equal(r.data, undefined);
  await assert.rejects(() => coingeckoJson("/simple/price?ids=bitcoin&vs_currencies=usd"), /coingecko/);
});

test("paths that are not plain CoinGecko resources are refused before any fetch", async () => {
  for (const bad of ["", "simple/price", "/../admin", "//evil.test/x", "/a b", "https://evil.test/x"]) {
    const r = await getCoinGecko(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, "invalid_request", bad);
  }
  assert.equal(calls.length, 0);
});

test("attribution text is the required, exact CoinGecko wording", () => {
  assert.equal(COINGECKO_ATTRIBUTION, "Data provided by CoinGecko");
});

test("crypto lens macros read through the cache and label stale data", async () => {
  const actions = new Map();
  (await import("../domains/crypto.js")).default((d, n, fn) => actions.set(`${d}.${n}`, fn));
  route = (url) => (url.includes("/coins/markets")
    ? res([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", image: "i", current_price: 100, price_change_percentage_24h: 2, market_cap: 5, market_cap_rank: 1 }])
    : res(PRICES));
  const search = actions.get("crypto.search-tokens");
  const a = await search({}, null, { ids: ["bitcoin"] });
  const b = await search({}, null, { ids: ["bitcoin"] });
  assert.equal(a.ok, true);
  assert.equal(a.result.tokens[0].symbol, "BTC");
  assert.equal(a.result.attribution, COINGECKO_ATTRIBUTION);
  assert.equal(a.result.stale, undefined);
  assert.deepEqual(b.result.tokens, a.result.tokens);
  assert.equal(calls.length, 1, "second user read is a cache hit");

  clock += 130_000; // expired, upstream now down => stale, labelled
  route = () => res({}, 503);
  const c = await search({}, null, { ids: ["bitcoin"] });
  assert.equal(c.ok, true);
  assert.equal(c.result.stale, true);
  assert.equal(typeof c.result.fetchedAt, "number");

  clock += 2 * 60 * 60_000; // beyond the 1 h stale limit => honest failure, no data
  const d = await search({}, null, { ids: ["bitcoin"] });
  assert.equal(d.ok, false);
  assert.match(d.error, /coingecko unreachable/);
});
