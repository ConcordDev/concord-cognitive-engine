// Tier-2 contract tests for crafting lens parity macros.
// Covers the feature-parity backlog: visual grid, discovery/experimentation,
// craft queue + batch, craftable-now filter, quality tiers, gather plan,
// favorites + history. Pins per-user scoping and deterministic outcomes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCraftingActions from "../domains/crafting.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`crafting.${name}`);
  if (!fn) throw new Error(`crafting.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => {
  registerCraftingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", id: "user_b" }, userId: "user_b" };

// ── core macros still present ───────────────────────────────────────

describe("crafting — core macros", () => {
  it("list returns empty items with no recipe DTUs", () => {
    const r = call("list", ctxA);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
  });

  it("counts returns a zeroed type map", () => {
    const r = call("counts", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.food_recipe, 0);
  });

  it("marketplace_browse returns empty when nothing listed", () => {
    const r = call("marketplace_browse", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 0);
  });

  it("forge_preflight rejects a missing recipeId", () => {
    const r = call("forge_preflight", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /recipeId/);
  });
});

// ── Visual crafting grid ────────────────────────────────────────────

describe("crafting — visual grid", () => {
  it("grid_save persists a grid and grid_list returns it", () => {
    const s = call("grid_save", ctxA, {
      name: "Iron Sword",
      cells: [
        { slot: 1, material: "iron ingot", quantity: 2 },
        { slot: 4, material: "iron ingot", quantity: 1 },
        { slot: 7, material: "wood", quantity: 1 },
      ],
      output: { name: "Iron Sword", type: "blueprint" },
    });
    assert.equal(s.ok, true);
    assert.equal(s.result.updated, false);
    assert.equal(s.result.grid.cells.length, 3);
    const l = call("grid_list", ctxA);
    assert.equal(l.result.count, 1);
  });

  it("grid_save rejects an empty grid", () => {
    const r = call("grid_save", ctxA, { name: "X", cells: [] });
    assert.equal(r.ok, false);
  });

  it("grid_save updates an existing grid by name", () => {
    call("grid_save", ctxA, { name: "Bow", cells: [{ slot: 0, material: "string", quantity: 3 }] });
    const r = call("grid_save", ctxA, { name: "bow", cells: [{ slot: 0, material: "string", quantity: 5 }] });
    assert.equal(r.result.updated, true);
    assert.equal(r.result.grid.cells[0].quantity, 5);
    assert.equal(call("grid_list", ctxA).result.count, 1);
  });

  it("grid_delete removes a grid", () => {
    const s = call("grid_save", ctxA, { name: "Axe", cells: [{ slot: 0, material: "stone", quantity: 1 }] });
    const d = call("grid_delete", ctxA, { id: s.result.grid.id });
    assert.equal(d.ok, true);
    assert.equal(call("grid_list", ctxA).result.count, 0);
  });

  it("INVARIANT: grids are scoped per-user", () => {
    call("grid_save", ctxA, { name: "Secret", cells: [{ slot: 0, material: "ore", quantity: 1 }] });
    assert.equal(call("grid_list", ctxB).result.count, 0);
  });
});

// ── Recipe discovery / experimentation ──────────────────────────────

describe("crafting — discovery", () => {
  it("discovery_combine records a new combination", () => {
    const r = call("discovery_combine", ctxA, {
      materials: [
        { material: "Water", quantity: 1 },
        { material: "Flour", quantity: 2 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.discovered, true);
    assert.ok(r.result.recipe.outline.suggestedName.includes("flour"));
  });

  it("discovery_combine requires at least 2 materials", () => {
    const r = call("discovery_combine", ctxA, { materials: [{ material: "Salt", quantity: 1 }] });
    assert.equal(r.ok, false);
  });

  it("INVARIANT: re-submitting the same set is idempotent (not re-discovered)", () => {
    const set = { materials: [{ material: "iron", quantity: 1 }, { material: "coal", quantity: 1 }] };
    const first = call("discovery_combine", ctxA, set);
    assert.equal(first.result.discovered, true);
    const second = call("discovery_combine", ctxA, set);
    assert.equal(second.result.discovered, false);
    assert.equal(second.result.recipe.attempts, 2);
  });

  it("discovery_list returns discovered combinations", () => {
    call("discovery_combine", ctxA, { materials: [{ material: "a", quantity: 1 }, { material: "b", quantity: 1 }] });
    const l = call("discovery_list", ctxA);
    assert.equal(l.result.count, 1);
  });
});

// ── Craft queue + batch crafting ────────────────────────────────────

describe("crafting — queue + batch", () => {
  it("queue_add enqueues a job", () => {
    const r = call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.quantity, 3);
    assert.equal(r.result.queueDepth, 1);
  });

  it("queue_add rejects a missing recipeName", () => {
    const r = call("queue_add", ctxA, { recipeId: "r1" });
    assert.equal(r.ok, false);
  });

  it("queue_list sums total units", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 2 });
    call("queue_add", ctxA, { recipeId: "r2", recipeName: "Stew", quantity: 4 });
    const l = call("queue_list", ctxA);
    assert.equal(l.result.pending, 2);
    assert.equal(l.result.totalUnits, 6);
  });

  it("queue_remove drops a job", () => {
    const a = call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 1 });
    const rm = call("queue_remove", ctxA, { id: a.result.job.id });
    assert.equal(rm.ok, true);
    assert.equal(call("queue_list", ctxA).result.pending, 0);
  });

  it("queue_craft_all processes every pending job and clears the queue", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 2 });
    call("queue_add", ctxA, { recipeId: "r2", recipeName: "Stew", quantity: 3 });
    const r = call("queue_craft_all", ctxA, { seed: 12345 });
    assert.equal(r.ok, true);
    assert.equal(r.result.jobsProcessed, 2);
    assert.equal(r.result.totalUnits, 5);
    assert.equal(call("queue_list", ctxA).result.pending, 0);
  });

  it("queue_craft_all rejects an empty queue", () => {
    const r = call("queue_craft_all", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("queue_craft_all is deterministic for a fixed seed", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 4 });
    const r1 = call("queue_craft_all", ctxA, { seed: 999 });
    globalThis._concordSTATE = { dtus: new Map() };
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 4 });
    const r2 = call("queue_craft_all", ctxA, { seed: 999 });
    assert.deepEqual(
      r1.result.crafted[0].units.map((u) => u.tier),
      r2.result.crafted[0].units.map((u) => u.tier),
    );
  });
});

// ── Craftable-now filter ────────────────────────────────────────────

describe("crafting — craftable now", () => {
  it("craftable_now flags recipes satisfied by inventory", () => {
    const r = call("craftable_now", ctxA, {
      recipes: [
        { id: "r1", title: "Bread", requirements: [{ material: "flour", quantity: 2 }] },
        { id: "r2", title: "Cake", requirements: [{ material: "flour", quantity: 5 }] },
      ],
      inventory: [{ item_name: "Flour", quantity: 3 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.craftableCount, 1);
    assert.equal(r.result.blockedCount, 1);
    const cake = r.result.recipes.find((x) => x.id === "r2");
    assert.equal(cake.missing[0].short, 2);
  });

  it("craftable_now treats a no-requirement recipe as craftable", () => {
    const r = call("craftable_now", ctxA, {
      recipes: [{ id: "r1", title: "Idea", requirements: [] }],
      inventory: [],
    });
    assert.equal(r.result.craftableCount, 1);
  });
});

// ── Quality / rarity tiers ──────────────────────────────────────────

describe("crafting — quality tiers", () => {
  it("quality_tiers returns the full ladder", () => {
    const r = call("quality_tiers", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.tiers.length, 5);
  });

  it("quality_roll returns a tier and is deterministic for a seed", () => {
    const r1 = call("quality_roll", ctxA, { seed: 42, skillLevel: 10 });
    const r2 = call("quality_roll", ctxA, { seed: 42, skillLevel: 10 });
    assert.equal(r1.result.tier, r2.result.tier);
    assert.ok(["crude", "standard", "fine", "exquisite", "masterwork"].includes(r1.result.tier));
  });

  it("quality_roll skill bias never produces a sub-crude tier", () => {
    const r = call("quality_roll", ctxA, { seed: 1, skillLevel: 0, focus: 0 });
    assert.ok(r.result.multiplier >= 0.7);
  });
});

// ── Material gathering integration ──────────────────────────────────

describe("crafting — gather plan", () => {
  it("gather_plan aggregates demand across recipes and subtracts inventory", () => {
    const r = call("gather_plan", ctxA, {
      recipes: [
        { id: "r1", title: "Bread", requirements: [{ material: "flour", quantity: 2 }] },
        { id: "r2", title: "Cake", requirements: [{ material: "flour", quantity: 3 }, { material: "egg", quantity: 2 }] },
      ],
      inventory: [{ item_name: "flour", quantity: 4 }],
      nodeHints: { flour: "mill", egg: "coop" },
    });
    assert.equal(r.ok, true);
    const flour = r.result.lines.find((l) => l.material === "flour");
    assert.equal(flour.need, 5);
    assert.equal(flour.stillNeed, 1);
    assert.equal(flour.nodeHint, "mill");
    assert.equal(r.result.fullySatisfied, false);
  });

  it("gather_plan rejects an empty recipe list", () => {
    const r = call("gather_plan", ctxA, { recipes: [] });
    assert.equal(r.ok, false);
  });
});

// ── Favorites + history ─────────────────────────────────────────────

describe("crafting — favorites + history", () => {
  it("favorite_toggle pins and unpins a recipe", () => {
    const on = call("favorite_toggle", ctxA, { recipeId: "r1", recipeName: "Bread" });
    assert.equal(on.result.favorited, true);
    const off = call("favorite_toggle", ctxA, { recipeId: "r1" });
    assert.equal(off.result.favorited, false);
  });

  it("favorite_list returns pinned recipes", () => {
    call("favorite_toggle", ctxA, { recipeId: "r1", recipeName: "Bread" });
    call("favorite_toggle", ctxA, { recipeId: "r2", recipeName: "Stew" });
    assert.equal(call("favorite_list", ctxA).result.count, 2);
  });

  it("history_list captures crafted units after a batch", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 3 });
    call("queue_craft_all", ctxA, { seed: 7 });
    const h = call("history_list", ctxA, {});
    assert.equal(h.result.count, 1);
    assert.equal(h.result.unitsCrafted, 3);
    assert.ok(Object.keys(h.result.tierDistribution).length >= 1);
  });

  it("history_clear wipes the log", () => {
    call("queue_add", ctxA, { recipeId: "r1", recipeName: "Bread", quantity: 1 });
    call("queue_craft_all", ctxA, { seed: 7 });
    const c = call("history_clear", ctxA);
    assert.equal(c.result.cleared, 1);
    assert.equal(call("history_list", ctxA, {}).result.count, 0);
  });

  it("INVARIANT: favorites + history are scoped per-user", () => {
    call("favorite_toggle", ctxA, { recipeId: "r1", recipeName: "Bread" });
    assert.equal(call("favorite_list", ctxB).result.count, 0);
  });
});
