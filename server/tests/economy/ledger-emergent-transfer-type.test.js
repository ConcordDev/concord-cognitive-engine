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
  debitReserveAccount,
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

  it("creditOperatingWallet records a ledger row and is idempotent", () => {
    // Before 2026-07-25 this mutated operating_balance while writing NOTHING
    // to economy_ledger and ignoring refId entirely — no audit trail, and a
    // retry credited the emergent twice.
    createEmergentAccount(db, { emergentId: "e_credit", displayName: "Credit Probe", seedAmount: 0 });

    const first = creditOperatingWallet(db, {
      emergentId: "e_credit", amount: 200, source: "marketplace sale",
      refId: "credit_ref_1", requestId: "req_credit", ip: "198.51.100.9",
    });
    assert.equal(first.ok, true);
    assert.notEqual(first.idempotent, true, "the first credit must not report idempotent");

    const rows = db.prepare("SELECT type, request_id, ip FROM economy_ledger WHERE ref_id = 'credit_ref_1'").all();
    assert.equal(rows.length, 1, "exactly one ledger row for this credit");
    assert.equal(rows[0].type, "MARKETPLACE_PURCHASE", "a 'marketplace sale' maps to its real type");
    assert.equal(rows[0].request_id, "req_credit");
    assert.equal(rows[0].ip, "198.51.100.9");

    const balAfterFirst = getEmergentAccount(db, "e_credit").operatingBalance;
    assert.equal(balAfterFirst, 200);

    const retry = creditOperatingWallet(db, {
      emergentId: "e_credit", amount: 200, source: "marketplace sale", refId: "credit_ref_1",
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.idempotent, true, "a repeated refId must short-circuit");
    assert.equal(
      getEmergentAccount(db, "e_credit").operatingBalance,
      balAfterFirst,
      "a retried credit must not mint a second time",
    );
  });

  it("an unknown credit source falls back to ADJUSTMENT without losing the real source", () => {
    createEmergentAccount(db, { emergentId: "e_src", displayName: "Source Probe", seedAmount: 0 });
    creditOperatingWallet(db, {
      emergentId: "e_src", amount: 10, source: "grant_from_operator", refId: "src_ref_1",
    });
    const row = db.prepare(
      "SELECT type, metadata_json FROM economy_ledger WHERE ref_id = 'src_ref_1'",
    ).get();
    assert.equal(row.type, "ADJUSTMENT", "an unmapped source must not be dressed up as a sale");
    assert.equal(
      JSON.parse(row.metadata_json).source,
      "grant_from_operator",
      "the real source must survive in metadata so the conservative type loses no information",
    );
  });

  it("debitReserveAccount records a ledger row and is idempotent", () => {
    createEmergentAccount(db, { emergentId: "e_debit", displayName: "Debit Probe", seedAmount: 0 });
    creditOperatingWallet(db, { emergentId: "e_debit", amount: 300, source: "sale", refId: "debit_seed" });
    transferToReserve(db, { emergentId: "e_debit", amount: 200, refId: "debit_to_reserve" });

    const reserveBefore = getEmergentAccount(db, "e_debit").reserveBalance;
    assert.ok(reserveBefore > 0, "reserve must be funded for this test to mean anything");

    const spend = Math.min(50, reserveBefore);
    const r = debitReserveAccount(db, {
      emergentId: "e_debit", amount: spend, refId: "debit_ref_1", requestId: "req_debit", ip: "198.51.100.10",
    });
    assert.equal(r.ok, true);

    const row = db.prepare("SELECT type, request_id FROM economy_ledger WHERE ref_id = 'debit_ref_1'").get();
    assert.ok(row, "the debit must leave a ledger row");
    assert.equal(row.type, "MARKETPLACE_PURCHASE");
    assert.equal(row.request_id, "req_debit");

    const after = getEmergentAccount(db, "e_debit").reserveBalance;
    const retry = debitReserveAccount(db, { emergentId: "e_debit", amount: spend, refId: "debit_ref_1" });
    assert.equal(retry.idempotent, true);
    assert.equal(
      getEmergentAccount(db, "e_debit").reserveBalance,
      after,
      "a retried debit must not spend twice",
    );
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
