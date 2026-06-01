/**
 * Security regression test for playtest #L2 — SQL identifier injection + crash
 * via a user/LLM-authored skill's `resource_bar`.
 *
 * consumeResourceBar interpolates barType into an UPDATE SET clause (SQLite
 * does not parameterize identifiers). The whitelist must reject anything that
 * isn't a real deductible column — both the injection vector and the crash.
 *
 * Run: node --test server/tests/resource-bar-injection.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { consumeResourceBar, getOrInitPlayerBars } from "../lib/combat/damage-calculator.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_resource_bars (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT,
      hp REAL, max_hp REAL, mana REAL, max_mana REAL,
      stamina REAL, max_stamina REAL, bio_power REAL, max_bio_power REAL,
      perception REAL, max_perception REAL, last_regen_at INTEGER, updated_at INTEGER
    );
  `);
  return db;
}

describe("#L2 — resource_bar identifier injection guard", () => {
  let db;
  beforeEach(() => { db = setupDb(); });
  afterEach(() => db.close());

  it("deducts a valid bar", () => {
    const r = consumeResourceBar(db, "u1", "w1", "stamina", 10);
    assert.equal(r.ok, true);
    assert.equal(getOrInitPlayerBars(db, "u1", "w1").stamina, 90);
  });

  it("rejects an unknown bar instead of crashing with `no such column`", () => {
    // e.g. a skill DTU naming `health`/`stardust` — looks valid, column is `hp`
    const r = consumeResourceBar(db, "u1", "w1", "health", 10);
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid_resource_bar/);
  });

  it("rejects a SET-clause injection and writes NOTHING (no free-resource cheat)", () => {
    getOrInitPlayerBars(db, "u1", "w1"); // init at 100/100/…
    const evil = "mana = 99999, stamina";
    const r = consumeResourceBar(db, "u1", "w1", evil, 1);
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid_resource_bar/);
    // the injection must NOT have rewritten any column
    const bars = getOrInitPlayerBars(db, "u1", "w1");
    assert.equal(bars.mana, 100);
    assert.equal(bars.stamina, 100);
  });

  it("rejects every non-whitelisted identifier shape", () => {
    for (const bad of ["", "hp; DROP TABLE player_resource_bars", "max_hp", "updated_at", "1=1"]) {
      assert.equal(consumeResourceBar(db, "u1", "w1", bad, 1).ok, false, `should reject "${bad}"`);
    }
    // table still intact after the DROP attempt
    assert.ok(db.prepare("SELECT 1 FROM player_resource_bars LIMIT 1"));
  });
});
