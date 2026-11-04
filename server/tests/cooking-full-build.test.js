// server/tests/cooking-full-build.test.js
//
// GB-1088 full-lens build pins for cooking:
//  - S-CK2-3: ai-meal-plan PREVIEW persists nothing; APPLY persists
//    exactly the reviewed assignment list; a foreign recipeId refuses
//    the whole apply; preview:false keeps the legacy one-call apply.
//  - S-CK2-4: the Energy unit fix. FDC returns "Energy" twice (kcal and
//    kJ). Live-verified 2026-11-04: potato flour SR Legacy 168446 →
//    357 KCAL and 1490.0 kJ; the lens showed 1490. All three Energy
//    readers (free-api-live search rows, usda-nutrition headline,
//    recipe-nutrition-compute) must read the kcal entry only.
//  - S-CK2-4 companion: usda-search returns generic reference foods
//    ahead of Branded rows within the page.
//
// Run under --experimental-test-module-mocks (the food-feed-sources
// module is mocked; free-api-live fetches through global fetch, which
// is stubbed in-process).

import { describe, it, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mock the FDC feed sources before importing the domain ──────────
const POTATO_FLOUR_NUTRIENTS = [
  { nutrientName: "Energy", value: 1490, unitName: "kJ" },   // kJ FIRST here…
  { nutrientName: "Energy", value: 357, unitName: "KCAL" },  // …kcal second
  { nutrientName: "Protein", value: 6, unitName: "g" },
  { nutrientName: "Total lipid (fat)", value: 0.6, unitName: "g" },
  { nutrientName: "Carbohydrate, by difference", value: 79, unitName: "g" },
  { nutrientName: "Fiber, total dietary", value: 5.9, unitName: "g" },
  { nutrientName: "Sugars, total including NLEA", value: 3.5, unitName: "g" },
  { nutrientName: "Sodium, Na", value: 55, unitName: "mg" },
];
let searchFoods = [];
mock.module("../lib/food-feed-sources.js", {
  cache: false,
  exports: {
    getMealDbLetter: async () => ({ ok: false, reason: "mocked" }),
    getUsdaSearch: async () => ({ ok: true, data: { foods: searchFoods, totalHits: searchFoods.length, currentPage: 1, totalPages: 1 }, fetchedAt: 0 }),
    getUsdaFood: async (fdcId) => ({
      ok: true,
      data: {
        fdcId, description: "Potato flour", dataType: "SR Legacy",
        foodNutrients: POTATO_FLOUR_NUTRIENTS.map((n) => ({
          nutrient: { name: n.nutrientName, unitName: n.unitName },
          amount: n.value,
        })),
      },
    }),
  },
});

const { default: registerCookingActions } = await import("../domains/cooking.js");
const { default: registerFreeApiLiveMacros } = await import("../domains/free-api-live.js");

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}, userId = "cook-1") {
  const fn = ACTIONS.get(`cooking.${name}`);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  return fn({ actor: { userId }, macro: { run: async () => ({ ok: false }) } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCookingActions(register); registerFreeApiLiveMacros(register); });
beforeEach(() => { globalThis._concordSTATE = {}; searchFoods = []; });

function seedTwoRecipes() {
  const a = call("recipes-create", { title: "Pancakes", servings: 4, ingredients: [{ name: "flour", qty: 2, unit: "cups" }] }).result.recipe;
  const b = call("recipes-create", { title: "Soup", servings: 2, ingredients: [{ name: "potato", qty: 3, unit: "" }] }).result.recipe;
  return [a, b];
}

describe("S-CK2-3 — ai-meal-plan review step", () => {
  it("preview proposes a week and persists NOTHING", async () => {
    seedTwoRecipes();
    const r = await call("ai-meal-plan", { days: 7, slots: ["dinner"], start: "2026-11-09" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.preview, true);
    assert.equal(r.result.applied, false);
    assert.equal(r.result.assigned.length, 7);
    const plan = call("meal-plan-get", { start: "2026-11-09", end: "2026-11-16" });
    assert.equal(plan.result.entries.length, 0, "preview must not write the plan");
  });

  it("apply persists exactly the reviewed list; manual entries survive", async () => {
    const [a, b] = seedTwoRecipes();
    // a manual entry in a slot the preview does not touch
    call("meal-plan-set", { date: "2026-11-09", slot: "breakfast", recipeId: a.id });
    const preview = await call("ai-meal-plan", { days: 7, slots: ["dinner"], start: "2026-11-09" });
    const applied = await call("ai-meal-plan", { assignments: preview.result.assigned });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.result.applied, true);
    const plan = call("meal-plan-get", { start: "2026-11-09", end: "2026-11-16" });
    const dinners = plan.result.entries.filter((e) => e.slot === "dinner");
    assert.equal(dinners.length, 7);
    for (const aEntry of preview.result.assigned) {
      const got = dinners.find((e) => e.date === aEntry.date);
      assert.equal(got.recipeId, aEntry.recipeId, `date ${aEntry.date} holds the reviewed recipe`);
    }
    const breakfast = plan.result.entries.find((e) => e.slot === "breakfast");
    assert.equal(breakfast.recipeId, a.id, "the manual entry was not overwritten");
    void b;
  });

  it("apply refuses a foreign recipeId whole — nothing persists", async () => {
    seedTwoRecipes();
    const r = await call("ai-meal-plan", { assignments: [{ date: "2026-11-09", slot: "dinner", recipeId: "rec_not_mine" }] });
    assert.equal(r.ok, false);
    const plan = call("meal-plan-get", { start: "2026-11-09", end: "2026-11-16" });
    assert.equal(plan.result.entries.length, 0);
  });

  it("preview:false keeps the legacy one-call apply for non-UI callers", async () => {
    seedTwoRecipes();
    const r = await call("ai-meal-plan", { days: 3, slots: ["dinner"], start: "2026-11-09", preview: false });
    assert.equal(r.result.applied, true);
    const plan = call("meal-plan-get", { start: "2026-11-09", end: "2026-11-16" });
    assert.equal(plan.result.entries.length, 3);
  });
});

describe("S-CK2-4 — Energy is read in kcal, never kJ", () => {
  it("usda-nutrition headline takes the KCAL entry (kJ listed first)", async () => {
    const r = await call("usda-nutrition", { fdcId: 168446 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.headline.caloriesKcal, 357);
  });

  it("recipe-nutrition-compute totals use kcal", async () => {
    searchFoods = [{ fdcId: 168446, description: "Potato flour", dataType: "SR Legacy", foodNutrients: POTATO_FLOUR_NUTRIENTS }];
    const rec = call("recipes-create", { title: "Mash", servings: 1, ingredients: [{ name: "potato flour", qty: 100, unit: "g" }] }).result.recipe;
    const r = await call("recipe-nutrition-compute", { id: rec.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.total.caloriesKcal, 357, "100 g at 357 kcal/100g — not 1490");
  });

  it("live_food_search rows treat a unitless Energy as kcal (legacy payload shape)", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ totalHits: 1, foods: [{ fdcId: 1, description: "Apple, raw", dataType: "SR Legacy", foodNutrients: [{ nutrientName: "Energy", value: 52 }] }] }),
    });
    try {
      const fn = ACTIONS.get("cooking.live_food_search");
      const r = await fn({}, { query: "apple", limit: 3 });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.foods[0].kcalPer100g, 52);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("live_food_search rows take the KCAL entry (kJ listed last — the walked order)", async () => {
    const walkedOrder = [
      { nutrientName: "Energy", value: 357, unitName: "KCAL" },
      { nutrientName: "Energy", value: 1490, unitName: "kJ" },
      { nutrientName: "Protein", value: 6, unitName: "g" },
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ totalHits: 1, foods: [{ fdcId: 168446, description: "Potato flour", dataType: "SR Legacy", foodNutrients: walkedOrder }] }),
    });
    try {
      const fn = ACTIONS.get("cooking.live_food_search");
      const r = await fn({}, { query: "potato flour", limit: 5 });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.foods[0].kcalPer100g, 357);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("S-CK2-4 companion — generic reference foods lead usda-search", () => {
  it("an SR Legacy staple outranks a Branded row in the returned page", async () => {
    searchFoods = [
      { fdcId: 1, description: "BRAND X FLOUR MIX", dataType: "Branded" },
      { fdcId: 169761, description: "Wheat flour, white, all-purpose, enriched, bleached", dataType: "SR Legacy" },
      { fdcId: 2, description: "BRAND Y PANCAKE MIX", dataType: "Branded" },
    ];
    const r = await call("usda-search", { query: "flour" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.foods[0].fdcId, 169761);
    assert.equal(r.result.foods[0].dataType, "SR Legacy");
    assert.equal(r.result.count, 3, "no rows dropped by the ordering");
  });
});
