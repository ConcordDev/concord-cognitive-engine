/**
 * C1 / F4.2 — meta-progression applies to runs.
 *
 * roguelite_unlocks were purchased but hasUnlock had no caller — purchases were
 * inert. Now owned unlocks fold into a run-modifier bundle the run reads.
 *
 * Pins:
 *   - runMetaModifiers reflects owned unlocks' catalog effects
 *   - purchaseUnlock is catalog-priced (client cost ignored for known unlocks)
 *   - startRun returns the meta modifiers
 *   - an unowned unlock contributes nothing
 *
 * Run: node --test tests/integration/roguelite-meta-modifiers.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up245 } from "../../migrations/245_roguelite_runs.js";
import {
  runMetaModifiers, purchaseUnlock, startRun, META_UNLOCK_CATALOG, getBalance,
} from "../../lib/roguelite.js";

function freshDb(balance = 2000) {
  const db = new Database(":memory:");
  up245(db);
  db.prepare(`INSERT INTO roguelite_meta_currency (user_id, balance, lifetime) VALUES ('u1', ?, ?)`).run(balance, balance);
  return db;
}

describe("C1 — runMetaModifiers", () => {
  it("is empty with no unlocks; reflects owned ones", () => {
    const db = freshDb();
    const before = runMetaModifiers(db, "u1");
    assert.equal(before.startingHpBonus, 0);
    assert.equal(before.damageMult, 0);

    purchaseUnlock(db, "u1", "veteran_vigor");  // +25 hp
    purchaseUnlock(db, "u1", "sharp_start");    // +0.10 dmg
    const after = runMetaModifiers(db, "u1");
    assert.equal(after.startingHpBonus, 25);
    assert.equal(after.damageMult, 0.10);
    db.close();
  });
});

describe("C1 — purchase is catalog-priced", () => {
  it("uses the server cost, ignoring a client-supplied cost", () => {
    const db = freshDb(1000);
    // try to pay 1 for a 150-cost unlock → server charges 150
    const r = purchaseUnlock(db, "u1", "veteran_vigor", 1);
    assert.equal(r.ok, true);
    assert.equal(getBalance(db, "u1").balance, 1000 - META_UNLOCK_CATALOG.veteran_vigor.costCc);
    db.close();
  });
  it("rejects re-purchase + insufficient funds", () => {
    const db = freshDb(100); // not enough for 150
    assert.equal(purchaseUnlock(db, "u1", "veteran_vigor").error, "insufficient_funds");
    const rich = freshDb(2000);
    purchaseUnlock(rich, "u1", "extra_pick");
    assert.equal(purchaseUnlock(rich, "u1", "extra_pick").error, "already_unlocked");
    rich.close(); db.close();
  });
});

describe("C1 — startRun surfaces the modifiers", () => {
  it("a run started after a purchase carries the modifiers", () => {
    const db = freshDb();
    purchaseUnlock(db, "u1", "extra_pick"); // +1 draft pick
    const r = startRun(db, "u1", { worldId: "w1", regionId: "r1" });
    assert.equal(r.ok, true);
    assert.equal(r.modifiers.extraDraftPicks, 1);
    db.close();
  });
});
