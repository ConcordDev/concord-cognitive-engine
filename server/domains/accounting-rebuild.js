// server/domains/accounting-rebuild.js
//
// Accounting lens rebuild Sprint A — register() pattern alongside
// the legacy registerLensAction macros in server/domains/accounting.js.
// Each macro persists to migration 234 tables via lib/accounting/persistence.js.
//
// ~25 macros covering the full QuickBooks/Xero/FreshBooks/Wave surface:
//   Entities:   entity_create / entity_list / entity_archive
//   CoA:        account_create / account_list / account_get / account_update / account_archive
//   Journal:    journal_post / journal_void / journal_list / journal_get
//   Invoices:   invoice_create / invoice_get / invoice_list / invoice_send / invoice_pay / invoice_void
//   Reports:    trial_balance / balance_sheet / profit_loss / invoice_aging
//   Budgets:    budget_create / budget_variance

import {
  getOrSeedDefaultEntity, createEntity, listEntities, archiveEntity,
  createAccount, listCoa, getAccount, updateAccount, archiveAccount,
  postJournalEntry, voidJournalEntry, listJournalEntries, getJournalEntry,
  createInvoice, getInvoice, listInvoices, markInvoiceSent,
  recordInvoicePayment, voidInvoice, computeInvoiceAging,
  computeTrialBalance, computeBalanceSheet, computeProfitLoss,
  createBudget, computeBudgetVariance,
} from "../lib/accounting/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

// Resolve which entity to operate against. If input.entityId is given
// use it (verifying ownership); otherwise auto-seed + use the user's
// default entity. This lets the lens "just work" for first-time users
// without forcing them to create an entity manually.
function _resolveEntity(db, userId, input = {}) {
  if (!db || !userId) return null;
  if (input.entityId) {
    const e = db.prepare(`SELECT id, owner_user_id FROM accounting_entities WHERE id = ?`).get(input.entityId);
    if (!e || e.owner_user_id !== userId) return null;
    return e.id;
  }
  const def = getOrSeedDefaultEntity(db, userId);
  return def?.id || null;
}

