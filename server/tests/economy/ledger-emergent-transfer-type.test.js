/**
 * Tier-2 contract test — economy_ledger accepts every type the code writes.
 *
 * Found 2026-07-25 by following a `unused-destructured-param` finding into
 * emergent-accounts.js. `transferToReserve` records its double-entry rows with
 * `type: "EMERGENT_TRANSFER"`, but migration 002's allowlist never contained
 * that value and migration 372 (which widened it for the STAKE_* types) did
 * not add it either. Result on any real migrated DB: the INSERT violates
 * `CHECK(type IN (...))`, the surrounding db.transaction() rolls back, and
 * `transferToReserve` returns { ok:false, error:"transfer_failed" } — every
 * time, via the live route economy/routes.js:1254.
 *
 * The same audit found `ADJUSTMENT` and `MAKE_GOOD` (economy/reconciliation.js
 * corrections) in the same state — treasury drift could be detected but the
 * corrective entry could never be written.
 *
 * Migration 008's comment asserted "EMERGENT_TRANSFER will work because we
 * recreate the table with expanded constraints" while doing nothing of the
 * sort, which is why this survived so long. That is exactly why this test
 * asserts against the REAL migrated schema and the REAL function rather than
 * trusting a comment.
 *
 * Run: node --test tests/economy/ledger-emergent-transfer-type.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  createEmergentAccount,
  creditOperatingWallet,
  transferToReserve,
  getEmergentAccount,
} from "../../economy/emergent-accounts.js";

let db;

before(async () => {
  db = new Database(":memory:");
  await runMigrations(db);
});

describe("economy_ledger type allowlist covers every type the code writes", () => {
  // The three types migration 395 added. Each is asserted individually so a
  // future narrowing names the exact value it broke.
  for (const type of ["EMERGENT_TRANSFER", "ADJUSTMENT", "MAKE_GOOD"]) {
    it(`accepts a ${type} row`, () => {
      assert.doesNotThrow(() => {
        db.prepare(
          `INSERT INTO economy_ledger
             (id, type, from_user_id, to_user_id, amount, fee, net, status)
           VALUES (?, ?, 'acct_a', 'acct_b', 10, 0, 10, 'complete')`,
        ).run(`probe_${type}`, type);
      }, `${type} must be an accepted economy_ledger type`);
    });
  }

  it("still REJECTS a type nobody writes (the widening did not become a free-for-all)", () => {
    // Negative direction. Without this, replacing the CHECK with no constraint
    // at all would satisfy every assertion above.
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO economy_ledger
             (id, type, from_user_id, to_user_id, amount, fee, net, status)
           VALUES ('probe_bogus', 'NOT_A_REAL_LEDGER_TYPE', 'a', 'b', 10, 0, 10, 'complete')`,
        ).run();
      },
      /CHECK constraint failed/,
      "the type CHECK must still constrain — an unknown type has to be rejected",
    );
  });
});

describe("transferToReserve works end-to-end on a real migrated DB", () => {
  it("moves operating balance into reserve and reports ok", () => {
    // Seed funding is disabled by policy ("emergents must earn CC"), so the
    // account is created unseeded and then credited.
    const created = createEmergentAccount(db, {
      emergentId: "e_xfer",
      displayName: "Transfer Probe",
      seedAmount: 0,
    });
    assert.equal(created.ok, true, "account creation should succeed");

    const credited = creditOperatingWallet(db, {
      emergentId: "e_xfer",
      amount: 500,
      source: "sale",
      refId: "xfer_seed_credit",
    });
    assert.equal(credited.ok, true, "operating credit should succeed");

    const before = getEmergentAccount(db, "e_xfer");
    assert.equal(before.operatingBalance, 500);
    assert.equal(before.reserveBalance, 0);

    const r = transferToReserve(db, {
      emergentId: "e_xfer",
      amount: 100,
      refId: "xfer_ref_1",
      requestId: "req_xfer",
      ip: "203.0.113.1",
    });

    // The regression: this returned { ok:false, error:"transfer_failed" }
    // for every call before migration 395.
    assert.equal(r.ok, true, `transferToReserve failed: ${JSON.stringify(r)}`);

    const after = getEmergentAccount(db, "e_xfer");
    assert.equal(after.operatingBalance, 400, "operating should be debited in full");
    assert.ok(
      after.reserveBalance > 0 && after.reserveBalance <= 100,
      `reserve should be credited net-of-fee, got ${after.reserveBalance}`,
    );
  });

  it("writes the ledger rows the transfer claims to write", () => {
    const rows = db.prepare(
      "SELECT type, request_id, ip FROM economy_ledger WHERE ref_id = 'xfer_ref_1'",
    ).all();
    assert.ok(rows.length >= 1, "the transfer must leave at least one ledger row");
    assert.ok(
      rows.some((x) => x.type === "EMERGENT_TRANSFER"),
      "an EMERGENT_TRANSFER row must be recorded",
    );
    // The audit fields the signature accepts must actually land.
    const xfer = rows.find((x) => x.type === "EMERGENT_TRANSFER");
    assert.equal(xfer.request_id, "req_xfer");
    assert.equal(xfer.ip, "203.0.113.1");
  });

  it("is idempotent on refId — a retry does not double-debit", () => {
    const before = getEmergentAccount(db, "e_xfer").operatingBalance;
    const again = transferToReserve(db, {
      emergentId: "e_xfer",
      amount: 100,
      refId: "xfer_ref_1",
      requestId: "req_xfer",
      ip: "203.0.113.1",
    });
    assert.equal(again.ok, true);
    assert.equal(again.idempotent, true, "a repeated refId must short-circuit");
    assert.equal(
      getEmergentAccount(db, "e_xfer").operatingBalance,
      before,
      "a retried transfer must not move money a second time",
    );
  });
});
