// server/tests/accounting-rebuild-sprint-a.test.js
//
// Tier-2 contract tests for accounting rebuild Sprint A.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAccountingRebuildMacros from "../domains/accounting-rebuild.js";
import {
  getOrSeedDefaultEntity, createEntity, listEntities,
  seedDefaultCoa, createAccount, listCoa, getAccount, updateAccount, archiveAccount,
  postJournalEntry, voidJournalEntry, listJournalEntries, getJournalEntry,
  createInvoice, getInvoice, listInvoices, markInvoiceSent,
  recordInvoicePayment, voidInvoice, computeInvoiceAging,
  computeTrialBalance, computeBalanceSheet, computeProfitLoss,
  createBudget, computeBudgetVariance,
  DEFAULT_COA,
} from "../lib/accounting/persistence.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/234_accounting_rebuild.js");
  m.up(db);
  registerAccountingRebuildMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── Entities ────────────────────────────────────────────────────

describe("entities", () => {
  it("getOrSeedDefaultEntity creates personal entity with default CoA", () => {
    const e = getOrSeedDefaultEntity(db, "u_seed");
    assert.ok(e?.id);
    assert.equal(e.owner_user_id, "u_seed");
    assert.equal(e.kind, "personal");
    const accounts = listCoa(db, e.id);
    assert.equal(accounts.length, DEFAULT_COA.length);
  });

  it("idempotent — second call returns same entity", () => {
    const e1 = getOrSeedDefaultEntity(db, "u_idem");
    const e2 = getOrSeedDefaultEntity(db, "u_idem");
    assert.equal(e1.id, e2.id);
  });

  it("createEntity seeds CoA + sequences", () => {
    const r = createEntity(db, "u_corp", { name: "Acme LLC", kind: "llc" });
    assert.equal(r.ok, true);
    const accounts = listCoa(db, r.id);
    assert.equal(accounts.length, DEFAULT_COA.length);
    const seq = db.prepare(`SELECT next_value FROM accounting_sequences WHERE entity_id = ? AND kind = 'journal'`).get(r.id);
    assert.equal(seq.next_value, 1);
  });

  it("listEntities returns user's entities only", () => {
    createEntity(db, "u_multi", { name: "First", kind: "personal" });
    createEntity(db, "u_multi", { name: "Second", kind: "llc" });
    createEntity(db, "u_other", { name: "Other", kind: "personal" });
    const mine = listEntities(db, "u_multi");
    assert.equal(mine.length, 2);
    assert.ok(mine.every((e) => e.owner_user_id === "u_multi"));
  });
});

// ─── CoA ─────────────────────────────────────────────────────────

describe("chart of accounts", () => {
  it("createAccount with valid type + UNIQUE on (entity_id, code)", () => {
    const e = getOrSeedDefaultEntity(db, "u_coa");
    const r1 = createAccount(db, e.id, { code: "9999", name: "Test", type: "asset", normalBalance: "debit" });
    assert.equal(r1.ok, true);
    const r2 = createAccount(db, e.id, { code: "9999", name: "Dup", type: "asset", normalBalance: "debit" });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "code_already_exists");
  });

  it("rejects invalid type", () => {
    const e = getOrSeedDefaultEntity(db, "u_coa_bad");
    const r = createAccount(db, e.id, { code: "x", name: "x", type: "INVALID" });
    assert.equal(r.reason, "invalid_type");
  });

  it("auto-picks normalBalance based on type if not provided", () => {
    const e = getOrSeedDefaultEntity(db, "u_normal");
    const r = createAccount(db, e.id, { code: "9001", name: "Auto Asset", type: "asset" });
    const a = getAccount(db, r.id);
    assert.equal(a.normal_balance, "debit");
    const r2 = createAccount(db, e.id, { code: "9002", name: "Auto Rev", type: "revenue" });
    const a2 = getAccount(db, r2.id);
    assert.equal(a2.normal_balance, "credit");
  });

  it("updateAccount changes name + active state", () => {
    const e = getOrSeedDefaultEntity(db, "u_upd");
    const r = createAccount(db, e.id, { code: "9100", name: "Old", type: "expense" });
    updateAccount(db, e.id, r.id, { name: "New Name", isActive: false });
    const got = getAccount(db, r.id);
    assert.equal(got.name, "New Name");
    assert.equal(got.is_active, 0);
  });

  it("archiveAccount soft-deletes", () => {
    const e = getOrSeedDefaultEntity(db, "u_arch");
    const r = createAccount(db, e.id, { code: "9200", name: "X", type: "expense" });
    archiveAccount(db, e.id, r.id);
    const active = listCoa(db, e.id);
    assert.ok(!active.find((a) => a.id === r.id));
    const all = listCoa(db, e.id, { includeArchived: true });
    assert.ok(all.find((a) => a.id === r.id));
  });

  it("listCoa filters by type", () => {
    const e = getOrSeedDefaultEntity(db, "u_filt");
    const revenue = listCoa(db, e.id, { type: "revenue" });
    assert.ok(revenue.length > 0);
    assert.ok(revenue.every((a) => a.type === "revenue"));
  });
});

