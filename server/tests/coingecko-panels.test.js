// Feed-cache phase 8d: crypto.coingecko-markets / crypto.coingecko-global —
// the server reads behind the four browser CoinGecko panels (CoinGeckoTicker,
// MarketsPulse, StakingMarkets, WalletMarkets). Paths are built server-side
// from validated scalars; the shared market cache (lib/market-feed-sources.js)
// does the fetching. No network: public-fetch's test transport is stubbed.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerCrypto from "../domains/crypto.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";
import { _resetMarketFeedForTests, COINGECKO_ATTRIBUTION } from "../lib/market-feed-sources.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
const call = (name, params) => ACTIONS.get(`crypto.${name}`)({}, { id: null, data: {}, meta: {} }, params);

const realFetch = globalThis.fetch;
const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });

let calls;
let route;
before(() => { registerCrypto(register); });
beforeEach(() => {
  calls = [];
  route = () => res([]);
  delete process.env.COINGECKO_DEMO_API_KEY;
  _resetMarketFeedForTests();
  __setPublicFetchTestTransport(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return route(String(url));
  });
  globalThis.fetch = () => { throw new Error("network disabled in tests"); };
});
afterEach(() => {
  __setPublicFetchTestTransport(null);
  globalThis.fetch = realFetch;
  _resetMarketFeedForTests();
});

test("invalid params are a 400 with no upstream call", async () => {
  for (const params of [{ vs: "jpy" }, { vs: "usd", category: "defi" }, { category: "../x" }, { vs: "USD;DROP" }]) {
    const r = await call("coingecko-markets", params);
    assert.equal(r.ok, false, JSON.stringify(params));
    assert.equal(r.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("markets: server-built path, raw coins, attribution carried", async () => {
  route = () => res([{ id: "bitcoin", symbol: "btc", current_price: 1 }]);
  const r = await call("coingecko-markets", { vs: "eur", perPage: 15 });
  assert.equal(r.ok, true);
  assert.equal(r.result.coins.length, 1);
  assert.equal(r.result.attribution, COINGECKO_ATTRIBUTION);
  const u = new URL(calls[0].url);
  assert.equal(u.host, "api.coingecko.com");
  assert.equal(u.pathname, "/api/v3/coins/markets");
  assert.equal(u.searchParams.get("vs_currency"), "eur");
  assert.equal(u.searchParams.get("per_page"), "15");
  assert.equal(u.searchParams.get("price_change_percentage"), null);
});

test("markets: staking category + 24h/7d changes when the panel asks", async () => {
  route = () => res([]);
  await call("coingecko-markets", { category: "proof-of-stake", changes: true });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("category"), "proof-of-stake");
  assert.equal(u.searchParams.get("price_change_percentage"), "24h,7d");
});

test("global: returns the raw global payload", async () => {
  route = () => res({ data: { active_cryptocurrencies: 100 } });
  const r = await call("coingecko-global", {});
  assert.equal(r.ok, true);
  assert.equal(r.result.global.data.active_cryptocurrencies, 100);
  assert.ok(new URL(calls[0].url).pathname.endsWith("/global"));
});

test("the same markets request twice makes one upstream call", async () => {
  route = () => res([]);
  await call("coingecko-markets", { vs: "usd", perPage: 20 });
  await call("coingecko-markets", { vs: "usd", perPage: 20 });
  assert.equal(calls.length, 1);
});

test("upstream failure is an honest unavailable", async () => {
  route = () => res({}, 503);
  const r = await call("coingecko-markets", {});
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
});
