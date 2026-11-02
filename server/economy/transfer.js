// economy/transfer.js
// Atomic transfer engine. All writes happen inside a single SQLite transaction.
// If any step fails, nothing commits — no partial state.

import { recordTransactionBatch, generateTxId, checkRefIdProcessed } from "./ledger.js";
import { calculateFee, PLATFORM_ACCOUNT_ID, isReservedDebitAccount } from "./fees.js";
import { validateAmount, validateBalance, validateUsers } from "./validators.js";

/**
 * Execute an atomic transfer between two users.
 *
 * Steps (all-or-nothing):
 *   1. Validate sender balance
 *   2. Compute fee
 *   3. Compute net amount
 *   4. Create debit record (from sender)
 *   5. Create credit record (to recipient)
 *   6. Create fee record (to platform)
 *   7. Commit all together
 *
 * @returns {{ ok: boolean, transactions: array, error?: string }}
 */
export function executeTransfer(db, { from, to, amount, type = "TRANSFER", metadata = {}, refId, requestId, ip }) {
  // Idempotency: if refId provided, check if already processed
  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, entries: existing.entries };
  }

  // 1. Validate (non-balance checks outside transaction for fast-fail)
  const amountCheck = validateAmount(amount);
  if (!amountCheck.ok) return amountCheck;
  const userCheck = validateUsers(from, to);
  if (!userCheck.ok) return userCheck;

  // Reserved-account guard (Gate 5 Act 2): platform system accounts are
  // never debited through this path. Legitimate system debits of those
  // accounts write via recordTransactionBatch directly (fee-split
  // distribution, chargeback payout, emergent reserve debits); __ESCROW__
  // releases ride this path by design and are not in the reserved set.
  if (isReservedDebitAccount(from)) return { ok: false, error: "reserved_account_debit" };

  // 2-3. Compute fee and net
  const { fee, net } = calculateFee(type, amount);

  // 4-7. Atomic commit: balance check + debit + credit + fee
  const batchId = generateTxId();

  // Execute atomically (balance validated INSIDE transaction to prevent races)
  const doTransfer = db.transaction(() => {
    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }

    // Balance check inside transaction for atomicity
    const balanceCheck = validateBalance(db, from, amount);
    if (!balanceCheck.ok) throw new Error(`insufficient_balance:${balanceCheck.balance}:${balanceCheck.required}`);

    const entries = [];

    // Debit: sender loses the full amount
    entries.push({
      id: generateTxId(),
      type,
      from,
      to,
      amount,
      fee,
      net,
      status: "complete",
      refId,
      metadata: { ...metadata, batchId, role: "debit" },
      requestId,
      ip,
    });

    // Credit: recipient gets the net amount
    entries.push({
      id: generateTxId(),
      type,
      from: null,
      to,
      amount: net,
      fee: 0,
      net,
      status: "complete",
      refId,
      metadata: { ...metadata, batchId, role: "credit" },
      requestId,
      ip,
    });

    // Fee: platform gets the fee (if > 0)
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
        metadata: { ...metadata, batchId, role: "fee", sourceType: type },
        requestId,
        ip,
      });
    }

    return recordTransactionBatch(db, entries);
  });

  try {
    const results = doTransfer();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };
    return {
      ok: true,
      batchId,
      transactions: results,
      amount,
      fee,
      net,
      from,
      to,
    };
  } catch (err) {
    if (err.message?.startsWith('insufficient_balance:')) {
      const parts = err.message.split(':');
      return { ok: false, error: "insufficient_balance", balance: Number(parts[1]), required: Number(parts[2]) };
    }
    if (err.message?.includes('UNIQUE constraint') && refId) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] transaction_failed:", err.message);
    return { ok: false, error: "transaction_failed" };
  }
}

/**
 * Execute a token purchase (external money → tokens).
 * No sender — tokens are minted to the buyer, with a fee to platform.
 */
export function executePurchase(db, { userId, amount, metadata = {}, refId, requestId, ip }) {
  // Idempotency: if refId provided, check if already processed
  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, entries: existing.entries };
  }

  const amountCheck = validateAmount(amount);
  if (!amountCheck.ok) return amountCheck;

  if (!userId) return { ok: false, error: "missing_user_id" };

  const { fee, net } = calculateFee("TOKEN_PURCHASE", amount);
  const batchId = generateTxId();

  const entries = [
    // Credit: buyer gets net tokens
    {
      id: generateTxId(),
      type: "TOKEN_PURCHASE",
      from: null,
      to: userId,
      amount: net,
      fee: 0,
      net,
      status: "complete",
      refId,
      metadata: { ...metadata, batchId, role: "credit", grossAmount: amount },
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
      metadata: { ...metadata, batchId, role: "fee", sourceType: "TOKEN_PURCHASE" },
      requestId,
      ip,
    });
  }

  const doPurchase = db.transaction(() => {
    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }
    return recordTransactionBatch(db, entries);
  });

  try {
    const results = doPurchase();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };
    return { ok: true, batchId, transactions: results, amount, fee, net };
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint') && refId) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] purchase_failed:", err.message);
    return { ok: false, error: "purchase_failed" };
  }
}