// ─── Journal entries ─────────────────────────────────────────────

describe("journal entries — double-entry invariant", () => {
  it("balanced JE posts; unbalanced rejected", () => {
    const e = getOrSeedDefaultEntity(db, "u_je");
    const cash = listCoa(db, e.id).find((a) => a.code === "1010");
    const ar = listCoa(db, e.id).find((a) => a.code === "1020");
    const r = postJournalEntry(db, e.id, {
      date: "2026-05-18",
      memo: "Customer paid AR",
      lines: [
        { accountId: cash.id, debit: 500, credit: 0 },
        { accountId: ar.id, debit: 0, credit: 500 },
      ],
      postedBy: "u_je",
    });
    assert.equal(r.ok, true);
    assert.equal(r.number, "JE-00001");

    const bad = postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [
        { accountId: cash.id, debit: 500, credit: 0 },
        { accountId: ar.id, debit: 0, credit: 400 },
      ],
      postedBy: "u_je",
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "unbalanced");
  });

  it("rejects line with both debit + credit", () => {
    const e = getOrSeedDefaultEntity(db, "u_je2");
    const cash = listCoa(db, e.id).find((a) => a.code === "1010");
    const r = postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [
        { accountId: cash.id, debit: 100, credit: 100 },
        { accountId: cash.id, debit: 0, credit: 100 },
      ],
      postedBy: "u_je2",
    });
    assert.equal(r.reason, "line_cannot_be_both_sides");
  });

  it("rejects negative amounts", () => {
    const e = getOrSeedDefaultEntity(db, "u_je3");
    const cash = listCoa(db, e.id).find((a) => a.code === "1010");
    const r = postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [{ accountId: cash.id, debit: -100, credit: 0 }],
      postedBy: "u_je3",
    });
    assert.ok(["min_two_lines", "negative_amount"].includes(r.reason));
  });

  it("voidJournalEntry posts a reversing JE + preserves audit trail", () => {
    const e = getOrSeedDefaultEntity(db, "u_void");
    const cash = listCoa(db, e.id).find((a) => a.code === "1010");
    const rev = listCoa(db, e.id).find((a) => a.code === "4010");
    const r = postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 1000 }],
      postedBy: "u_void",
    });
    const v = voidJournalEntry(db, e.id, r.id, { voidedBy: "u_void" });
    assert.equal(v.ok, true);
    assert.equal(v.reversed, true);
    const original = getJournalEntry(db, r.id);
    assert.equal(original.status, "voided");
    // The reversing JE should exist + reverse the original
    const reverseJe = getJournalEntry(db, v.reversingJeId);
    assert.equal(reverseJe.reverses_je_id, r.id);
    assert.equal(reverseJe.lines[0].credit, 1000); // Cash was debited 1000 → now credited
    assert.equal(reverseJe.lines[1].debit, 1000);
  });

  it("listJournalEntries filterable by status + sinceDate", () => {
    const e = getOrSeedDefaultEntity(db, "u_list_je");
    const cash = listCoa(db, e.id).find((a) => a.code === "1010");
    const rev = listCoa(db, e.id).find((a) => a.code === "4010");
    postJournalEntry(db, e.id, { date: "2026-01-15", lines: [{ accountId: cash.id, debit: 100, credit: 0 }, { accountId: rev.id, debit: 0, credit: 100 }], postedBy: "u_list_je" });
    postJournalEntry(db, e.id, { date: "2026-06-15", lines: [{ accountId: cash.id, debit: 200, credit: 0 }, { accountId: rev.id, debit: 0, credit: 200 }], postedBy: "u_list_je" });
    const recent = listJournalEntries(db, e.id, { sinceDate: "2026-05-01" });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].date, "2026-06-15");
  });
});

// ─── Reports ─────────────────────────────────────────────────────

