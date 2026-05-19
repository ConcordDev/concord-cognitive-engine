// server/lib/wallet/persistence.js
//
// Wallet lens Sprint A — durable CRUD on top of migration 243.
// NON-CUSTODIAL by design: credentials_ref stores Plaid public_token
// or wallet address; never private keys or secrets.
//
// Concord Coin balance is computed live from economy_ledger (existing
// substrate) and projected into wallet_balances_snapshot as a virtual
// account so it appears in unified-view queries alongside connected
// external accounts.

import { randomUUID } from "node:crypto";

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── Accounts ────────────────────────────────────────────────

export function linkAccount(db, ownerUserId, { nickname, kind, provider = null, providerAccountId = null, institution = null, accountMask = null, credentialsRef = null, currency = "USD", readonly = true }) {
  if (!db || !ownerUserId || !nickname || !kind) return { ok: false, reason: "missing_args" };
  const allowedKind = ["concord_coin","bank_checking","bank_savings","credit_card","debit_card","brokerage","crypto_wallet","crypto_exchange","stablecoin_account","digital_wallet","manual"];
  if (!allowedKind.includes(kind)) return { ok: false, reason: "invalid_kind" };
  const id = `wacc:${randomUUID()}`;
  // Concord-coin account is unique per user (one balance source)
  if (kind === "concord_coin") {
    const existing = db.prepare(`SELECT id FROM wallet_accounts WHERE owner_user_id = ? AND kind = 'concord_coin' AND removed_at IS NULL`).get(ownerUserId);
    if (existing) return { ok: true, id: existing.id, alreadyExists: true };
  }
  try {
    db.prepare(`
      INSERT INTO wallet_accounts (id, owner_user_id, nickname, kind, provider, provider_account_id, institution, account_mask, credentials_ref, currency, status, readonly, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, ownerUserId, String(nickname).slice(0, 120), kind,
      provider, providerAccountId, institution,
      accountMask ? String(accountMask).slice(0, 30) : null,
      credentialsRef, currency, readonly ? 1 : 0,
      _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getAccount(db, id, ownerUserId) {
  if (!db || !id || !ownerUserId) return null;
  const r = db.prepare(`SELECT * FROM wallet_accounts WHERE id = ? AND owner_user_id = ? AND removed_at IS NULL`).get(id, ownerUserId);
  return r || null;
}

export function listAccounts(db, ownerUserId, { kind = null, includeRemoved = false } = {}) {
  if (!db || !ownerUserId) return [];
  const filters = ["owner_user_id = ?"];
  const args = [ownerUserId];
  if (!includeRemoved) filters.push("removed_at IS NULL");
  if (kind) { filters.push("kind = ?"); args.push(kind); }
  return db.prepare(`SELECT * FROM wallet_accounts WHERE ${filters.join(" AND ")} ORDER BY created_at ASC`).all(...args);
}

export function disconnectAccount(db, ownerUserId, id) {
  if (!db || !id || !ownerUserId) return { ok: false };
  const r = db.prepare(`UPDATE wallet_accounts SET status = 'disconnected', removed_at = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?`).run(_now(), _now(), id, ownerUserId);
  return { ok: r.changes > 0 };
}

// ─── Balances ────────────────────────────────────────────────

export function upsertBalance(db, accountId, { balanceCents, availableCents = null, currency = "USD", source = "provider" }) {
  if (!db || !accountId) return { ok: false };
  try {
    db.prepare(`
      INSERT INTO wallet_balances_snapshot (account_id, balance_cents, available_cents, currency, as_of, source)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        balance_cents = excluded.balance_cents,
        available_cents = excluded.available_cents,
        currency = excluded.currency,
        as_of = excluded.as_of,
        source = excluded.source
    `).run(accountId, Math.floor(Number(balanceCents) || 0),
      availableCents != null ? Math.floor(Number(availableCents)) : null,
      currency, _now(), source);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

export function getBalance(db, accountId) {
  if (!db || !accountId) return null;
  return db.prepare(`SELECT * FROM wallet_balances_snapshot WHERE account_id = ?`).get(accountId);
}

/**
 * Compute Concord Coin balance from economy_ledger live + snapshot it.
 * (sum of incoming credit - sum of outgoing debit, in cents.)
 */
export function refreshConcordCoinBalance(db, ownerUserId, accountId) {
  if (!db || !accountId) return { ok: false };
  try {
    // economy_ledger uses fractional amounts; convert to cents
    const incoming = db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0) AS c FROM economy_ledger WHERE to_user_id = ? AND status = 'complete'`).get(ownerUserId);
    const outgoing = db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) AS c FROM economy_ledger WHERE from_user_id = ? AND status = 'complete'`).get(ownerUserId);
    const balance = (incoming?.c || 0) - (outgoing?.c || 0);
    upsertBalance(db, accountId, { balanceCents: balance, currency: "concord_coin", source: "live" });
    return { ok: true, balanceCents: balance };
  } catch (err) {
    // economy_ledger may not exist in test envs — graceful degrade
    return { ok: true, balanceCents: 0, reason: "economy_ledger_unavailable", note: err?.message };
  }
}

export function unifiedBalances(db, ownerUserId, { refreshConcord = true } = {}) {
  if (!db || !ownerUserId) return [];
  const accounts = listAccounts(db, ownerUserId);
  if (refreshConcord) {
    const cc = accounts.find((a) => a.kind === "concord_coin");
    if (cc) refreshConcordCoinBalance(db, ownerUserId, cc.id);
  }
  return accounts.map((a) => {
    const bal = getBalance(db, a.id);
    return {
      ...a,
      balance_cents: bal?.balance_cents || 0,
      available_cents: bal?.available_cents,
      balance_as_of: bal?.as_of,
      balance_source: bal?.source,
    };
  });
}

// ─── Transactions ───────────────────────────────────────────

export function ingestTransaction(db, ownerUserId, {
  accountId, sourceProviderId = null, direction, amountCents, currency = "USD",
  counterparty = null, counterpartyKind = null, category = null, subcategory = null,
  memo = null, occurredAt, postedAt = null, status = "posted", meta = null,
}) {
  if (!db || !ownerUserId || !accountId || !direction || amountCents == null || !occurredAt) return { ok: false, reason: "missing_args" };
  if (!["debit", "credit"].includes(direction)) return { ok: false, reason: "invalid_direction" };
  const amt = Math.floor(Number(amountCents));
  if (amt < 0) return { ok: false, reason: "amount_must_be_non_negative" };
  // Verify the account belongs to the user
  const acc = db.prepare(`SELECT id FROM wallet_accounts WHERE id = ? AND owner_user_id = ?`).get(accountId, ownerUserId);
  if (!acc) return { ok: false, reason: "account_not_found" };
  const id = `wtx:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO wallet_transactions (id, owner_user_id, account_id, source_provider_id, direction, amount_cents, currency, counterparty, counterparty_kind, category, subcategory, memo, occurred_at, posted_at, status, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerUserId, accountId, sourceProviderId,
      direction, amt, currency,
      counterparty ? String(counterparty).slice(0, 200) : null,
      counterpartyKind, category, subcategory,
      memo ? String(memo).slice(0, 500) : null,
      Number(occurredAt), postedAt ? Number(postedAt) : null,
      status, meta ? JSON.stringify(meta) : null, _now());
    return { ok: true, id };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return { ok: true, deduped: true, reason: "duplicate_source_provider_id" };
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listTransactions(db, ownerUserId, { accountId = null, category = null, sinceTs = null, untilTs = null, limit = 200 } = {}) {
  if (!db || !ownerUserId) return [];
  const filters = ["owner_user_id = ?"];
  const args = [ownerUserId];
  if (accountId) { filters.push("account_id = ?"); args.push(accountId); }
  if (category) { filters.push("category = ?"); args.push(category); }
  if (sinceTs) { filters.push("occurred_at >= ?"); args.push(Number(sinceTs)); }
  if (untilTs) { filters.push("occurred_at <= ?"); args.push(Number(untilTs)); }
  args.push(Math.min(Math.max(1, Number(limit) || 200), 1000));
  return db.prepare(`SELECT * FROM wallet_transactions WHERE ${filters.join(" AND ")} ORDER BY occurred_at DESC LIMIT ?`).all(...args);
}

export function categorizeTransaction(db, ownerUserId, txId, { category, subcategory = null }) {
  if (!db || !ownerUserId || !txId) return { ok: false };
  const r = db.prepare(`UPDATE wallet_transactions SET category = ?, subcategory = ? WHERE id = ? AND owner_user_id = ?`).run(category, subcategory, txId, ownerUserId);
  return { ok: r.changes > 0 };
}

// ─── Recurring discovery ───────────────────────────────────

export function registerRecurring(db, ownerUserId, { counterparty, typicalAmountCents, cadence = "monthly", category = null, nextExpectedAt = null, source = "manual", cancellationUrl = null }) {
  if (!db || !ownerUserId || !counterparty || typicalAmountCents == null) return { ok: false, reason: "missing_args" };
  const id = `wrec:${randomUUID()}`;
  db.prepare(`
    INSERT INTO wallet_recurring (id, owner_user_id, counterparty, typical_amount_cents, cadence, category, next_expected_at, source, cancellation_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerUserId, String(counterparty).slice(0, 200),
    Math.floor(typicalAmountCents),
    ["weekly","biweekly","monthly","quarterly","annually","custom"].includes(cadence) ? cadence : "monthly",
    category, nextExpectedAt ? Number(nextExpectedAt) : null,
    ["detected","manual","imported"].includes(source) ? source : "manual",
    cancellationUrl, _now());
  return { ok: true, id };
}

export function listRecurring(db, ownerUserId, { activeOnly = true } = {}) {
  if (!db || !ownerUserId) return [];
  const sql = activeOnly
    ? `SELECT * FROM wallet_recurring WHERE owner_user_id = ? AND active = 1 ORDER BY next_expected_at ASC NULLS LAST`
    : `SELECT * FROM wallet_recurring WHERE owner_user_id = ? ORDER BY created_at DESC`;
  return db.prepare(sql).all(ownerUserId);
}

export function cancelRecurring(db, ownerUserId, id) {
  if (!db || !id) return { ok: false };
  const r = db.prepare(`UPDATE wallet_recurring SET active = 0, cancelled_at = ? WHERE id = ? AND owner_user_id = ?`).run(_now(), id, ownerUserId);
  return { ok: r.changes > 0 };
}

// ─── Categories ────────────────────────────────────────────

export function listCategories(db, ownerUserId, { includeSystem = true } = {}) {
  if (!db) return [];
  if (includeSystem) {
    return db.prepare(`SELECT * FROM wallet_categories WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY parent_key NULLS FIRST, key`).all(ownerUserId);
  }
  return db.prepare(`SELECT * FROM wallet_categories WHERE owner_user_id = ? ORDER BY key`).all(ownerUserId);
}

export function upsertCategory(db, ownerUserId, { key, label, icon = null, color = null, kind = "expense", budgetMonthlyCents = null, parentKey = null }) {
  if (!db || !ownerUserId || !key || !label) return { ok: false, reason: "missing_args" };
  const id = `wcat:${ownerUserId}:${key}`;
  try {
    db.prepare(`
      INSERT INTO wallet_categories (id, owner_user_id, key, label, icon, color, kind, budget_monthly_cents, parent_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_id, key) DO UPDATE SET
        label = excluded.label, icon = excluded.icon, color = excluded.color,
        kind = excluded.kind, budget_monthly_cents = excluded.budget_monthly_cents,
        parent_key = excluded.parent_key
    `).run(id, ownerUserId, key, label, icon, color,
      ["expense","income","transfer","investment","tax","tip"].includes(kind) ? kind : "expense",
      budgetMonthlyCents != null ? Math.floor(budgetMonthlyCents) : null,
      parentKey, _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "upsert_failed", error: err?.message };
  }
}

// ─── Rails config ──────────────────────────────────────────

export function getRailsConfig(db, ownerUserId) {
  if (!db || !ownerUserId) return null;
  const r = db.prepare(`SELECT * FROM wallet_rails_config WHERE owner_user_id = ?`).get(ownerUserId);
  if (r) return r;
  // Lazy default
  db.prepare(`INSERT INTO wallet_rails_config (owner_user_id, updated_at) VALUES (?, ?)`).run(ownerUserId, _now());
  return db.prepare(`SELECT * FROM wallet_rails_config WHERE owner_user_id = ?`).get(ownerUserId);
}

export function updateRailsConfig(db, ownerUserId, patch = {}) {
  if (!db || !ownerUserId) return { ok: false };
  const cur = getRailsConfig(db, ownerUserId);
  const sets = [];
  const args = [];
  if (patch.preferSpeedOverCost !== undefined) { sets.push("prefer_speed_over_cost = ?"); args.push(patch.preferSpeedOverCost ? 1 : 0); }
  if (patch.maxAchFeeCents !== undefined) { sets.push("max_ach_fee_cents = ?"); args.push(Math.max(0, Math.floor(patch.maxAchFeeCents))); }
  if (patch.maxFednowFeeCents !== undefined) { sets.push("max_fednow_fee_cents = ?"); args.push(Math.max(0, Math.floor(patch.maxFednowFeeCents))); }
  if (patch.maxRtpFeeCents !== undefined) { sets.push("max_rtp_fee_cents = ?"); args.push(Math.max(0, Math.floor(patch.maxRtpFeeCents))); }
  if (patch.allowConcordCoinFirst !== undefined) { sets.push("allow_concord_coin_first = ?"); args.push(patch.allowConcordCoinFirst ? 1 : 0); }
  if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };
  sets.push("updated_at = ?"); args.push(_now()); args.push(ownerUserId);
  db.prepare(`UPDATE wallet_rails_config SET ${sets.join(", ")} WHERE owner_user_id = ?`).run(...args);
  return { ok: true };
}

// ─── Spending summary ──────────────────────────────────────

export function spendingSummary(db, ownerUserId, { sinceDays = 30 } = {}) {
  if (!db || !ownerUserId) return null;
  const sinceTs = _now() - sinceDays * 86400;
  const rows = db.prepare(`
    SELECT category, COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS n
    FROM wallet_transactions
    WHERE owner_user_id = ? AND direction = 'debit' AND status = 'posted' AND occurred_at >= ?
    GROUP BY category
    ORDER BY total_cents DESC
  `).all(ownerUserId, sinceTs);
  const incomeRow = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM wallet_transactions
    WHERE owner_user_id = ? AND direction = 'credit' AND status = 'posted' AND occurred_at >= ?
  `).get(ownerUserId, sinceTs);
  const totalSpend = rows.reduce((s, r) => s + r.total_cents, 0);
  return {
    sinceDays,
    totalSpendCents: totalSpend,
    totalIncomeCents: incomeRow?.total || 0,
    netCents: (incomeRow?.total || 0) - totalSpend,
    byCategory: rows,
  };
}
