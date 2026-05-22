// Contract tests for server/domains/cooking.js — pure-compute recipe
// helpers + real USDA FoodData Central integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCookingActions from "../domains/cooking.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`cooking.${name}`);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerCookingActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.FDC_API_KEY;
  delete process.env.NASA_FDC_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("cooking.scaleRecipe", () => {
  it("doubles a 4-serving recipe to 8 servings", () => {
    const r = call("scaleRecipe", ctxA, {
      data: { servings: 4, targetServings: 8, ingredients: [{ name: "flour", quantity: "2", unit: "cups" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.scaleFactor, 2);
    assert.match(r.result.ingredients[0].scaled, /^4 cups$/);
  });
});

describe("cooking.substitution", () => {
  it("returns common butter substitutions", () => {
    const r = call("substitution", ctxA, { data: { ingredient: "unsalted butter" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.ok(r.result.substitutions.some((s) => s.sub.toLowerCase().includes("coconut")));
  });
});

describe("cooking.usda-search (USDA FoodData Central)", () => {
  it("rejects empty query", async () => {
    const r = await call("usda-search", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("rejects query shorter than 2 chars", async () => {
    const r = await call("usda-search", ctxA, { query: "a" });
    assert.equal(r.ok, false);
  });

  it("hits FDC + parses real response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          totalHits: 142, currentPage: 1, totalPages: 15,
          foods: [{
            fdcId: 173410, description: "Cheese, cheddar",
            dataType: "SR Legacy", publishedDate: "2019-04-01",
            score: 850.0,
          }, {
            fdcId: 1097518, description: "Cheese, cheddar, sharp, sliced",
            dataType: "Branded", brandOwner: "Sargento", brandName: "Sargento",
            gtinUpc: "046100000557",
            servingSize: 28, servingSizeUnit: "g",
            score: 720.5,
          }],
        }),
      };
    };
    const r = await call("usda-search", ctxA, { query: "cheddar" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.nal\.usda\.gov\/fdc\/v1\/foods\/search/);
    assert.match(capturedUrl, /api_key=DEMO_KEY/);
    assert.match(capturedUrl, /query=cheddar/);
    assert.equal(r.result.foods.length, 2);
    assert.equal(r.result.foods[0].fdcId, 173410);
    assert.equal(r.result.foods[1].brandOwner, "Sargento");
    assert.equal(r.result.totalHits, 142);
    assert.equal(r.result.source, "usda-fooddata-central");
    assert.equal(r.result.usingDemoKey, true);
  });

  it("uses FDC_API_KEY env when set", async () => {
    process.env.FDC_API_KEY = "real-fdc-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ foods: [] }) };
    };
    const r = await call("usda-search", ctxA, { query: "apple" });
    assert.match(capturedUrl, /api_key=real-fdc-key/);
    assert.equal(r.result.usingDemoKey, false);
  });

  it("supports dataType filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ foods: [] }) };
    };
    await call("usda-search", ctxA, { query: "apple", dataType: "SR Legacy" });
    assert.match(capturedUrl, /dataType=SR%20Legacy/);
  });

  it("surfaces 429 rate limit with helpful key-setup pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("usda-search", ctxA, { query: "apple" });
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit exceeded.*FDC_API_KEY/);
  });
});

describe("cooking.usda-nutrition (USDA FoodData Central)", () => {
  it("rejects missing fdcId", async () => {
    const r = await call("usda-nutrition", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("rejects non-positive fdcId", async () => {
    assert.equal((await call("usda-nutrition", ctxA, { fdcId: 0 })).ok, false);
    assert.equal((await call("usda-nutrition", ctxA, { fdcId: -1 })).ok, false);
  });

  it("hits FDC + parses headline + full nutrient list", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          fdcId: 173410, description: "Cheese, cheddar", dataType: "SR Legacy",
          foodNutrients: [
            { nutrient: { name: "Energy", unitName: "KCAL" }, amount: 403 },
            { nutrient: { name: "Protein", unitName: "G" }, amount: 22.87 },
            { nutrient: { name: "Total lipid (fat)", unitName: "G" }, amount: 33.31 },
            { nutrient: { name: "Carbohydrate, by difference", unitName: "G" }, amount: 3.09 },
            { nutrient: { name: "Calcium, Ca", unitName: "MG" }, amount: 721 },
            { nutrient: { name: "Sodium, Na", unitName: "MG" }, amount: 643 },
            { nutrient: { name: "Iron, Fe", unitName: "MG" }, amount: 0.16 },
          ],
        }),
      };
    };
    const r = await call("usda-nutrition", ctxA, { fdcId: 173410 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/fdc\/v1\/food\/173410/);
    assert.equal(r.result.description, "Cheese, cheddar");
    assert.equal(r.result.headline.caloriesKcal, 403);
    assert.equal(r.result.headline.proteinG, 22.87);
    assert.equal(r.result.headline.calciumMg, 721);
    // full nutrient dict has all 7 entries
    assert.equal(Object.keys(r.result.nutrients).length, 7);
    assert.equal(r.result.source, "usda-fooddata-central");
  });

  it("returns clear 404 when FDC ID doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("usda-nutrition", ctxA, { fdcId: 9999999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /FDC ID not found/);
  });
});

