// server/tests/gear-durability.test.js
//
// Contract tests for the gear DURABILITY + REPAIR engine
// (server/lib/gear-durability.js). Death-tied decay, broken-at-0,
// repair-as-gold-sink, broken-gear-contributes-no-stats, legacy-NULL-untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  decayEquippedOnDeath,
  isBroken,
  isLowDurability,
  repairAll,
  repairCostFor,
  getInventoryDurability,
  makeWalletDebit,
  DURABILITY,
} from "../lib/gear-durability.js";
import { equippedAffixBonuses } from "../lib/item-affixes.js";
import { getEquipmentSetBonuses } from "../lib/item-sets.js";

// ── Test DB setup ────────────────────────────────────────────────────────────
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits INTEGER DEFAULT 0);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type TEXT,
      item_id TEXT,
      item_name TEXT,
      quantity INTEGER DEFAULT 1,
      quality REAL,
      gear_level INTEGER,
      affixes_json TEXT,
      set_id TEXT,
      acquired_at INTEGER DEFAULT (unixepoch()),
      current_durability INTEGER,
      max_durability INTEGER
    );
    CREATE TABLE player_equipment (
      user_id TEXT PRIMARY KEY,
      right_hand_id TEXT, left_hand_id TEXT,
      head_id TEXT, body_id TEXT, accessory_id TEXT,
      updated_at INTEGER
    );
  `);
  return db;
}

let _n = 0;
function addItem(db, userId, overrides = {}) {
  const id = overrides.id || `inv_${++_n}`;
  const row = {
    id, user_id: userId,
    item_type: "equipment", item_id: "sword", item_name: "Test Sword",
    quantity: 1, quality: 50, gear_level: 10,
    affixes_json: null, set_id: null,
    current_durability: 100, max_durability: 100,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO player_inventory
      (id, user_id, item_type, item_id, item_name, quantity, quality, gear_level,
       affixes_json, set_id, current_durability, max_durability)
    VALUES (@id,@user_id,@item_type,@item_id,@item_name,@quantity,@quality,@gear_level,
            @affixes_json,@set_id,@current_durability,@max_durability)
  `).run(row);
  return id;
}

function equip(db, userId, { right, head, body } = {}) {
  db.prepare(`INSERT OR REPLACE INTO player_equipment (user_id, right_hand_id, head_id, body_id) VALUES (?,?,?,?)`)
    .run(userId, right || null, head || null, body || null);
}

// ── isBroken / isLowDurability ───────────────────────────────────────────────
test("isBroken: 0/max is broken; NULL-max is never broken; >0 is not", () => {
  assert.equal(isBroken({ current_durability: 0, max_durability: 100 }), true);
  assert.equal(isBroken({ current_durability: 40, max_durability: 100 }), false);
  assert.equal(isBroken({ current_durability: 0, max_durability: null }), false);
  assert.equal(isBroken({ current_durability: null, max_durability: null }), false);
});

test("isLowDurability: at/below 20% but not broken", () => {
  assert.equal(isLowDurability({ current_durability: 20, max_durability: 100 }), true);
  assert.equal(isLowDurability({ current_durability: 21, max_durability: 100 }), false);
  assert.equal(isLowDurability({ current_durability: 0, max_durability: 100 }), false); // broken, not "low"
  assert.equal(isLowDurability({ current_durability: 5, max_durability: null }), false); // indestructible
});

// ── decayEquippedOnDeath ─────────────────────────────────────────────────────
test("decay-on-death reduces equipped durability by DEATH_DECAY", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  const sword = addItem(db, "u1", { current_durability: 100, max_durability: 100 });
  const helm  = addItem(db, "u1", { current_durability: 100, max_durability: 100, item_name: "Helm" });
  const bag   = addItem(db, "u1", { item_type: "material", current_durability: null, max_durability: null, item_name: "Ore" });
  equip(db, "u1", { right: sword, head: helm });

  const changes = decayEquippedOnDeath(db, "u1");
  assert.equal(changes.length, 2, "only equipped gear decays");
  for (const c of changes) {
    assert.equal(c.current, 100 - DURABILITY.DEATH_DECAY);
    assert.equal(c.broke, false);
  }
  // Unequipped material untouched (still NULL).
  const ore = db.prepare(`SELECT * FROM player_inventory WHERE id = ?`).get(bag);
  assert.equal(ore.max_durability, null);
  // Sword DB value actually decremented.
  const s = db.prepare(`SELECT current_durability FROM player_inventory WHERE id = ?`).get(sword);
  assert.equal(s.current_durability, 80);
});

test("decay floors at 0 and flags broke on the transition death", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  const sword = addItem(db, "u1", { current_durability: 10, max_durability: 100 });
  equip(db, "u1", { right: sword });

  const changes = decayEquippedOnDeath(db, "u1");
  assert.equal(changes[0].current, 0);
  assert.equal(changes[0].broke, true, "crossed >0 → 0 this death");
  assert.equal(changes[0].broken, true);

  // A second death keeps it at 0 and does NOT re-flag broke.
  const again = decayEquippedOnDeath(db, "u1");
  assert.equal(again[0].current, 0);
  assert.equal(again[0].broke, false);
  assert.equal(again[0].broken, true);
});

test("legacy equipped gear with NULL durability is lazily initialised then decays", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  const legacy = addItem(db, "u1", { current_durability: null, max_durability: null, item_type: "weapon" });
  equip(db, "u1", { right: legacy });

  const changes = decayEquippedOnDeath(db, "u1");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].max, DURABILITY.MAX_DEFAULT);
  assert.equal(changes[0].current, DURABILITY.MAX_DEFAULT - DURABILITY.DEATH_DECAY);
});