export default function registerAccountingRebuildMacros(register) {

  // ─── Entities ─────────────────────────────────────────────────

  register("accounting", "entity_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return createEntity(db, userId, input);
  }, { destructive: true, note: "Create a new accounting entity (personal / sole_prop / llc / corp / non_profit / household / project). Auto-seeds GAAP-baseline chart of accounts." });

  register("accounting", "entity_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, entities: listEntities(db, userId) };
  }, { note: "List my accounting entities (multi-entity dashboard)" });

  register("accounting", "entity_archive", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return archiveEntity(db, userId, String(input.id || input.entityId || ""));
  }, { destructive: true, note: "Archive an entity (soft-delete; books preserved)" });

  // ─── Chart of Accounts ────────────────────────────────────────

  register("accounting", "account_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return createAccount(db, entityId, input);
  }, { destructive: true, note: "Create a new account in the CoA (code + name + type + normalBalance)" });

  register("accounting", "account_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, accounts: listCoa(db, entityId, { type: input.type, includeArchived: !!input.includeArchived }) };
  }, { note: "List CoA accounts (optional type filter: asset/liability/equity/revenue/expense)" });

  register("accounting", "account_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const a = getAccount(db, String(input.id || ""));
    if (!a) return { ok: false, reason: "not_found" };
    // Ownership check via entity
    const e = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(a.entity_id);
    if (!e || e.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, account: a };
  }, { note: "Get one account by id" });

  register("accounting", "account_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return updateAccount(db, entityId, String(input.id || ""), input);
  }, { destructive: true, note: "Update account name / tax_category / parent / active" });

  register("accounting", "account_archive", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return archiveAccount(db, entityId, String(input.id || ""));
  }, { destructive: true, note: "Archive an account (soft-delete; cannot fully delete due to JE FK)" });

  // ─── Journal entries ─────────────────────────────────────────

  register("accounting", "journal_post", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return postJournalEntry(db, entityId, { ...input, postedBy: userId });
  }, { destructive: true, note: "Post a journal entry. lines: [{accountId, debit, credit, memo?}]. Enforces sum(debits) = sum(credits) in a single transaction." });

  register("accounting", "journal_void", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return voidJournalEntry(db, entityId, String(input.id || input.journalEntryId || ""), { voidedBy: userId, reason: input.reason });
  }, { destructive: true, note: "Void a journal entry (posts a reversing JE; preserves audit trail)" });

  register("accounting", "journal_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, entries: listJournalEntries(db, entityId, { limit: input.limit, status: input.status, sinceDate: input.sinceDate }) };
  }, { note: "List journal entries for the entity" });

  register("accounting", "journal_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const je = getJournalEntry(db, String(input.id || ""));
    if (!je) return { ok: false, reason: "not_found" };
    const e = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(je.entity_id);
    if (!e || e.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, entry: je };
  }, { note: "Get one journal entry with its lines" });

  // ─── Invoices ────────────────────────────────────────────────

  register("accounting", "invoice_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return createInvoice(db, entityId, input);
  }, { destructive: true, note: "Draft a new invoice with line items (quantity × unit_price × tax_rate)" });

  register("accounting", "invoice_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const inv = getInvoice(db, String(input.id || ""));
    if (!inv) return { ok: false, reason: "not_found" };
    const e = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(inv.entity_id);
    if (!e || e.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    return { ok: true, invoice: inv };
  }, { note: "Get invoice with line items" });

  register("accounting", "invoice_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, invoices: listInvoices(db, entityId, input) };
  }, { note: "List invoices filterable by status / customer_id" });

  register("accounting", "invoice_send", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Ownership via invoice
    const inv = db.prepare(`SELECT entity_id FROM accounting_invoices WHERE id = ?`).get(String(input.id || ""));
    if (!inv) return { ok: false, reason: "not_found" };
    const e = db.prepare(`SELECT owner_user_id FROM accounting_entities WHERE id = ?`).get(inv.entity_id);
    if (!e || e.owner_user_id !== userId) return { ok: false, reason: "forbidden" };
    return markInvoiceSent(db, String(input.id));
  }, { destructive: true, note: "Mark an invoice sent (transitions draft → sent)" });

  register("accounting", "invoice_pay", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return recordInvoicePayment(db, entityId, {
      invoiceId: String(input.invoiceId || input.id || ""),
      amount: Number(input.amount),
      method: input.method,
      reference: input.reference,
      occurredAt: input.occurredAt,
      recordedBy: userId,
    });
  }, { destructive: true, note: "Record a payment against an invoice. Partial payments supported; status advances draft → sent → partial → paid." });

  register("accounting", "invoice_void", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return voidInvoice(db, entityId, String(input.id || ""));
  }, { destructive: true, note: "Void an unpaid invoice" });

  // ─── Reports ─────────────────────────────────────────────────

  register("accounting", "trial_balance", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const tb = computeTrialBalance(db, entityId, { asOfDate: input.asOfDate });
    return { ok: true, ...tb };
  }, { note: "Trial balance as of a date (defaults to today). isBalanced=true when totalDebits === totalCredits." });

  register("accounting", "balance_sheet", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const bs = computeBalanceSheet(db, entityId, { asOfDate: input.asOfDate });
    return { ok: true, ...bs };
  }, { note: "Balance sheet. Auto-rolls P&L into retained earnings. Assets = Liabilities + Equity." });

  register("accounting", "profit_loss", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    const pl = computeProfitLoss(db, entityId, { startDate: input.startDate, endDate: input.endDate });
    return { ok: true, ...pl };
  }, { note: "P&L for a period (defaults to year-to-date)" });

  register("accounting", "invoice_aging", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, ...computeInvoiceAging(db, entityId, { asOfDate: input.asOfDate }) };
  }, { note: "AR aging buckets: current / 1-30 / 31-60 / 61-90 / over_90 with daysOverdue per invoice" });

  // ─── Budgets ─────────────────────────────────────────────────

  register("accounting", "budget_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return createBudget(db, entityId, { ...input, createdBy: userId });
  }, { destructive: true, note: "Create a budget with per-account planned amounts for a period" });

  register("accounting", "budget_variance", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const entityId = _resolveEntity(db, userId, input);
    if (!entityId) return { ok: false, reason: "entity_not_found" };
    return { ok: true, ...computeBudgetVariance(db, entityId, String(input.id || input.budgetId || "")) };
  }, { note: "Budget vs actual variance with per-account % deviation" });
}
