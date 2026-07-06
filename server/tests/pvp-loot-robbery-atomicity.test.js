/**
 * Pinning test for pvp-loot.js's Sparks-transfer atomicity fixes
 * (verification-audit campaign, money-txn-hygiene finding).
 *
 * handleRobbery, handlePlayerDeath, handleNPCKilledPlayer, and
 * claimLootBag each did a Sparks balance UPDATE + sparks_ledger INSERT
 * (handleRobbery: two of each pair) as unguarded sequential writes. A
 * crash mid-sequence could destroy Sparks (debited from one side, never
 * credited to the other) or leave a balance change with no matching
 * ledger row.
 *
 * Run: node --test server/tests/pvp-loot-robbery-atomicity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { handleRobbery, handlePlayerDeath, handleNPCKilledPlayer } from "../lib/pvp-loot.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT, item_type TEXT, item_id TEXT,
      item_name TEXT, quantity INTEGER, quality TEXT
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, delta REAL, reason TEXT, world_id TEXT
    );
    CREATE TABLE death_loot_bags (
      id TEXT PRIMARY KEY, world_id TEXT, x REAL, y REAL, z REAL,
      owner_id TEXT, killer_id TEXT, sparks INTEGER, items_json TEXT,
      expires_at INTEGER, claimed_by TEXT, claimed_at INTEGER
    );
  `);
  return db;
}

function fund(db, userId, sparks) {
  db.prepare(`INSERT INTO users (id, sparks) VALUES (?, ?)`).run(userId, sparks);
}
function sparksOf(db, userId) {
  return db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(userId)?.sparks ?? 0;
}
function ledgerCount(db) {
  return db.prepare(`SELECT COUNT(*) AS c FROM sparks_ledger`).get().c;
}

function armRunFailureAtOccurrence(db, matchSql, occurrence) {
  const origPrepare = db.prepare.bind(db);
  let count = 0;
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (matchSql.test(sql)) {
      count += 1;
      const thisOccurrence = count;
      if (thisOccurrence === occurrence) {
        return {
          run: () => { throw new Error(`simulated_failure_at_occurrence_${occurrence}`); },
          get: (...args) => stmt.get(...args),
          all: (...args) => stmt.all(...args),
        };
      }
    }
    return stmt;
  };
}

describe("pvp-loot.js handleRobbery atomicity", () => {
  it("rolls back both balance updates when the second ledger INSERT fails", () => {
    const db = freshDb();
    fund(db, "victim1", 1000);
    fund(db, "robber1", 0);

    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 2);

    assert.throws(() => handleRobbery(db, { robberId: "robber1", victimId: "victim1", gameMode: "crime_world", worldId: "w1" }));

    assert.equal(sparksOf(db, "victim1"), 1000, "victim debit must be rolled back even though only the 2nd ledger insert failed");
    assert.equal(sparksOf(db, "robber1"), 0, "robber credit must be rolled back too");
    assert.equal(ledgerCount(db), 0);
  });

  it("control: robbery succeeds end-to-end with both balances and 2 ledger rows", () => {
    const db = freshDb();
    fund(db, "victim2", 1000);
    fund(db, "robber2", 0);

    const result = handleRobbery(db, { robberId: "robber2", victimId: "victim2", gameMode: "crime_world", worldId: "w1" });
    assert.equal(result.ok, true);
    assert.equal(result.sparksStolen, 200);
    assert.equal(sparksOf(db, "victim2"), 800);
    assert.equal(sparksOf(db, "robber2"), 200);
    assert.equal(ledgerCount(db), 2);
  });
});

describe("pvp-loot.js handlePlayerDeath atomicity", () => {
  it("rolls back the Sparks debit when the ledger INSERT fails", () => {
    const db = freshDb();
    fund(db, "victim3", 1000);

    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 1);

    assert.throws(() => handlePlayerDeath(db, { killedId: "victim3", killerId: "killer3", gameMode: "combat", worldId: "w1" }));
    assert.equal(sparksOf(db, "victim3"), 1000, "death Sparks debit must be rolled back");
    assert.equal(ledgerCount(db), 0);
  });

  it("control: succeeds end-to-end", () => {
    const db = freshDb();
    fund(db, "victim4", 1000);
    const result = handlePlayerDeath(db, { killedId: "victim4", killerId: "killer4", gameMode: "combat", worldId: "w1" });
    assert.equal(result.sparksDropped, 300);
    assert.equal(sparksOf(db, "victim4"), 700);
    assert.equal(ledgerCount(db), 1);
  });
});

describe("pvp-loot.js handleNPCKilledPlayer atomicity", () => {
  it("rolls back the Sparks debit when the ledger INSERT fails", () => {
    const db = freshDb();
    fund(db, "victim5", 1000);

    armRunFailureAtOccurrence(db, /INSERT INTO sparks_ledger/, 1);

    assert.throws(() => handleNPCKilledPlayer(db, { npcId: "npc1", playerId: "victim5", worldId: "w1" }));
    assert.equal(sparksOf(db, "victim5"), 1000);
    assert.equal(ledgerCount(db), 0);
  });
});