describe("financial reports", () => {
  it("trial balance is balanced after any posted JE", () => {
    const e = createEntity(db, "u_tb", { name: "TB Test" });
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 1000 }],
      postedBy: "u_tb",
    });
    const tb = computeTrialBalance(db, e.id);
    assert.equal(tb.totalDebits, 1000);
    assert.equal(tb.totalCredits, 1000);
    assert.equal(tb.isBalanced, true);
  });

  it("balance sheet rolls P&L into equity (Assets = Liabilities + Equity)", () => {
    const e = createEntity(db, "u_bs", { name: "BS Test" });
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    const rent = accs.find((a) => a.code === "6010");
    // Earn revenue: Cash 1000 DR, Revenue 1000 CR
    postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [{ accountId: cash.id, debit: 1000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 1000 }],
      postedBy: "u_bs",
    });
    // Pay rent: Rent expense 300 DR, Cash 300 CR
    postJournalEntry(db, e.id, {
      date: "2026-05-18",
      lines: [{ accountId: rent.id, debit: 300, credit: 0 }, { accountId: cash.id, debit: 0, credit: 300 }],
      postedBy: "u_bs",
    });
    const bs = computeBalanceSheet(db, e.id);
    assert.equal(bs.netIncome, 700);
    assert.equal(bs.totalAssets, 700);
    assert.equal(bs.totalEquity, 700);
    assert.equal(bs.isBalanced, true);
  });

  it("profit_loss for period sums revenue - expenses", () => {
    const e = createEntity(db, "u_pl", { name: "PL Test" });
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    const rent = accs.find((a) => a.code === "6010");
    postJournalEntry(db, e.id, {
      date: "2026-03-15",
      lines: [{ accountId: cash.id, debit: 5000, credit: 0 }, { accountId: rev.id, debit: 0, credit: 5000 }],
      postedBy: "u_pl",
    });
    postJournalEntry(db, e.id, {
      date: "2026-03-20",
      lines: [{ accountId: rent.id, debit: 1500, credit: 0 }, { accountId: cash.id, debit: 0, credit: 1500 }],
      postedBy: "u_pl",
    });
    const pl = computeProfitLoss(db, e.id, { startDate: "2026-03-01", endDate: "2026-03-31" });
    assert.equal(pl.totalRevenue, 5000);
    assert.equal(pl.totalExpenses, 1500);
    assert.equal(pl.netIncome, 3500);
  });
});

// ─── Invoices ────────────────────────────────────────────────────

describe("invoices + payments + aging", () => {
  it("createInvoice computes subtotal + tax + total per line", () => {
    const e = getOrSeedDefaultEntity(db, "u_inv");
    const r = createInvoice(db, e.id, {
      customerName: "Acme Corp",
      customerEmail: "ap@acme.com",
      lines: [
        { description: "Consulting", quantity: 10, unitPrice: 100, taxRate: 0.0825 },
        { description: "Materials",  quantity: 2,  unitPrice: 50,  taxRate: 0 },
      ],
    });
    assert.equal(r.ok, true);
    const inv = getInvoice(db, r.id);
    // Line 1: 10*100=1000 + 8.25% tax = 82.50 → 1082.50
    // Line 2: 2*50=100 + 0 tax = 100
    // Subtotal = 1100, Tax = 82.50, Total = 1182.50
    assert.equal(inv.subtotal, 1100);
    assert.equal(inv.tax_total, 82.5);
    assert.equal(inv.total, 1182.5);
    assert.equal(inv.lines.length, 2);
  });

  it("invoice status ladder: draft → sent → partial → paid", () => {
    const e = getOrSeedDefaultEntity(db, "u_ladder");
    const r = createInvoice(db, e.id, {
      customerName: "Beta Inc",
      lines: [{ description: "Service", quantity: 1, unitPrice: 1000, taxRate: 0 }],
    });
    assert.equal(getInvoice(db, r.id).status, "draft");
    markInvoiceSent(db, r.id);
    assert.equal(getInvoice(db, r.id).status, "sent");
    recordInvoicePayment(db, e.id, { invoiceId: r.id, amount: 400, recordedBy: "u_ladder" });
    assert.equal(getInvoice(db, r.id).status, "partial");
    recordInvoicePayment(db, e.id, { invoiceId: r.id, amount: 600, recordedBy: "u_ladder" });
    assert.equal(getInvoice(db, r.id).status, "paid");
  });

  it("invoice_aging buckets correctly by daysOverdue", () => {
    const e = getOrSeedDefaultEntity(db, "u_aging");
    const inv = createInvoice(db, e.id, {
      customerName: "Late Co",
      issuedDate: "2026-01-01",
      dueDate: "2026-01-15",
      lines: [{ description: "x", quantity: 1, unitPrice: 500, taxRate: 0 }],
    });
    markInvoiceSent(db, inv.id);
    const aging = computeInvoiceAging(db, e.id, { asOfDate: "2026-05-18" });
    // 2026-05-18 is 123 days after 2026-01-15 → over_90
    assert.ok(aging.buckets.over_90 >= 500);
  });

  it("voidInvoice can't void a paid invoice", () => {
    const e = getOrSeedDefaultEntity(db, "u_voidinv");
    const inv = createInvoice(db, e.id, { customerName: "X", lines: [{ description: "x", quantity: 1, unitPrice: 100, taxRate: 0 }] });
    markInvoiceSent(db, inv.id);
    recordInvoicePayment(db, e.id, { invoiceId: inv.id, amount: 100, recordedBy: "u_voidinv" });
    const v = voidInvoice(db, e.id, inv.id);
    assert.equal(v.ok, false); // already paid → status filter blocks
  });
});

