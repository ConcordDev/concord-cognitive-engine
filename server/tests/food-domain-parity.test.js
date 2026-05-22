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

// ─── Parity backlog — barcode, recipe photos/ratings, calorie goals,
// pantry-aware auto meal-plans, aisle-grouped shopping, restaurant map ──

describe("food.barcode-lookup", () => {
  it("rejects barcodes shorter than 6 digits", async () => {
    const r = await call("barcode-lookup", ctxA, { barcode: "123" });
    assert.equal(r.ok, false);
  });

  it("parses a real Open Food Facts product response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            code: "3017620422003",
            product_name: "Nutella",
            brands: "Ferrero",
            serving_size: "15g",
            nutriscore_grade: "e",
            nutriments: {
              "energy-kcal_serving": 80, "proteins_serving": 0.9,
              "carbohydrates_serving": 8.6, "fat_serving": 4.6,
              "sugars_serving": 8.3, "sodium_serving": 0.0159,
            },
          },
        }),
      };
    };
    const r = await call("barcode-lookup", ctxA, { barcode: "3017620422003" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.equal(r.result.name, "Nutella");
    assert.equal(r.result.nutrition.calories, 80);
    assert.equal(r.result.nutrition.sodium_mg, 16);
    assert.match(capturedUrl, /api\/v2\/product\/3017620422003/);
  });

  it("returns found:false on status 0", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 0 }) });
    const r = await call("barcode-lookup", ctxA, { barcode: "000000000000" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, false);
  });
});

