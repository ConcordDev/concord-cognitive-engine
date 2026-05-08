// tests/balances.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getBalance,
  hasSufficientBalance,
  getBalances,
  getPlatformBalance,
  getSystemBalanceSummary,
} from "../economy/balances.js";

// ---------------------------------------------------------------------------
// Mock database helper
// ---------------------------------------------------------------------------
function createMockDb(ledgerRows = []) {
  return {
    prepare(sql) {
      return {
        get(...params) {
          // Credit query
          if (sql.includes("to_user_id") && sql.includes("SUM") && sql.includes("net")) {
            const userId = params[0];
            let total = 0;
            for (const r of ledgerRows) {
              if (r.to_user_id === userId && r.status === "complete") {
                total += Math.round(r.net * 100);
              }
            }
            return { total_cents: total };
          }
          // Debit query
          if (sql.includes("from_user_id") && sql.includes("SUM") && sql.includes("amount")) {
            const userId = params[0];
            let total = 0;
            for (const r of ledgerRows) {
              if (r.from_user_id === userId && r.status === "complete") {
                total += Math.round(r.amount * 100);
              }
            }
            return { total_cents: total };
          }
          return null;
        },
        all() {
          // UNION DISTINCT accounts query for getSystemBalanceSummary
          if (sql.includes("DISTINCT") && sql.includes("UNION")) {
            const accountSet = new Set();
            for (const r of ledgerRows) {
              if (r.to_user_id != null) accountSet.add(r.to_user_id);
              if (r.from_user_id != null) accountSet.add(r.from_user_id);
            }
            return [...accountSet].map((id) => ({ account_id: id }));
          }
          return [];
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getBalance", () => {
  it("returns zero balance for a user with no ledger rows", () => {
    const db = createMockDb([]);
    const result = getBalance(db, "user1");
    assert.deepStrictEqual(result, { balance: 0, totalCredits: 0, totalDebits: 0 });
  });

  it("computes balance from credits only", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 50, amount: 50, status: "complete" },
    ]);
    const result = getBalance(db, "user1");
    assert.equal(result.balance, 50);
    assert.equal(result.totalCredits, 50);
    assert.equal(result.totalDebits, 0);
  });

  it("computes balance from debits only", () => {
    const db = createMockDb([
      { from_user_id: "user1", to_user_id: "user2", net: 20, amount: 25, status: "complete" },
    ]);
    const result = getBalance(db, "user1");
    assert.equal(result.balance, -25);
    assert.equal(result.totalCredits, 0);
    assert.equal(result.totalDebits, 25);
  });

  it("computes net balance from both credits and debits", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 100, amount: 100, status: "complete" },
      { from_user_id: "user1", to_user_id: "user2", net: 30, amount: 40, status: "complete" },
    ]);
    const result = getBalance(db, "user1");
    assert.equal(result.balance, 60);
    assert.equal(result.totalCredits, 100);
    assert.equal(result.totalDebits, 40);
  });

  it("ignores non-complete rows", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 100, amount: 100, status: "complete" },
      { to_user_id: "user1", from_user_id: null, net: 50, amount: 50, status: "pending" },
    ]);
    const result = getBalance(db, "user1");
    assert.equal(result.balance, 100);
  });

  it("handles null/undefined credits result (falsy total_cents)", () => {
    // When db returns null or 0 for total_cents, the || 0 fallback should fire
    const db = {
      prepare() {
        return {
          get() {
            return { total_cents: null };
          },
        };
      },
    };
    const result = getBalance(db, "user1");
    assert.equal(result.balance, 0);
  });

  it("handles undefined result from get (no row returned)", () => {
    const db = {
      prepare() {
        return {
          get() {
            return undefined;
          },
        };
      },
    };
    const result = getBalance(db, "user1");
    assert.equal(result.balance, 0);
    assert.equal(result.totalCredits, 0);
    assert.equal(result.totalDebits, 0);
  });
});

describe("hasSufficientBalance", () => {
  it("returns true when balance >= amount", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 100, amount: 100, status: "complete" },
    ]);
    assert.equal(hasSufficientBalance(db, "user1", 100), true);
    assert.equal(hasSufficientBalance(db, "user1", 50), true);
  });

  it("returns false when balance < amount", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 10, amount: 10, status: "complete" },
    ]);
    assert.equal(hasSufficientBalance(db, "user1", 50), false);
  });

  it("returns true for zero amount when balance is zero", () => {
    const db = createMockDb([]);
    assert.equal(hasSufficientBalance(db, "user1", 0), true);
  });
});

