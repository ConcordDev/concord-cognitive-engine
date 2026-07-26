// economy/emergent-accounts.js
// Emergent Account Service: Sovereign AI economic participants.
// Each emergent has two accounts:
//   - Operating Wallet: receives marketplace earnings and royalty income
//   - Reserve Account: spending account for marketplace purchases
//
// CRITICAL: Emergent funds can NEVER leave the system as fiat.
// All emergent money permanently circulates within the Concord economy.

import { randomUUID } from "crypto";
import { recordTransactionBatch, generateTxId, checkRefIdProcessed } from "./ledger.js";
import { calculateFee, PLATFORM_ACCOUNT_ID } from "./fees.js";
import { economyAudit } from "./audit.js";

function uid(prefix = "ema") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Account ID prefixes for ledger tracking
const OPERATING_PREFIX = "emergent_op:";
const RESERVE_PREFIX = "emergent_res:";

/**
 * Create a new emergent account with operating and reserve wallets.
 * Optionally seeds the account with initial funds (cold start solution).
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.emergentId — unique emergent entity ID
 * @param {string} [opts.displayName] — human-readable name
 * @param {number} [opts.seedAmount=0] — DEPRECATED: emergents start at zero. They earn through creation.
 *   Seed amounts are rejected to prevent artificial economic activity.
 */
export function createEmergentAccount(db, { emergentId, displayName, seedAmount = 0 }) {
  // Emergents start at ZERO. They earn through creation, not handouts.
  // Seeding creates circular revenue that an auditor would flag as wash trading.
  if (seedAmount > 0) {
    return { ok: false, error: "emergent_seed_disabled", detail: "Emergents must earn CC through creation. Seed funding is not permitted." };
  }
  if (!emergentId) return { ok: false, error: "missing_emergent_id" };

  // Check if account already exists
  const existing = db.prepare(
    "SELECT id FROM emergent_accounts WHERE emergent_id = ?"
  ).get(emergentId);
  if (existing) return { ok: false, error: "emergent_account_exists" };

  const id = uid("ema");
  const now = nowISO();

  const doCreate = db.transaction(() => {
    db.prepare(`
      INSERT INTO emergent_accounts (id, emergent_id, display_name, operating_balance, reserve_balance, seed_amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, 'active', ?, ?)
    `).run(id, emergentId, displayName || null, seedAmount, seedAmount, now, now);

    // If seeded, record the mint in the ledger
    if (seedAmount > 0) {
      const entries = [{
        id: generateTxId(),
        type: "TOKEN_PURCHASE",
        from: null,
        to: operatingAccountId(emergentId),
        amount: seedAmount,
        fee: 0,
        net: seedAmount,
        status: "complete",
        refId: `emergent_seed:${emergentId}`,
        metadata: { role: "emergent_seed", emergentId, seedAmount },
      }];
      recordTransactionBatch(db, entries);
    }
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
    console.error("[economy] account_creation_failed:", err.message);
    return { ok: false, error: "account_creation_failed" };
  }
}

/**
 * Transfer funds from operating wallet → reserve account.
 * Subject to the 1.46% universal fee.
 * This is the ONLY way to move funds within an emergent's accounts.
 */
export function transferToReserve(db, { emergentId, amount, refId, requestId, ip }) {
  if (!emergentId) return { ok: false, error: "missing_emergent_id" };
  if (!amount || amount <= 0) return { ok: false, error: "invalid_amount" };

  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, entries: existing.entries };
  }

  const { fee, net } = calculateFee("EMERGENT_TRANSFER", amount);
  const batchId = generateTxId();

  const doTransfer = db.transaction(() => {
    const account = getEmergentAccountInternal(db, emergentId);
    if (!account) throw new Error("emergent_not_found");
    if (account.status !== "active") throw new Error("emergent_suspended");
    if (account.operating_balance < amount) {
      throw new Error(`insufficient_operating:${account.operating_balance}:${amount}`);
    }

    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }

    // Update balances
    const now = nowISO();
    db.prepare(`
      UPDATE emergent_accounts
      SET operating_balance = operating_balance - ?,
          reserve_balance = reserve_balance + ?,
          updated_at = ?
      WHERE emergent_id = ?
    `).run(amount, net, now, emergentId);

    // Record in ledger
    const entries = [
      {
        id: generateTxId(),
        type: "EMERGENT_TRANSFER",
        from: operatingAccountId(emergentId),
        to: reserveAccountId(emergentId),
        amount,
        fee,
        net,
        status: "complete",
        refId,
        metadata: { batchId, role: "debit", emergentId },
        requestId,
        ip,
      },
    ];

    // Fee to platform
    if (fee > 0) {
      entries.push({
        id: generateTxId(),
        type: "FEE",
        from: null,
        to: PLATFORM_ACCOUNT_ID,
        amount: fee,
        fee: 0,
        net: fee,
        status: "complete",
        refId,
        metadata: { batchId, role: "fee", sourceType: "EMERGENT_TRANSFER", emergentId },
        requestId,
        ip,
      });
    }

    return recordTransactionBatch(db, entries);
  });

  try {
    const results = doTransfer();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };
    return { ok: true, batchId, transactions: results, amount, fee, net, emergentId };
  } catch (err) {
    if (err.message?.startsWith("insufficient_operating:")) {
      const parts = err.message.split(":");
      return { ok: false, error: "insufficient_operating_balance", balance: Number(parts[1]), required: Number(parts[2]) };
    }
    if (err.message === "emergent_not_found") return { ok: false, error: "emergent_not_found" };
    if (err.message === "emergent_suspended") return { ok: false, error: "emergent_suspended" };
    console.error("[economy] transfer_failed:", err.message);
    return { ok: false, error: "transfer_failed" };
  }
}

