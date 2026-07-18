/**
 * Migration 372 — widen economy_ledger type CHECK for staking, WITHOUT losing or
 * altering any existing row and without relaxing any other constraint.
 *
 * This guards the money source-of-truth table rebuild: adding STAKE_ESCROW/
 * STAKE_RETURN/STAKE_YIELD/STAKE_PENALTY must (a) preserve every pre-existing
 * ledger row byte-for-byte, (b) keep the amount>0 / net>0 / status / from-or-to
 * CHECKs and the unique ref_id-debit index intact, and (c) be idempotent.
 *
 * Run: node --test server/tests/economy/ledger-staking-types-migration.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as ledgerUp } from "../../migrations/002_economy_tables.js";
import { up as refIdUp } from "../../migrations/004_ledger_idempotency.js";
import { up as stakingTypesUp } from "../../migrations/372_ledger_staking_types.js";

function preMigrationDb() {
  const db = new Database(":memory:");
  ledgerUp(db);   // narrow 7-type CHECK
  refIdUp(db);    // + ref_id column & unique partial index
  return db;
}

function insert(db, row) {
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, metadata_json, ref_id)
    VALUES (@id, @type, @from_user_id, @to_user_id, @amount, @fee, @net, @status, @metadata_json, @ref_id)
  `).run({
    id: row.id, type: row.type, from_user_id: row.from ?? null, to_user_id: row.to ?? null,
    amount: row.amount, fee: row.fee ?? 0, net: row.net ?? row.amount,
    status: row.status ?? "complete", metadata_json: row.meta ?? "{}", ref_id: row.ref ?? null,
  });
}

describe("migration 372 — economy_ledger staking types", () => {
  it("STAKE_ESCROW is rejected BEFORE the migration (proves the real bug)", () => {
    const db = preMigrationDb();
    assert.throws(
      () => insert(db, { id: "x1", type: "STAKE_ESCROW", from: "u1", to: "staking_escrow", amount: 100 }),
      /CHECK constraint failed/,
    );
    db.close();
  });

  it("preserves every existing row exactly through the rebuild", () => {
    const db = preMigrationDb();
    const seed = [
      { id: "a", type: "TOKEN_PURCHASE", to: "u1", amount: 1000, fee: 14.6, net: 985.4, ref: "buy:1", meta: '{"role":"credit"}' },
      { id: "b", type: "TRANSFER", from: "u1", to: "u2", amount: 100, fee: 1.46, net: 98.54, ref: "t:1", meta: '{"role":"debit"}' },
      { id: "c", type: "ROYALTY_PAYOUT", from: "__PLATFORM__", to: "anc", amount: 25, net: 25 },
      { id: "d", type: "REVERSAL", from: "u2", to: "u1", amount: 50, net: 50, status: "reversed" },
    ];
    for (const r of seed) insert(db, r);
    const before = db.prepare("SELECT * FROM economy_ledger ORDER BY id").all();

    stakingTypesUp(db);

    const after = db.prepare("SELECT * FROM economy_ledger ORDER BY id").all();
    assert.deepEqual(after, before, "every row must survive the rebuild unchanged");
    assert.equal(after.length, 4);
    db.close();
  });

  it("admits the four STAKE_* types after the migration", () => {
    const db = preMigrationDb();
    stakingTypesUp(db);
    for (const t of ["STAKE_ESCROW", "STAKE_RETURN", "STAKE_YIELD", "STAKE_PENALTY"]) {
      assert.doesNotThrow(
        () => insert(db, { id: `s_${t}`, type: t, from: "a", to: "b", amount: 10 }),
        `${t} should be accepted`,
      );
    }
    // …and still admits the original types.
    assert.doesNotThrow(() => insert(db, { id: "keep", type: "MARKETPLACE_PURCHASE", from: "a", to: "b", amount: 5 }));
    db.close();
  });

  it("keeps the other CHECKs + the unique ref_id-debit index intact", () => {
    const db = preMigrationDb();
    stakingTypesUp(db);
    // amount>0 still enforced
    assert.throws(() => insert(db, { id: "z", type: "STAKE_YIELD", to: "u", amount: 0 }), /CHECK constraint failed/);
    // net>0 still enforced
    assert.throws(() => insert(db, { id: "z2", type: "STAKE_YIELD", to: "u", amount: 5, net: 0 }), /CHECK constraint failed/);
    // status domain still enforced
    assert.throws(() => insert(db, { id: "z3", type: "STAKE_YIELD", to: "u", amount: 5, status: "bogus" }), /CHECK constraint failed/);
    // unique partial index on (ref_id where role=debit) still enforced
    insert(db, { id: "d1", type: "TRANSFER", from: "a", to: "b", amount: 5, net: 5, ref: "dup", meta: '{"role":"debit"}' });
    assert.throws(
      () => insert(db, { id: "d2", type: "TRANSFER", from: "a", to: "c", amount: 5, net: 5, ref: "dup", meta: '{"role":"debit"}' }),
      /UNIQUE constraint failed/,
    );
    db.close();
  });

  it("is idempotent — re-running is a no-op that keeps rows", () => {
    const db = preMigrationDb();
    insert(db, { id: "keep1", type: "FEE", from: "__PLATFORM__", to: "u", amount: 3, net: 3 });
    stakingTypesUp(db);
    const mid = db.prepare("SELECT sql FROM sqlite_master WHERE name='economy_ledger'").get().sql;
    stakingTypesUp(db); // second run
    const after = db.prepare("SELECT sql FROM sqlite_master WHERE name='economy_ledger'").get().sql;
    assert.equal(after, mid, "schema unchanged on re-run");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_ledger").get().n, 1, "row preserved");
    db.close();
  });
});
