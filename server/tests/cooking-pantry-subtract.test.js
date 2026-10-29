// server/tests/cooking-pantry-subtract.test.js
//
// Q21 (E-91): shopping-list-generate must subtract COUNTED pantry
// stock. Before the fix only uncounted entries ("have it, no count")
// affected the list; a counted 500 g of flour against a 200 g need
// still listed the full 200 g. Pins: partial coverage lists only the
// shortfall; full coverage drops the item; uncounted still drops it;
// a unit mismatch subtracts nothing; subtractPantry:false lists full.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCookingActions from "../domains/cooking.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`cooking.${name}`);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  return fn({ actor: { userId: "cook-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCookingActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function planRecipe(ingredients, { servings = 4, planServings = 4 } = {}) {
  const recipe = call("recipes-create", { title: "Bread", servings, ingredients }).result.recipe;
  call("meal-plan-set", { date: "2026-11-10", slot: "dinner", recipeId: recipe.id, servings: planServings });
  return recipe;
}
function generate(extra = {}) {
  const r = call("shopping-list-generate", { start: "2026-11-09", end: "2026-11-16", ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.items;
}
const flour = (items) => items.find((i) => i.name.toLowerCase() === "flour");

describe("cooking pantry subtraction (Q21)", () => {
  it("partial counted coverage lists only the shortfall", () => {
    planRecipe([{ name: "Flour", qty: 500, unit: "g" }]);
    call("pantry-add", { name: "Flour", qty: 300, unit: "g" });
    const items = generate();
    assert.equal(flour(items).qty, 200, "500 needed − 300 on hand = 200 to buy");
  });

  it("full counted coverage drops the item entirely", () => {
    planRecipe([{ name: "Flour", qty: 200, unit: "g" }]);
    call("pantry-add", { name: "Flour", qty: 500, unit: "g" });
    assert.equal(flour(generate()), undefined);
  });

  it("uncounted pantry stock still drops the item (pre-existing semantics)", () => {
    planRecipe([{ name: "Flour", qty: 200, unit: "g" }]);
    call("pantry-add", { name: "Flour" }); // no qty -> null
    assert.equal(flour(generate()), undefined);
  });

  it("a unit mismatch subtracts nothing (no conversion is invented)", () => {
    planRecipe([{ name: "Flour", qty: 2, unit: "cups" }]);
    call("pantry-add", { name: "Flour", qty: 900, unit: "g" });
    assert.equal(flour(generate()).qty, 2);
  });

  it("subtractPantry:false lists the full quantity", () => {
    planRecipe([{ name: "Flour", qty: 500, unit: "g" }]);
    call("pantry-add", { name: "Flour", qty: 300, unit: "g" });
    assert.equal(flour(generate({ subtractPantry: false })).qty, 500);
  });

  it("scaled servings subtract against the scaled need", () => {
    planRecipe([{ name: "Flour", qty: 100, unit: "g" }], { servings: 4, planServings: 8 }); // factor 2 -> 200 g
    call("pantry-add", { name: "Flour", qty: 150, unit: "g" });
    assert.equal(flour(generate()).qty, 50);
  });
});
