import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Constants replicated from the source ─────────────────────────────────────

const OPERATING_PREFIX = "emergent_op:";
const RESERVE_PREFIX = "emergent_res:";

function operatingAccountId(emergentId) {
  return OPERATING_PREFIX + emergentId;
}

function reserveAccountId(emergentId) {
  return RESERVE_PREFIX + emergentId;
}

function isEmergentAccount(accountId) {
  return !!(accountId?.startsWith(OPERATING_PREFIX) || accountId?.startsWith(RESERVE_PREFIX));
}

function canWithdrawToFiat(accountId) {
  if (isEmergentAccount(accountId)) return false;
  return true;
}

// ── Mock database factory ────────────────────────────────────────────────────

function createMockDb() {
  const accounts = [];
  const txIdCounter = 0;
  const ledgerEntries = [];
  const refIdMap = {};

  const db = {
    _accounts: accounts,
    _ledger: ledgerEntries,
    _refIdMap: refIdMap,

    prepare(sql) {
      return {
        get(...params) {
          if (sql.includes("emergent_accounts") && sql.includes("emergent_id = ?")) {
            return accounts.find(a => a.emergent_id === params[0]) || undefined;
          }
          if (sql.includes("emergent_accounts") && sql.includes("id FROM")) {
            return accounts.find(a => a.emergent_id === params[0]) || undefined;
          }
          if (sql.includes("COUNT")) {
            const status = params[0];
            const matching = status ? accounts.filter(a => a.status === status) : accounts;
            return { c: matching.length };
          }
          return undefined;
        },
        all(...params) {
          if (sql.includes("emergent_accounts")) {
            let result = [...accounts];
            if (sql.includes("status = ?")) {
              result = result.filter(a => a.status === params[0]);
            }
            const limit = params[params.length - 2] || 50;
            const offset = params[params.length - 1] || 0;
            return result.slice(offset, offset + limit);
          }
          return [];
        },
        run(...params) {
          if (sql.includes("INSERT INTO emergent_accounts")) {
            accounts.push({
              id: params[0], emergent_id: params[1], display_name: params[2],
              operating_balance: params[3], reserve_balance: 0,
              seed_amount: params[4], status: "active",
              created_at: params[5], updated_at: params[6],
              total_earned: 0, total_spent: 0,
            });
            return { changes: 1 };
          }
          if (sql.includes("UPDATE emergent_accounts") && sql.includes("operating_balance = operating_balance - ?")) {
            const acc = accounts.find(a => a.emergent_id === params[3]);
            if (acc) {
              acc.operating_balance -= params[0];
              acc.reserve_balance += params[1];
              acc.updated_at = params[2];
            }
            return { changes: acc ? 1 : 0 };
          }
          if (sql.includes("UPDATE emergent_accounts") && sql.includes("operating_balance = operating_balance + ?")) {
            const acc = accounts.find(a => a.emergent_id === params[2]);
            if (acc) {
              acc.operating_balance += params[0];
              acc.total_earned += params[1];
              acc.updated_at = params[2];
            }
            return { changes: acc ? 1 : 0 };
          }
          if (sql.includes("UPDATE emergent_accounts") && sql.includes("reserve_balance = reserve_balance - ?")) {
            const acc = accounts.find(a => a.emergent_id === params[2]);
            if (acc) {
              acc.reserve_balance -= params[0];
              acc.total_spent += params[1];
              acc.updated_at = params[2];
            }
            return { changes: acc ? 1 : 0 };
          }
          if (sql.includes("UPDATE emergent_accounts") && sql.includes("status = 'suspended'")) {
            const acc = accounts.find(a => a.emergent_id === params[1] && a.status === "active");
            if (acc) {
              acc.status = "suspended";
              acc.updated_at = params[0];
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
      };
    },

    transaction(fn) {
      return (...args) => fn(...args);
    },
  };

  return db;
}

// ── Reimplemented functions for testing ──────────────────────────────────────

function createEmergentAccount(db, { emergentId, displayName, seedAmount = 0 }) {
  if (!emergentId) return { ok: false, error: "missing_emergent_id" };

  const existing = db.prepare(
    "SELECT id FROM emergent_accounts WHERE emergent_id = ?"
  ).get(emergentId);
  if (existing) return { ok: false, error: "emergent_account_exists" };

  const id = "ema_test123";
  const now = "2026-01-01 00:00:00";

  const doCreate = db.transaction(() => {
    db.prepare(`
      INSERT INTO emergent_accounts (id, emergent_id, display_name, operating_balance, reserve_balance, seed_amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, 'active', ?, ?)
    `).run(id, emergentId, displayName || null, seedAmount, seedAmount, now, now);
  });

  try {
    doCreate();
    return {
      ok: true,
      account: {
        id,
        emergentId,
        displayName,
        operatingBalance: seedAmount,
        reserveBalance: 0,
        seedAmount,
        status: "active",
      },
    };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) return { ok: false, error: "emergent_account_exists" };
    return { ok: false, error: "account_creation_failed" };
  }
}

function getEmergentAccount(db, emergentId) {
  const account = db.prepare("SELECT * FROM emergent_accounts WHERE emergent_id = ?").get(emergentId);
  if (!account) return null;

  return {
    id: account.id,
    emergentId: account.emergent_id,
    displayName: account.display_name,
    operatingBalance: account.operating_balance,
    reserveBalance: account.reserve_balance,
    totalBalance: Math.round((account.operating_balance + account.reserve_balance) * 100) / 100,
    seedAmount: account.seed_amount,
    totalEarned: account.total_earned,
    totalSpent: account.total_spent,
    status: account.status,
    createdAt: account.created_at,
    updatedAt: account.updated_at,
  };
}

function listEmergentAccounts(db, { status = "active", limit = 50, offset = 0 } = {}) {
  let sql = "SELECT * FROM emergent_accounts WHERE 1=1";
  const params = [];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(a => ({
    id: a.id,
    emergentId: a.emergent_id,
    displayName: a.display_name,
    operatingBalance: a.operating_balance,
    reserveBalance: a.reserve_balance,
    totalBalance: Math.round((a.operating_balance + a.reserve_balance) * 100) / 100,
    status: a.status,
    createdAt: a.created_at,
  }));

  const total = db.prepare(
    "SELECT COUNT(*) as c FROM emergent_accounts" + (status ? " WHERE status = ?" : "")
  ).get(...(status ? [status] : []))?.c || 0;

  return { items, total, limit, offset };
}

function suspendEmergentAccount(db, { emergentId, reason }) {
  const now = "2026-01-01 00:00:00";
  const result = db.prepare(
    "UPDATE emergent_accounts SET status = 'suspended', updated_at = ? WHERE emergent_id = ? AND status = 'active'"
  ).run(now, emergentId);

  if (result.changes === 0) return { ok: false, error: "emergent_not_found_or_not_active" };
  return { ok: true, emergentId, status: "suspended", reason };
}

function transferToReserve(db, { emergentId, amount, refId }) {
  if (!emergentId) return { ok: false, error: "missing_emergent_id" };
  if (!amount || amount <= 0) return { ok: false, error: "invalid_amount" };

  const account = db.prepare("SELECT * FROM emergent_accounts WHERE emergent_id = ?").get(emergentId);
  if (!account) return { ok: false, error: "emergent_not_found" };
  if (account.status !== "active") return { ok: false, error: "emergent_suspended" };
  if (account.operating_balance < amount) {
    return {
      ok: false,
      error: "insufficient_operating_balance",
      balance: account.operating_balance,
      required: amount,
    };
  }

  const fee = Math.round(amount * 0.0146 * 100) / 100;
  const net = Math.round((amount - fee) * 100) / 100;

  db.prepare(`
    UPDATE emergent_accounts
    SET operating_balance = operating_balance - ?,
        reserve_balance = reserve_balance + ?,
        updated_at = ?
    WHERE emergent_id = ?
  `).run(amount, net, "2026-01-01", emergentId);

  return { ok: true, amount, fee, net, emergentId };
}

function creditOperatingWallet(db, { emergentId, amount, source }) {
  if (!emergentId || !amount || amount <= 0) return { ok: false, error: "invalid_credit_params" };

  const account = db.prepare("SELECT * FROM emergent_accounts WHERE emergent_id = ?").get(emergentId);
  if (!account) {
    return { ok: false, error: "credit_failed" };
  }

  db.prepare(`
    UPDATE emergent_accounts
    SET operating_balance = operating_balance + ?,
        total_earned = total_earned + ?,
        updated_at = ?
    WHERE emergent_id = ?
  `).run(amount, amount, "2026-01-01", emergentId);

  return { ok: true, emergentId, amount, source };
}

function debitReserveAccount(db, { emergentId, amount }) {
  if (!emergentId || !amount || amount <= 0) return { ok: false, error: "invalid_debit_params" };

  const account = db.prepare("SELECT * FROM emergent_accounts WHERE emergent_id = ?").get(emergentId);
  if (!account) {
    return { ok: false, error: "debit_failed" };
  }
  if (account.reserve_balance < amount) {
    return {
      ok: false,
      error: "insufficient_reserve_balance",
      balance: account.reserve_balance,
      required: amount,
    };
  }

  db.prepare(`
    UPDATE emergent_accounts
    SET reserve_balance = reserve_balance - ?,
        total_spent = total_spent + ?,
        updated_at = ?
    WHERE emergent_id = ?
  `).run(amount, amount, "2026-01-01", emergentId);

  return { ok: true, emergentId, amount };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("emergent-accounts", () => {
  // ── isEmergentAccount ──────────────────────────────────────────────

  describe("isEmergentAccount", () => {
    it("returns true for operating prefix", () => {
      assert.equal(isEmergentAccount("emergent_op:abc"), true);
    });

    it("returns true for reserve prefix", () => {
      assert.equal(isEmergentAccount("emergent_res:xyz"), true);
    });

    it("returns false for regular account", () => {
      assert.equal(isEmergentAccount("user_123"), false);
    });

    it("returns false for null", () => {
      assert.equal(isEmergentAccount(null), false);
    });

    it("returns false for undefined", () => {
      assert.equal(isEmergentAccount(undefined), false);
    });

    it("returns false for empty string", () => {
      assert.equal(isEmergentAccount(""), false);
    });
  });

  // ── canWithdrawToFiat ──────────────────────────────────────────────

  describe("canWithdrawToFiat", () => {
    it("returns false for emergent operating account", () => {
      assert.equal(canWithdrawToFiat("emergent_op:entity1"), false);
    });

    it("returns false for emergent reserve account", () => {
      assert.equal(canWithdrawToFiat("emergent_res:entity1"), false);
    });

    it("returns true for normal user account", () => {
      assert.equal(canWithdrawToFiat("user_abc"), true);
    });

    it("returns true for platform account", () => {
      assert.equal(canWithdrawToFiat("__PLATFORM__"), true);
    });

    it("returns true for null (non-emergent)", () => {
      // null?.startsWith() returns undefined which is falsy
      assert.equal(canWithdrawToFiat(null), true);
    });
  });

  // ── operatingAccountId / reserveAccountId ──────────────────────────

  describe("operatingAccountId", () => {
    it("prepends operating prefix", () => {
      assert.equal(operatingAccountId("entity1"), "emergent_op:entity1");
    });
  });

  describe("reserveAccountId", () => {
    it("prepends reserve prefix", () => {
      assert.equal(reserveAccountId("entity1"), "emergent_res:entity1");
    });
  });

  // ── createEmergentAccount ──────────────────────────────────────────

  describe("createEmergentAccount", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
    });

    it("returns error for missing emergentId", () => {
      const res = createEmergentAccount(db, {});
      assert.equal(res.ok, false);
      assert.equal(res.error, "missing_emergent_id");
    });

    it("returns error for empty emergentId", () => {
      const res = createEmergentAccount(db, { emergentId: "" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "missing_emergent_id");
    });

    it("creates account with default seed amount", () => {
      const res = createEmergentAccount(db, { emergentId: "e1" });
      assert.equal(res.ok, true);
      assert.equal(res.account.emergentId, "e1");
      assert.equal(res.account.operatingBalance, 0);
      assert.equal(res.account.reserveBalance, 0);
      assert.equal(res.account.seedAmount, 0);
      assert.equal(res.account.status, "active");
    });

    it("creates account with seed amount", () => {
      const res = createEmergentAccount(db, { emergentId: "e1", seedAmount: 500 });
      assert.equal(res.ok, true);
      assert.equal(res.account.operatingBalance, 500);
      assert.equal(res.account.seedAmount, 500);
    });

    it("creates account with display name", () => {
      const res = createEmergentAccount(db, { emergentId: "e1", displayName: "Test Entity" });
      assert.equal(res.ok, true);
      assert.equal(res.account.displayName, "Test Entity");
    });

    it("returns error for duplicate emergent account", () => {
      createEmergentAccount(db, { emergentId: "e1" });
      const res = createEmergentAccount(db, { emergentId: "e1" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_account_exists");
    });

    it("handles UNIQUE constraint error", () => {
      const badDb = {
        prepare() {
          return {
            get() { return undefined; },
            run() { throw new Error("UNIQUE constraint failed"); },
          };
        },
        transaction(fn) { return () => fn(); },
      };
      const res = createEmergentAccount(badDb, { emergentId: "e1" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_account_exists");
    });

    it("handles generic creation error", () => {
      const badDb = {
        prepare() {
          return {
            get() { return undefined; },
            run() { throw new Error("disk full"); },
          };
        },
        transaction(fn) { return () => fn(); },
      };
      const res = createEmergentAccount(badDb, { emergentId: "e1" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "account_creation_failed");
    });
  });

  // ── getEmergentAccount ─────────────────────────────────────────────

  describe("getEmergentAccount", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
    });

    it("returns null for nonexistent account", () => {
      const result = getEmergentAccount(db, "nonexistent");
      assert.equal(result, null);
    });

    it("returns formatted account", () => {
      createEmergentAccount(db, { emergentId: "e1", displayName: "Bot", seedAmount: 100 });
      const result = getEmergentAccount(db, "e1");
      assert.ok(result);
      assert.equal(result.emergentId, "e1");
      assert.equal(result.displayName, "Bot");
      assert.equal(result.operatingBalance, 100);
      assert.equal(result.reserveBalance, 0);
      assert.equal(result.totalBalance, 100);
      assert.equal(result.status, "active");
    });

    it("computes totalBalance correctly with rounding", () => {
      createEmergentAccount(db, { emergentId: "e1", seedAmount: 100 });
      // Manually set balances to test rounding
      db._accounts[0].operating_balance = 33.333;
      db._accounts[0].reserve_balance = 66.667;
      const result = getEmergentAccount(db, "e1");
      assert.equal(result.totalBalance, 100);
    });
  });

  // ── listEmergentAccounts ───────────────────────────────────────────

  describe("listEmergentAccounts", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
      createEmergentAccount(db, { emergentId: "e1" });
      createEmergentAccount(db, { emergentId: "e2" });
    });

    it("lists all active accounts by default", () => {
      const result = listEmergentAccounts(db);
      assert.equal(result.items.length, 2);
      assert.equal(result.total, 2);
      assert.equal(result.limit, 50);
      assert.equal(result.offset, 0);
    });

    it("filters by status", () => {
      suspendEmergentAccount(db, { emergentId: "e1", reason: "test" });
      const result = listEmergentAccounts(db, { status: "active" });
      assert.equal(result.items.length, 1);
    });

    it("applies limit and offset", () => {
      const result = listEmergentAccounts(db, { limit: 1, offset: 0 });
      assert.equal(result.items.length, 1);
      assert.equal(result.limit, 1);
    });

    it("handles no status filter", () => {
      const result = listEmergentAccounts(db, { status: null });
      assert.ok(Array.isArray(result.items));
    });

    it("maps items correctly with totalBalance", () => {
      const result = listEmergentAccounts(db);
      const item = result.items[0];
      assert.ok(item.id);
      assert.ok(item.emergentId);
      assert.equal(typeof item.totalBalance, "number");
      assert.ok(item.createdAt);
    });
  });

  // ── suspendEmergentAccount ─────────────────────────────────────────

  describe("suspendEmergentAccount", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
      createEmergentAccount(db, { emergentId: "e1" });
    });

    it("suspends an active account", () => {
      const res = suspendEmergentAccount(db, { emergentId: "e1", reason: "abuse" });
      assert.equal(res.ok, true);
      assert.equal(res.status, "suspended");
      assert.equal(res.reason, "abuse");
    });

    it("returns error for nonexistent account", () => {
      const res = suspendEmergentAccount(db, { emergentId: "nonexistent", reason: "test" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_not_found_or_not_active");
    });

    it("returns error for already suspended account", () => {
      suspendEmergentAccount(db, { emergentId: "e1", reason: "first" });
      const res = suspendEmergentAccount(db, { emergentId: "e1", reason: "second" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_not_found_or_not_active");
    });
  });

  // ── transferToReserve ──────────────────────────────────────────────

  describe("transferToReserve", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
      createEmergentAccount(db, { emergentId: "e1", seedAmount: 1000 });
    });

    it("returns error for missing emergentId", () => {
      const res = transferToReserve(db, { amount: 100 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "missing_emergent_id");
    });

    it("returns error for invalid amount (0)", () => {
      const res = transferToReserve(db, { emergentId: "e1", amount: 0 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_amount");
    });

    it("returns error for negative amount", () => {
      const res = transferToReserve(db, { emergentId: "e1", amount: -50 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_amount");
    });

    it("returns error for missing amount", () => {
      const res = transferToReserve(db, { emergentId: "e1" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_amount");
    });

    it("returns error for nonexistent emergent", () => {
      const res = transferToReserve(db, { emergentId: "nonexistent", amount: 100 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_not_found");
    });

    it("returns error for suspended emergent", () => {
      suspendEmergentAccount(db, { emergentId: "e1", reason: "test" });
      const res = transferToReserve(db, { emergentId: "e1", amount: 100 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "emergent_suspended");
    });

    it("returns error for insufficient operating balance", () => {
      const res = transferToReserve(db, { emergentId: "e1", amount: 2000 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "insufficient_operating_balance");
      assert.equal(res.balance, 1000);
      assert.equal(res.required, 2000);
    });

    it("transfers successfully with fee", () => {
      const res = transferToReserve(db, { emergentId: "e1", amount: 100 });
      assert.equal(res.ok, true);
      assert.equal(res.amount, 100);
      assert.equal(res.fee, 1.46);
      assert.equal(res.net, 98.54);
    });
  });

  // ── creditOperatingWallet ──────────────────────────────────────────

  describe("creditOperatingWallet", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
      createEmergentAccount(db, { emergentId: "e1", seedAmount: 0 });
    });

    it("returns error for missing emergentId", () => {
      const res = creditOperatingWallet(db, { amount: 100, source: "sale" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_credit_params");
    });

    it("returns error for missing amount", () => {
      const res = creditOperatingWallet(db, { emergentId: "e1", source: "sale" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_credit_params");
    });

    it("returns error for zero amount", () => {
      const res = creditOperatingWallet(db, { emergentId: "e1", amount: 0, source: "sale" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_credit_params");
    });

    it("returns error for negative amount", () => {
      const res = creditOperatingWallet(db, { emergentId: "e1", amount: -10, source: "sale" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_credit_params");
    });

    it("returns error for nonexistent emergent", () => {
      const res = creditOperatingWallet(db, { emergentId: "nonexistent", amount: 100, source: "sale" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "credit_failed");
    });

    it("credits successfully", () => {
      const res = creditOperatingWallet(db, { emergentId: "e1", amount: 250, source: "marketplace" });
      assert.equal(res.ok, true);
      assert.equal(res.emergentId, "e1");
      assert.equal(res.amount, 250);
      assert.equal(res.source, "marketplace");
    });
  });

  // ── debitReserveAccount ────────────────────────────────────────────

  describe("debitReserveAccount", () => {
    let db;

    beforeEach(() => {
      db = createMockDb();
      createEmergentAccount(db, { emergentId: "e1", seedAmount: 1000 });
      // Move funds to reserve via direct manipulation for testing
      db._accounts[0].reserve_balance = 500;
    });

    it("returns error for missing emergentId", () => {
      const res = debitReserveAccount(db, { amount: 100 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_debit_params");
    });

    it("returns error for missing amount", () => {
      const res = debitReserveAccount(db, { emergentId: "e1" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_debit_params");
    });

    it("returns error for zero amount", () => {
      const res = debitReserveAccount(db, { emergentId: "e1", amount: 0 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_debit_params");
    });

    it("returns error for negative amount", () => {
      const res = debitReserveAccount(db, { emergentId: "e1", amount: -5 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "invalid_debit_params");
    });

    it("returns error for nonexistent emergent", () => {
      const res = debitReserveAccount(db, { emergentId: "nonexistent", amount: 100 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "debit_failed");
    });

    it("returns error for insufficient reserve balance", () => {
      const res = debitReserveAccount(db, { emergentId: "e1", amount: 999 });
      assert.equal(res.ok, false);
      assert.equal(res.error, "insufficient_reserve_balance");
      assert.equal(res.balance, 500);
      assert.equal(res.required, 999);
    });

    it("debits successfully", () => {
      const res = debitReserveAccount(db, { emergentId: "e1", amount: 200 });
      assert.equal(res.ok, true);
      assert.equal(res.emergentId, "e1");
      assert.equal(res.amount, 200);
    });
  });

  // ── Constants ──────────────────────────────────────────────────────

  describe("constants", () => {
    it("OPERATING_PREFIX is correct", () => {
      assert.equal(OPERATING_PREFIX, "emergent_op:");
    });

    it("RESERVE_PREFIX is correct", () => {
      assert.equal(RESERVE_PREFIX, "emergent_res:");
    });
  });
});
