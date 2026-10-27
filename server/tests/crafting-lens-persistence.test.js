// server/tests/crafting-lens-persistence.test.js
//
// crafting.js keeps five per-user stores directly on STATE (craftingGrids,
// craftingQueue, craftingHistory, craftingDiscoveries, craftingFavorites). They
// were missing from LENS_STATE_KEYS, so a restart wiped them. Round-trip them
// through serializeLensState -> JSON -> hydrateLensState into a fresh STATE and
// read them back through the Crafting lens actions.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";
import registerCraftingActions from "../domains/crafting.js";

const KEYS = ["craftingGrids", "craftingQueue", "craftingHistory", "craftingDiscoveries", "craftingFavorites"];
const prevState = globalThis._concordSTATE;
after(() => { globalThis._concordSTATE = prevState; });

const actions = new Map();
registerCraftingActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
const run = (name, userId, params = {}) => actions.get(`crafting.${name}`)({ actor: { userId } }, null, params);

test("all five crafting stores are registered for snapshot persistence", () => {
  for (const k of KEYS) assert.ok(LENS_STATE_KEYS.includes(k), `${k} in LENS_STATE_KEYS`);
});

test("crafting grids, queue, history, discoveries and favorites survive serialize -> hydrate", () => {
  globalThis._concordSTATE = {};
  const ok = (r) => { assert.equal(r?.ok, true, JSON.stringify(r)); return r; };
  ok(run("grid_save", "u1", { name: "Iron sword", cells: [{ slot: 0, material: "iron", quantity: 2 }, { slot: 4, material: "wood" }] }));
  ok(run("discovery_combine", "u1", { materials: [{ material: "iron" }, { material: "coal" }] }));
  ok(run("queue_add", "u1", { recipeId: "r_sword", recipeName: "Sword" }));
  ok(run("queue_add", "u1", { recipeId: "r_shield", recipeName: "Shield" }));
  ok(run("queue_craft_all", "u1", { seed: 7 }));
  ok(run("queue_add", "u1", { recipeId: "r_bow", recipeName: "Bow" })); // stays pending
  ok(run("favorite_toggle", "u1", { recipeId: "r_sword", recipeName: "Sword" }));

  const live = globalThis._concordSTATE;
  for (const k of KEYS) assert.ok(live[k] instanceof Map && live[k].has("u1"), `${k} populated`);
  const before = Object.fromEntries(KEYS.map((k) => [k, structuredClone(live[k].get("u1"))]));
  assert.ok(before.craftingHistory.length >= 2);

  const blob = JSON.parse(JSON.stringify(serializeLensState(live)));
  for (const k of KEYS) assert.ok(blob[k], `${k} written to the snapshot`);

  // "Restart": brand-new STATE, hydrate from the persisted blob.
  const fresh = {};
  hydrateLensState(fresh, blob);
  globalThis._concordSTATE = fresh;
  for (const k of KEYS) {
    assert.ok(fresh[k] instanceof Map, `${k} is a Map again`);
    assert.deepEqual(fresh[k].get("u1"), before[k], `${k} round-trips`);
  }
  assert.ok(fresh.craftingDiscoveries.get("u1") instanceof Map);
  assert.ok(fresh.craftingFavorites.get("u1") instanceof Map);

  // Lazy bucket() must reuse the hydrated Maps, not replace them.
  assert.equal(ok(run("grid_list", "u1")).result.count, 1);
  assert.equal(ok(run("discovery_list", "u1")).result.count, before.craftingDiscoveries.size);
  assert.equal(ok(run("favorite_list", "u1")).result.count, 1);
  const q = ok(run("queue_list", "u1")).result;
  assert.ok(JSON.stringify(q).includes("r_bow"), "pending queue entry survives");
  const h = ok(run("history_list", "u1")).result;
  assert.ok(JSON.stringify(h).includes("Sword"), "craft history survives");
  assert.equal(globalThis._concordSTATE.craftingGrids, fresh.craftingGrids);
});
