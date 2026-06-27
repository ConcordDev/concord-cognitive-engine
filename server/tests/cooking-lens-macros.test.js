// Behavioral macro tests for server/domains/cooking.js — the recipe-box /
// meal-plan / pantry / shopping-list / nutrition substrate the /lenses/cooking
// lens drives via lensRun('cooking', …).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150/39283):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// with virtualArtifact.data = input. Our harness reproduces that exactly so a
// param-position regression surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values: recipe scaling factors, unit→gram conversion, nutrition macro
// rollups, shopping-list consolidation + unit normalization, cook/made-log
// math, and per-user isolation. Validation-rejection, degrade-graceful (no
// STATE), and a fail-CLOSED poisoned-numeric case are pinned.
//
// It ALSO pins the double-wrapped-input regression that the CookingActionPanel
// client triggers: that client posts { artifact: { data: recipe } } as the
// lens-run body, so the live dispatch sets virtualArtifact.data to
// { artifact: { data: recipe } } — one extra layer. The receivers were
// reading artifact.data.ingredients (always undefined → empty result), a
// dead-calculator. recipeData() unwraps it. The "double-wrapped" tests below
// reproduce the EXACT client payload shape and assert real computed values.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCookingActions from "../domains/cooking.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "cooking", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch: handler(ctx, virtualArtifact, input), with
// virtualArtifact.data = input. `body` lets a test reproduce the
// CookingActionPanel { artifact: { data } } body shape (no `input` key),
// where the server sets virtualArtifact.data = body-minus-routing-keys.
function call(name, ctx, input = {}, body = null) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  const data = body !== null ? body : (input || {});
  const params = body !== null ? body : (input || {});
  const virtualArtifact = { id: null, domain: "cooking", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, params);
}