describe("food.recipe-add / recipe-list", () => {
  it("adds a recipe and lists it scoped per user", () => {
    const r = call("recipe-add", ctxA, {
      title: "Veggie chili", slot: "Dinner", calories: 420,
      ingredients: [{ item: "beans", qty: 2, unit: "can", aisle: "Canned" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recipe.slot, "Dinner");
    const list = call("recipe-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.recipes[0].avgRating, 0);
    assert.equal(call("recipe-list", ctxB, {}).result.count, 0);
  });

  it("rejects empty title", () => {
    assert.equal(call("recipe-add", ctxA, { title: "" }).ok, false);
  });
});

describe("food.recipe-photo-*", () => {
  it("add / list / delete recipe photos with step ordering", () => {
    const rid = call("recipe-add", ctxA, { title: "Pasta" }).result.recipe.id;
    const p1 = call("recipe-photo-add", ctxA, { recipeId: rid, dataUrl: "data:image/png;base64,AAA", stepNumber: 2 });
    assert.equal(p1.ok, true);
    call("recipe-photo-add", ctxA, { recipeId: rid, dataUrl: "data:image/png;base64,BBB", stepNumber: 1 });
    const list = call("recipe-photo-list", ctxA, { recipeId: rid });
    assert.equal(list.result.count, 2);
    assert.equal(list.result.photos[0].stepNumber, 1); // sorted by step
    const del = call("recipe-photo-delete", ctxA, { id: p1.result.photo.id });
    assert.equal(del.ok, true);
    assert.equal(call("recipe-photo-list", ctxA, { recipeId: rid }).result.count, 1);
  });

  it("rejects photo with no recipeId or dataUrl", () => {
    assert.equal(call("recipe-photo-add", ctxA, { dataUrl: "data:x" }).ok, false);
    assert.equal(call("recipe-photo-add", ctxA, { recipeId: "r1" }).ok, false);
  });
});

describe("food.recipe-rate + cook history", () => {
  it("rating is 1-5, one per user, upserts", () => {
    const rid = call("recipe-add", ctxA, { title: "Curry" }).result.recipe.id;
    assert.equal(call("recipe-rate", ctxA, { recipeId: rid, rating: 9 }).ok, false);
    const r1 = call("recipe-rate", ctxA, { recipeId: rid, rating: 4 });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.updated, false);
    const r2 = call("recipe-rate", ctxA, { recipeId: rid, rating: 5 });
    assert.equal(r2.result.updated, true);
    assert.equal(call("recipe-list", ctxA, {}).result.recipes[0].avgRating, 5);
  });

  it("recipe-cooked records cook-it-again history", () => {
    const rid = call("recipe-add", ctxA, { title: "Soup" }).result.recipe.id;
    call("recipe-cooked", ctxA, { recipeId: rid, servings: 2 });
    const second = call("recipe-cooked", ctxA, { recipeId: rid });
    assert.equal(second.result.cookCount, 2);
    const hist = call("recipe-cook-history", ctxA, { recipeId: rid });
    assert.equal(hist.result.count, 2);
    assert.equal(hist.result.history[0].recipeTitle, "Soup");
    assert.equal(call("recipe-list", ctxA, {}).result.recipes[0].cookCount, 2);
  });
});

describe("food.nutrition-goal + day-summary", () => {
  it("set / get goal and aggregate a day against it", () => {
    assert.equal(call("nutrition-goal-get", ctxA, {}).result.goal, null);
    const set = call("nutrition-goal-set", ctxA, { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 });
    assert.equal(set.ok, true);
    assert.equal(call("nutrition-goal-get", ctxA, {}).result.goal.calories, 2000);

    const today = new Date().toISOString().slice(0, 10);
    call("nutrition-log", ctxA, { dish: "Eggs", calories: 200, macros: { protein_g: 18, carbs_g: 2, fat_g: 14 } });
    call("nutrition-log", ctxA, { dish: "Rice", calories: 300, macros: { protein_g: 6, carbs_g: 65, fat_g: 1 } });
    const sum = call("nutrition-day-summary", ctxA, { date: today });
    assert.equal(sum.ok, true);
    assert.equal(sum.result.totals.calories, 500);
    assert.equal(sum.result.totals.protein_g, 24);
    assert.equal(sum.result.progress.calories.pct, 25);
    assert.equal(sum.result.progress.calories.remaining, 1500);
  });

  it("rejects an all-zero goal", () => {
    assert.equal(call("nutrition-goal-set", ctxA, { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }).ok, false);
  });
});

describe("food.meal-plan-auto (pantry-aware)", () => {
  it("requires recipes and slot coverage", () => {
    const empty = call("meal-plan-auto", ctxA, { days: 3, mealsPerDay: 3 });
    assert.equal(empty.ok, false);
  });

  it("builds a plan favouring pantry-stocked recipes", () => {
    call("pantry-add", ctxA, { itemName: "chicken", qty: 1, unit: "lb" });
    call("recipe-add", ctxA, { title: "Oatmeal", slot: "Breakfast", ingredients: [{ item: "oats", qty: 1, unit: "cup" }] });
    call("recipe-add", ctxA, { title: "Chicken salad", slot: "Lunch", ingredients: [{ item: "chicken", qty: 1, unit: "lb" }] });
    call("recipe-add", ctxA, { title: "Roast chicken", slot: "Dinner", ingredients: [{ item: "chicken", qty: 1, unit: "lb" }] });
    const r = call("meal-plan-auto", ctxA, { startDate: "2026-07-01", days: 3, mealsPerDay: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.meals.length, 9);
    assert.equal(r.result.pantryItemsUsed, 1);
    assert.ok(Array.isArray(r.result.ingredientsToBuy));
    // plan persisted into meal-plan-list
    assert.equal(call("meal-plan-list", ctxA, { startDate: "2026-07-01", days: 3 }).result.meals.length, 9);
  });

  it("avoidTags excludes matching recipes", () => {
    call("recipe-add", ctxA, { title: "Beef stew", slot: "Dinner", tags: ["meat"] });
    call("recipe-add", ctxA, { title: "Lentil stew", slot: "Dinner", tags: ["vegan"] });
    call("recipe-add", ctxA, { title: "Toast", slot: "Breakfast" });
    call("recipe-add", ctxA, { title: "Wrap", slot: "Lunch" });
    const r = call("meal-plan-auto", ctxA, { days: 2, mealsPerDay: 3, avoidTags: ["meat"] });
    assert.equal(r.ok, true);
    assert.ok(r.result.meals.every((m) => m.title !== "Beef stew"));
  });
});

describe("food.store-layout + shopping-list-grouped", () => {
  it("store layout set/get and aisle-ordered shopping list", () => {
    const set = call("store-layout-set", ctxA, { storeName: "Local Mart", aisleOrder: ["Produce", "Dairy", "Canned"] });
    assert.equal(set.ok, true);
    assert.equal(call("store-layout-get", ctxA, {}).result.layouts.length, 1);

    const rid = call("recipe-add", ctxA, {
      title: "Salad", slot: "Lunch",
      ingredients: [
        { item: "Lettuce", qty: 1, unit: "head", aisle: "Produce" },
        { item: "Cheese", qty: 1, unit: "block", aisle: "Dairy" },
        { item: "Beans", qty: 1, unit: "can", aisle: "Canned" },
      ],
    }).result.recipe.id;
    call("recipe-add", ctxA, { title: "Toast", slot: "Breakfast" });
    call("recipe-add", ctxA, { title: "Stew", slot: "Dinner" });
    call("meal-plan-auto", ctxA, { startDate: "2026-08-01", days: 1, mealsPerDay: 3 });
    void rid;
    const grouped = call("shopping-list-grouped", ctxA, { startDate: "2026-08-01", days: 1, storeName: "Local Mart" });
    assert.equal(grouped.ok, true);
    assert.equal(grouped.result.byAisle[0].aisle, "Produce");
    assert.equal(grouped.result.totalItems, 3);
  });

  it("rejects empty aisleOrder", () => {
    assert.equal(call("store-layout-set", ctxA, { storeName: "X", aisleOrder: [] }).ok, false);
  });
});

describe("food.biz-map", () => {
  it("returns geo markers with directions URLs, filters, distance sort", () => {
    const a = call("biz-create", ctxA, { name: "Far Diner", cuisine: "diner", lat: 40.0, lng: -74.0 }).result.business.id;
    const b = call("biz-create", ctxA, { name: "Near Cafe", cuisine: "cafe", lat: 40.71, lng: -74.0 }).result.business.id;
    call("biz-create", ctxA, { name: "No Geo", cuisine: "thai" }); // no lat/lng
    const r = call("biz-map", ctxA, { originLat: 40.72, originLng: -74.0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.withoutGeo, 1);
    assert.equal(r.result.markers[0].id, b); // nearest first
    assert.ok(r.result.markers[0].distanceKm < r.result.markers[1].distanceKm);
    assert.match(r.result.markers[0].directionsUrl, /openstreetmap\.org\/directions/);
    void a;
    const filtered = call("biz-map", ctxA, { cuisine: "cafe" });
    assert.equal(filtered.result.count, 1);
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
