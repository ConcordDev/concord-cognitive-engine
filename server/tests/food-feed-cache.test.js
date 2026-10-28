import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { res, setupFoodFeedTest, teardownFoodFeedTest, loadActions } from "./lib/food-feed-test-kit.js";
import { getOffCategory, OFF_CATEGORIES } from "../lib/food-feed-sources.js";

const HOUR = 3_600_000;
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const product = (n) => ({ code: String(1000 + n), product_name: `Snack ${n}`, brands: "B", nutriscore_grade: "b", categories: "snacks", extra: "dropped" });
const body = (n) => ({ products: Array.from({ length: n }, (_, i) => product(i)) });

let kit;
let created;
const macroCtx = () => ({
  ...ctx,
  macro: { run: async (_d, _n, input) => { created.push(input); return { ok: true, dtu: { id: `dtu_${created.length}` } }; } },
});

beforeEach(() => {
  created = [];
  globalThis._concordSTATE = {};
  kit = setupFoodFeedTest(() => res(body(24)));
});
afterEach(() => { teardownFoodFeedTest(); delete globalThis._concordSTATE; });

const currentCat = () => OFF_CATEGORIES[new Date().getHours() % OFF_CATEGORIES.length];

test("food.feed: one upstream call per category; page_size is fixed at 24 and limit only slices", async () => {
  const actions = await loadActions("../domains/food.js");
  const feed = actions.get("food.feed");
  const r1 = await feed(macroCtx(), null, { limit: 5 });
  assert.equal(r1.ok, true);
  assert.equal(kit.calls.length, 1);
  assert.match(kit.calls[0].url, new RegExp(`/category/${currentCat()}\\.json\\?page_size=24&`));
  assert.ok(!/page_size=5/.test(kit.calls[0].url));
  assert.equal(r1.result.ingested, 5);

  // A second call (new limit) is served from the cache: no new upstream call.
  const r2 = await feed(macroCtx(), null, { limit: 12 });
  assert.equal(kit.calls.length, 1);
  assert.equal(r2.ok, true);
  assert.equal(r2.result.ingested, 7); // 12 requested, first 5 already in feedSeen
  assert.equal(r2.result.skipped, 5);
  assert.deepEqual(kit.bareFetch, []);
});

test("food.feed: DTU source / visibility fields are unchanged", async () => {
  const actions = await loadActions("../domains/food.js");
  await actions.get("food.feed")(macroCtx(), null, { limit: 2 });
  assert.equal(created.length, 2);
  for (const c of created) {
    assert.equal(c.source, "openfoodfacts-feed");
    assert.equal(c.visibility, "public");
    assert.equal(c.visibilityScope, "global");
    assert.deepEqual(c.tags, ["food", "feed", "product", "openfoodfacts"]);
  }
});

test("OFF requests carry the descriptive User-Agent", async () => {
  await getOffCategory("snacks");
  assert.equal(kit.calls.length, 1);
  assert.equal(
    kit.calls[0].init.headers["User-Agent"],
    process.env.CONCORD_OFF_USER_AGENT || "ConcordOS/1.0 (contact@concord-os.org)",
  );
});

test("honest unavailable: upstream down and nothing cached => no data, no fabrication", async () => {
  kit = setupFoodFeedTest(() => res({}, { status: 503 }));
  const actions = await loadActions("../domains/food.js");
  const r = await actions.get("food.feed")(macroCtx(), null, { limit: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /upstream_error/);
  assert.equal(r.lastOkAt, null);
  assert.equal(created.length, 0);
});

test("stale: past TTL with upstream failing serves cached data flagged stale with fetchedAt", async () => {
  let down = false;
  kit = setupFoodFeedTest(() => (down ? res({}, { status: 500 }) : res(body(3))));
  const fresh = await getOffCategory("snacks");
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);
  const at = fresh.fetchedAt;
  down = true;
  kit.tick(25 * HOUR);
  const stale = await getOffCategory("snacks");
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, at);
  assert.equal(stale.data.products.length, 3);
});

test("beyond the 7-day stale window the answer is unavailable with lastOkAt", async () => {
  let down = false;
  kit = setupFoodFeedTest(() => (down ? res({}, { status: 500 }) : res(body(3))));
  const fresh = await getOffCategory("pastas");
  down = true;
  kit.tick(8 * 24 * HOUR);
  const r = await getOffCategory("pastas");
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.equal(r.lastOkAt, fresh.fetchedAt);
});

test("a failing global fetch proves no bare fetch remains in food.js", async () => {
  const actions = await loadActions("../domains/food.js");
  await actions.get("food.feed")(macroCtx(), null, { limit: 1 });
  assert.deepEqual(kit.bareFetch, []);
});