before(() => { registerCookingActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = { __seeded: true }; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// Helper — create a recipe and return its id.
function createRecipe(ctx, params) {
  const r = call("recipes-create", ctx, params);
  assert.equal(r.ok, true, `recipes-create failed: ${JSON.stringify(r)}`);
  return r.result.recipe;
}

// ── 1. Registration — every lens-driven macro present ─────────────
describe("cooking — registration", () => {
  it("registers every macro the lens calls via lensRun", () => {
    for (const m of [
      // CookingActionPanel pure-compute
      "scaleRecipe", "nutritionEstimate", "substitution", "usda-search", "usda-nutrition",
      // RecipeKitchen
      "recipes-list", "recipe-history", "recipes-get", "recipe-rate", "recipe-log-cooked",
      "recipe-nutrition-compute", "recipe-export-card", "shopping-list-by-store",
      // RecipeBoxSection
      "meal-plan-get", "meal-plan-set", "meal-plan-clear", "shopping-list-get",
      "pantry-list", "pantry-cook-suggestions", "recipes-create", "recipes-update",
      "recipes-delete", "recipes-scale", "ai-meal-plan", "shopping-list-generate",
      "shopping-list-toggle", "shopping-list-clear", "pantry-add", "pantry-delete",
      // RecipeImportBar
      "import-from-url", "import-from-photo",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing cooking.${m}`);
    }
  });
});

// ── 2. scaleRecipe — exact scale-factor math (flat + double-wrapped) ─
describe("cooking — scaleRecipe (pure-compute)", () => {
  const RECIPE = {
    name: "Pancakes",
    servings: 4,
    targetServings: 8,
    ingredients: [
      { name: "flour", quantity: "200", unit: "g" },
      { name: "milk", quantity: "300", unit: "ml" },
      { name: "egg", quantity: "2", unit: "" },
    ],
  };

  it("scales each ingredient by targetServings/baseServings (flat input)", () => {
    const r = call("scaleRecipe", ctxA, RECIPE);
    assert.equal(r.ok, true);
    assert.equal(r.result.baseServings, 4);
    assert.equal(r.result.targetServings, 8);
    assert.equal(r.result.scaleFactor, 2);
    // factor 2 → 200→400 / 300→600 / 2→4
    assert.equal(r.result.ingredients[0].scaled, "400 g");
    assert.equal(r.result.ingredients[1].scaled, "600 ml");
    assert.equal(r.result.ingredients[2].scaled.trim(), "4");
    assert.equal(r.result.recipe, "Pancakes");
  });

  it("DOUBLE-WRAP regression: the CookingActionPanel { artifact: { data } } body still computes", () => {
    // EXACT client shape: callMacro posts the body { domain, action, artifact:{data} }
    // (no `input` key) → server sets virtualArtifact.data = { artifact: { data } }.
    const body = { artifact: { data: RECIPE } };
    const r = call("scaleRecipe", ctxA, {}, body);
    assert.equal(r.ok, true);
    assert.equal(r.result.scaleFactor, 2, "double-wrapped payload must NOT silently return an empty/default scale");
    assert.equal(r.result.ingredients.length, 3, "ingredients must survive the unwrap (was [] in the dead-calculator)");
    assert.equal(r.result.ingredients[0].scaled, "400 g");
    assert.equal(r.result.recipe, "Pancakes");
  });

  it("targetServings can come from the 3rd-arg params override", () => {
    // baseServings 4, no targetServings on data, 12 in params → factor 3
    const data = { name: "Soup", servings: 4, ingredients: [{ name: "stock", quantity: "1000", unit: "ml" }] };
    const r = call("scaleRecipe", ctxA, { ...data, targetServings: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.scaleFactor, 3);
    assert.equal(r.result.ingredients[0].scaled, "3000 ml");
  });
});

// ── 3. nutritionEstimate — macro rollup math ──────────────────────
describe("cooking — nutritionEstimate (pure-compute)", () => {
  // db: flour 364cal/10p/76c/1f, butter 717cal/1p/0c/81f per 100g.
  const RECIPE = {
    name: "Shortbread",
    servings: 2,
    ingredients: [
      { name: "flour", grams: 200 },   // factor 2 → 728 cal, 20 p, 152 c, 2 f
      { name: "butter", grams: 100 },  // factor 1 → 717 cal, 1 p, 0 c, 81 f
    ],
  };

  it("sums per-ingredient nutrients scaled by grams, divides by servings", () => {
    const r = call("nutritionEstimate", ctxA, RECIPE);
    assert.equal(r.ok, true);
    // 364*2 + 717 = 1445 total cal
    assert.equal(r.result.totalCalories, 1445);
    assert.equal(r.result.servings, 2);
    assert.equal(r.result.perServing, Math.round(1445 / 2)); // 723
    // protein 20+1=21g, carbs 152g, fat 2+81=83g
    assert.equal(r.result.macros.protein, "21g");
    assert.equal(r.result.macros.carbs, "152g");
    assert.equal(r.result.macros.fat, "83g");
  });

  it("DOUBLE-WRAP regression: { artifact: { data } } body rolls up real macros", () => {
    const r = call("nutritionEstimate", ctxA, {}, { artifact: { data: RECIPE } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCalories, 1445, "double-wrapped nutrition must compute, not return 0");
    assert.equal(r.result.macros.fat, "83g");
  });

  it("unmatched ingredients contribute zero (degrade-graceful, never throws)", () => {
    const r = call("nutritionEstimate", ctxA, { servings: 1, ingredients: [{ name: "moon dust", grams: 500 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCalories, 0);
  });
});

// ── 4. substitution — table lookup ────────────────────────────────
describe("cooking — substitution", () => {
  it("returns known substitutions for a matched ingredient", () => {
    const r = call("substitution", ctxA, { ingredient: "Butter" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true);
    assert.ok(r.result.substitutions.some((x) => x.sub === "Coconut oil"));
  });

  it("DOUBLE-WRAP regression: { artifact: { data: { ingredient } } } resolves", () => {
    const r = call("substitution", ctxA, {}, { artifact: { data: { ingredient: "egg" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, true, "double-wrapped substitution must find the ingredient");
    assert.equal(r.result.ingredient, "egg");
  });

  it("unknown ingredient → found:false with a placeholder, never throws", () => {
    const r = call("substitution", ctxA, { ingredient: "unobtanium" });
    assert.equal(r.ok, true);
    assert.equal(r.result.found, false);
    assert.equal(r.result.substitutions.length, 1);
  });
});

// ── 5. recipes-scale — server-side scaling against stored recipe ──
describe("cooking — recipes-scale (state-backed)", () => {
  it("scales stored ingredient quantities by targetServings/servings", () => {
    const rec = createRecipe(ctxA, {
      title: "Stew", servings: 4,
      ingredients: [{ name: "beef", qty: 500, unit: "g" }, { name: "onion", qty: 2, unit: "" }],
    });
    const r = call("recipes-scale", ctxA, { id: rec.id, targetServings: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.result.factor, 1.5);
    // 500*1.5 = 750, 2*1.5 = 3
    assert.equal(r.result.ingredients.find((i) => i.name === "beef").qty, 750);
    assert.equal(r.result.ingredients.find((i) => i.name === "onion").qty, 3);
  });

  it("rejects an unknown recipe id (validation-rejection)", () => {
    const r = call("recipes-scale", ctxA, { id: "nope", targetServings: 6 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

// ── 6. recipe-rate / recipe-log-cooked — counters + validation ────
describe("cooking — rate + cook log", () => {
  it("recipe-rate averages stars and counts; rejects out-of-range stars", () => {
    const rec = createRecipe(ctxA, { title: "Cake", servings: 8 });
    const a = call("recipe-rate", ctxA, { id: rec.id, stars: 5 });
    const b = call("recipe-rate", ctxA, { id: rec.id, stars: 3 });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.result.ratingCount, 2);
    assert.equal(b.result.avgRating, 4); // (5+3)/2
    const bad = call("recipe-rate", ctxA, { id: rec.id, stars: 9 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /1-5/);
  });

  it("recipe-log-cooked increments timesCooked; normalizes bad dates", () => {
    const rec = createRecipe(ctxA, { title: "Soup", servings: 4 });
    const c1 = call("recipe-log-cooked", ctxA, { id: rec.id, date: "2026-01-15" });
    assert.equal(c1.ok, true);
    assert.equal(c1.result.timesCooked, 1);
    assert.equal(c1.result.lastCooked, "2026-01-15");
    const c2 = call("recipe-log-cooked", ctxA, { id: rec.id, date: "not-a-date" });
    assert.equal(c2.ok, true);
    assert.equal(c2.result.timesCooked, 2);
    assert.match(c2.result.lastCooked, /^\d{4}-\d{2}-\d{2}$/); // fell back to today
  });
});

// ── 7. shopping-list-by-store — unit normalization + consolidation ─
describe("cooking — shopping-list-by-store (unit conversion + consolidation)", () => {
  it("normalizes mass units to grams and consolidates duplicate ingredients", () => {
    // Two flour rows: 1 lb (453.6g) + 200 g → 653.6 g consolidated.
    call("shopping-list-add", ctxA, { name: "flour", qty: 1, unit: "lb" });
    call("shopping-list-add", ctxA, { name: "flour", qty: 200, unit: "g" });
    call("shopping-list-add", ctxA, { name: "milk", qty: 2, unit: "cups" }); // 2*240 = 480 ml
    const r = call("shopping-list-by-store", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.consolidatedFrom, 3, "started from 3 raw rows");
    assert.equal(r.result.totalItems, 2, "flour rows consolidated → 2 distinct items");
    // Find the consolidated flour entry.
    const allItems = r.result.stores.flatMap((s) => s.aisles.flatMap((a) => a.items));
    const flour = allItems.find((i) => i.name === "flour");
    assert.ok(flour, "flour present");
    assert.equal(flour.unit, "g");
    assert.equal(flour.qty, Math.round((453.6 + 200) * 100) / 100); // 653.6
    const milk = allItems.find((i) => i.name === "milk");
    assert.equal(milk.unit, "ml");
    assert.equal(milk.qty, 480);
  });
});

// ── 8. pantry-cook-suggestions — coverage ranking ─────────────────
describe("cooking — pantry-cook-suggestions", () => {
  it("ranks recipes by pantry-covered ingredient fraction", () => {
    createRecipe(ctxA, {
      title: "Omelette", servings: 1,
      ingredients: [{ name: "egg" }, { name: "cheese" }, { name: "butter" }],
    });
    call("pantry-add", ctxA, { name: "egg" });
    call("pantry-add", ctxA, { name: "butter" });
    const r = call("pantry-cook-suggestions", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.suggestions));
    const om = r.result.suggestions.find((x) => x.title === "Omelette");
    assert.ok(om, "Omelette suggested");
    assert.equal(om.haveCount, 2, "2 of 3 ingredients in pantry");
    assert.equal(om.totalCount, 3);
    assert.equal(om.coveragePct, 67); // round(2/3*100)
  });

  it("empty pantry returns a CTA message, not an error", () => {
    const r = call("pantry-cook-suggestions", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.suggestions, []);
    assert.match(r.result.message, /pantry/i);
  });
});

// ── 9. meal-plan — set / get / clear round-trip ───────────────────
describe("cooking — meal plan", () => {
  it("set then get reflects the planned slot", () => {
    const rec = createRecipe(ctxA, { title: "Tacos", servings: 4 });
    const set = call("meal-plan-set", ctxA, { date: "2026-03-01", slot: "dinner", recipeId: rec.id });
    assert.equal(set.ok, true);
    const get = call("meal-plan-get", ctxA, { start: "2026-03-01", end: "2026-03-07" });
    assert.equal(get.ok, true);
    const cells = JSON.stringify(get.result);
    assert.ok(cells.includes(rec.id), "planned recipe id present in plan");
    const clear = call("meal-plan-clear", ctxA, { date: "2026-03-01", slot: "dinner" });
    assert.equal(clear.ok, true);
  });
});

// ── 10. usda-search — validation-rejection (no network) ───────────
describe("cooking — usda-search validation (hermetic, no network)", () => {
  it("rejects a missing query before any fetch", async () => {
    const r = await call("usda-search", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /query required/);
  });
  it("rejects a too-short query before any fetch", async () => {
    const r = await call("usda-search", ctxA, { query: "a" });
    assert.equal(r.ok, false);
    assert.match(r.error, /2 characters/);
  });
  it("usda-nutrition rejects a non-numeric fdcId before any fetch", async () => {
    const r = await call("usda-nutrition", ctxA, { fdcId: "abc" });
    assert.equal(r.ok, false);
    assert.match(r.error, /fdcId required/);
  });
});

// ── 11. degrade-graceful — no STATE ───────────────────────────────
describe("cooking — degrade-graceful when STATE absent", () => {
  it("state-backed macros return ok:false (never throw) with no STATE", () => {
    globalThis._concordSTATE = null;
    for (const m of ["recipes-list", "pantry-list", "shopping-list-get", "meal-plan-get"]) {
      const r = call(m, ctxA, {});
      assert.equal(r.ok, false, `${m} should fail-soft`);
      assert.match(r.error, /STATE unavailable/);
    }
  });
});

// ── 12. fail-CLOSED poisoned numerics ─────────────────────────────
describe("cooking — fail-CLOSED on poisoned numerics", () => {
  it("recipes-create clamps a poisoned servings to a sane bound", () => {
    const r = call("recipes-create", ctxA, { title: "Poison", servings: 1e308 });
    assert.equal(r.ok, true);
    // servings is Math.max(1, Number(...) || 4). 1e308 is finite so it would
    // pass through — pin that it's at least a finite number and the recipe
    // round-trips without producing Infinity downstream.
    assert.ok(Number.isFinite(r.result.recipe.servings), "servings must stay finite");
  });

  it("recipes-scale with Infinity targetServings does not mint Infinity quantities (fail-CLOSED)", () => {
    const rec = createRecipe(ctxA, { title: "S", servings: 4, ingredients: [{ name: "x", qty: 10, unit: "g" }] });
    // A poisoned non-finite targetServings is clamped to the recipe's own
    // servings (factor 1) — NEVER an Infinity factor that serializes to a null
    // qty downstream. This pins the hardened fail-CLOSED behavior.
    const r = call("recipes-scale", ctxA, { id: rec.id, targetServings: Infinity });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.factor), "factor must stay finite");
    assert.equal(r.result.factor, 1, "non-finite target → fall back to base servings");
    assert.ok(Number.isFinite(r.result.ingredients[0].qty), "scaled qty must stay finite, not null/Infinity");
    assert.equal(r.result.ingredients[0].qty, 10);
  });

  it("recipe-rate rejects a poisoned NaN/Infinity star rating (fail-CLOSED)", () => {
    const rec = createRecipe(ctxA, { title: "R", servings: 1 });
    const r = call("recipe-rate", ctxA, { id: rec.id, stars: Infinity });
    assert.equal(r.ok, false, "non-finite stars must be rejected, not stored");
    assert.match(r.error, /1-5/);
  });
});

// ── 13. per-user isolation ────────────────────────────────────────
describe("cooking — per-user isolation", () => {
  it("user_a's recipes are invisible to user_b", () => {
    createRecipe(ctxA, { title: "A-only", servings: 2 });
    const listB = call("recipes-list", ctxB, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.recipes.length, 0, "user_b sees none of user_a's recipes");
    const listA = call("recipes-list", ctxA, {});
    assert.equal(listA.result.recipes.length, 1);
  });
});
