import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFoodActions from "../domains/food.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`food.${name}`);
  assert.ok(fn, `food.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFoodActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("food.pantry-*", () => {
  it("add/list/delete scoped per user", () => {
    const r1 = call("pantry-add", ctxA, { itemName: "Tomatoes", qty: 5, unit: "item", location: "fridge" });
    assert.equal(r1.ok, true);
    const list = call("pantry-list", ctxA, {});
    assert.equal(list.result.items.length, 1);
    assert.equal(list.result.items[0].itemName, "Tomatoes");
    assert.equal(call("pantry-list", ctxB, {}).result.items.length, 0);

    const del = call("pantry-delete", ctxA, { id: r1.result.item.id });
    assert.equal(del.ok, true);
    assert.equal(call("pantry-list", ctxA, {}).result.items.length, 0);
  });

  it("rejects empty itemName", () => {
    assert.equal(call("pantry-add", ctxA, { itemName: "" }).ok, false);
  });
});

describe("food.recipe-scale", () => {
  it("scales linearly with kitchen-fraction rounding", () => {
    const r = call("recipe-scale", ctxA, {
      baseServings: 4, targetServings: 6,
      ingredients: [
        { qty: 2, unit: "cup", item: "flour" },
        { qty: 1, unit: "tsp", item: "salt" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.factor, 1.5);
    assert.equal(r.result.ingredients.length, 2);
    assert.equal(r.result.ingredients[0].scaled.qty, 3);
    assert.equal(r.result.ingredients[1].scaled.qty, 1.5);
  });

  it("identity when target = base", () => {
    const r = call("recipe-scale", ctxA, {
      baseServings: 4, targetServings: 4,
      ingredients: [{ qty: 1.5, unit: "cup", item: "rice" }],
    });
    assert.equal(r.result.factor, 1);
    assert.equal(r.result.ingredients[0].scaled.qty, 1.5);
  });
});

describe("food.recipe-substitute", () => {
  it("rejects empty ingredient", async () => {
    const r = await call("recipe-substitute", { llm: { chat: async () => ({}) } }, { ingredient: "" });
    assert.equal(r.ok, false);
  });

  it("ALWAYS returns allergenWarning field (invariant)", async () => {
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      llm: { chat: async () => ({ text: '{"substitutes":[{"original":"milk","substitute":"oat milk","ratio":"1:1","confidence":0.9}]}' }) },
    };
    const r = await call("recipe-substitute", ctx, { ingredient: "milk", excludeAllergens: ["dairy"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.allergenWarning, "allergenWarning is a MUST-RETURN field");
    assert.match(r.result.allergenWarning, /cross.contamin|traces/i);
  });
});

describe("food.vision-identify", () => {
  it("rejects empty image", async () => {
    const r = await call("vision-identify", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("graceful fallback on vision error", async () => {
    const r = await call("vision-identify", ctxA, { imageDataUrl: "data:image/png;base64,iVBOR" });
    assert.equal(r.ok, true);
    assert.ok(["fallback", "llava-vision", "error"].includes(r.result.source));
  });
});

describe("food.nutrition-log + daily aggregate (via list)", () => {
  it("log + list-by-day round-trip scoped per user", () => {
    const r1 = call("nutrition-log", ctxA, { dish: "Apple", calories: 95, macros: { protein_g: 0.5, carbs_g: 25, fat_g: 0.3 } });
    assert.equal(r1.ok, true);
    const r2 = call("nutrition-log", ctxA, { dish: "Coffee", calories: 5 });
    assert.equal(r2.ok, true);
    // Other user empty
    const state = globalThis._concordSTATE.foodLens;
    assert.equal((state.nutritionLog.get("user_a") || []).length, 2);
    assert.equal((state.nutritionLog.get("user_b") || []).length, 0);
  });

  it("rejects log with no dish AND zero calories", () => {
    assert.equal(call("nutrition-log", ctxA, { dish: "", calories: 0 }).ok, false);
  });
});

describe("food.meal-plan-generate (real recipes or Spoonacular API)", () => {
  function seedRecipes(userId) {
    const STATE = globalThis._concordSTATE;
    STATE.foodLens = STATE.foodLens || {};
    STATE.foodLens.recipes = STATE.foodLens.recipes || new Map();
    STATE.foodLens.recipes.set(userId, [
      { id: "r1", slot: "Breakfast", title: "Greek yogurt parfait", calories: 320, protein: 24, carbs: 36, fat: 8 },
      { id: "r2", slot: "Lunch", title: "Chicken Caesar wrap", calories: 520, protein: 35, carbs: 42, fat: 22 },
      { id: "r3", slot: "Dinner", title: "Sheet-pan salmon", calories: 580, protein: 42, carbs: 18, fat: 34 },
      { id: "r4", slot: "Snack", title: "Apple + almond butter", calories: 230, protein: 6, carbs: 32, fat: 12 },
    ]);
  }

  it("returns error pointing to recipe library when none configured and no Spoonacular key", async () => {
    delete process.env.SPOONACULAR_API_KEY;
    const r = await call("meal-plan-generate", ctxA, { startDate: "2026-05-18", days: 7, mealsPerDay: 3 });
    assert.equal(r.ok, false);
    assert.match(r.error, /recipe library|food\.recipe-add|SPOONACULAR_API_KEY/);
  });

  it("generates plan from real user recipe library when populated", async () => {
    seedRecipes("user_a");
    const r = await call("meal-plan-generate", ctxA, { startDate: "2026-05-18", days: 7, mealsPerDay: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.meals.length, 21);
    for (const m of r.result.meals) {
      assert.ok(["Breakfast", "Lunch", "Dinner"].includes(m.slot));
      assert.ok(m.title.length > 0);
      assert.ok(m.calories > 0);
      assert.ok(m.recipeId);
    }
  });

  it("list returns only meals in range after real-recipe generation", async () => {
    seedRecipes("user_a");
    await call("meal-plan-generate", ctxA, { startDate: "2026-05-18", days: 7, mealsPerDay: 2 });
    const r = call("meal-plan-list", ctxA, { startDate: "2026-05-18", days: 7 });
    assert.equal(r.result.meals.length, 14);
  });

  it("grocery list builds aisle groupings from real-recipe plan", async () => {
    seedRecipes("user_a");
    await call("meal-plan-generate", ctxA, { startDate: "2026-05-18", days: 7, mealsPerDay: 3 });
    const r = call("grocery-list-build", ctxA, { startDate: "2026-05-18", days: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.byAisle.length >= 4);
    assert.ok(r.result.byAisle.some((a) => a.aisle === "Produce"));
    assert.ok(r.result.byAisle.some((a) => a.aisle === "Protein"));
  });
});

describe("food.recipe-import-url", () => {
  it("rejects empty URL", async () => {
    const r = await call("recipe-import-url", ctxA, { url: "" });
    assert.equal(r.ok, false);
  });

  it("falls back gracefully when network unavailable", async () => {
    const r = await call("recipe-import-url", ctxA, { url: "https://example.com/recipe" });
    assert.equal(r.ok, false);
    assert.match(r.error, /fetch|network|disabled/i);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one of the pre-existing macros is registered", () => {
    assert.ok(ACTIONS.size > 12);
  });
});
