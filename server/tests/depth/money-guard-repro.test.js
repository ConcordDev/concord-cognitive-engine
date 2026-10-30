// tests/depth/money-guard-repro.test.js
//
// Q28 — repro-tests for the INC-114 group (INC-114, 121, 123, 131, 133:
// overpay / fake-paid money bugs). The group's fix landed as the shared
// guard `assertPayable` (server/lib/money-guards.js, #1488), unit-pinned
// by tests/money-guards.test.js — but no test exercised the guard AT ITS
// CALL SITES, so a domain could stop calling it, call it with the wrong
// balance, or swallow its refusal and nothing would fail. This suite is
// that repro, one section per guarded payment action, run against the
// real handlers through the depth harness:
//
//   accounting  tax-payment-record      (balance = min(tax owed, cash))
//   accounting  bills-pay               (fixed-amount surface: pays the
//                                        bill's own total, refuses repeats)
//   finance     bills-pay               (guard engages when amount given)
//   masonry     invoice-record-payment
//   plumbing    invoiceRecordPayment
//   trades      invoices-record-payment
//   veterinary  invoice-pay
//
// Per surface the repro pins the group's two bug shapes:
//   OVERPAY    — paying more than the outstanding balance is refused
//                with amount_exceeds_balance and the record is untouched;
//                an overpay of the REMAINING balance after a partial
//                payment is refused too (the guard reads the live balance).
//   FAKE-PAID  — a zero / non-positive "payment" never settles a record,
//                and a settled record refuses further payments (the
//                already-paid arm, in each domain's own error string —
//                money-guards.js keeps callers' strings by design).
// Exact payment settles; that is asserted on every surface so the repro
// cannot pass by refusing everything.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("money-guard repro — masonry invoice-record-payment", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-masonry"); });

  it("overpay and zero are refused untouched; partial, remainder-overpay, settle, repeat follow the guard", async () => {
    const created = await lensRun("masonry", "invoice-create", { params: { client: "Repro", contractTotal: 1000, progressPct: 100 } }, ctx);
    assert.equal(created.ok, true);
    const inv = created.result;
    assert.equal(inv.balance, 1000);

    const over = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 1000.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "Payment amount must be positive");

    const listAfterRejects = await lensRun("masonry", "invoice-list", {}, ctx);
    const untouched = listAfterRejects.result.invoices.find(i => i.id === inv.id);
    assert.equal(untouched.payments.length, 0);
    assert.equal(untouched.balance, 1000);
    assert.equal(untouched.status, "unpaid");

    const partial = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 400 } }, ctx);
    assert.equal(partial.ok, true);
    assert.equal(partial.result.status, "partial");
    assert.equal(partial.result.balance, 600);

    const overRemainder = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 600.01 } }, ctx);
    assert.equal(overRemainder.ok, false);
    assert.equal(overRemainder.error, "amount_exceeds_balance");

    const settle = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 600 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.status, "paid");
    assert.equal(settle.result.balance, 0);

    const repeat = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.id, amount: 1 } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "already_paid");
  });
});