// ── repairAll ────────────────────────────────────────────────────────────────
test("repairAll costs CC, refills to max, and debits the wallet", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  const sword = addItem(db, "u1", { current_durability: 20, max_durability: 100, gear_level: 10 });
  equip(db, "u1", { right: sword });

  const expectedCost = repairCostFor({ current_durability: 20, max_durability: 100, gear_level: 10 });
  assert.ok(expectedCost > 0);

  const res = repairAll(db, "u1", { walletDebit: makeWalletDebit(db, "u1") });
  assert.equal(res.ok, true);
  assert.equal(res.cost, expectedCost);
  assert.equal(res.repaired.length, 1);

  const s = db.prepare(`SELECT current_durability FROM player_inventory WHERE id = ?`).get(sword);
  assert.equal(s.current_durability, 100, "refilled to max");

  const bal = db.prepare(`SELECT concordia_credits FROM users WHERE id='u1'`).get();
  assert.equal(bal.concordia_credits, 1000 - expectedCost, "CC debited");
});

test("repairAll rejects on insufficient funds and does NOT refill", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1)`).run();
  const sword = addItem(db, "u1", { current_durability: 0, max_durability: 100, gear_level: 50 });
  equip(db, "u1", { right: sword });

  const res = repairAll(db, "u1", { walletDebit: makeWalletDebit(db, "u1") });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "insufficient_funds");
  assert.ok(res.cost > 1);

  const s = db.prepare(`SELECT current_durability FROM player_inventory WHERE id = ?`).get(sword);
  assert.equal(s.current_durability, 0, "still broken — no free repair");
  const bal = db.prepare(`SELECT concordia_credits FROM users WHERE id='u1'`).get();
  assert.equal(bal.concordia_credits, 1, "wallet untouched");
});

test("repairAll with nothing damaged is a free no-op", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  addItem(db, "u1", { current_durability: 100, max_durability: 100 });
  const res = repairAll(db, "u1", { walletDebit: makeWalletDebit(db, "u1") });
  assert.equal(res.ok, true);
  assert.equal(res.cost, 0);
  assert.equal(res.repaired.length, 0);
});

// ── getInventoryDurability ───────────────────────────────────────────────────
test("getInventoryDurability lists only items with durability, with flags", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES ('u1', 1000)`).run();
  const broken = addItem(db, "u1", { current_durability: 0, max_durability: 100 });
  const low    = addItem(db, "u1", { current_durability: 15, max_durability: 100 });
  const full   = addItem(db, "u1", { current_durability: 100, max_durability: 100 });
  addItem(db, "u1", { current_durability: null, max_durability: null, item_type: "material" });
  equip(db, "u1", { right: broken });

  const list = getInventoryDurability(db, "u1");
  assert.equal(list.length, 3, "material with NULL max omitted");
  const byId = Object.fromEntries(list.map((i) => [i.itemId, i]));
  assert.equal(byId[broken].broken, true);
  assert.equal(byId[broken].equipped, true);
  assert.equal(byId[low].lowDurability, true);
  assert.equal(byId[full].broken, false);
  assert.equal(byId[full].lowDurability, false);
});

// ── broken gear contributes no stats ─────────────────────────────────────────
test("broken gear contributes no affix bonus; repaired gear does", () => {
  const affixes = JSON.stringify([{ id: "keen", stat: "enchantmentBonus", value: 10 }]);
  const intact  = { affixes_json: affixes, current_durability: 100, max_durability: 100 };
  const broken  = { affixes_json: affixes, current_durability: 0,   max_durability: 100 };

  assert.equal(equippedAffixBonuses({ rightHand: intact }).enchantmentBonus, 10);
  assert.equal(equippedAffixBonuses({ rightHand: broken }).enchantmentBonus, 0, "broken gear is dead weight");

  // NULL-max (indestructible) item still contributes.
  const nullMax = { affixes_json: affixes, current_durability: null, max_durability: null };
  assert.equal(equippedAffixBonuses({ rightHand: nullMax }).enchantmentBonus, 10);
});

test("broken gear stops counting toward set bonuses", () => {
  const p = (cur) => ({ set_id: "emberforged", current_durability: cur, max_durability: 100 });
  // Two intact emberforged pieces → 2-piece set bonus (resist 0.05).
  const both = getEquipmentSetBonuses({ rightHand: p(100), body: p(100) });
  assert.ok(both.resist >= 0.05);
  // One of them broken → set count drops below threshold → no bonus.
  const oneBroken = getEquipmentSetBonuses({ rightHand: p(100), body: p(0) });
  assert.equal(oneBroken.resist, 0, "broken piece doesn't count toward the set");
});

// ── repairCostFor determinism ────────────────────────────────────────────────
test("repairCostFor is 0 for full / NULL-max items and scales with damage", () => {
  assert.equal(repairCostFor({ current_durability: 100, max_durability: 100, gear_level: 10 }), 0);
  assert.equal(repairCostFor({ current_durability: 50, max_durability: null }), 0);
  const partial = repairCostFor({ current_durability: 50, max_durability: 100, gear_level: 10 });
  const full    = repairCostFor({ current_durability: 0,  max_durability: 100, gear_level: 10 });
  assert.ok(full > partial, "more missing durability costs more");
});
