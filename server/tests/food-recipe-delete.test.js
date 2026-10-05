// tests/food-recipe-delete.test.js — food.recipe-delete removes only the
// caller's own recipe (plus its photos and ratings), keeps cook history as
// "(removed recipe)", and refuses unknown / other-user ids.
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

let saves = 0;
before(() => { registerFoodActions(register); });
beforeEach(() => {
  saves = 0;
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => { saves += 1; };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("food.recipe-delete", () => {
  it("deletes the caller's recipe with its photos and ratings, keeps cook history", () => {
    const keep = call("recipe-add", ctxA, { title: "Keep Me" }).result.recipe;
    const gone = call("recipe-add", ctxA, { title: "Delete Me" }).result.recipe;
    call("recipe-photo-add", ctxA, { recipeId: gone.id, url: "https://example.invalid/p.jpg" });
    call("recipe-photo-add", ctxA, { recipeId: keep.id, url: "https://example.invalid/k.jpg" });
    call("recipe-rate", ctxA, { recipeId: gone.id, rating: 4 });
    call("recipe-cooked", ctxA, { recipeId: gone.id });

    const before = saves;
    const del = call("recipe-delete", ctxA, { id: gone.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, gone.id);
    assert.equal(del.result.title, "Delete Me");
    assert.ok(saves > before, "delete must persist state");

    const list = call("recipe-list", ctxA).result.recipes;
    assert.deepEqual(list.map((r) => r.id), [keep.id]);
    const photos = call("recipe-photo-list", ctxA).result.photos;
    assert.deepEqual(photos.map((p) => p.recipeId), [keep.id]);
    const hist = call("recipe-cook-history", ctxA).result.history;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].recipeTitle, "(removed recipe)");
  });

  it("cannot delete another user's recipe", () => {
    const mine = call("recipe-add", ctxA, { title: "A's recipe" }).result.recipe;
    const r = call("recipe-delete", ctxB, { id: mine.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "recipe not found");
    assert.equal(call("recipe-list", ctxA).result.recipes.length, 1);
  });

  it("refuses a missing or unknown id", () => {
    assert.equal(call("recipe-delete", ctxA, {}).error, "id required");
    assert.equal(call("recipe-delete", ctxA, { id: "rec_nope" }).error, "recipe not found");
  });
});
