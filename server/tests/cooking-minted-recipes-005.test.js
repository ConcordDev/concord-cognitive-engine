// FIX-005 — a recipe minted as a DTU (CookingActionPanel's Mint posts
// source 'cooking:recipe:mint' with meta.cook.recipe) must appear in the
// cooking recipe library. Before this fix, recipes-list read ONLY the
// lens's own store, so a minted recipe vanished on reload ("No recipes
// found"). The DTU stays the record; list/get/scale read it as a view,
// owner-scoped by the canonical dtuListedOwner chain.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCookingActions from "../domains/cooking.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`cooking.${name}`);
  if (!fn) throw new Error(`cooking.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerCookingActions(register); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function mintedDtu(over = {}) {
  return {
    id: "dtu_minted_1",
    title: "Recipe — QA audit food Nov8 2054",
    tags: ["cooking", "recipe"],
    source: "cooking:recipe:mint",
    author: "user_a",
    createdAt: "2026-11-08T20:54:00.000Z",
    meta: {
      visibility: "private",
      cook: {
        recipe: {
          name: "QA audit food Nov8 2054",
          servings: 2,
          targetServings: 4,
          ingredients: [
            { name: "flour", qty: 200, unit: "g" },
            "eggs",
          ],
        },
      },
    },
    ...over,
  };
}

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("FIX-005 minted recipe DTUs in the recipe library", () => {
  it("recipes-list unions the owner's minted recipe DTU as a view", () => {
    globalThis._concordSTATE.dtus.set("dtu_minted_1", mintedDtu());
    const r = call("recipes-list", ctxA);
    assert.equal(r.ok, true);
    const mine = r.result.recipes.find(x => x.id === "dtu_minted_1");
    assert.ok(mine, "minted recipe must be listed");
    assert.equal(mine.title, "QA audit food Nov8 2054");
    assert.equal(mine.servings, 2);
    assert.equal(mine.mintedDtu, true);
    assert.deepEqual(mine.ingredients, [
      { name: "flour", qty: 200, unit: "g" },
      { name: "eggs", qty: null, unit: "" },
    ]);
  });

  it("recipes-get and recipes-scale resolve the minted id for its owner", () => {
    globalThis._concordSTATE.dtus.set("dtu_minted_1", mintedDtu());
    const g = call("recipes-get", ctxA, { id: "dtu_minted_1" });
    assert.equal(g.ok, true);
    assert.equal(g.result.recipe.title, "QA audit food Nov8 2054");
    const sc = call("recipes-scale", ctxA, { id: "dtu_minted_1", targetServings: 4 });
    assert.equal(sc.ok, true);
    assert.equal(sc.result.factor, 2);
    assert.equal(sc.result.ingredients[0].qty, 400);
  });

  it("another user neither lists nor gets the minted recipe", () => {
    globalThis._concordSTATE.dtus.set("dtu_minted_1", mintedDtu());
    const r = call("recipes-list", ctxB);
    assert.equal(r.result.recipes.some(x => x.id === "dtu_minted_1"), false);
    const g = call("recipes-get", ctxB, { id: "dtu_minted_1" });
    assert.equal(g.ok, false);
    assert.equal(g.error, "recipe not found");
  });

  it("the owner chain honours ownerId-stamped DTUs, and non-recipe DTUs never appear", () => {
    const alt = mintedDtu({ id: "dtu_minted_2", author: undefined, ownerId: "user_a" });
    globalThis._concordSTATE.dtus.set("dtu_minted_2", alt);
    globalThis._concordSTATE.dtus.set("dtu_plain", {
      id: "dtu_plain", title: "Notes", tags: ["cooking", "recipe"], source: "cooking:recipe:mint",
      author: "user_a", meta: { visibility: "private" },
    });
    const r = call("recipes-list", ctxA);
    const ids = r.result.recipes.map(x => x.id);
    assert.ok(ids.includes("dtu_minted_2"), "ownerId-stamped minted DTU must list");
    assert.equal(ids.includes("dtu_plain"), false, "a DTU without meta.cook.recipe is not a recipe");
  });

  it("update and delete on a minted id refuse by name and keep the DTU", () => {
    globalThis._concordSTATE.dtus.set("dtu_minted_1", mintedDtu());
    const u = call("recipes-update", ctxA, { id: "dtu_minted_1", title: "renamed" });
    assert.equal(u.ok, false);
    assert.match(u.error, /read-only in the recipe library/);
    const d = call("recipes-delete", ctxA, { id: "dtu_minted_1" });
    assert.equal(d.ok, false);
    assert.match(d.error, /read-only in the recipe library/);
    assert.ok(globalThis._concordSTATE.dtus.has("dtu_minted_1"));
  });

  it("store recipes are unaffected and search matches minted titles", () => {
    call("recipes-create", ctxA, { title: "Store soup", servings: 3, ingredients: [{ name: "stock", qty: 1, unit: "l" }] });
    globalThis._concordSTATE.dtus.set("dtu_minted_1", mintedDtu());
    const all = call("recipes-list", ctxA).result.recipes;
    assert.equal(all.length, 2);
    const q = call("recipes-list", ctxA, { q: "audit food" }).result.recipes;
    assert.deepEqual(q.map(x => x.id), ["dtu_minted_1"]);
  });
});
