/**
 * T3.3 — the price the PLAYER pays now moves with regional scarcity. Until now
 * priceModulator (1.0 + scarcity×0.5, bounded [0.75,1.5]) only affected NPC↔NPC
 * trades; the npc-shop player buy route used a flat price. This pins the exact
 * function + price math the route uses, against a seeded regional_scarcity cache.
 *
 * Run: node --test tests/npc-shop-scarcity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up131 } from "../migrations/131_npc_economy.js";
import { priceModulator } from "../lib/npc-economy.js";

function setupDb() { const db = new Database(":memory:"); up131(db); return db; }
function setScarcity(db, world, resource, scarcity) {
  db.prepare(`INSERT INTO regional_scarcity (world_id, resource_kind, scarcity, computed_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(world_id, resource_kind) DO UPDATE SET scarcity = excluded.scarcity`).run(world, resource, scarcity);
}
// mirrors routes/npc-shop.js: unitPrice = max(1, round(base * mult))
const unitPrice = (base, mult) => Math.max(1, Math.round(base * mult));

describe("T3.3 — scarcity moves the player's shop price", () => {
  it("scarce resource → price up (bounded at 1.5×)", () => {
    const db = setupDb();
    setScarcity(db, "concordia-hub", "stone", 1.0); // max scarcity
    const m = priceModulator(db, "concordia-hub", "stone");
    assert.equal(m, 1.5); // 1.0 + 1.0*0.5
    assert.equal(unitPrice(2, m), 3); // shop stone base 2 → 3
  });

  it("abundant resource → price down (bounded at 0.75×)", () => {
    const db = setupDb();
    setScarcity(db, "concordia-hub", "wood", -0.5); // abundance
    const m = priceModulator(db, "concordia-hub", "wood");
    assert.equal(m, 0.75); // 1.0 + (-0.5)*0.5
    assert.equal(unitPrice(3, m), 2); // shop wood base 3 → 2 (rounded)
  });

  it("untracked / uncached resource → flat 1.0 (current behaviour preserved)", () => {
    const db = setupDb();
    // "clay" isn't a tracked resource and has no scarcity row
    assert.equal(priceModulator(db, "concordia-hub", "clay"), 1.0);
    assert.equal(unitPrice(2, 1.0), 2);
  });

  it("never drops below 1 spark even at full abundance on a cheap item", () => {
    const db = setupDb();
    setScarcity(db, "concordia-hub", "sand", -1.0);
    const m = priceModulator(db, "concordia-hub", "sand");
    assert.equal(unitPrice(1, m), 1); // base 1 * 0.75 = 0.75 → max(1, round) = 1
  });

  it("scarcity is world-scoped", () => {
    const db = setupDb();
    setScarcity(db, "tunya", "ore", 1.0);
    assert.equal(priceModulator(db, "tunya", "ore"), 1.5);
    assert.equal(priceModulator(db, "concordia-hub", "ore"), 1.0); // other world unaffected
  });
});