// ═════════════════════════════════════════════════════════════════
//  Paprika + Samsung Food + Plan to Eat 2026 parity — recipes,
//  collections, scaling, meal plan, grocery list, pantry, AI plan.
// ═════════════════════════════════════════════════════════════════

const ctxCk = { actor: { userId: "cook_u" }, userId: "cook_u" };

describe("cooking — 2026 parity macros", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("recipes-create + list with normalized ingredients", () => {
    const r = call("recipes-create", ctxCk, {
      title: "Pasta Pomodoro", servings: 4, prepMin: 10, cookMin: 20,
      ingredients: [{ name: "pasta", qty: 400, unit: "g" }, "salt", { name: "tomato", qty: 6 }],
      steps: ["Boil pasta", "Make sauce"],
    });
    assert.equal(r.ok, true);
    assert.match(r.result.recipe.number, /^R-\d{5}$/);
    assert.equal(r.result.recipe.ingredients.length, 3);
    assert.equal(r.result.recipe.ingredients[1].name, "salt");
    assert.equal(call("recipes-list", ctxCk).result.recipes.length, 1);
  });

  it("recipes-scale scales quantities by serving factor", () => {
    const rec = call("recipes-create", ctxCk, { title: "Cake", servings: 8, ingredients: [{ name: "flour", qty: 200, unit: "g" }] }).result.recipe;
    const r = call("recipes-scale", ctxCk, { id: rec.id, targetServings: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.factor, 0.5);
    assert.equal(r.result.ingredients[0].qty, 100);
  });

  it("recipes-delete removes from collections + meal plan", () => {
    const rec = call("recipes-create", ctxCk, { title: "X" }).result.recipe;
    const col = call("collections-create", ctxCk, { name: "Faves" }).result.collection;
    call("collections-toggle-recipe", ctxCk, { collectionId: col.id, recipeId: rec.id });
    call("meal-plan-set", ctxCk, { date: "2026-06-01", slot: "dinner", recipeId: rec.id });
    call("recipes-delete", ctxCk, { id: rec.id });
    assert.equal(call("collections-list", ctxCk).result.collections[0].recipeCount, 0);
    assert.equal(call("meal-plan-get", ctxCk, { start: "2026-06-01", end: "2026-06-01" }).result.entries.length, 0);
  });

  it("collections toggle adds + removes a recipe", () => {
    const rec = call("recipes-create", ctxCk, { title: "Soup" }).result.recipe;
    const col = call("collections-create", ctxCk, { name: "Winter" }).result.collection;
    const add = call("collections-toggle-recipe", ctxCk, { collectionId: col.id, recipeId: rec.id });
    assert.equal(add.result.inCollection, true);
    const rem = call("collections-toggle-recipe", ctxCk, { collectionId: col.id, recipeId: rec.id });
    assert.equal(rem.result.inCollection, false);
  });

  it("meal-plan-set + get within a range", () => {
    const rec = call("recipes-create", ctxCk, { title: "Tacos", servings: 4 }).result.recipe;
    call("meal-plan-set", ctxCk, { date: "2026-06-10", slot: "dinner", recipeId: rec.id });
    const got = call("meal-plan-get", ctxCk, { start: "2026-06-08", end: "2026-06-12" });
    assert.equal(got.result.entries.length, 1);
    assert.equal(got.result.entries[0].recipe.title, "Tacos");
  });

  it("meal-plan-set rejects bad slot", () => {
    const rec = call("recipes-create", ctxCk, { title: "X" }).result.recipe;
    const r = call("meal-plan-set", ctxCk, { date: "2026-06-10", slot: "brunch", recipeId: rec.id });
    assert.equal(r.ok, false);
  });

  it("shopping-list-generate consolidates ingredients + groups by aisle", () => {
    const r1 = call("recipes-create", ctxCk, { title: "A", servings: 2, ingredients: [{ name: "tomato", qty: 4, unit: "" }, { name: "chicken breast", qty: 2, unit: "" }] }).result.recipe;
    const r2 = call("recipes-create", ctxCk, { title: "B", servings: 2, ingredients: [{ name: "tomato", qty: 2, unit: "" }, { name: "milk", qty: 1, unit: "cup" }] }).result.recipe;
    call("meal-plan-set", ctxCk, { date: "2026-06-15", slot: "lunch", recipeId: r1.id, servings: 2 });
    call("meal-plan-set", ctxCk, { date: "2026-06-15", slot: "dinner", recipeId: r2.id, servings: 2 });
    const r = call("shopping-list-generate", ctxCk, { start: "2026-06-15", end: "2026-06-15" });
    assert.equal(r.ok, true);
    // tomato should consolidate to 6 (4 + 2)
    const tomato = r.result.items.find(i => i.name.toLowerCase() === "tomato");
    assert.equal(tomato.qty, 6);
    assert.equal(tomato.aisle, "produce");
    const chicken = r.result.items.find(i => i.name.toLowerCase() === "chicken breast");
    assert.equal(chicken.aisle, "meat");
  });

  it("shopping-list-generate subtracts pantry items", () => {
    const rec = call("recipes-create", ctxCk, { title: "A", servings: 2, ingredients: [{ name: "olive oil", qty: 2, unit: "tbsp" }, { name: "onion", qty: 1, unit: "" }] }).result.recipe;
    call("meal-plan-set", ctxCk, { date: "2026-06-20", slot: "dinner", recipeId: rec.id });
    call("pantry-add", ctxCk, { name: "olive oil" }); // qty null = "have it"
    const r = call("shopping-list-generate", ctxCk, { start: "2026-06-20", end: "2026-06-20", subtractPantry: true });
    assert.ok(!r.result.items.find(i => i.name.toLowerCase() === "olive oil"));
    assert.ok(r.result.items.find(i => i.name.toLowerCase() === "onion"));
  });

  it("shopping-list toggle marks an item checked", () => {
    call("shopping-list-add", ctxCk, { name: "eggs" });
    const list = call("shopping-list-get", ctxCk).result.items;
    const t = call("shopping-list-toggle", ctxCk, { id: list[0].id });
    assert.equal(t.result.item.checked, true);
  });

  it("pantry-cook-suggestions ranks recipes by coverage", () => {
    call("recipes-create", ctxCk, { title: "Easy", ingredients: [{ name: "egg" }, { name: "toast" }] });
    call("recipes-create", ctxCk, { title: "Hard", ingredients: [{ name: "egg" }, { name: "saffron" }, { name: "lobster" }] });
    call("pantry-add", ctxCk, { name: "egg" });
    call("pantry-add", ctxCk, { name: "toast" });
    const r = call("pantry-cook-suggestions", ctxCk);
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestions[0].title, "Easy");
    assert.equal(r.result.suggestions[0].coveragePct, 100);
  });

  it("ai-meal-plan fills the week from the recipe box", async () => {
    call("recipes-create", ctxCk, { title: "R1", tags: ["vegan"] });
    call("recipes-create", ctxCk, { title: "R2", tags: ["vegan"] });
    call("recipes-create", ctxCk, { title: "R3" });
    const r = await call("ai-meal-plan", ctxCk, { days: 7, slots: ["dinner"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.assigned.length, 7);
    const got = call("meal-plan-get", ctxCk, { start: r.result.assigned[0].date, end: r.result.assigned[6].date });
    assert.equal(got.result.entries.length, 7);
  });

  it("ai-meal-plan rejects with empty recipe box", async () => {
    globalThis._concordSTATE = { dtus: new Map() };
    const r = await call("ai-meal-plan", ctxCk, { days: 3 });
    assert.equal(r.ok, false);
  });

  it("cooking-dashboard-summary aggregates", () => {
    call("recipes-create", ctxCk, { title: "A" });
    call("collections-create", ctxCk, { name: "C" });
    call("pantry-add", ctxCk, { name: "salt" });
    const r = call("cooking-dashboard-summary", ctxCk);
    assert.equal(r.ok, true);
    assert.equal(r.result.recipeCount, 1);
    assert.equal(r.result.collectionCount, 1);
    assert.equal(r.result.pantryItems, 1);
  });
});

// ═════════════════════════════════════════════════════════════════
//  Paprika 3 + Samsung Food gap-closing backlog — URL import,
//  photo OCR, ratings + made-it log, USDA-linked nutrition,
//  multi-store shopping, printable recipe export.
// ═════════════════════════════════════════════════════════════════

describe("cooking — Paprika/Samsung Food backlog macros", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("import-from-url rejects an invalid url", async () => {
    const r = await call("import-from-url", ctxCk, { url: "not-a-url" });
    assert.equal(r.ok, false);
    assert.match(r.error, /url required/);
  });

  it("import-from-url parses schema.org/Recipe JSON-LD into a real recipe", async () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Garlic Butter Pasta",
        recipeYield: "4 servings",
        prepTime: "PT10M",
        cookTime: "PT20M",
        recipeCuisine: "Italian",
        keywords: "pasta, quick, dinner",
        recipeIngredient: ["400 g spaghetti", "3 cloves garlic", "½ cup butter"],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Boil the pasta." },
          { "@type": "HowToStep", text: "Melt the butter with garlic." },
        ],
        image: ["https://example.com/pasta.jpg"],
        description: "A simple weeknight pasta.",
      })}</script></head><body></body></html>`;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => html });
    const r = await call("import-from-url", ctxCk, { url: "https://example.com/recipe" });
    assert.equal(r.ok, true);
    assert.equal(r.result.recipe.title, "Garlic Butter Pasta");
    assert.equal(r.result.recipe.servings, 4);
    assert.equal(r.result.recipe.prepMin, 10);
    assert.equal(r.result.recipe.cookMin, 20);
    assert.equal(r.result.importedIngredients, 3);
    assert.equal(r.result.importedSteps, 2);
    assert.equal(r.result.recipe.cuisine, "Italian");
    assert.equal(r.result.recipe.sourceUrl, "https://example.com/recipe");
    // imported recipe lands in the recipe box
    assert.equal(call("recipes-list", ctxCk).result.recipes.length, 1);
  });

  it("import-from-url fails clearly when no Recipe JSON-LD is present", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "<html><body>nothing</body></html>" });
    const r = await call("import-from-url", ctxCk, { url: "https://example.com/blank" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no schema\.org\/Recipe/);
  });

  it("import-from-photo rejects when no image is supplied", async () => {
    const r = await call("import-from-photo", ctxCk, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /imageB64 or imageUrl required/);
  });

  it("recipe-rate appends a star rating and returns the running average", () => {
    const rec = call("recipes-create", ctxCk, { title: "Curry" }).result.recipe;
    const a = call("recipe-rate", ctxCk, { id: rec.id, stars: 5, note: "Loved it" });
    assert.equal(a.ok, true);
    assert.equal(a.result.avgRating, 5);
    const b = call("recipe-rate", ctxCk, { id: rec.id, stars: 3 });
    assert.equal(b.result.ratingCount, 2);
    assert.equal(b.result.avgRating, 4);
  });

  it("recipe-rate rejects out-of-range stars", () => {
    const rec = call("recipes-create", ctxCk, { title: "X" }).result.recipe;
    assert.equal(call("recipe-rate", ctxCk, { id: rec.id, stars: 9 }).ok, false);
    assert.equal(call("recipe-rate", ctxCk, { id: rec.id, stars: 0 }).ok, false);
  });

  it("recipe-log-cooked records a made-it entry with a date", () => {
    const rec = call("recipes-create", ctxCk, { title: "Stew" }).result.recipe;
    const r = call("recipe-log-cooked", ctxCk, { id: rec.id, date: "2026-06-01", note: "Family dinner" });
    assert.equal(r.ok, true);
    assert.equal(r.result.timesCooked, 1);
    assert.equal(r.result.lastCooked, "2026-06-01");
  });

  it("recipe-history aggregates ratings + made-it log", () => {
    const rec = call("recipes-create", ctxCk, { title: "Soup" }).result.recipe;
    call("recipe-rate", ctxCk, { id: rec.id, stars: 4 });
    call("recipe-log-cooked", ctxCk, { id: rec.id, date: "2026-05-20" });
    call("recipe-log-cooked", ctxCk, { id: rec.id, date: "2026-06-02" });
    const r = call("recipe-history", ctxCk, { id: rec.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.ratingCount, 1);
    assert.equal(r.result.timesCooked, 2);
    assert.equal(r.result.lastCooked, "2026-06-02");
  });

  it("recipe-nutrition-compute rejects a recipe with no ingredients", async () => {
    const rec = call("recipes-create", ctxCk, { title: "Empty" }).result.recipe;
    const r = await call("recipe-nutrition-compute", ctxCk, { id: rec.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /no ingredients/);
  });

  it("recipe-nutrition-compute sums USDA nutrients scaled by ingredient grams", async () => {
    const rec = call("recipes-create", ctxCk, {
      title: "Buttered toast", servings: 2,
      ingredients: [{ name: "butter", qty: 100, unit: "g" }],
    }).result.recipe;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        foods: [{
          fdcId: 173410, description: "Butter, salted",
          foodNutrients: [
            { nutrientName: "Energy", value: 717 },
            { nutrientName: "Protein", value: 0.85 },
            { nutrientName: "Total lipid (fat)", value: 81.11 },
            { nutrientName: "Carbohydrate, by difference", value: 0.06 },
          ],
        }],
      }),
    });
    const r = await call("recipe-nutrition-compute", ctxCk, { id: rec.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total.caloriesKcal, 717);
    assert.equal(r.result.perServing.caloriesKcal, 359);
    assert.equal(r.result.resolvedCount, 1);
    assert.equal(r.result.source, "usda-fooddata-central");
    // nutrition persists on the recipe
    assert.ok(call("recipes-get", ctxCk, { id: rec.id }).result.recipe.nutrition);
  });

  it("shopping-list-by-store normalizes units + groups items by store", () => {
    call("shopping-list-add", ctxCk, { name: "flour", qty: 1, unit: "kg" });
    call("shopping-list-add", ctxCk, { name: "flour", qty: 500, unit: "g" });
    call("shopping-list-add", ctxCk, { name: "bread", qty: 1, unit: "" });
    const r = call("shopping-list-by-store", ctxCk);
    assert.equal(r.ok, true);
    assert.equal(r.result.consolidatedFrom, 3);
    // flour 1kg + 500g consolidates to 1500 g
    const grocery = r.result.stores.find(st => st.store === "Grocery");
    const pantryAisle = grocery.aisles.find(a => a.aisle === "pantry");
    const flour = pantryAisle.items.find(i => i.name.toLowerCase() === "flour");
    assert.equal(flour.qty, 1500);
    assert.equal(flour.unit, "g");
    // bread routes to the Bakery store
    assert.ok(r.result.stores.find(st => st.store === "Bakery"));
  });

  it("recipe-export-card produces a printable text card + html", () => {
    const rec = call("recipes-create", ctxCk, {
      title: "Pancakes", servings: 4, prepMin: 5, cookMin: 15,
      ingredients: [{ name: "flour", qty: 200, unit: "g" }, { name: "milk", qty: 1, unit: "cup" }],
      steps: ["Mix batter", "Cook on griddle"],
    }).result.recipe;
    const r = call("recipe-export-card", ctxCk, { id: rec.id });
    assert.equal(r.ok, true);
    assert.match(r.result.card, /PANCAKES/);
    assert.match(r.result.card, /INGREDIENTS/);
    assert.match(r.result.card, /200 g flour/);
    assert.match(r.result.html, /<!doctype html>/);
    assert.match(r.result.html, /Pancakes/);
    assert.equal(r.result.format, "printable-card");
  });

  it("recipe-export-card rejects an unknown recipe id", () => {
    const r = call("recipe-export-card", ctxCk, { id: "rec_nope" });
    assert.equal(r.ok, false);
  });
});