/**
 * Map a credit's declared `source` onto a real economy_ledger type.
 *
 * creditOperatingWallet documents its inflows as "marketplace sale or
 * royalties", so those two map to their existing dedicated types. Anything
 * else falls back to ADJUSTMENT — a deliberately conservative label rather
 * than guessing a more specific one — and the caller's actual `source` string
 * is always preserved in the row's metadata, so the fallback loses no
 * information and never dresses an unknown movement up as a sale.
 */
function ledgerTypeForCreditSource(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("royalt")) return "ROYALTY_PAYOUT";
  if (s.includes("sale") || s.includes("marketplace") || s.includes("purchase")) return "MARKETPLACE_PURCHASE";
  return "ADJUSTMENT";
}

/**
 * Credit an emergent's operating wallet (from marketplace sale or royalties).
 *
 * Records a real ledger row. Before 2026-07-25 this mutated operating_balance
 * and total_earned while writing NOTHING to economy_ledger and silently
 * ignoring refId — so the movement had no audit trail and a retry
 * double-credited. Its sibling transferToReserve always did both; this brings
 * the two into line.
 */
export function creditOperatingWallet(db, { emergentId, amount, source, refId, metadata = {}, requestId, ip }) {
  if (!emergentId || !amount || amount <= 0) return { ok: false, error: "invalid_credit_params" };

  // Idempotency, mirroring transferToReserve: a refId already in the ledger
  // means this credit landed on a prior delivery. Without this, a retry
  // silently credited the emergent a second time.
  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, emergentId, amount, source, entries: existing.entries };
  }

  const batchId = generateTxId();

  const doCredit = db.transaction(() => {
    const account = getEmergentAccountInternal(db, emergentId);
    if (!account) throw new Error("emergent_not_found");

    // Re-check inside the transaction to close the race the pre-check leaves.
    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }

    const now = nowISO();
    db.prepare(`
      UPDATE emergent_accounts
      SET operating_balance = operating_balance + ?,
          total_earned = total_earned + ?,
          updated_at = ?
      WHERE emergent_id = ?
    `).run(amount, amount, now, emergentId);

    return recordTransactionBatch(db, [
      {
        id: generateTxId(),
        type: ledgerTypeForCreditSource(source),
        from: null, // external inflow (marketplace sale / royalty payout)
        to: operatingAccountId(emergentId),
        amount,
        fee: 0,
        net: amount,
        status: "complete",
        refId,
        // The true source is always recorded even when it doesn't map to a
        // dedicated ledger type — the row is never mislabelled to look tidier.
        metadata: { ...metadata, batchId, role: "credit", emergentId, source: source || null },
        requestId,
        ip,
      },
    ]);
  });

  try {
    const results = doCredit();
    if (results?.idempotent) return { ok: true, idempotent: true, emergentId, amount, source, entries: results.entries };
    return { ok: true, emergentId, amount, source, batchId, transactions: results };
  } catch (err) {
    console.error("[economy] credit_failed:", err.message);
    return { ok: false, error: "credit_failed" };
  }
}

