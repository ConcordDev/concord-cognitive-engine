import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { res, setupFoodFeedTest, teardownFoodFeedTest, loadActions } from "./lib/food-feed-test-kit.js";
import { getOffProduct } from "../lib/food-feed-sources.js";

const ctx = { actor: { userId: "u1" }, userId: "u1" };
const offBody = { count: 321, products: [
  { code: "111", product_name: "Sourdough Loaf", brands: "Baker", nutriscore_grade: "a", nova_group: 3, ecoscore_grade: "b", image_url: "http://i/1.png", quantity: "500 g", junk: 1 },
  { code: "222", product_name: "Sourdough Rolls", brands: "Baker", nutriscore_grade: "c", quantity: "6" },
] };

let kit;
let actions;
beforeEach(async () => {
  kit = setupFoodFeedTest(() => res(offBody));
  actions = await loadActions("../domains/household.js");
});
afterEach(() => teardownFoodFeedTest());

test("off-product-search uses legacy cgi/search.pl (real full-text), never v2 /search", async () => {
  const r = await actions.get("household.off-product-search")(ctx, null, { query: "Sourdough", pageSize: 12 });
  assert.equal(r.ok, true);
  assert.equal(kit.calls.length, 1);
  const u = kit.calls[0].url;
  assert.match(u, /^https:\/\/world\.openfoodfacts\.org\/cgi\/search\.pl\?/);
  assert.match(u, /search_terms=sourdough/);
  assert.match(u, /search_simple=1/);
  assert.match(u, /action=process/);
  assert.match(u, /json=1/);
  assert.match(u, /page_size=12/);
  assert.ok(!/\/api\/v2\/search/.test(u));
});

test("off-product-search keeps the BarcodeLookup result shape and adds freshness", async () => {
  const r = await actions.get("household.off-product-search")(ctx, null, { query: "sourdough" });
  assert.equal(r.result.query, "sourdough");
  assert.equal(r.result.count, 2);
  assert.equal(r.result.totalResults, 321);
  assert.equal(r.result.page, 1);
  assert.equal(r.result.source, "open-food-facts");
  assert.deepEqual(Object.keys(r.result.products[0]).sort(),
    ["barcode", "brand", "ecoScore", "imageUrl", "name", "novaGroup", "nutriScore", "quantity"]);
  assert.equal(r.result.products[0].barcode, "111");
  assert.equal(typeof r.result.fetchedAt, "number");
  assert.equal(r.result.stale, undefined);
});

test("identical queries (case / whitespace-insensitive) make one upstream call", async () => {
  const run = actions.get("household.off-product-search");
  await run(ctx, null, { query: "Sourdough  Bread", pageSize: 20 });
  await run(ctx, null, { query: " sourdough bread", pageSize: 20 });
  assert.equal(kit.calls.length, 1);
  await run(ctx, null, { query: "sourdough bread", pageSize: 20, page: 2 });
  assert.equal(kit.calls.length, 2);
});

test("User-Agent header is sent on search and product lookups", async () => {
  await actions.get("household.off-product-search")(ctx, null, { query: "oat milk" });
  kit = setupFoodFeedTest(() => res({ status: 1, product: { product_name: "Oats" } }));
  await getOffProduct("12345678");
  const ua = process.env.CONCORD_OFF_USER_AGENT || "ConcordOS/1.0 (contact@concord-os.org)";
  assert.equal(kit.calls[0].init.headers["User-Agent"], ua);
});

test("off-product-lookup: cached per barcode, 404 is 'not found' (not unavailable)", async () => {
  kit = setupFoodFeedTest((u) => (u.includes("/00000000.json")
    ? res({}, { status: 404 })
    : res({ status: 1, product: { product_name: "Oats", brands: "Q", nutriments: { "energy-kcal_100g": 370 } } })));
  const lookup = actions.get("household.off-product-lookup");
  const a = await lookup(ctx, null, { barcode: "87654321" });
  const b = await lookup(ctx, null, { barcode: "87654321" });
  assert.equal(a.ok, true);
  assert.equal(a.result.name, "Oats");
  assert.equal(a.result.nutrition.energyKcal100g, 370);
  assert.equal(b.ok, true);
  assert.equal(kit.calls.length, 1);
  const missing = await lookup(ctx, null, { barcode: "00000000" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /product not found/);
  assert.equal(missing.status, undefined);
});

test("upstream failure => honest unavailable, nothing invented", async () => {
  kit = setupFoodFeedTest(() => res({}, { status: 503 }));
  const r = await actions.get("household.off-product-search")(ctx, null, { query: "granola" });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /upstream_error/);
  assert.equal(r.lastOkAt, null);
  assert.equal(r.result, undefined);
});

test("no bare fetch in household.js", async () => {
  await actions.get("household.off-product-search")(ctx, null, { query: "tea" });
  assert.deepEqual(kit.bareFetch, []);
});