describe("money-guard repro — plumbing invoiceRecordPayment", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-plumbing"); });

  it("overpay and zero are refused untouched; exact settles; repeat refused", async () => {
    const created = await lensRun("plumbing", "invoiceFromQuote", { params: { client: "Repro", lines: [{ name: "Fix", quantity: 1, unitPrice: 250 }] } }, ctx);
    assert.equal(created.ok, true);
    const inv = created.result.invoice;
    assert.equal(inv.total, 250);

    const over = await lensRun("plumbing", "invoiceRecordPayment", { params: { invoiceId: inv.id, amount: 250.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("plumbing", "invoiceRecordPayment", { params: { invoiceId: inv.id, amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "amount_required");

    const listAfterRejects = await lensRun("plumbing", "invoiceList", {}, ctx);
    const untouched = listAfterRejects.result.invoices.find(i => i.id === inv.id);
    assert.equal(untouched.amountPaid, 0);
    assert.equal(untouched.status, "issued");

    const settle = await lensRun("plumbing", "invoiceRecordPayment", { params: { invoiceId: inv.id, amount: 250 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.invoice.status, "paid");
    assert.equal(settle.result.balanceDue, 0);

    const repeat = await lensRun("plumbing", "invoiceRecordPayment", { params: { invoiceId: inv.id, amount: 1 } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "already_paid");
  });
});

describe("money-guard repro — trades invoices-record-payment", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-trades"); });

  it("overpay and zero are refused; exact settles; repeat refused by the domain's own paid check", async () => {
    const created = await lensRun("trades", "invoices-create", { params: { customerName: "Repro", lineItems: [{ qty: 2, unitPrice: 150 }] } }, ctx);
    assert.equal(created.ok, true);
    const inv = created.result.invoice;
    assert.equal(inv.total, 300);

    const over = await lensRun("trades", "invoices-record-payment", { params: { id: inv.id, amount: 300.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("trades", "invoices-record-payment", { params: { id: inv.id, amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "amount must be > 0");

    const settle = await lensRun("trades", "invoices-record-payment", { params: { id: inv.id, amount: 300 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.invoice.status, "paid");
    assert.equal(settle.result.invoice.amountPaid, 300);

    const repeat = await lensRun("trades", "invoices-record-payment", { params: { id: inv.id, amount: 1 } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "invoice already paid");
  });
});

describe("money-guard repro — veterinary invoice-pay", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-veterinary"); });

  it("overpay and zero are refused; exact settles to balanceDue 0; repeat refused", async () => {
    const created = await lensRun("veterinary", "invoice-create", { params: { patientName: "Repro", lineItems: [{ description: "Exam", qty: 1, unitPrice: 120 }] } }, ctx);
    assert.equal(created.ok, true);
    const inv = created.result.invoice;
    assert.equal(inv.balanceDue, 120);

    const over = await lensRun("veterinary", "invoice-pay", { params: { id: inv.id, amount: 120.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("veterinary", "invoice-pay", { params: { id: inv.id, amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "payment amount required");

    const settle = await lensRun("veterinary", "invoice-pay", { params: { id: inv.id, amount: 120 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.invoice.balanceDue, 0);
    assert.equal(settle.result.invoice.status, "paid");

    const repeat = await lensRun("veterinary", "invoice-pay", { params: { id: inv.id, amount: 1 } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "already_paid");
  });
});

describe("money-guard repro — finance bills-pay", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-finance"); });

  it("a zero-amount 'payment' never marks the bill paid (fake-paid arm); overpay refused; exact settles; repeat is unchanged", async () => {
    const created = await lensRun("finance", "bills-add", { params: { name: "Repro Bill", amount: 200 } }, ctx);
    assert.equal(created.ok, true);
    const bill = created.result.bill;

    const over = await lensRun("finance", "bills-pay", { params: { id: bill.id, amount: 200.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("finance", "bills-pay", { params: { id: bill.id, amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "invalid_amount");

    const listAfterRejects = await lensRun("finance", "bills-list", {}, ctx);
    const untouched = listAfterRejects.result.bills.find(b => b.id === bill.id);
    assert.equal(untouched.paidThisCycle, false);
    assert.equal(untouched.lastPaidAt, null);

    const settle = await lensRun("finance", "bills-pay", { params: { id: bill.id, amount: 200 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.bill.paidThisCycle, true);

    const repeat = await lensRun("finance", "bills-pay", { params: { id: bill.id, amount: 200 } }, ctx);
    assert.equal(repeat.ok, true);
    assert.equal(repeat.unchanged, true);
  });
});

describe("money-guard repro — accounting tax-payment-record", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q28-accounting"); });

  it("the payable cap is min(tax owed, cash) read from the real journal; overpay refused; settle zeroes the liability", async () => {
    const coa = await lensRun("accounting", "coa-list", {}, ctx);
    const accounts = coa.result.accounts;
    const cash = accounts.find(a => String(a.code) === "1000");
    const tax = accounts.find(a => String(a.code) === "2100");
    const revenue = accounts.find(a => String(a.code) === "4000");
    assert.ok(cash && tax && revenue, "default CoA carries cash, sales-tax-payable and revenue accounts");

    // Seed a real liability through the journal: $1,100 cash in, $1,000
    // revenue, $100 sales tax collected -> owed 100, cash 1,100, cap 100.
    const je = await lensRun("accounting", "je-post", { params: { date: "2026-10-29", memo: "repro tax seed", lines: [
      { accountId: cash.id, debit: 1100, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: 1000 },
      { accountId: tax.id, debit: 0, credit: 100 },
    ] } }, ctx);
    assert.equal(je.ok, true);

    const liability = await lensRun("accounting", "tax-liability", {}, ctx);
    assert.equal(liability.result.salesTaxPayable, 100);

    const over = await lensRun("accounting", "tax-payment-record", { params: { amount: 100.01 } }, ctx);
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");

    const zero = await lensRun("accounting", "tax-payment-record", { params: { amount: 0 } }, ctx);
    assert.equal(zero.ok, false);
    assert.equal(zero.error, "payment amount must be positive");

    const settle = await lensRun("accounting", "tax-payment-record", { params: { amount: 100 } }, ctx);
    assert.equal(settle.ok, true);
    assert.equal(settle.result.amount, 100);

    const after = await lensRun("accounting", "tax-liability", {}, ctx);
    assert.equal(after.result.salesTaxPayable, 0);

    const repeat = await lensRun("accounting", "tax-payment-record", { params: { amount: 1 } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "amount_exceeds_balance");
  });

  it("accounting bills-pay (fixed-amount surface) pays exactly the bill total and refuses a repeat", async () => {
    const coa = await lensRun("accounting", "coa-list", {}, ctx);
    const expense = coa.result.accounts.find(a => a.category === "expense");
    assert.ok(expense, "default CoA carries an expense account");

    const vendor = await lensRun("accounting", "vendors-create", { params: { name: "Repro Vendor" } }, ctx);
    assert.equal(vendor.ok, true);

    const created = await lensRun("accounting", "bills-create", { params: { vendorId: vendor.result.vendor.id, total: 75, expenseAccountId: expense.id } }, ctx);
    assert.equal(created.ok, true);
    const bill = created.result.bill;
    assert.equal(bill.status, "open");

    const paid = await lensRun("accounting", "bills-pay", { params: { id: bill.id } }, ctx);
    assert.equal(paid.ok, true);
    assert.equal(paid.result.bill.status, "paid");

    const repeat = await lensRun("accounting", "bills-pay", { params: { id: bill.id } }, ctx);
    assert.equal(repeat.ok, false);
    assert.equal(repeat.error, "bill already paid");
  });
});
