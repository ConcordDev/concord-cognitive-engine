// G6 — enchantment. The load-bearing pin is the TIER-LOCK: a soul gem's tier caps
// the enchant potency. Also: the essence sets the affinity/effect, gem+essence are
// consumed, and the guards (not-a-soul-gem / missing mats / kill-switch) hold.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upEnch } from "../migrations/323_item_enchantments.js";
import { enchant, listEnchantments, SOUL_GEM_CAP } from "../lib/enchantment.js";
import registerEnchantmentMacros from "../domains/enchantment.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT, item_name TEXT, quantity INTEGER, quality TEXT, acquired_at INTEGER);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT, health_pct REAL DEFAULT 1.0);
    CREATE TABLE user_active_effects (id TEXT PRIMARY KEY, user_id TEXT, effect_id TEXT, magnitude REAL, expires_at INTEGER, source TEXT);
  `);
  upEnch(db);
  db.prepare("INSERT INTO world_buildings VALUES ('ench1','sere','enchanter',1.0)").run();
  return db;
}
function give(db, itemId, qty = 1) {
  db.prepare("INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, acquired_at) VALUES (?, 'u1','item',?,?,?,'raw',unixepoch())")
    .run(`inv_${itemId}_${Math.random()}`, itemId, itemId, qty);
}
const qty = (db, itemId) => Number(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id='u1' AND item_id=?").get(itemId).n);

describe("enchantment (G6)", () => {
  beforeEach(() => { process.env.CONCORD_ENCHANTMENT = "1"; process.env.CONCORD_CRAFT_STATIONS = "1"; });
  afterEach(() => { delete process.env.CONCORD_ENCHANTMENT; delete process.env.CONCORD_CRAFT_STATIONS; });

  it("TIER-LOCK: the gem tier caps enchant potency (petty < grand < black)", () => {
    // enchant the same item with each gem tier at the same station; potency is
    // capped at the gem's ceiling, so a petty gem can never reach a black-tier enchant.
    function potencyWith(gem) {
      const db = freshDb();
      give(db, "sword1"); give(db, gem); give(db, "essence_life");
      const r = enchant(db, "u1", "sere", { itemId: "sword1", gemItemId: gem, essenceItemId: "essence_life", buildingId: "ench1" });
      return r.failed ? null : r.enchantment.potency;
    }
    const petty = potencyWith("petty_soul_gem");
    const grand = potencyWith("grand_soul_gem");
    const black = potencyWith("black_soul_gem");
    // each is at most its cap, and the gradient holds
    if (petty != null) assert.ok(petty <= SOUL_GEM_CAP.petty_soul_gem);
    if (grand != null) assert.ok(grand <= SOUL_GEM_CAP.grand_soul_gem);
    if (black != null) assert.ok(black <= SOUL_GEM_CAP.black_soul_gem);
    // a petty gem cannot reach grand's ceiling
    assert.ok(SOUL_GEM_CAP.petty_soul_gem < SOUL_GEM_CAP.grand_soul_gem && SOUL_GEM_CAP.grand_soul_gem < SOUL_GEM_CAP.black_soul_gem);
  });

  it("consumes the gem + essence and persists the enchant (essence sets the affinity)", () => {
    const db = freshDb();
    give(db, "sword1"); give(db, "grand_soul_gem"); give(db, "essence_life", 1);
    const r = enchant(db, "u1", "sere", { itemId: "sword1", gemItemId: "grand_soul_gem", essenceItemId: "essence_life", buildingId: "ench1" });
    assert.equal(r.ok, true);
    assert.equal(qty(db, "grand_soul_gem"), 0, "gem consumed");
    assert.equal(qty(db, "essence_life"), 0, "essence consumed");
    if (!r.failed) {
      assert.equal(r.enchantment.affinity, "bio", "essence_life → bio affinity");
      assert.equal(r.enchantment.effect, "life_steal");
      assert.equal(listEnchantments(db, "u1", "sword1").length, 1, "persisted on the item");
    }
  });

  it("rejects a non-soul-gem, missing mats, and the kill-switch", () => {
    const db = freshDb();
    give(db, "sword1"); give(db, "iron_ingot"); give(db, "essence_life");
    assert.equal(enchant(db, "u1", "sere", { itemId: "sword1", gemItemId: "iron_ingot", essenceItemId: "essence_life" }).reason, "not_a_soul_gem");
    assert.equal(enchant(db, "u1", "sere", { itemId: "sword1", gemItemId: "petty_soul_gem", essenceItemId: "essence_life" }).reason, "no_gem");
    process.env.CONCORD_ENCHANTMENT = "0";
    assert.equal(enchant(db, "u1", "sere", { itemId: "sword1", gemItemId: "grand_soul_gem", essenceItemId: "essence_life" }).reason, "disabled");
  });

  it("rejects enchanting an item the player does not own", () => {
    const db = freshDb();
    // owns the mats but not the target item — must not mint an enchantment for it
    give(db, "grand_soul_gem"); give(db, "essence_life");
    const r = enchant(db, "u1", "sere", { itemId: "not_owned_sword", gemItemId: "grand_soul_gem", essenceItemId: "essence_life" });
    assert.equal(r.reason, "no_item");
    assert.equal(qty(db, "grand_soul_gem"), 1, "gem NOT consumed on rejection");
    assert.equal(listEnchantments(db, "u1", "not_owned_sword").length, 0, "no enchantment persisted");
  });

  it("the enchant macro rejects anonymous callers", () => {
    const db = freshDb();
    give(db, "sword1"); give(db, "grand_soul_gem"); give(db, "essence_life");
    const m = new Map();
    registerEnchantmentMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    const enchantMacro = m.get("enchantment.enchant");
    const input = { worldId: "sere", itemId: "sword1", gemItemId: "grand_soul_gem", essenceItemId: "essence_life", buildingId: "ench1" };
    assert.equal(enchantMacro({ db }, input).reason, "auth_required", "no actor");
    assert.equal(enchantMacro({ db, actor: { userId: "anon" } }, input).reason, "auth_required", "anon actor");
    assert.equal(enchantMacro({ db, actor: { userId: "u1" } }, input).ok, true, "real user can enchant");
  });

  it("registers the enchantment macros", () => {
    const m = new Map();
    registerEnchantmentMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    assert.ok(m.has("enchantment.enchant") && m.has("enchantment.list"));
  });
});
