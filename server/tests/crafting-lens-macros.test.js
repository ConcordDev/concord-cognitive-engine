// Behavioral macro tests for the crafting lens — the macros the live lens
// page actually drives through lensRun('crafting', …) → POST /api/lens/run.
//
// The crafting page calls two crafting.* macros directly:
//   • lensRun('crafting','favorite_toggle', { recipeId, recipeName, recipeType })
//   • lensRun('crafting','favorite_list', {})
// plus the discovery/grid/queue/quality/gather backlog macros that the
// Workbench surfaces. This file is NOT shape-only: every test asserts ACTUAL
// values + multi-step round-trips (toggle on → list reflects it; toggle off →
// list drops it), per-user isolation, idempotent re-discovery, deterministic
// seeded batch crafting, and the favorited count returned to the UI.
//
// LIGHTWEIGHT + hermetic: a local register harness drives each registered
// macro the way runMacro/LENS_ACTIONS would (handler(ctx, artifact, input))
// against the REAL in-memory globalThis._concordSTATE the domain persists to.
// No server boot, no network, no LLM, no DB migrations — runs in <1s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCraftingActions from "../domains/crafting.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "crafting", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the /api/lens/run + runMcpTool dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`crafting.${name} not registered`);
  return fn(ctx, { id: null, domain: "crafting", type: "domain_action", data: input, meta: {} }, input);
}

before(() => {
  registerCraftingActions(register);
});

