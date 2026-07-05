/**
 * Pinning test for server.js's creditWallet/debitWallet compensating-
 * rollback fix (verification-audit campaign, money-txn-hygiene finding).
 *
 * The wallet balance (STATE.economic.wallets) is in-memory only, mutated
 * BEFORE the economy_ledger bridge write is even attempted — a
 * db.transaction() around the ledger INSERT literally cannot roll back a
 * plain JS object mutation that already happened. The real fix (Option B)
 * is a compensating action: on a genuine ledger-write failure (not the
 * already-handled ref_id-missing-column or UNIQUE-constraint soft cases),
 * revert the in-memory balance mutation so either both halves exist or
 * neither does.
 *
 * Run: node --test server/tests/economy/credit-debit-wallet-atomicity.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";

let __TEST__;

before(async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-wallet-atomicity-state-${process.pid}-${Date.now()}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-wallet-atomicity-${process.pid}-${Date.now()}.db`);
  }
  __TEST__ = (await import("../../server.js")).__TEST__;
});

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
          run: () => { throw new Error(`simulated_ledger_write_failure_${occurrence}`); },
          get: (...args) => stmt.get(...args),
          all: (...args) => stmt.all(...args),
        };
      }
    }
    return stmt;
  };
}

const LEDGER_INSERT_RE = /INSERT INTO economy_ledger/;

describe("server.js creditWallet/debitWallet compensating rollback", () => {
  it("creditWallet reverts the in-memory balance when the ledger bridge write fails", () => {
    const odId = `test_credit_${Date.now()}`;
    const before = __TEST__.getWallet(odId);
    const beforeBalance = before.balance;
    const beforeEarned = before.tokensEarned;

    armRunFailureAtOccurrence(__TEST__.STATE.db, LEDGER_INSERT_RE, 1);
    const wallet = __TEST__.creditWallet(odId, 100, "test credit");

    assert.equal(wallet.balance, beforeBalance, "balance must be reverted when the ledger bridge write fails");
    assert.equal(wallet.tokensEarned, beforeEarned, "tokensEarned must be reverted too");
  });

  it("debitWallet reverts the in-memory balance when the ledger bridge write fails", () => {
    const odId = `test_debit_${Date.now()}`;
    // Fund the wallet first (no failure armed for this call).
    __TEST__.creditWallet(odId, 500, "seed funds");
    const before = __TEST__.getWallet(odId);
    const beforeBalance = before.balance;
    const beforeSpent = before.tokensSpent;

    armRunFailureAtOccurrence(__TEST__.STATE.db, LEDGER_INSERT_RE, 1);
    const wallet = __TEST__.debitWallet(odId, 100, "test debit");

    assert.equal(wallet.balance, beforeBalance, "balance must be reverted when the ledger bridge write fails");
    assert.equal(wallet.tokensSpent, beforeSpent, "tokensSpent must be reverted too");
  });

  it("control: creditWallet/debitWallet succeed normally with no induced failure", () => {
    const odId = `test_control_${Date.now()}`;
    const c = __TEST__.creditWallet(odId, 200, "control credit");
    assert.equal(c.balance, 200);
    const d = __TEST__.debitWallet(odId, 50, "control debit");
    assert.equal(d.balance, 150);
  });
});
