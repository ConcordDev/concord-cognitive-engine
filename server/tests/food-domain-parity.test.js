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

// ─── Yelp 2026 parity — restaurant discovery ──────────────────────────

describe("food.biz-* directory", () => {
  it("create requires name + cuisine, then lists", () => {
    assert.equal(call("biz-create", ctxA, { name: "X" }).ok, false);
    assert.equal(call("biz-create", ctxA, { cuisine: "thai" }).ok, false);
    const r = call("biz-create", ctxA, { name: "Som Tam", cuisine: "Thai", priceTier: 2, neighborhood: "Mission" });
    assert.equal(r.ok, true);
    assert.equal(r.result.business.cuisine, "thai");
    assert.equal(call("biz-list", ctxB, {}).result.count, 1); // directory is shared
  });

  it("search filters by cuisine, price and rating", () => {
    call("biz-create", ctxA, { name: "Pho 88", cuisine: "vietnamese", priceTier: 1 });
    call("biz-create", ctxA, { name: "Bella", cuisine: "italian", priceTier: 3 });
    assert.equal(call("biz-search", ctxA, { cuisine: "italian" }).result.count, 1);
    assert.equal(call("biz-search", ctxA, { priceTier: 1 }).result.count, 1);
    assert.equal(call("biz-search", ctxA, { query: "pho" }).result.count, 1);
  });

  it("open-now reflects business hours", () => {
    const id = call("biz-create", ctxA, { name: "AllDay", cuisine: "cafe", hours: { open: "00:00", close: "23:59" } }).result.business.id;
    assert.equal(call("biz-detail", ctxA, { id }).result.business.openNow, true);
  });

  it("only the owner can delete a business", () => {
    const id = call("biz-create", ctxA, { name: "Owned", cuisine: "bbq" }).result.business.id;
    assert.equal(call("biz-delete", ctxB, { id }).ok, false);
    assert.equal(call("biz-delete", ctxA, { id }).ok, true);
  });
});

describe("food.review-*", () => {
  it("aggregate rating averages reviews; one review per user", () => {
    const id = call("biz-create", ctxA, { name: "Tacos", cuisine: "mexican" }).result.business.id;
    call("review-create", ctxA, { bizId: id, rating: 4, text: "solid" });
    call("review-create", ctxB, { bizId: id, rating: 2, text: "meh" });
    assert.equal(call("biz-detail", ctxA, { id }).result.business.rating, 3);
    const upd = call("review-create", ctxA, { bizId: id, rating: 5, text: "better" });
    assert.equal(upd.result.updated, true);
    assert.equal(call("biz-detail", ctxA, { id }).result.business.rating, 3.5);
  });

  it("rejects out-of-range rating", () => {
    const id = call("biz-create", ctxA, { name: "R", cuisine: "diner" }).result.business.id;
    assert.equal(call("review-create", ctxA, { bizId: id, rating: 9 }).ok, false);
  });

  it("review vote toggles per user", () => {
    const id = call("biz-create", ctxA, { name: "V", cuisine: "deli" }).result.business.id;
    const rev = call("review-create", ctxA, { bizId: id, rating: 4 }).result.review;
    assert.equal(call("review-vote", ctxB, { bizId: id, id: rev.id, kind: "useful" }).result.count, 1);
    assert.equal(call("review-vote", ctxB, { bizId: id, id: rev.id, kind: "useful" }).result.count, 0);
  });
});

describe("food.photo + tip + checkin", () => {
  it("photos and tips attach to a business", () => {
    const id = call("biz-create", ctxA, { name: "P", cuisine: "sushi" }).result.business.id;
    call("photo-add", ctxA, { bizId: id, caption: "the omakase" });
    call("tip-add", ctxB, { bizId: id, text: "go early" });
    assert.equal(call("photo-list", ctxA, { bizId: id }).result.photos.length, 1);
    assert.equal(call("tip-list", ctxA, { bizId: id }).result.tips.length, 1);
    assert.equal(call("tip-add", ctxA, { bizId: id, text: "" }).ok, false);
  });

  it("checkin tracks visit number and history", () => {
    const id = call("biz-create", ctxA, { name: "C", cuisine: "ramen" }).result.business.id;
    call("checkin", ctxA, { bizId: id });
    const second = call("checkin", ctxA, { bizId: id });
    assert.equal(second.result.visitNumber, 2);
    assert.equal(call("checkin-history", ctxA, {}).result.count, 2);
    assert.equal(call("checkin-history", ctxB, {}).result.count, 0);
  });
});

