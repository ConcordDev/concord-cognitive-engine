/**
 * Money guards, terminal-transition idempotency, and supply-chain deletes.
 *
 * Run: NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/money-guards.test.js
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertPayable, assertTransition } from "../lib/money-guards.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";
import registerAccounting from "../domains/accounting.js";
import registerFinance from "../domains/finance.js";
import registerTrades from "../domains/trades.js";
import registerVeterinary from "../domains/veterinary.js";
import registerPlumbing from "../domains/plumbing.js";
import registerMasonry from "../domains/masonry.js";
import registerSupplychain from "../domains/supplychain.js";
import registerPharmacy from "../domains/pharmacy.js";
import registerHvac from "../domains/hvac.js";
import registerLegal from "../domains/legal.js";
import registerCustom from "../domains/custom.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}, userId = "user_a") {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} registered`);
  const ctx = { actor: { userId }, userId, state: globalThis._concordSTATE };
  return fn(ctx, { id: null, domain, type: "domain_action", data: params, meta: {} }, params);
}

before(() => {
  registerAccounting(register);
  registerFinance(register);
  registerTrades(register);
  registerVeterinary(register);
  registerPlumbing(register);
  registerMasonry(register);
  registerSupplychain(register);
  registerPharmacy(register);
  registerHvac(register);
  registerLegal(register);
  registerCustom(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("assertPayable / assertTransition", () => {
  it("refuses non-positive and overpay, and allows a payment inside the balance", () => {
    assert.equal(assertPayable(100, -50).error, "invalid_amount");
    assert.equal(assertPayable(100, 0).error, "invalid_amount");
    assert.equal(assertPayable(100, 1e9).error, "amount_exceeds_balance");
    assert.equal(assertPayable(100, 40).ok, true);
    assert.equal(assertPayable(100, 40, { alreadyPaid: true }).error, "already_paid");
  });

  it("refuses an unknown status and does not treat a repeat terminal move as a new transition", () => {
    const map = { pending: ["approved", "rejected"], approved: [], rejected: [] };
    assert.equal(assertTransition("pending", "zz_bogus", map).error, "invalid_status");
    assert.equal(assertTransition("pending", "approved", map).ok, true);
    assert.equal(assertTransition("approved", "approved", map).unchanged, true);
    assert.equal(assertTransition("approved", "pending", map).error, "invalid_transition");
  });
});

describe("overpay rows and INC money/state holes", () => {
  it("accounting tax-payment-record refuses 1e9 against a smaller liability", () => {
    call("accounting", "coa-list", {});
    const accounts = call("accounting", "coa-list", {}).result.accounts;
    const tax = accounts.find((a) => a.code === "2100");
    const cash = accounts.find((a) => a.code === "1000");
    call("accounting", "je-post", {
      memo: "collected tax",
      lines: [
        { accountId: cash.id, debit: 300, credit: 0 },
        { accountId: tax.id, debit: 0, credit: 300 },
      ],
    });
    const over = call("accounting", "tax-payment-record", { amount: 1e9 });
    assert.equal(over.ok, false);
    assert.equal(over.error, "amount_exceeds_balance");
    const pay = call("accounting", "tax-payment-record", { amount: 300 });
    assert.equal(pay.ok, true, JSON.stringify(pay));
    assert.equal(call("accounting", "tax-liability", {}).result.salesTaxPayable, 0);
  });

  it("finance bills-pay refuses -50 and 1e9, and a second pay is unchanged", () => {
    const bill = call("finance", "bills-add", { name: "Rent", amount: 900, dueDay: 1, cadence: "monthly" }).result.bill;
    assert.equal(call("finance", "bills-pay", { id: bill.id, amount: -50 }).error, "invalid_amount");
    assert.equal(call("finance", "bills-pay", { id: bill.id, amount: 1e9 }).error, "amount_exceeds_balance");
    assert.equal(call("finance", "bills-pay", { id: bill.id }).ok, true);
    const again = call("finance", "bills-pay", { id: bill.id });
    assert.equal(again.unchanged, true);
    assert.equal(again.result.bill.paidThisCycle, true);
  });

  it("trades invoices-record-payment refuses an amount above the balance (INC-109)", () => {
    const inv = call("trades", "invoices-create", {
      customerName: "Ada",
      lineItems: [{ qty: 1, unitPrice: 80 }],
      taxRate: 0,
    }).result.invoice;
    const over = call("trades", "invoices-record-payment", { id: inv.id, amount: 1e9 });
    assert.equal(over.error, "amount_exceeds_balance");
    assert.equal(call("trades", "invoices-record-payment", { id: inv.id, amount: 80 }).ok, true);
    assert.equal(call("trades", "invoices-record-payment", { id: inv.id, amount: 1 }).error, "invoice already paid");
  });

  it("veterinary refuses an empty paid invoice and an overpay (INC-123)", () => {
    const empty = call("veterinary", "invoice-create", { patientName: "Miso", lineItems: [] });
    assert.equal(empty.ok, false);
    const inv = call("veterinary", "invoice-create", {
      patientName: "Miso",
      lineItems: [{ description: "Exam", qty: 1, unitPrice: 40 }],
    }).result.invoice;
    assert.equal(inv.status, "unpaid");
    assert.equal(call("veterinary", "invoice-pay", { id: inv.id, amount: 1e9 }).error, "amount_exceeds_balance");
    assert.equal(call("veterinary", "invoice-pay", { id: inv.id, amount: -50 }).error, "payment amount required");
    assert.equal(call("veterinary", "invoice-pay", { id: inv.id, amount: 40 }).ok, true);
    assert.equal(call("veterinary", "invoice-pay", { id: inv.id, amount: 1 }).error, "already_paid");
  });

  it("plumbing invoiceRecordPayment refuses an overpay (INC-114)", () => {
    const inv = call("plumbing", "invoiceFromQuote", {
      lines: [{ name: "Pipe", quantity: 1, unitPrice: 100 }],
    }).result.invoice;
    assert.equal(call("plumbing", "invoiceRecordPayment", { invoiceId: inv.id, amount: 1e9 }).error, "amount_exceeds_balance");
    assert.equal(call("plumbing", "invoiceRecordPayment", { invoiceId: inv.id, amount: 100 }).result.invoice.status, "paid");
  });

  it("masonry refuses a bogus change-order status and does not reuse invoice numbers (INC-121, INC-122)", () => {
    const co = call("masonry", "change-order-create", { description: "Extra course", laborHours: 2 }).result;
    assert.equal(call("masonry", "change-order-sign", { id: co.id, status: "zz_bogus" }).error, "invalid_status");
    const signed = call("masonry", "change-order-sign", { id: co.id, status: "approved", signedBy: "Owner" });
    assert.equal(signed.result.status, "approved");
    const stamped = signed.result.signedOffAt;
    const again = call("masonry", "change-order-sign", { id: co.id, status: "approved" });
    assert.equal(again.unchanged, true);
    assert.equal(again.result.signedOffAt, stamped);

    const first = call("masonry", "invoice-create", { client: "Acme", contractTotal: 1000, progressPct: 100 }).result;
    call("masonry", "invoice-delete", { id: first.id });
    const second = call("masonry", "invoice-create", { client: "Acme", contractTotal: 500, progressPct: 100 }).result;
    assert.notEqual(second.number, first.number);
    assert.equal(call("masonry", "invoice-record-payment", { id: second.id, amount: 1e9 }).error, "amount_exceeds_balance");
  });
});

describe("supplychain deletes and repeat terminals", () => {
  it("deletes a shipment by id, survives a snapshot, and 404s the second delete", () => {
    const created = call("supplychain", "shipmentCreate", { reference: "SHP-1", origin: "Shanghai", destination: "Los Angeles" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.result.shipment.id;
    const del = call("supplychain", "shipmentDelete", { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.removed, 1);
    assert.equal(call("supplychain", "shipmentList", {}).result.shipments.some((s) => s.id === id), false);
    const snap = serializeLensState(globalThis._concordSTATE);
    const fresh = {};
    hydrateLensState(fresh, snap);
    globalThis._concordSTATE = fresh;
    assert.equal(call("supplychain", "shipmentList", {}).result.shipments.some((s) => s.id === id), false);
    const again = call("supplychain", "shipmentDelete", { shipmentId: id });
    assert.equal(again.ok, false);
    assert.equal(again.error, "not_found");

    const wo = call("supplychain", "workOrderCreate", { item: "Bolt", quantity: 2, unitCost: 3 }).result.workOrder;
    assert.equal(call("supplychain", "workOrderDelete", { id: wo.id }).result.removed, 1);
    assert.equal(call("supplychain", "workOrderDelete", { workOrderId: wo.id }).error, "not_found");
  });

  it("a second cancel or close does not re-stamp", () => {
    const agr = call("hvac", "agreement-create", { client: "Ada" }).result.agreement;
    const once = call("hvac", "agreement-cancel", { id: agr.id });
    assert.equal(once.result.agreement.status, "cancelled");
    const stamped = once.result.agreement.cancelledAt;
    const twice = call("hvac", "agreement-cancel", { id: agr.id });
    assert.equal(twice.unchanged, true);
    assert.equal(twice.result.agreement.cancelledAt, stamped);

    const matter = call("legal", "matters-create", { name: "Ada v. Bob" });
    assert.equal(matter.ok, true, JSON.stringify(matter));
    const closed = call("legal", "matters-close", { id: matter.result.matter.id });
    const closedAt = closed.result.matter.closedAt;
    const reclosed = call("legal", "matters-close", { id: matter.result.matter.id });
    assert.equal(reclosed.unchanged, true);
    assert.equal(reclosed.result.matter.closedAt, closedAt);
  });

  it("a second caregiver or canvas delete is not_found", () => {
    const cg = call("pharmacy", "caregiver-add", { name: "Kai" }).result.caregiver;
    assert.equal(call("pharmacy", "caregiver-remove", { id: cg.id }).result.removed, 1);
    assert.equal(call("pharmacy", "caregiver-remove", { id: cg.id }).error, "not_found");

    const canvas = call("custom", "canvasCreate", { name: "Board" });
    assert.equal(canvas.ok, true, JSON.stringify(canvas));
    const canvasId = canvas.result.canvas?.id || canvas.result.id;
    assert.equal(call("custom", "canvasDelete", { canvasId }).ok, true);
    assert.equal(call("custom", "canvasDelete", { canvasId }).error, "not_found");
  });
});
