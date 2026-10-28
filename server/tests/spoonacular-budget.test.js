import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { res, setupFoodFeedTest, teardownFoodFeedTest, loadActions } from "./lib/food-feed-test-kit.js";
import { getSpoonacularMealPlan, getSpoonacularQuota } from "../lib/food-feed-sources.js";

const SECRET = "spoon-secret-key-123";
const plan = { week: { monday: { meals: [{ id: 1, title: "Oats" }, { id: 2, title: "Soup" }, { id: 3, title: "Pasta" }], nutrients: { calories: 2000, protein: 90, carbohydrates: 250, fat: 70 } } } };
const quotaHeaders = { "X-API-Quota-Request": "1", "X-API-Quota-Used": "3.5" };

let kit;
let prevKey;
beforeEach(() => {
  prevKey = process.env.SPOONACULAR_API_KEY;
  process.env.SPOONACULAR_API_KEY = SECRET;
  kit = setupFoodFeedTest(() => res(plan, { headers: quotaHeaders }));
});
afterEach(() => {
  teardownFoodFeedTest();
  if (prevKey === undefined) delete process.env.SPOONACULAR_API_KEY; else process.env.SPOONACULAR_API_KEY = prevKey;
});

test("API key travels in the x-api-key header, never in the URL", async () => {
  const r = await getSpoonacularMealPlan({ targetCalories: 2000 });
  assert.equal(r.ok, true);
  assert.equal(kit.calls.length, 1);
  assert.ok(!kit.calls[0].url.includes(SECRET));
  assert.ok(!/apiKey=|api_key=/i.test(kit.calls[0].url));
  assert.equal(kit.calls[0].init.headers["x-api-key"], SECRET);
});

test("the same plan params are served from cache: one upstream call", async () => {
  await getSpoonacularMealPlan({ targetCalories: 2000, diet: "Vegan" });
  const b = await getSpoonacularMealPlan({ targetCalories: 2000, diet: " vegan " });
  assert.equal(kit.calls.length, 1);
  assert.equal(b.ok, true);
});

test("quota headers from the real response are exposed", async () => {
  await getSpoonacularMealPlan({ targetCalories: 1800 });
  const q = getSpoonacularQuota();
  assert.equal(q.request, 1);
  assert.equal(q.used, 3.5);
});

test("the 21st distinct plan in a day makes no upstream call", async () => {
  for (let i = 0; i < 20; i++) {
    const r = await getSpoonacularMealPlan({ targetCalories: 1500 + i });
    assert.equal(r.ok, true, `plan ${i + 1}`);
    kit.tick(61_000); // clear the 1/min bucket without refilling the daily one
  }
  assert.equal(kit.calls.length, 20);
  const r21 = await getSpoonacularMealPlan({ targetCalories: 4000 });
  assert.equal(r21.ok, false);
  assert.equal(r21.status, "unavailable");
  assert.equal(r21.reason, "budget_exhausted");
  assert.equal(kit.calls.length, 20);
});

test("a 402 becomes unavailable/quota_exhausted and blocks further upstream calls today", async () => {
  kit = setupFoodFeedTest(() => res({ message: "points limit" }, { status: 402 }));
  const r = await getSpoonacularMealPlan({ targetCalories: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unavailable");
  assert.equal(r.reason, "quota_exhausted");
  assert.equal(kit.calls.length, 1);
  kit.tick(5 * 60_000);
  const again = await getSpoonacularMealPlan({ targetCalories: 2100 });
  assert.equal(again.reason, "quota_exhausted");
  assert.equal(kit.calls.length, 1);
});

test("food.meal-plan-generate surfaces quota_exhausted honestly and invents no plan", async () => {
  kit = setupFoodFeedTest(() => res({}, { status: 402 }));
  globalThis._concordSTATE = {};
  try {
    const actions = await loadActions("../domains/food.js");
    const r = await actions.get("food.meal-plan-generate")({ actor: { userId: "u1" }, userId: "u1" }, null, { days: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.status, "unavailable");
    assert.equal(r.reason, "quota_exhausted");
    assert.equal(globalThis._concordSTATE.foodLens.mealPlans.get("u1"), undefined);
    assert.deepEqual(kit.bareFetch, []);
  } finally {
    delete globalThis._concordSTATE;
  }
});

test("food.meal-plan-generate builds the plan from the cached Spoonacular week", async () => {
  globalThis._concordSTATE = {};
  try {
    const actions = await loadActions("../domains/food.js");
    const run = actions.get("food.meal-plan-generate");
    const c = { actor: { userId: "u1" }, userId: "u1" };
    const r = await run(c, null, { days: 1, startDate: "2026-10-28" });
    assert.equal(r.ok, true);
    await run(c, null, { days: 1, startDate: "2026-10-29" });
    assert.equal(kit.calls.length, 1); // second request reuses the cached week
    assert.ok(kit.calls[0].url.includes("mealplanner/generate"));
  } finally {
    delete globalThis._concordSTATE;
  }
});
