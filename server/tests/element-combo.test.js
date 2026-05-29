/**
 * WS4(c) — combat element-combo tests.
 * Pure multiplier mapping + a real-DB chain: a complementary elemental follow-up
 * amplifies, a cancelling one dampens, same element resonates, and a broken
 * combo resets the element chain to neutral.
 * Run: node --test tests/element-combo.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { recordStrike, elementComboMultiplier } from "../lib/combat-polish.js";

describe("elementComboMultiplier (pure)", () => {
  it("resonates on same element, amplifies complements, dampens cancels", () => {
    assert.ok(elementComboMultiplier("fire", "fire") > 1);     // resonance
    assert.ok(elementComboMultiplier("fire", "wind") > 1);     // complementary → explosion
    assert.ok(elementComboMultiplier("fire", "water") < 1);    // cancelling
    assert.equal(elementComboMultiplier("fire", "bio"), 1);    // neutral
    assert.equal(elementComboMultiplier(null, "fire"), 1);     // no prior strike
    assert.equal(elementComboMultiplier("none", "fire"), 1);   // none is neutral
  });
});

function realDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE combat_actor_state (
      actor_kind TEXT, actor_id TEXT, world_id TEXT, profile_id TEXT,
      stance TEXT, posture TEXT, awareness TEXT, awareness_target TEXT,
      gas REAL, max_gas REAL, combo_count INTEGER, combo_last_at_ms INTEGER,
      rocked_until_ms INTEGER, last_element TEXT, grapple_target TEXT,
      mount_state TEXT, hyperarmor_until_ms INTEGER DEFAULT 0, updated_at INTEGER,
      PRIMARY KEY (actor_kind, actor_id)
    );
    CREATE TABLE combat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT, actor_kind TEXT,
      actor_id TEXT, kind TEXT, payload TEXT, created_at INTEGER
    );
  `);
  return db;
}

describe("recordStrike element chain (real DB)", () => {
  it("rewards a complementary chain and resets on a broken combo", () => {
    const db = realDb();
    const t0 = 1_000_000;
    // First strike (fire) — no prior element, neutral.
    const a = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: t0, element: "fire" });
    assert.equal(a.element_multiplier, 1);
    // Quick follow-up (wind) within the combo window → fire→wind amplifies.
    const b = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: t0 + 200, element: "wind" });
    assert.ok(b.element_multiplier > 1, "fire→wind should amplify");
    assert.ok(b.combo > a.combo);
    // last_element persisted
    assert.equal(db.prepare("SELECT last_element FROM combat_actor_state WHERE actor_id='u1'").get().last_element, "wind");
    // Long gap breaks the combo → element chain resets to neutral.
    const c = recordStrike(db, { actorKind: "player", actorId: "u1", nowMs: t0 + 60_000, element: "fire" });
    assert.equal(c.broken_previous_combo, true);
    assert.equal(c.element_multiplier, 1, "broken combo starts a neutral element chain");
  });

  it("dampens a cancelling chain", () => {
    const db = realDb();
    const t0 = 2_000_000;
    recordStrike(db, { actorKind: "player", actorId: "u2", nowMs: t0, element: "fire" });
    const b = recordStrike(db, { actorKind: "player", actorId: "u2", nowMs: t0 + 200, element: "water" });
    assert.ok(b.element_multiplier < 1, "fire→water should dampen");
  });
});