describe("getBalances", () => {
  it("returns balances for multiple users", () => {
    const db = createMockDb([
      { to_user_id: "user1", from_user_id: null, net: 100, amount: 100, status: "complete" },
      { to_user_id: "user2", from_user_id: null, net: 200, amount: 200, status: "complete" },
    ]);
    const result = getBalances(db, ["user1", "user2"]);
    assert.equal(result.user1.balance, 100);
    assert.equal(result.user2.balance, 200);
  });

  it("returns empty object for empty array", () => {
    const db = createMockDb([]);
    const result = getBalances(db, []);
    assert.deepStrictEqual(result, {});
  });
});

describe("getPlatformBalance", () => {
  it("returns the balance for the platform account", () => {
    const db = createMockDb([
      { to_user_id: "__PLATFORM__", from_user_id: null, net: 500, amount: 500, status: "complete" },
    ]);
    const result = getPlatformBalance(db, "__PLATFORM__");
    assert.equal(result.balance, 500);
  });
});

describe("getSystemBalanceSummary", () => {
  it("returns categorized balances for users, emergents, and platform accounts", () => {
    const db = createMockDb([
      // user account
      { to_user_id: "alice", from_user_id: null, net: 100, amount: 100, status: "complete" },
      // emergent operating account
      { to_user_id: "emergent_op:bot1", from_user_id: null, net: 50, amount: 50, status: "complete" },
      // emergent reserve account
      { to_user_id: "emergent_res:bot1", from_user_id: null, net: 30, amount: 30, status: "complete" },
      // platform account
      { to_user_id: "__PLATFORM__", from_user_id: null, net: 200, amount: 200, status: "complete" },
    ]);
    const result = getSystemBalanceSummary(db);
    assert.equal(result.users.count, 1);
    assert.equal(result.users.totalBalance, 100);
    assert.equal(result.emergents.count, 2);
    assert.equal(result.emergents.totalBalance, 80);
    assert.equal(result.platform.totalBalance, 200);
    assert.equal(result.total.circulatingBalance, 380);
  });

  it("skips accounts with zero or negative balance", () => {
    const db = createMockDb([
      { to_user_id: "alice", from_user_id: null, net: 100, amount: 100, status: "complete" },
      // bob has no credits → balance is 0
      { from_user_id: "bob", to_user_id: "carol", net: 10, amount: 10, status: "complete" },
    ]);
    const result = getSystemBalanceSummary(db);
    // alice: 100 credit - 0 debit = 100. bob: 0 credit - 10 debit = -10 (skipped). carol: 10 credit - 0 debit = 10.
    assert.equal(result.users.count, 2);
    assert.equal(result.users.totalBalance, 110);
  });

  it("skips null account_id entries", () => {
    const ledgerRows = [
      { to_user_id: "alice", from_user_id: null, net: 50, amount: 50, status: "complete" },
    ];
    // Override to inject a null account_id
    const db = {
      prepare(sql) {
        return {
          get(...params) {
            if (sql.includes("to_user_id") && sql.includes("SUM") && sql.includes("net")) {
              const userId = params[0];
              let total = 0;
              for (const r of ledgerRows) {
                if (r.to_user_id === userId && r.status === "complete")
                  {total += Math.round(r.net * 100);}
              }
              return { total_cents: total };
            }
            if (sql.includes("from_user_id") && sql.includes("SUM") && sql.includes("amount")) {
              const userId = params[0];
              let total = 0;
              for (const r of ledgerRows) {
                if (r.from_user_id === userId && r.status === "complete")
                  {total += Math.round(r.amount * 100);}
              }
              return { total_cents: total };
            }
            return null;
          },
          all() {
            // include a null account_id
            return [{ account_id: null }, { account_id: "alice" }];
          },
        };
      },
    };
    const result = getSystemBalanceSummary(db);
    assert.equal(result.users.count, 1);
    assert.equal(result.users.totalBalance, 50);
  });

  it("returns zeros when ledger is empty", () => {
    const db = createMockDb([]);
    const result = getSystemBalanceSummary(db);
    assert.equal(result.users.count, 0);
    assert.equal(result.users.totalBalance, 0);
    assert.equal(result.emergents.count, 0);
    assert.equal(result.emergents.totalBalance, 0);
    assert.equal(result.platform.totalBalance, 0);
    assert.equal(result.total.circulatingBalance, 0);
  });

  it("rounds floating point correctly", () => {
    const db = createMockDb([
      { to_user_id: "alice", from_user_id: null, net: 33.33, amount: 33.33, status: "complete" },
      { to_user_id: "bob", from_user_id: null, net: 66.67, amount: 66.67, status: "complete" },
    ]);
    const result = getSystemBalanceSummary(db);
    assert.equal(result.total.circulatingBalance, 100);
  });
});