// ─── Budgets ─────────────────────────────────────────────────────

describe("budgets + variance", () => {
  it("createBudget + computeBudgetVariance returns per-account variance %", () => {
    const e = createEntity(db, "u_budg", { name: "Budg Co" });
    const accs = listCoa(db, e.id);
    const cash = accs.find((a) => a.code === "1010");
    const rent = accs.find((a) => a.code === "6010");
    const rev = accs.find((a) => a.code === "4010");
    // Plan: Rent 1000, Revenue 5000
    const budget = createBudget(db, e.id, {
      name: "Q1 2026",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      lines: [
        { accountId: rent.id, amount: 1000 },
        { accountId: rev.id, amount: 5000 },
      ],
      createdBy: "u_budg",
    });
    // Actual: Rent 1200, Revenue 4500
    postJournalEntry(db, e.id, {
      date: "2026-02-15",
      lines: [{ accountId: rent.id, debit: 1200, credit: 0 }, { accountId: cash.id, debit: 0, credit: 1200 }],
      postedBy: "u_budg",
    });
    postJournalEntry(db, e.id, {
      date: "2026-02-20",
      lines: [{ accountId: cash.id, debit: 4500, credit: 0 }, { accountId: rev.id, debit: 0, credit: 4500 }],
      postedBy: "u_budg",
    });
    const v = computeBudgetVariance(db, e.id, budget.id);
    const rentVar = v.variance.find((l) => l.code === "6010");
    const revVar = v.variance.find((l) => l.code === "4010");
    assert.equal(rentVar.planned, 1000);
    assert.equal(rentVar.actual, 1200);
    assert.equal(rentVar.variance, 200);
    assert.equal(rentVar.pctVariance, 20);
    assert.equal(revVar.actual, 4500);
    assert.equal(revVar.variance, -500);
    assert.equal(revVar.pctVariance, -10);
  });
});

// ─── Macros end-to-end ──────────────────────────────────────────

describe("macros", () => {
  it("journal_post via macro round-trips through entity resolution", async () => {
    const seed = getOrSeedDefaultEntity(db, "u_macro");
    const accs = listCoa(db, seed.id);
    const cash = accs.find((a) => a.code === "1010");
    const rev = accs.find((a) => a.code === "4010");
    const r = await MACROS.get("journal_post")(ctx("u_macro"), {
      date: "2026-05-18",
      memo: "via macro",
      lines: [{ accountId: cash.id, debit: 50, credit: 0 }, { accountId: rev.id, debit: 0, credit: 50 }],
    });
    assert.equal(r.ok, true);
    assert.ok(r.number.startsWith("JE-"));
  });

  it("entity_list returns mine only", async () => {
    const r = await MACROS.get("entity_list")(ctx("u_macro_2"));
    assert.equal(r.ok, true);
    // No entities yet for u_macro_2 (this user hasn't been seeded)
    assert.equal(r.entities.length, 0);
  });

  it("trial_balance via macro auto-seeds entity + returns isBalanced", async () => {
    const r = await MACROS.get("trial_balance")(ctx("u_auto_seed"));
    assert.equal(r.ok, true);
    assert.equal(r.isBalanced, true);
    // u_auto_seed got a personal entity seeded with CoA but no JEs
    assert.equal(r.totalDebits, 0);
    assert.equal(r.totalCredits, 0);
  });
});
