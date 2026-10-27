/**
 * Non-finite input guard (probe 2026-10-27, class 1).
 * JSON.parse("1e999") is Infinity and Number("Infinity") is too, so money
 * fields could hold Infinity (an unlimited gift card). Pins both layers:
 * the global gate in invokeLensHandler and the handler-level checks.
 *
 * Run: node --test tests/finite-input-guard.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findNonFiniteInput, rejectNonFiniteInput, isNonFiniteNumericString,
  finiteOrNull, boundedNum, moneyOrNull,
} from "../lib/finite-input.js";
import { invokeLensHandler } from "../lib/lens-action-dispatch.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ctx = { actor: { userId: "u1" }, userId: "u1" };

async function domain(name) {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  const m = await import(`../domains/${name}.js`);
  const reg = new Map();
  m.default((_d, a, h) => reg.set(a, h));
  return (action, params) => reg.get(action)(ctx, { data: {} }, params);
}

test("finds non-finite numbers at any depth", () => {
  assert.equal(findNonFiniteInput(JSON.parse('{"value":1e999}')), "value");
  assert.equal(findNonFiniteInput(JSON.parse('{"a":{"b":[1,2,-1e999]}}')), "a.b[2]");
  assert.equal(findNonFiniteInput({ x: NaN }), "x");
  assert.equal(findNonFiniteInput(Infinity), "(root)");
});

test("finds numeric-looking strings that parse to non-finite", () => {
  for (const s of ["Infinity", "-Infinity", "+Infinity", "NaN", "1e999", " 1E400 ", "-1e999"]) {
    assert.equal(isNonFiniteNumericString(s), true, s);
    assert.equal(findNonFiniteInput({ amount: s }), "amount", s);
  }
});

test("legit input passes: names, words, finite numbers, numeric strings", () => {
  assert.equal(findNonFiniteInput({ amount: 12.5, qty: "3", big: "1e20", neg: -4, zero: 0 }), null);
  assert.equal(findNonFiniteInput({ city: "Nancy", note: "to infinity and beyond", code: "abc" }), null);
  // Free-text keys never trip the string rule, even when the text is exactly a number word.
  assert.equal(findNonFiniteInput({ name: "NaN", title: "Infinity", tags: ["NaN"], description: "1e999" }), null);
  assert.equal(findNonFiniteInput(null), null);
  assert.equal(findNonFiniteInput({ when: new Date(), list: [] }), null);
});

test("bounded: deep or huge bodies stop scanning instead of refusing", () => {
  let deep = { v: Infinity };
  for (let i = 0; i < 50; i++) deep = { n: deep };
  assert.equal(findNonFiniteInput(deep), null);
  const big = Array.from({ length: 20000 }, (_, i) => i);
  big.push(Infinity);
  const t0 = Date.now();
  assert.equal(findNonFiniteInput({ big }), null);
  assert.ok(Date.now() - t0 < 200);
});

test("rejectNonFiniteInput uses the invalid_input shape and maps to HTTP 400", () => {
  const r = rejectNonFiniteInput({ initialValue: "Infinity" });
  assert.deepEqual(r, { ok: false, error: "invalid_input", field: "initialValue", reason: "non_finite_number" });
  assert.equal(shapeLensRunHttp(r).status, 400);
  assert.equal(rejectNonFiniteInput({ initialValue: 25 }), null);
});

test("invokeLensHandler refuses non-finite input before the handler runs", async () => {
  let ran = false;
  const handler = () => { ran = true; return { ok: true }; };
  const r = await invokeLensHandler(handler, ctx, {}, JSON.parse('{"initialValue":1e999}'), null);
  assert.equal(r.error, "invalid_input");
  assert.equal(ran, false);
  const ok = await invokeLensHandler(handler, ctx, {}, { initialValue: 25 }, null);
  assert.equal(ok.ok, true);
  assert.equal(ran, true);
});

test("number helpers", () => {
  assert.equal(finiteOrNull("12.5"), 12.5);
  assert.equal(finiteOrNull("Infinity"), null);
  assert.equal(finiteOrNull("abc"), null);
  assert.equal(finiteOrNull(true), null);
  assert.equal(boundedNum(undefined, { min: 0 }, 7), 7);
  assert.equal(boundedNum(-1, { min: 0 }, 7), null);
  assert.equal(moneyOrNull(1e999), null);
  assert.equal(moneyOrNull("", 0), 0);
  assert.equal(moneyOrNull(19.99), 19.99);
});

test("retail gift card: Infinity / NaN / huge refused, normal value works, redeem bounded", async () => {
  const run = await domain("retail");
  for (const v of [Infinity, "Infinity", "1e999", NaN, "abc", -5, 0, 1e9]) {
    const r = await run("gift-cards-create", { initialValue: v });
    assert.equal(r.ok, false, String(v));
    assert.equal(r.error, "invalid_input");
  }
  const ok = await run("gift-cards-create", { initialValue: 50 });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.card.balance, 50);
  const code = ok.result.card.code;
  assert.equal((await run("gift-cards-redeem", { code, amount: Infinity })).ok, false);
  assert.equal((await run("gift-cards-redeem", { code, amount: 60 })).ok, false);
  const red = await run("gift-cards-redeem", { code, amount: 50 });
  assert.equal(red.ok, true);
  assert.equal(red.result.status, "redeemed");
});

test("finance: tax-estimate, monthly income, transactions refuse non-finite", async () => {
  const run = await domain("finance");
  assert.equal((await run("tax-estimate", { wages: "Infinity" })).error, "invalid_input");
  assert.equal((await run("tax-estimate", { otherIncome: Infinity })).error, "invalid_input");
  const ok = await run("tax-estimate", { wages: 85000 });
  assert.equal(ok.ok, true);
  assert.ok(!/Infinity|NaN/.test(JSON.stringify(ok)));
  assert.equal((await run("monthly-income-set", { monthlyIncome: Infinity })).ok, false);
  assert.equal((await run("monthly-income-set", { monthlyIncome: 5000 })).ok, true);
  assert.equal((await run("transactions-ingest", { description: "x", amount: Infinity })).ok, false);
  assert.equal((await run("cashflow-forecast", { startBalance: Infinity })).ok, false);
  assert.equal((await run("accounts-link", { institution: "B", name: "C", balance: -Infinity })).ok, false);
  assert.equal((await run("accounts-link", { institution: "B", name: "C", kind: "credit", balance: -250 })).ok, true);
});

test("realestate calc-affordability returns a validation error for bad inputs", async () => {
  const run = await domain("realestate");
  const base = { grossIncome: 120000, monthlyDebts: 500, downPayment: 40000, rate: 6.5, termYears: 30 };
  for (const [k, v] of [["downPayment", NaN], ["downPayment", Infinity], ["downPayment", -1], ["downPayment", "abc"], ["rate", -1], ["rate", Infinity], ["termYears", 0], ["monthlyDebts", "abc"]]) {
    const r = await run("calc-affordability", { ...base, [k]: v });
    assert.equal(r.ok, false, `${k}=${v}`);
    assert.equal(r.error, "invalid_input");
    assert.equal(r.field, k);
  }
  const ok = await run("calc-affordability", base);
  assert.equal(ok.ok, true);
  assert.ok(!/Infinity|NaN/.test(JSON.stringify(ok)));
});

test("trades invoice taxRate must be a finite fraction 0..1", async () => {
  const art = { data: { workOrders: [{ description: "w", laborHours: 2, laborRate: 50, materials: [] }] } };
  // generateInvoice reads artifact.data, so call the raw handler.
  const m = await import("../domains/trades.js");
  const reg = new Map();
  m.default((_d, a, h) => reg.set(a, h));
  const h = reg.get("generateInvoice");
  for (const t of ["abc", -1, Infinity, NaN, 8]) {
    const r = await h(ctx, art, { taxRate: t });
    assert.equal(r.ok, false, String(t));
  }
  const ok = await h(ctx, art, { taxRate: 0.08 });
  assert.equal(ok.ok, true);
  assert.ok(!/Infinity|NaN/.test(JSON.stringify(ok)));
});

test("other money sites refuse Infinity", async () => {
  const trades = await domain("trades");
  assert.equal((await trades("payments-create-link", { invoiceRef: "i1", amount: Infinity })).ok, false);
  assert.equal((await trades("recurring-plans-create", { customerId: "c", serviceType: "s", priceEach: Infinity })).ok, false);
  const gov = await domain("government");
  assert.equal((await gov("fines-create", { payerName: "p", reason: "r", amountUsd: Infinity })).ok, false);
  assert.equal((await gov("permits-apply", { applicantName: "a", applicantEmail: "a@b.c", kind: "k", feeUsd: Infinity })).ok, false);
  const legal = await domain("legal");
  assert.equal((await legal("matters-create", { name: "m", flatFee: Infinity })).ok, false);
  assert.equal((await legal("matters-create", { name: "m", flatFee: 500 })).ok, true);
  const law = await domain("law");
  assert.equal((await law("contract-create", { title: "t", value: Infinity })).ok, false);
  const crypto = await domain("crypto");
  assert.equal((await crypto("nfts-add", { name: "n", costBasisUsd: Infinity })).ok, false);
  const mkt = await domain("marketplace");
  assert.equal((await mkt("listings-create", { title: "t", priceUsd: 5, shippingCostUsd: Infinity })).ok, false);
  const food = await domain("food");
  assert.equal((await food("pantry-add", { itemName: "rice", qty: Infinity })).ok, false);
  assert.equal((await food("waste-log-add", { itemName: "rice", estimatedCostImpact: Infinity })).ok, false);
  const events = await domain("events");
  assert.equal((await events("settlementCalc", { ticketsSold: 10, ticketPrice: "abc" })).ok, false);
  const ev = await events("settlementCalc", { ticketsSold: 100, ticketPrice: 20, guarantee: 500, doorSplit: 80 });
  assert.equal(ev.ok, true);
  assert.equal(ev.result.settlement, 1600);
});
