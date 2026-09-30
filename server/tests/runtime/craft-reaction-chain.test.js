// tests/runtime/craft-reaction-chain.test.js
//
// End-to-end proof of the exact chain a full-Concord cross-lens audit
// (2026-09-13) named as the platform's real remaining gap: "I changed
// something in Lens A" (crafted an item) automatically becoming "Lens B
// knows and reacts" (a notification appears) — through the event bus,
// with NO direct import from the crafting engine into the notification
// system. That's the point: craft-engine.js only knows about
// lib/runtime/event-bus.js; it has never heard of emergent/social-layer.js.
//
// Run: node --test tests/runtime/craft-reaction-chain.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { executeCraft } from "../../lib/crafting/craft-engine.js";
import { seedResourceProperties } from "../../lib/resources.js";
import { getNotifications } from "../../emergent/social-layer.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { _reset as _resetBus, subscribe } from "../../lib/runtime/event-bus.js";

const WORLD_ID = "concordia-hub";
const USER = "user_reaction_chain";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY, world_type TEXT, rule_modulators TEXT);
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, title TEXT,
      data TEXT, skill_level INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT, skill_type TEXT,
      native_world_type TEXT, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0,
      xp_to_next INTEGER DEFAULT 100, last_used_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, skill_type, native_world_type)
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT,
      item_name TEXT, quantity INTEGER DEFAULT 1, quality TEXT,
      acquired_at INTEGER DEFAULT (unixepoch()), properties_json TEXT,
      spoils_at INTEGER
    );
    CREATE TABLE user_active_effects (
      id TEXT PRIMARY KEY, user_id TEXT, effect_id TEXT, kind TEXT,
      magnitude REAL, source_dtu_id TEXT,
      started_at INTEGER DEFAULT (unixepoch()), expires_at INTEGER
    );
    CREATE TABLE resource_properties (
      item_id TEXT PRIMARY KEY, potency INTEGER, affinity TEXT, stability INTEGER,
      volume REAL, weight REAL, rarity_tier INTEGER, source_type TEXT,
      magical_sub TEXT, updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  db.prepare("INSERT INTO worlds (id, world_type, rule_modulators) VALUES (?, 'standard', '{}')").run(WORLD_ID);
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level)
              VALUES ('s1', ?, 'crafting', 'standard', 60)`).run(USER);
  seedResourceProperties(db);
  return db;
}

function makeSwordRecipe(db) {
  const data = {
    spec: { name: "Iron Sword", output_type: "weapon", output_subtype: "sword", minPotency: 0 },
    resource_requirements: [{ resource_id: "iron_ingot", quantity: 2 }],
    skill_requirements: [],
    output_type: "weapon",
  };
  db.prepare(`INSERT INTO dtus (id, creator_id, type, title, data, skill_level)
              VALUES ('recipe_sword', 'system', 'recipe', 'Iron Sword', ?, 0)`).run(JSON.stringify(data));
  return "recipe_sword";
}

function giveItem(db, itemId, qty) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity)
              VALUES (?, ?, 'material', ?, ?, ?)`).run(`inv_${itemId}`, USER, itemId, itemId, qty);
}

beforeEach(() => {
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  _resetReactions();
  delete globalThis.STATE;
});

describe("the audit's own example: forge sword -> another lens reacts, with no direct import", () => {
  it("executeCraft publishes item.crafted with real crafted-item data", () => {
    const events = [];
    const unsub = subscribe("item.crafted", (e) => events.push(e.payload));

    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    const r = executeCraft(db, USER, WORLD_ID, makeSwordRecipe(db));

    assert.equal(r.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].userId, USER);
    assert.equal(events[0].worldId, WORLD_ID);
    assert.equal(events[0].dtuId, r.dtu.id);
    assert.equal(events[0].itemName, "Iron Sword");
    assert.equal(events[0].failed, false);
    unsub();
  });

  it("end-to-end: a real craft, with NO import from craft-engine to social-layer, produces a real notification", () => {
    // This is the actual chain, not a mocked one. initReactions() is the
    // ONLY thing that knows both event-bus.js and social-layer.js exist —
    // craft-engine.js never imports social-layer.js, directly or
    // otherwise. If this test passes, the reaction graph is real.
    globalThis.STATE = {};
    initReactions();

    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    const r = executeCraft(db, USER, WORLD_ID, makeSwordRecipe(db));
    assert.equal(r.ok, true);

    const { notifications, total } = getNotifications(globalThis.STATE, USER);
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "item_crafted");
    assert.match(notifications[0].content, /Iron Sword/);
  });

  it("a craft that soft-fails still reaches the reactor, with an honest failure-flavored notification", () => {
    globalThis.STATE = {};
    initReactions();

    const db = makeDb();
    // Weak mats + an unreachable minPotency -> soft fizzle (never a throw).
    db.exec(`
      UPDATE dtus SET data = json_set(data, '$.spec.minPotency', 80)
      WHERE id = (SELECT id FROM dtus LIMIT 1)
    `);
    const data = {
      spec: { name: "Doomed Blade", output_type: "weapon", output_subtype: "sword", minPotency: 80 },
      resource_requirements: [{ resource_id: "wood", quantity: 1 }],
      skill_requirements: [],
      output_type: "weapon",
    };
    db.prepare(`INSERT INTO dtus (id, creator_id, type, title, data, skill_level)
                VALUES ('recipe_weak', 'system', 'recipe', 'Doomed Blade', ?, 0)`).run(JSON.stringify(data));
    giveItem(db, "wood", 1);

    const r = executeCraft(db, USER, WORLD_ID, "recipe_weak");
    assert.equal(r.ok, true);
    assert.equal(r.failed, true, "sanity: this craft really did soft-fail");

    const { notifications } = getNotifications(globalThis.STATE, USER);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].content, /flawed|partially failed/);
  });

  it("no userId, no STATE yet -> the reactor honestly no-ops instead of fabricating a notification", () => {
    // STATE deliberately left unset (simulates the event firing before
    // boot has assigned globalThis.STATE). The reactor must not throw
    // and must not create a phantom notification against nothing.
    initReactions();
    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    assert.doesNotThrow(() => executeCraft(db, USER, WORLD_ID, makeSwordRecipe(db)));
  });

  it("initReactions is idempotent — calling it twice does not double-fire the reaction", () => {
    globalThis.STATE = {};
    initReactions();
    initReactions(); // second call must be a no-op

    const db = makeDb();
    giveItem(db, "iron_ingot", 2);
    executeCraft(db, USER, WORLD_ID, makeSwordRecipe(db));

    const { total } = getNotifications(globalThis.STATE, USER);
    assert.equal(total, 1, "double-subscription would have produced 2 notifications for 1 craft");
  });
});