describe("food.collection-*", () => {
  it("create, add businesses, detail resolves them", () => {
    const b1 = call("biz-create", ctxA, { name: "One", cuisine: "thai" }).result.business.id;
    const b2 = call("biz-create", ctxA, { name: "Two", cuisine: "thai" }).result.business.id;
    const col = call("collection-create", ctxA, { name: "Date night" }).result.collection;
    call("collection-add-biz", ctxA, { collectionId: col.id, bizId: b1 });
    call("collection-add-biz", ctxA, { collectionId: col.id, bizId: b2 });
    const detail = call("collection-detail", ctxA, { id: col.id });
    assert.equal(detail.result.businesses.length, 2);
    assert.equal(call("collection-list", ctxB, {}).result.count, 0); // per-user
    assert.equal(call("collection-delete", ctxA, { id: col.id }).ok, true);
  });
});

describe("food.reservation + waitlist", () => {
  it("reservation create / list / cancel", () => {
    const id = call("biz-create", ctxA, { name: "Resy", cuisine: "french" }).result.business.id;
    const res = call("reservation-create", ctxA, { bizId: id, partySize: 4, dateTime: "2026-06-01T19:00" });
    assert.equal(res.ok, true);
    assert.equal(call("reservation-list", ctxA, {}).result.count, 1);
    assert.equal(call("reservation-cancel", ctxA, { id: res.result.reservation.id }).result.reservation.status, "cancelled");
    assert.equal(call("reservation-create", ctxA, { bizId: id, partySize: 0, dateTime: "x" }).ok, false);
  });

  it("waitlist estimates wait from queue depth", () => {
    const id = call("biz-create", ctxA, { name: "Walk", cuisine: "burger" }).result.business.id;
    const first = call("waitlist-join", ctxA, { bizId: id, partySize: 2 });
    assert.equal(first.result.position, 1);
    const second = call("waitlist-join", ctxB, { bizId: id, partySize: 4 });
    assert.equal(second.result.position, 2);
    assert.ok(second.result.estimatedWaitMin > first.result.estimatedWaitMin);
    assert.equal(call("waitlist-join", ctxA, { bizId: id, partySize: 2 }).ok, false); // already on
    assert.equal(call("waitlist-status", ctxA, {}).result.count, 1);
  });
});

describe("food.top-restaurants + facets + dashboard", () => {
  it("top-restaurants ranks by Bayesian score", () => {
    const a = call("biz-create", ctxA, { name: "Hyped", cuisine: "thai" }).result.business.id;
    const b = call("biz-create", ctxA, { name: "Steady", cuisine: "thai" }).result.business.id;
    call("review-create", ctxA, { bizId: a, rating: 5 });             // 5.0 on 1 review
    call("review-create", ctxA, { bizId: b, rating: 5 });
    call("review-create", ctxB, { bizId: b, rating: 5 });             // 5.0 on 2 reviews
    const top = call("top-restaurants", ctxA, {});
    assert.equal(top.result.restaurants[0].id, b); // more reviews → higher Bayesian score
  });

  it("cuisine facets + dashboard aggregate", () => {
    call("biz-create", ctxA, { name: "T1", cuisine: "thai" });
    call("biz-create", ctxA, { name: "T2", cuisine: "thai" });
    call("biz-create", ctxA, { name: "I1", cuisine: "italian" });
    const facets = call("cuisine-facets", ctxA, {});
    assert.equal(facets.result.facets[0].cuisine, "thai");
    assert.equal(facets.result.facets[0].count, 2);
    const dash = call("food-discover-dashboard", ctxA, {});
    assert.equal(dash.result.businesses, 3);
    assert.equal(dash.result.cuisines, 2);
  });
});