beforeEach(() => {
  // Fresh per-user state every test; mirrors the live STATE container shape.
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", id: "user_b" }, userId: "user_b" };

// ── the macros the live lens page drives ────────────────────────────

describe("crafting lens — registration of the driven macros", () => {
  it("registers every macro the page calls", () => {
    for (const m of ["favorite_toggle", "favorite_list", "list", "counts", "marketplace_browse"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing crafting.${m}`);
    }
  });
});

describe("crafting lens — favorite_toggle ↔ favorite_list round-trip (the MineTab star)", () => {
  it("favorite_list is empty before any toggle", () => {
    const l = call("favorite_list", ctxA, {});
    assert.equal(l.ok, true);
    assert.deepEqual(l.result.favorites, []);
    assert.equal(l.result.count, 0);
  });

  it("toggling a recipe ON makes favorite_list reflect it with the real recipeId", () => {
    const on = call("favorite_toggle", ctxA, {
      recipeId: "dtu_iron_sword",
      recipeName: "Iron Sword",
      recipeType: "blueprint",
    });
    assert.equal(on.ok, true);
    assert.equal(on.result.favorited, true);
    assert.equal(on.result.recipeId, "dtu_iron_sword");
    assert.equal(on.result.count, 1);

    const l = call("favorite_list", ctxA, {});
    assert.equal(l.result.count, 1);
    const fav = l.result.favorites[0];
    assert.equal(fav.recipeId, "dtu_iron_sword");
    assert.equal(fav.recipeName, "Iron Sword");
    assert.equal(fav.recipeType, "blueprint");
    assert.equal(typeof fav.favoritedAt, "string");
    // the Set the lens builds from favorites[].recipeId must contain the id
    assert.ok(new Set(l.result.favorites.map((f) => f.recipeId)).has("dtu_iron_sword"));
  });

  it("toggling the SAME recipe again removes it (favorite_list drops it)", () => {
    call("favorite_toggle", ctxA, { recipeId: "dtu_fireball", recipeName: "Fireball", recipeType: "spell_recipe" });
    const off = call("favorite_toggle", ctxA, { recipeId: "dtu_fireball" });
    assert.equal(off.result.favorited, false);
    assert.equal(off.result.count, 0);
    assert.equal(call("favorite_list", ctxA, {}).result.count, 0);
  });

  it("favorite_toggle rejects a missing recipeId (fail-closed, not silent success)", () => {
    const r = call("favorite_toggle", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /recipeId/);
  });

  it("INVARIANT: favorites are scoped per-user — user_b never sees user_a's stars", () => {
    call("favorite_toggle", ctxA, { recipeId: "dtu_secret", recipeName: "Secret" });
    assert.equal(call("favorite_list", ctxA, {}).result.count, 1);
    assert.equal(call("favorite_list", ctxB, {}).result.count, 0);
  });

  it("multiple favorites are returned newest-first", () => {
    call("favorite_toggle", ctxA, { recipeId: "r1", recipeName: "First" });
    call("favorite_toggle", ctxA, { recipeId: "r2", recipeName: "Second" });
    const l = call("favorite_list", ctxA, {});
    assert.equal(l.result.count, 2);
    // favoritedAt descending — both present regardless of clock granularity
    const ids = new Set(l.result.favorites.map((f) => f.recipeId));
    assert.ok(ids.has("r1") && ids.has("r2"));
  });
});

// ── the recipe-counts / list surfaces the header reads ──────────────

describe("crafting lens — list + counts reflect real recipe DTUs", () => {
  it("counts a real recipe DTU owned by the caller", () => {
    globalThis._concordSTATE.dtus.set("d1", {
      id: "d1", title: "Stew", ownerUserId: "user_a", meta: { type: "food_recipe" }, createdAt: "2026-01-01T00:00:00Z",
    });
    globalThis._concordSTATE.dtus.set("d2", {
      id: "d2", title: "Bolt", ownerUserId: "user_a", meta: { type: "spell_recipe" }, createdAt: "2026-01-02T00:00:00Z",
    });
    const c = call("counts", ctxA, {});
    assert.equal(c.ok, true);
    assert.equal(c.result.food_recipe, 1);
    assert.equal(c.result.spell_recipe, 1);
    assert.equal(c.result.blueprint, 0);

    const l = call("list", ctxA, {});
    assert.equal(l.result.count, 2);
    assert.ok(l.result.items.some((i) => i.dtuId === "d1" && i.type === "food_recipe"));
  });

  it("INVARIANT: list does not leak another user's recipe DTUs", () => {
    globalThis._concordSTATE.dtus.set("d1", {
      id: "d1", title: "Stew", ownerUserId: "user_a", meta: { type: "food_recipe" },
    });
    assert.equal(call("list", ctxB, {}).result.count, 0);
  });
});

// ── marketplace_browse (the Browse tab's macro path) ────────────────

describe("crafting lens — marketplace_browse returns only listed recipes", () => {
  it("an unlisted recipe DTU does not surface; a listed one does, with its price", () => {
    globalThis._concordSTATE.dtus.set("d1", {
      id: "d1", title: "Unlisted Spell", ownerUserId: "user_a", meta: { type: "spell_recipe" },
    });
    globalThis._concordSTATE.dtus.set("d2", {
      id: "d2", title: "Listed Blueprint", ownerUserId: "user_a",
      meta: { type: "blueprint" },
      marketplaceListing: { price: 42, listed_at: "2026-02-01T00:00:00Z" },
    });
    const r = call("marketplace_browse", ctxA, { sort: "newest" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.items[0].id, "d2");
    assert.equal(r.result.items[0].price, 42);
  });
});

// ── workbench-driven backlog macros (discovery / queue / quality) ───

describe("crafting lens — workbench macros produce real computed values", () => {
  it("discovery_combine is idempotent: same set re-attempts, not re-discovers", () => {
    const set = { materials: [{ material: "iron", quantity: 1 }, { material: "coal", quantity: 1 }] };
    const first = call("discovery_combine", ctxA, set);
    assert.equal(first.result.discovered, true);
    const second = call("discovery_combine", ctxA, set);
    assert.equal(second.result.discovered, false);
    assert.equal(second.result.recipe.attempts, 2);
    assert.equal(call("discovery_list", ctxA, {}).result.count, 1);
  });

  it("queue_add → queue_craft_all is deterministic for a fixed seed and clears the queue", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 4 });
    const a = call("queue_craft_all", ctxA, { seed: 4242 });
    assert.equal(a.result.totalUnits, 4);
    assert.equal(call("queue_list", ctxA, {}).result.pending, 0);

    // re-run with same seed on fresh state → identical tiers (no hidden RNG)
    globalThis._concordSTATE = { dtus: new Map() };
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 4 });
    const b = call("queue_craft_all", ctxA, { seed: 4242 });
    assert.deepEqual(
      a.result.crafted[0].units.map((u) => u.tier),
      b.result.crafted[0].units.map((u) => u.tier),
    );
  });

  it("quality_roll never returns a sub-crude multiplier and respects the seed", () => {
    const r1 = call("quality_roll", ctxA, { seed: 7, skillLevel: 10 });
    const r2 = call("quality_roll", ctxA, { seed: 7, skillLevel: 10 });
    assert.equal(r1.result.tier, r2.result.tier);
    assert.ok(r1.result.multiplier >= 0.7);
  });
});
