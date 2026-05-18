// server/lib/accounting/persistence.js
//
// Accounting lens rebuild Sprint A — durable CRUD on top of migration
// 234. Same conventions as social/persistence.js + state-map-
// persistence.js + marketplace/dtu-listings.js:
//   - DB-first reads
//   - upsert helpers preserve the in-memory shape so callers stay
//     unchanged
//   - all multi-row writes happen inside a transaction
//   - double-entry invariant enforced at the JE-post boundary
//
// The seedDefaultEntity helper guarantees every user has a personal
// entity + a baseline chart-of-accounts so the lens can return
// meaningful data even for fresh accounts.

import { randomUUID } from "node:crypto";

function _now() { return Math.floor(Date.now() / 1000); }
function _isoDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function _round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// Baseline GAAP-style chart of accounts seeded for every new entity.
// Modeled after the QuickBooks "Simple Start" template.
export const DEFAULT_COA = Object.freeze([
  // Assets (debit normal)
  { code: "1010", name: "Cash — Operating", type: "asset",      normal: "debit" },
  { code: "1020", name: "Accounts Receivable", type: "asset",   normal: "debit" },
  { code: "1100", name: "Inventory",         type: "asset",     normal: "debit" },
  { code: "1200", name: "Prepaid Expenses",  type: "asset",     normal: "debit" },
  { code: "1500", name: "Fixed Assets",      type: "asset",     normal: "debit" },
  // Liabilities (credit normal)
  { code: "2010", name: "Accounts Payable",  type: "liability", normal: "credit" },
  { code: "2050", name: "Sales Tax Payable", type: "liability", normal: "credit" },
  { code: "2200", name: "Loans Payable",     type: "liability", normal: "credit" },
  // Equity (credit normal)
  { code: "3010", name: "Owner Equity",      type: "equity",    normal: "credit" },
  { code: "3050", name: "Retained Earnings", type: "equity",    normal: "credit" },
  // Revenue (credit normal)
  { code: "4010", name: "Sales Revenue",     type: "revenue",   normal: "credit" },
  { code: "4020", name: "Service Revenue",   type: "revenue",   normal: "credit" },
  { code: "4900", name: "Other Income",      type: "revenue",   normal: "credit" },
  // Expenses (debit normal)
  { code: "5010", name: "Cost of Goods Sold", type: "expense",  normal: "debit" },
  { code: "6010", name: "Rent",              type: "expense",   normal: "debit" },
  { code: "6020", name: "Utilities",         type: "expense",   normal: "debit" },
  { code: "6030", name: "Salaries & Wages",  type: "expense",   normal: "debit" },
  { code: "6040", name: "Office Supplies",   type: "expense",   normal: "debit" },
  { code: "6050", name: "Software Subscriptions", type: "expense", normal: "debit" },
  { code: "6900", name: "Other Expenses",    type: "expense",   normal: "debit" },
]);

// ─── Entities ────────────────────────────────────────────────────

export function getOrSeedDefaultEntity(db, userId) {
  if (!db || !userId) return null;
  let row = db.prepare(`SELECT * FROM accounting_entities WHERE owner_user_id = ? AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1`).get(userId);
  if (row) return row;
  const id = `ent:${randomUUID()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO accounting_entities (id, owner_user_id, name, kind, base_currency, fiscal_year_start_month, created_at)
      VALUES (?, ?, ?, 'personal', 'concord_coin', 1, ?)
    `).run(id, userId, "Personal", _now());
    seedDefaultCoa(db, id);
    db.prepare(`INSERT OR IGNORE INTO accounting_sequences (entity_id, kind, next_value) VALUES (?, 'journal', 1), (?, 'invoice', 1), (?, 'payment', 1), (?, 'budget', 1)`).run(id, id, id, id);
  });
  tx();
  return db.prepare(`SELECT * FROM accounting_entities WHERE id = ?`).get(id);
}

