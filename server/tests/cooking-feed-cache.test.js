import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { res, setupFoodFeedTest, teardownFoodFeedTest, loadActions } from "./lib/food-feed-test-kit.js";
import { getMealDbLetter, getUsdaSearch } from "../lib/food-feed-sources.js";

const DAY = 24 * 3_600_000;
const meal = (n) => ({ idMeal: String(52000 + n), strMeal: `Meal ${n}`, strArea: "Italian", strCategory: "Pasta", strInstructions: "Cook.", strIngredient1: "Pasta", strMeasure1: "200g" });
const fdcFood = { fdcId: 111, description: "Oats", dataType: "Foundation", foodNutrients: [{ nutrientName: "Energy", value: 389, unitName: "KCAL" }] };

let kit;
let created;
const macroCtx = () => ({
  actor: { userId: "u1" }, userId: "u1",
  macro: { run: async (_d, _n, input) => { created.push(input); return { ok: true, dtu: { id: `dtu_${created.length}` } }; } },
});
const route = (url) => {
  if (url.includes("themealdb.com")) return res({ meals: [meal(1), meal(2), meal(3)] });
  if (url.includes("/foods/search")) return res({ foods: [fdcFood], totalHits: 1, currentPage: 1, totalPages: 1 });
  if (url.includes("/food/")) return res(fdcFood);
  return res({}, { status: 404 });
};

beforeEach(() => {
  created = [];
  globalThis._concordSTATE = {};
  kit = setupFoodFeedTest(route);
});
afterEach(() => { teardownFoodFeedTest(); delete globalThis._concordSTATE; });

test("cooking.feed: one TheMealDB call per letter; DTU source unchanged", async () => {
  const actions = await loadActions("../domains/cooking.js");
  const feed = actions.get("cooking.feed");
  const a = await feed(macroCtx(), null, { limit: 2 });
  const b = await feed(macroCtx(), null, { limit: 3 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(kit.calls.length, 1);
  const letter = "abcdefghijklmnoprst"[new Date().getHours() % 19];
  assert.ok(kit.calls[0].url.endsWith(`search.php?f=${letter}`));
  assert.ok(created.length >= 3);
  for (const c of created) {
    assert.equal(c.source, "themealdb-feed");
    assert.equal(c.visibility, "public");
    assert.equal(c.visibilityScope, "global");
  }
  assert.deepEqual(kit.bareFetch, []);
});

test("cooking.feed: upstream down => honest unavailable, no recipes invented", async () => {
  kit = setupFoodFeedTest(() => res({}, { status: 500 }));
  const actions = await loadActions("../domains/cooking.js");
  const r = await actions.get("cooking.feed")(macroCtx(), null, { limit: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.equal(r.lastOkAt, null);
  assert.equal(created.length, 0);
});

test("TheMealDB stale window is 30 days; stale data is flagged with fetchedAt", async () => {
  let down = false;
  kit = setupFoodFeedTest(() => (down ? res({}, { status: 500 }) : res({ meals: [meal(1)] })));
  const fresh = await getMealDbLetter("a");
  down = true;
  kit.tick(10 * DAY);
  const stale = await getMealDbLetter("a");
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, fresh.fetchedAt);
  kit.tick(25 * DAY);
  const gone = await getMealDbLetter("a");
  assert.equal(gone.ok, false);
  assert.equal(gone.status, "unavailable");
  assert.equal(gone.lastOkAt, fresh.fetchedAt);
});

test("usda-search / usda-nutrition: cached, key in a header (not the URL), no bare fetch", async () => {
  const actions = await loadActions("../domains/cooking.js");
  const search = actions.get("cooking.usda-search");
  const s1 = await search(macroCtx(), null, { query: "Oats" });
  const s2 = await search(macroCtx(), null, { query: "  oats " });
  assert.equal(s1.ok, true);
  assert.equal(s2.ok, true);
  assert.equal(s1.result.foods[0].fdcId, 111);
  assert.equal(kit.calls.length, 1);
  assert.ok(!/api_key=/i.test(kit.calls[0].url));
  assert.ok(kit.calls[0].init.headers["X-Api-Key"]);

  const nut = actions.get("cooking.usda-nutrition");
  const n1 = await nut(macroCtx(), null, { fdcId: 111 });
  await nut(macroCtx(), null, { fdcId: 111 });
  assert.equal(n1.ok, true);
  assert.equal(kit.calls.length, 2);
  assert.deepEqual(kit.bareFetch, []);
});

test("usda-nutrition: 404 keeps the 'not found' answer; outage is unavailable", async () => {
  kit = setupFoodFeedTest((u) => (u.includes("/food/999") ? res({}, { status: 404 }) : res({}, { status: 500 })));
  const actions = await loadActions("../domains/cooking.js");
  const nut = actions.get("cooking.usda-nutrition");
  const nf = await nut(macroCtx(), null, { fdcId: 999 });
  assert.equal(nf.ok, false);
  assert.match(nf.error, /FDC ID not found: 999/);
  const down = await nut(macroCtx(), null, { fdcId: 123 });
  assert.equal(down.ok, false);
  assert.equal(down.status, "unavailable");
});

test("usda-search: a '|' in the query cannot corrupt the cache key", async () => {
  await getUsdaSearch({ query: "a|b", pageSize: 5 });
  const again = await getUsdaSearch({ query: "a b", pageSize: 5 });
  assert.equal(again.ok, true);
  assert.equal(kit.calls.length, 1);
});