/**
 * Execute a marketplace purchase: buyer pays seller, platform takes fee.
 */
export function executeMarketplacePurchase(db, { buyerId, sellerId, amount, listingId, metadata = {}, refId, requestId, ip }) {
  // Idempotency: if refId provided, check if already processed
  if (refId) {
    const existing = checkRefIdProcessed(db, refId);
    if (existing.exists) return { ok: true, idempotent: true, entries: existing.entries };
  }

  // Validate amount (fast-fail outside transaction)
  const amtCheck = validateAmount(amount);
  if (!amtCheck.ok) return amtCheck;
  if (!buyerId) return { ok: false, error: "missing_buyer_id" };

  const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", amount);
  const batchId = generateTxId();

  // Balance validated INSIDE transaction to prevent concurrent overspend
  const doMarketplace = db.transaction(() => {
    if (refId) {
      const dupe = checkRefIdProcessed(db, refId);
      if (dupe.exists) return { idempotent: true, entries: dupe.entries };
    }

    // Atomic balance check — prevents race condition
    const balCheck = validateBalance(db, buyerId, amount);
    if (!balCheck.ok) throw new Error(`insufficient_balance:${balCheck.balance}:${balCheck.required}`);

    const entries = [
      // Debit: buyer pays full amount
      {
        id: generateTxId(),
        type: "MARKETPLACE_PURCHASE",
        from: buyerId,
        to: sellerId,
        amount,
        fee,
        net,
        status: "complete",
        refId,
        metadata: { ...metadata, batchId, listingId, role: "debit" },
        requestId,
        ip,
      },
      // Credit: seller gets net
      {
        id: generateTxId(),
        type: "MARKETPLACE_PURCHASE",
        from: null,
        to: sellerId,
        amount: net,
        fee: 0,
        net,
        status: "complete",
        refId,
        metadata: { ...metadata, batchId, listingId, role: "credit" },
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
        metadata: { ...metadata, batchId, listingId, role: "fee", sourceType: "MARKETPLACE_PURCHASE" },
        requestId,
        ip,
      });
    }

    return recordTransactionBatch(db, entries);
  });

  try {
    const results = doMarketplace();
    if (results.idempotent) return { ok: true, idempotent: true, entries: results.entries };
    return { ok: true, batchId, transactions: results, amount, fee, net, buyerId, sellerId, listingId };
  } catch (err) {
    if (err.message?.startsWith('insufficient_balance:')) {
      const parts = err.message.split(':');
      return { ok: false, error: "insufficient_balance", balance: Number(parts[1]), required: Number(parts[2]) };
    }
    if (err.message?.includes('UNIQUE constraint') && refId) {
      return { ok: true, idempotent: true };
    }
    console.error("[economy] marketplace_purchase_failed:", err.message);
    return { ok: false, error: "marketplace_purchase_failed" };
  }
}

/**
 * Create a reversal for a transaction. Never deletes — always adds counter-entry.
 */
export function executeReversal(db, { originalTxId, reason, requestId, ip }) {
  const original = db.prepare("SELECT * FROM economy_ledger WHERE id = ?").get(originalTxId);
  if (!original) return { ok: false, error: "transaction_not_found" };
  if (original.status === "reversed") return { ok: false, error: "already_reversed" };

  const batchId = generateTxId();

  const doReversal = db.transaction(() => {
    // Mark original as reversed
    db.prepare("UPDATE economy_ledger SET status = 'reversed' WHERE id = ?").run(originalTxId);

    // Create reversal entry (swap from/to)
    const entries = [{
      id: generateTxId(),
      type: "REVERSAL",
      from: original.to_user_id,
      to: original.from_user_id,
      amount: original.net,
      fee: 0,
      net: original.net,
      status: "complete",
      metadata: { originalTxId, reason, batchId, role: "reversal" },
      requestId,
      ip,
    }];

    return recordTransactionBatch(db, entries);
  });

  try {
    const results = doReversal();
    return { ok: true, batchId, transactions: results, originalTxId };
  } catch (err) {
    console.error("[economy] reversal_failed:", err.message);
    return { ok: false, error: "reversal_failed" };
  }
}