export function createEntity(db, userId, { name, kind = "personal", baseCurrency = "concord_coin", taxId = null, fiscalYearStartMonth = 1 } = {}) {
  if (!db || !userId || !name) return { ok: false, reason: "missing_args" };
  const allowed = ["personal","sole_prop","llc","corp","non_profit","household","project"];
  const k = allowed.includes(kind) ? kind : "personal";
  const id = `ent:${randomUUID()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO accounting_entities (id, owner_user_id, name, kind, base_currency, tax_id, fiscal_year_start_month, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, String(name).slice(0, 200), k, baseCurrency, taxId, fiscalYearStartMonth, _now());
    seedDefaultCoa(db, id);
    db.prepare(`INSERT OR IGNORE INTO accounting_sequences (entity_id, kind, next_value) VALUES (?, 'journal', 1), (?, 'invoice', 1), (?, 'payment', 1), (?, 'budget', 1)`).run(id, id, id, id);
  });
  tx();
  return { ok: true, id };
}

export function listEntities(db, userId) {
  if (!db || !userId) return [];
  return db.prepare(`SELECT * FROM accounting_entities WHERE owner_user_id = ? AND archived_at IS NULL ORDER BY created_at ASC`).all(userId);
}

export function archiveEntity(db, userId, entityId) {
  if (!db) return { ok: false };
  const r = db.prepare(`UPDATE accounting_entities SET archived_at = ? WHERE id = ? AND owner_user_id = ?`).run(_now(), entityId, userId);
  return { ok: r.changes > 0 };
}

// ─── Chart of Accounts ───────────────────────────────────────────

export function seedDefaultCoa(db, entityId) {
  if (!db || !entityId) return 0;
  const ins = db.prepare(`
    INSERT OR IGNORE INTO accounting_coa (id, entity_id, code, name, type, normal_balance, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  let seeded = 0;
  for (const a of DEFAULT_COA) {
    ins.run(`acc:${randomUUID()}`, entityId, a.code, a.name, a.type, a.normal, _now());
    seeded++;
  }
  return seeded;
}

export function createAccount(db, entityId, { code, name, type, normalBalance, parentAccountId = null, taxCategory = null }) {
  if (!db || !entityId || !code || !name || !type) return { ok: false, reason: "missing_args" };
  const allowedType = ["asset","liability","equity","revenue","expense","contra_asset","contra_liability","contra_revenue"];
  if (!allowedType.includes(type)) return { ok: false, reason: "invalid_type" };
  const normal = normalBalance || (["asset","expense","contra_liability","contra_revenue"].includes(type) ? "debit" : "credit");
  const id = `acc:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO accounting_coa (id, entity_id, code, name, type, normal_balance, parent_account_id, tax_category, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, entityId, String(code).slice(0, 50), String(name).slice(0, 200), type, normal, parentAccountId, taxCategory, _now(), _now());
    return { ok: true, id };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return { ok: false, reason: "code_already_exists" };
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function listCoa(db, entityId, { type = null, includeArchived = false } = {}) {
  if (!db || !entityId) return [];
  const filters = ["entity_id = ?"];
  const args = [entityId];
  if (!includeArchived) filters.push("archived_at IS NULL");
  if (type) { filters.push("type = ?"); args.push(type); }
  return db.prepare(`SELECT * FROM accounting_coa WHERE ${filters.join(" AND ")} ORDER BY code ASC`).all(...args);
}

export function getAccount(db, accountId) {
  if (!db || !accountId) return null;
  return db.prepare(`SELECT * FROM accounting_coa WHERE id = ?`).get(accountId);
}

export function updateAccount(db, entityId, accountId, { name, taxCategory, parentAccountId, isActive }) {
  if (!db || !entityId || !accountId) return { ok: false };
  const cur = db.prepare(`SELECT entity_id FROM accounting_coa WHERE id = ?`).get(accountId);
  if (!cur || cur.entity_id !== entityId) return { ok: false, reason: "not_found" };
  const sets = [];
  const args = [];
  if (name !== undefined) { sets.push("name = ?"); args.push(String(name).slice(0, 200)); }
  if (taxCategory !== undefined) { sets.push("tax_category = ?"); args.push(taxCategory); }
  if (parentAccountId !== undefined) { sets.push("parent_account_id = ?"); args.push(parentAccountId); }
  if (isActive !== undefined) { sets.push("is_active = ?"); args.push(isActive ? 1 : 0); }
  if (sets.length === 0) return { ok: false, reason: "nothing_to_update" };
  sets.push("updated_at = ?"); args.push(_now());
  args.push(accountId);
  db.prepare(`UPDATE accounting_coa SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function archiveAccount(db, entityId, accountId) {
  if (!db) return { ok: false };
  const r = db.prepare(`UPDATE accounting_coa SET archived_at = ?, is_active = 0, updated_at = ? WHERE id = ? AND entity_id = ?`).run(_now(), _now(), accountId, entityId);
  return { ok: r.changes > 0 };
}

// ─── Sequences ───────────────────────────────────────────────────

function _nextSeq(db, entityId, kind) {
  db.prepare(`INSERT OR IGNORE INTO accounting_sequences (entity_id, kind, next_value) VALUES (?, ?, 1)`).run(entityId, kind);
  const row = db.prepare(`SELECT next_value FROM accounting_sequences WHERE entity_id = ? AND kind = ?`).get(entityId, kind);
  const value = row.next_value;
  db.prepare(`UPDATE accounting_sequences SET next_value = next_value + 1 WHERE entity_id = ? AND kind = ?`).run(entityId, kind);
  return value;
}

function _formatNumber(prefix, n) {
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

// ─── Journal entries ─────────────────────────────────────────────

/**
 * Post a journal entry. Lines: [{ accountId, debit, credit, memo? }].
 * Enforces sum(debits) === sum(credits) inside a single transaction.
 */
export function postJournalEntry(db, entityId, { date, memo, lines, source = "manual", postedBy, status = "posted" }) {
  if (!db || !entityId || !postedBy) return { ok: false, reason: "missing_args" };
  if (!Array.isArray(lines) || lines.length < 2) return { ok: false, reason: "min_two_lines" };
  let dr = 0, cr = 0;
  for (const l of lines) {
    if (!l?.accountId) return { ok: false, reason: "missing_account_id" };
    const d = _round2(l.debit);
    const c = _round2(l.credit);
    if (d > 0 && c > 0) return { ok: false, reason: "line_cannot_be_both_sides" };
    if (d < 0 || c < 0) return { ok: false, reason: "negative_amount" };
    dr += d;
    cr += c;
  }
  dr = _round2(dr); cr = _round2(cr);
  if (dr !== cr) return { ok: false, reason: "unbalanced", debits: dr, credits: cr };
  if (dr === 0) return { ok: false, reason: "zero_total" };
  const id = `je:${randomUUID()}`;
  const number = _formatNumber("JE", _nextSeq(db, entityId, "journal"));
  const dateStr = date ? String(date).slice(0, 10) : _isoDate();
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO accounting_journal_entries (id, entity_id, number, date, memo, status, source, posted_by, posted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, entityId, number, dateStr, memo || null, status, source, postedBy, _now());
      const insLine = db.prepare(`
        INSERT INTO accounting_journal_lines (journal_entry_id, line_no, account_id, debit, credit, memo)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      lines.forEach((l, i) => {
        insLine.run(id, i + 1, l.accountId, _round2(l.debit), _round2(l.credit), l.memo || null);
      });
    });
    tx();
    return { ok: true, id, number, total: dr };
  } catch (err) {
    return { ok: false, reason: "post_failed", error: err?.message };
  }
}

export function voidJournalEntry(db, entityId, journalEntryId, { voidedBy, reason = "voided" } = {}) {
  if (!db) return { ok: false };
  const je = db.prepare(`SELECT * FROM accounting_journal_entries WHERE id = ? AND entity_id = ?`).get(journalEntryId, entityId);
  if (!je) return { ok: false, reason: "not_found" };
  if (je.status === "voided") return { ok: false, reason: "already_voided" };
  if (je.status === "draft") {
    db.prepare(`UPDATE accounting_journal_entries SET status = 'voided', voided_at = ?, voided_by = ? WHERE id = ?`).run(_now(), voidedBy, journalEntryId);
    return { ok: true, reversed: false };
  }
  // Post a reversing JE
  const lines = db.prepare(`SELECT account_id, debit, credit, memo FROM accounting_journal_lines WHERE journal_entry_id = ? ORDER BY line_no`).all(journalEntryId);
  const reversed = lines.map((l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit, memo: `Reverses ${je.number}: ${l.memo || ""}`.slice(0, 200) }));
  const r = postJournalEntry(db, entityId, {
    date: _isoDate(),
    memo: `Reversal of ${je.number}: ${reason}`,
    lines: reversed,
    source: `reverse:${je.id}`,
    postedBy: voidedBy,
  });
  if (r.ok) {
    db.prepare(`UPDATE accounting_journal_entries SET status = 'voided', voided_at = ?, voided_by = ?, reverses_je_id = NULL WHERE id = ?`).run(_now(), voidedBy, journalEntryId);
    db.prepare(`UPDATE accounting_journal_entries SET reverses_je_id = ? WHERE id = ?`).run(journalEntryId, r.id);
  }
  return { ok: r.ok, reversed: true, reversingJeId: r.id };
}

export function listJournalEntries(db, entityId, { limit = 200, status = null, sinceDate = null } = {}) {
  if (!db || !entityId) return [];
  const filters = ["entity_id = ?"];
  const args = [entityId];
  if (status) { filters.push("status = ?"); args.push(status); }
  if (sinceDate) { filters.push("date >= ?"); args.push(sinceDate); }
  args.push(Math.min(Number(limit) || 200, 2000));
  const rows = db.prepare(`
    SELECT * FROM accounting_journal_entries
    WHERE ${filters.join(" AND ")}
    ORDER BY date DESC, posted_at DESC LIMIT ?
  `).all(...args);
  return rows;
}

export function getJournalEntry(db, journalEntryId) {
  if (!db || !journalEntryId) return null;
  const je = db.prepare(`SELECT * FROM accounting_journal_entries WHERE id = ?`).get(journalEntryId);
  if (!je) return null;
  const lines = db.prepare(`SELECT * FROM accounting_journal_lines WHERE journal_entry_id = ? ORDER BY line_no`).all(journalEntryId);
  return { ...je, lines };
}

// ─── Trial balance + financial statements ────────────────────────

export function computeTrialBalance(db, entityId, { asOfDate = null } = {}) {
  if (!db || !entityId) return null;
  const dateFilter = asOfDate ? "AND je.date <= ?" : "";
  const args = asOfDate ? [entityId, "posted", asOfDate] : [entityId, "posted"];
  const rows = db.prepare(`
    SELECT c.id, c.code, c.name, c.type, c.normal_balance,
           COALESCE(SUM(jl.debit), 0) AS sum_debit,
           COALESCE(SUM(jl.credit), 0) AS sum_credit
    FROM accounting_coa c
    LEFT JOIN accounting_journal_lines jl ON jl.account_id = c.id
    LEFT JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
      AND je.status = ? ${dateFilter}
    WHERE c.entity_id = ? AND c.archived_at IS NULL
    GROUP BY c.id, c.code, c.name, c.type, c.normal_balance
    ORDER BY c.code ASC
  `).all(args[1], ...(asOfDate ? [args[2]] : []), args[0]);
  const accounts = rows.map((r) => {
    const debit = _round2(r.sum_debit);
    const credit = _round2(r.sum_credit);
    const net = r.normal_balance === "debit" ? debit - credit : credit - debit;
    return {
      id: r.id, code: r.code, name: r.name, type: r.type,
      normalBalance: r.normal_balance,
      sumDebit: debit, sumCredit: credit,
      balance: _round2(net),
      side: r.normal_balance,
    };
  });
  const totalDebits = _round2(accounts.reduce((s, a) => s + a.sumDebit, 0));
  const totalCredits = _round2(accounts.reduce((s, a) => s + a.sumCredit, 0));
  return {
    asOfDate: asOfDate || _isoDate(),
    accounts,
    totalDebits, totalCredits,
    isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
  };
}

export function computeBalanceSheet(db, entityId, { asOfDate = null } = {}) {
  const tb = computeTrialBalance(db, entityId, { asOfDate });
  if (!tb) return null;
  const groupBy = (type) => tb.accounts.filter((a) => a.type === type || a.type === `contra_${type}`).map((a) => ({ ...a, balance: a.type.startsWith("contra_") ? -a.balance : a.balance }));
  const assets = groupBy("asset");
  const liabilities = groupBy("liability");
  const equity = groupBy("equity");
  // Auto-roll P&L into Retained Earnings for display
  const revenue = tb.accounts.filter((a) => a.type === "revenue" || a.type === "contra_revenue").reduce((s, a) => s + (a.type === "contra_revenue" ? -a.balance : a.balance), 0);
  const expenses = tb.accounts.filter((a) => a.type === "expense").reduce((s, a) => s + a.balance, 0);
  const netIncome = _round2(revenue - expenses);
  const totalAssets = _round2(assets.reduce((s, a) => s + a.balance, 0));
  const totalLiabilities = _round2(liabilities.reduce((s, a) => s + a.balance, 0));
  const totalEquity = _round2(equity.reduce((s, a) => s + a.balance, 0) + netIncome);
  return {
    asOfDate: tb.asOfDate,
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity, netIncome,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

export function computeProfitLoss(db, entityId, { startDate, endDate } = {}) {
  if (!db || !entityId) return null;
  const start = startDate || `${new Date().getFullYear()}-01-01`;
  const end = endDate || _isoDate();
  const rows = db.prepare(`
    SELECT c.id, c.code, c.name, c.type,
           COALESCE(SUM(jl.debit), 0) AS sum_debit,
           COALESCE(SUM(jl.credit), 0) AS sum_credit
    FROM accounting_coa c
    LEFT JOIN accounting_journal_lines jl ON jl.account_id = c.id
    LEFT JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
      AND je.status = 'posted' AND je.date >= ? AND je.date <= ?
    WHERE c.entity_id = ? AND c.type IN ('revenue','contra_revenue','expense') AND c.archived_at IS NULL
    GROUP BY c.id, c.code, c.name, c.type
    ORDER BY c.code ASC
  `).all(start, end, entityId);
  const revenues = rows.filter((r) => r.type === "revenue" || r.type === "contra_revenue")
    .map((r) => ({ ...r, balance: _round2(r.type === "contra_revenue" ? r.sum_debit - r.sum_credit : r.sum_credit - r.sum_debit) }));
  const expenses = rows.filter((r) => r.type === "expense")
    .map((r) => ({ ...r, balance: _round2(r.sum_debit - r.sum_credit) }));
  const totalRevenue = _round2(revenues.reduce((s, r) => s + r.balance, 0));
  const totalExpenses = _round2(expenses.reduce((s, r) => s + r.balance, 0));
  const netIncome = _round2(totalRevenue - totalExpenses);
  return {
    period: { startDate: start, endDate: end },
    revenues, expenses,
    totalRevenue, totalExpenses, netIncome,
  };
}

// ─── Invoices ────────────────────────────────────────────────────

export function createInvoice(db, entityId, { customerId = null, customerName, customerEmail = null, issuedDate = null, dueDate = null, currency = "concord_coin", lines = [], notes = null }) {
  if (!db || !entityId || !customerName) return { ok: false, reason: "missing_args" };
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, reason: "min_one_line" };
  const id = `inv:${randomUUID()}`;
  const number = _formatNumber("INV", _nextSeq(db, entityId, "invoice"));
  const issued = issuedDate || _isoDate();
  const due = dueDate || _isoDate(new Date(Date.now() + 30 * 86400 * 1000));
  let subtotal = 0, taxTotal = 0;
  const normalized = lines.map((l, i) => {
    const qty = _round2(l.quantity || 1);
    const price = _round2(l.unitPrice || 0);
    const rate = Number(l.taxRate || 0);
    const lineSub = _round2(qty * price);
    const lineTax = _round2(lineSub * rate);
    subtotal += lineSub;
    taxTotal += lineTax;
    return {
      lineNo: i + 1,
      description: String(l.description || "").slice(0, 500),
      quantity: qty, unitPrice: price, taxRate: rate, lineTotal: _round2(lineSub + lineTax),
      revenueAccountId: l.revenueAccountId || null,
      taxAccountId: l.taxAccountId || null,
    };
  });
  subtotal = _round2(subtotal); taxTotal = _round2(taxTotal);
  const total = _round2(subtotal + taxTotal);
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO accounting_invoices (id, entity_id, number, customer_id, customer_name, customer_email, issued_date, due_date, currency, subtotal, tax_total, total, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(id, entityId, number, customerId, customerName, customerEmail, issued, due, currency, subtotal, taxTotal, total, notes, _now(), _now());
      const insLine = db.prepare(`
        INSERT INTO accounting_invoice_lines (invoice_id, line_no, description, quantity, unit_price, tax_rate, line_total, revenue_account_id, tax_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const l of normalized) {
        insLine.run(id, l.lineNo, l.description, l.quantity, l.unitPrice, l.taxRate, l.lineTotal, l.revenueAccountId, l.taxAccountId);
      }
    });
    tx();
    return { ok: true, id, number, total };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getInvoice(db, invoiceId) {
  if (!db) return null;
  const inv = db.prepare(`SELECT * FROM accounting_invoices WHERE id = ?`).get(invoiceId);
  if (!inv) return null;
  const lines = db.prepare(`SELECT * FROM accounting_invoice_lines WHERE invoice_id = ? ORDER BY line_no`).all(invoiceId);
  return { ...inv, lines };
}

export function listInvoices(db, entityId, { status = null, limit = 100, customerId = null } = {}) {
  if (!db || !entityId) return [];
  const filters = ["entity_id = ?"];
  const args = [entityId];
  if (status) { filters.push("status = ?"); args.push(status); }
  if (customerId) { filters.push("customer_id = ?"); args.push(customerId); }
  args.push(Math.min(Number(limit) || 100, 1000));
  return db.prepare(`SELECT * FROM accounting_invoices WHERE ${filters.join(" AND ")} ORDER BY issued_date DESC LIMIT ?`).all(...args);
}

export function markInvoiceSent(db, invoiceId) {
  if (!db) return { ok: false };
  const r = db.prepare(`UPDATE accounting_invoices SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(_now(), _now(), invoiceId);
  return { ok: r.changes > 0 };
}

export function recordInvoicePayment(db, entityId, { invoiceId, amount, method = "concord_coin", reference = null, occurredAt = null, recordedBy }) {
  if (!db || !invoiceId || !recordedBy) return { ok: false, reason: "missing_args" };
  const amt = _round2(amount);
  if (amt <= 0) return { ok: false, reason: "amount_must_be_positive" };
  const inv = db.prepare(`SELECT * FROM accounting_invoices WHERE id = ? AND entity_id = ?`).get(invoiceId, entityId);
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.status === "voided" || inv.status === "refunded") return { ok: false, reason: "invoice_not_payable" };
  const newPaid = _round2(inv.amount_paid + amt);
  const newStatus = newPaid >= inv.total - 0.005 ? "paid" : newPaid > 0 ? "partial" : inv.status;
  const occurred = occurredAt || new Date().toISOString();
  const paymentId = `pay:${randomUUID()}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO accounting_payments (id, entity_id, kind, invoice_id, amount, currency, method, reference, occurred_at, recorded_by, created_at)
      VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(paymentId, entityId, invoiceId, amt, inv.currency, method, reference, occurred, recordedBy, _now());
    db.prepare(`UPDATE accounting_invoices SET amount_paid = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?`).run(
      newPaid, newStatus,
      newStatus === "paid" ? _now() : inv.paid_at,
      _now(), invoiceId,
    );
  });
  tx();
  return { ok: true, paymentId, newStatus, amountPaid: newPaid };
}

export function voidInvoice(db, entityId, invoiceId) {
  if (!db) return { ok: false };
  const r = db.prepare(`UPDATE accounting_invoices SET status = 'voided', voided_at = ?, updated_at = ? WHERE id = ? AND entity_id = ? AND status != 'paid'`).run(_now(), _now(), invoiceId, entityId);
  return { ok: r.changes > 0 };
}

export function computeInvoiceAging(db, entityId, { asOfDate = null } = {}) {
  if (!db || !entityId) return null;
  const as = asOfDate || _isoDate();
  const rows = db.prepare(`
    SELECT id, number, customer_name, total, amount_paid, due_date, status,
           (total - amount_paid) AS outstanding
    FROM accounting_invoices
    WHERE entity_id = ? AND status IN ('sent','partial','overdue')
  `).all(entityId);
  const buckets = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
  const detail = [];
  for (const r of rows) {
    const dueDays = Math.floor((new Date(as) - new Date(r.due_date)) / 86400000);
    let bucket;
    if (dueDays <= 0) bucket = "current";
    else if (dueDays <= 30) bucket = "1_30";
    else if (dueDays <= 60) bucket = "31_60";
    else if (dueDays <= 90) bucket = "61_90";
    else bucket = "over_90";
    buckets[bucket] = _round2(buckets[bucket] + r.outstanding);
    detail.push({ ...r, outstanding: _round2(r.outstanding), daysOverdue: Math.max(0, dueDays), bucket });
  }
  return {
    asOfDate: as,
    buckets,
    totalOutstanding: _round2(Object.values(buckets).reduce((s, n) => s + n, 0)),
    invoices: detail,
  };
}

// ─── Budgets ─────────────────────────────────────────────────────

export function createBudget(db, entityId, { name, periodStart, periodEnd, lines = [], createdBy }) {
  if (!db || !entityId || !name || !periodStart || !periodEnd || !createdBy) return { ok: false, reason: "missing_args" };
  const id = `bud:${randomUUID()}`;
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO accounting_budgets (id, entity_id, name, period_start, period_end, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, entityId, String(name).slice(0, 200), periodStart, periodEnd, createdBy, _now());
      const insLine = db.prepare(`INSERT INTO accounting_budget_lines (budget_id, account_id, amount, notes) VALUES (?, ?, ?, ?)`);
      for (const l of lines) insLine.run(id, l.accountId, _round2(l.amount), l.notes || null);
    });
    tx();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function computeBudgetVariance(db, entityId, budgetId) {
  if (!db || !budgetId) return null;
  const budget = db.prepare(`SELECT * FROM accounting_budgets WHERE id = ? AND entity_id = ?`).get(budgetId, entityId);
  if (!budget) return null;
  const lines = db.prepare(`
    SELECT bl.account_id, bl.amount AS planned, c.code, c.name, c.type, c.normal_balance,
           COALESCE(SUM(CASE WHEN c.normal_balance = 'debit' THEN jl.debit - jl.credit ELSE jl.credit - jl.debit END), 0) AS actual
    FROM accounting_budget_lines bl
    INNER JOIN accounting_coa c ON c.id = bl.account_id
    LEFT JOIN accounting_journal_lines jl ON jl.account_id = bl.account_id
    LEFT JOIN accounting_journal_entries je ON je.id = jl.journal_entry_id
      AND je.status = 'posted' AND je.date >= ? AND je.date <= ?
    WHERE bl.budget_id = ?
    GROUP BY bl.account_id, bl.amount, c.code, c.name, c.type, c.normal_balance
    ORDER BY c.code ASC
  `).all(budget.period_start, budget.period_end, budgetId);
  const variance = lines.map((l) => ({
    accountId: l.account_id,
    code: l.code, name: l.name, type: l.type,
    planned: _round2(l.planned),
    actual: _round2(l.actual),
    variance: _round2(l.actual - l.planned),
    pctVariance: l.planned > 0 ? _round2(((l.actual - l.planned) / l.planned) * 100) : null,
  }));
  return { budget, variance };
}
