// server/domains/wallet-rebuild.js
//
// Wallet lens Sprint A — register()-pattern macros sitting alongside
// the legacy registerLensAction macros in server/domains/wallet.js
// (budgetCheck/portfolioBalance/spendingTrend/transactionCategorize).
//
// This file adds the durable non-custodial aggregation substrate:
// linked accounts, balances, transactions, recurring, categories,
// rails config, spending summary. NON-CUSTODIAL by design.

import {
  linkAccount, getAccount, listAccounts, disconnectAccount,
  upsertBalance, getBalance, refreshConcordCoinBalance, unifiedBalances,
  ingestTransaction, listTransactions, categorizeTransaction,
  registerRecurring, listRecurring, cancelRecurring,
  listCategories, upsertCategory,
  getRailsConfig, updateRailsConfig,
  spendingSummary,
} from "../lib/wallet/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerWalletRebuildMacros(register) {

  // ─── Accounts ──────────────────────────────────────────────

  register("wallet", "account_link", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return linkAccount(db, userId, input);
  }, { destructive: true, note: "Link an external account (bank / card / crypto wallet / brokerage). NON-CUSTODIAL by design — credentials_ref stores Plaid public_token or wallet address only; never private keys." });

  register("wallet", "account_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, accounts: listAccounts(db, userId, { kind: input.kind, includeRemoved: !!input.includeRemoved }) };
  }, { note: "List my linked accounts (filterable by kind)" });

  register("wallet", "account_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getAccount(db, String(input.id || ""), userId);
    if (!a) return { ok: false, reason: "not_found" };
    const bal = getBalance(db, a.id);
    return { ok: true, account: { ...a, balance: bal } };
  }, { note: "Get one account with its current balance snapshot" });

  register("wallet", "account_disconnect", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return disconnectAccount(db, userId, String(input.id || ""));
  }, { destructive: true, note: "Disconnect an account (soft-delete; transactions preserved)" });

  // ─── Balances + unified view ──────────────────────────────

  register("wallet", "balance_unified", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const accounts = unifiedBalances(db, userId, { refreshConcord: input.refreshConcord !== false });
    const totalsByCurrency = {};
    for (const a of accounts) {
      totalsByCurrency[a.currency] = (totalsByCurrency[a.currency] || 0) + (a.balance_cents || 0);
    }
    return { ok: true, accounts, totalsByCurrency };
  }, { note: "Unified balance view: Concord Coin + all linked accounts. Refreshes Concord Coin balance live from economy_ledger by default." });

  register("wallet", "balance_refresh_concord", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const accId = String(input.accountId || "");
    if (!accId) return { ok: false, reason: "accountId_required" };
    return refreshConcordCoinBalance(db, userId, accId);
  }, { destructive: true, note: "Force a live refresh of the Concord Coin balance from economy_ledger" });

  register("wallet", "balance_set", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const accId = String(input.accountId || "");
    const acc = getAccount(db, accId, userId);
    if (!acc) return { ok: false, reason: "account_not_found" };
    return upsertBalance(db, accId, {
      balanceCents: input.balanceCents,
      availableCents: input.availableCents,
      currency: input.currency || acc.currency,
      source: input.source || "provider",
    });
  }, { destructive: true, note: "Push a balance snapshot for a linked account (provider callbacks / manual)" });

  // ─── Transactions ─────────────────────────────────────────

  register("wallet", "tx_ingest", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return ingestTransaction(db, userId, input);
  }, { destructive: true, note: "Ingest a transaction. Idempotent on (account_id, source_provider_id)." });

  register("wallet", "tx_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, transactions: listTransactions(db, userId, input) };
  }, { note: "List my transactions (filterable by accountId / category / time range)" });

  register("wallet", "tx_categorize", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return categorizeTransaction(db, userId, String(input.id || input.txId || ""), { category: input.category, subcategory: input.subcategory });
  }, { destructive: true, note: "Manually set / change a transaction's category" });

  // ─── Recurring ────────────────────────────────────────────

  register("wallet", "recurring_register", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return registerRecurring(db, userId, input);
  }, { destructive: true, note: "Manually register a recurring charge (subscription)" });

  register("wallet", "recurring_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, recurring: listRecurring(db, userId, { activeOnly: input.activeOnly !== false }) };
  }, { note: "List my recurring charges (active only by default)" });

  register("wallet", "recurring_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return cancelRecurring(db, userId, String(input.id || ""));
  }, { destructive: true, note: "Mark a recurring charge cancelled (doesn't actually cancel with the merchant — that's external)" });

  // ─── Categories ───────────────────────────────────────────

  register("wallet", "category_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, categories: listCategories(db, userId, { includeSystem: input.includeSystem !== false }) };
  }, { note: "List categories (system defaults + my custom ones)" });

  register("wallet", "category_upsert", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return upsertCategory(db, userId, input);
  }, { destructive: true, note: "Create or update a custom category (with optional monthly budget)" });

  // ─── Rails config ─────────────────────────────────────────

  register("wallet", "rails_get", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, config: getRailsConfig(db, userId) };
  }, { note: "Get my multi-rail routing preferences (ACH/FedNow/RTP/concord-coin)" });

  register("wallet", "rails_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return updateRailsConfig(db, userId, input);
  }, { destructive: true, note: "Update rails routing preferences" });

  // ─── Summary ──────────────────────────────────────────────

  register("wallet", "spending_summary", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, ...spendingSummary(db, userId, { sinceDays: input.sinceDays }) };
  }, { note: "Spend summary by category for a period (default 30 days)" });
}