/**
 * Debit an emergent's reserve account (for marketplace purchases).
 */
export function debitReserveAccount(db, { emergentId, amount, refId, metadata = {}, requestId, ip }) {
  if (!emergentId || !amount || amount <= 0) return { ok: false, error: "invalid_debit_params" };

  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, emergentId, amount, entries: existing.entries };
  }

  const batchId = generateTxId();

  const doDebit = db.transaction(() => {
    const account = getEmergentAccountInternal(db, emergentId);
    if (!account) throw new Error("emergent_not_found");
    if (account.reserve_balance < amount) {
      throw new Error(`insufficient_reserve:${account.reserve_balance}:${amount}`);
    }

    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }

    const now = nowISO();
    db.prepare(`
      UPDATE emergent_accounts
      SET reserve_balance = reserve_balance - ?,
          total_spent = total_spent + ?,
          updated_at = ?
      WHERE emergent_id = ?
    `).run(amount, amount, now, emergentId);

    return recordTransactionBatch(db, [
      {
        id: generateTxId(),
        type: "MARKETPLACE_PURCHASE", // reserve funds marketplace purchases (see the doc comment above)
        from: reserveAccountId(emergentId),
        to: null,
        amount,
        fee: 0,
        net: amount,
        status: "complete",
        refId,
        // role:'debit' opts this row into the unique partial index on
        // (ref_id) WHERE role='debit', so a duplicate refId is rejected by the
        // database itself, not only by the read-side check above.
        metadata: { ...metadata, batchId, role: "debit", emergentId },
        requestId,
        ip,
      },
    ]);
  });

  try {
    const results = doDebit();
    if (results?.idempotent) return { ok: true, idempotent: true, emergentId, amount, entries: results.entries };
    return { ok: true, emergentId, amount, batchId, transactions: results };
  } catch (err) {
    if (err.message?.startsWith("insufficient_reserve:")) {
      const parts = err.message.split(":");
      return { ok: false, error: "insufficient_reserve_balance", balance: Number(parts[1]), required: Number(parts[2]) };
    }
    console.error("[economy] debit_failed:", err.message);
    return { ok: false, error: "debit_failed" };
  }
}

/**
 * Get an emergent account's full state.
 */
export function getEmergentAccount(db, emergentId) {
  const account = getEmergentAccountInternal(db, emergentId);
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

/**
 * List all emergent accounts.
 */
export function listEmergentAccounts(db, { status = "active", limit = 50, offset = 0 } = {}) {
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

/**
 * Suspend an emergent account (freezes all transactions).
 */
export function suspendEmergentAccount(db, { emergentId, reason }) {
  const now = nowISO();
  const result = db.prepare(
    "UPDATE emergent_accounts SET status = 'suspended', updated_at = ? WHERE emergent_id = ? AND status = 'active'"
  ).run(now, emergentId);

  if (result.changes === 0) return { ok: false, error: "emergent_not_found_or_not_active" };
  return { ok: true, emergentId, status: "suspended", reason };
}

/**
 * Check if an account ID belongs to an emergent entity.
 */
export function isEmergentAccount(accountId) {
  return !!(accountId?.startsWith(OPERATING_PREFIX) || accountId?.startsWith(RESERVE_PREFIX));
}

/**
 * Validate that an emergent can NOT withdraw to fiat.
 * This function exists as a guard — it always returns false for emergents.
 */
export function canWithdrawToFiat(accountId) {
  if (isEmergentAccount(accountId)) return false;
  return true; // Non-emergent accounts can withdraw
}

// Internal helpers

function getEmergentAccountInternal(db, emergentId) {
  return db.prepare("SELECT * FROM emergent_accounts WHERE emergent_id = ?").get(emergentId) || null;
}

function operatingAccountId(emergentId) {
  return OPERATING_PREFIX + emergentId;
}

function reserveAccountId(emergentId) {
  return RESERVE_PREFIX + emergentId;
}

export { operatingAccountId, reserveAccountId, OPERATING_PREFIX, RESERVE_PREFIX };
