// FIX-housing-003 — the Desk's RealEstateActionPanel spoke a second dialect
// for calc-rent-vs-buy / calc-mortgage: { homePrice, monthlyRent,
// downPaymentPct, interestRate (pre-divided by 100) } and none of the
// taxRate / insurance calc-mortgage requires. Every click failed or
// NOT_COMPUTED and no result tile ever appeared, while the Workbench tabs
// (which send the macros' own field names) worked. These pins hold the
// macros' contract: the panel's old dialect fails, its aligned dialect —
// price / rent / downPercent / rate (annual %) — computes.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/realestate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`realestate.${name}`);
  if (!fn) throw new Error(`realestate.${name} not registered`);
  return fn({ actor: { userId: "u" }, userId: "u" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("realestate action-panel dialect (FIX-housing-003)", () => {
  it("calc-rent-vs-buy rejects the panel's old dialect", () => {
    const r = call("calc-rent-vs-buy", { homePrice: 500000, monthlyRent: 2500, downPaymentPct: 20, interestRate: 0.07 });
    assert.equal(r.ok, false);
    assert.match(r.error, /price must be > 0/);
  });

  it("calc-rent-vs-buy computes from the aligned dialect", () => {
    const r = call("calc-rent-vs-buy", { price: 500000, rent: 2500, downPercent: 20, rate: 7 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.verdict, "string");
    assert.ok(r.result.verdict.length > 0);
    assert.ok("breakEvenYear" in r.result);
    assert.equal(r.result.monthlyRent, 2500);
  });

  it("calc-mortgage refuses the panel's old dialect as NOT_COMPUTED", () => {
    const r = call("calc-mortgage", { price: 500000, downPaymentPct: 20, interestRate: 0.07, termYears: 30 });
    assert.equal(r.result.status, "NOT_COMPUTED");
    assert.ok(r.result.missingInputs.includes("taxRate"));
    assert.ok(r.result.missingInputs.includes("insurance"));
    assert.ok(r.result.missingInputs.includes("rate"));
  });

  it("calc-mortgage computes PITI from the aligned dialect", () => {
    const r = call("calc-mortgage", { price: 500000, downPercent: 20, rate: 7, termYears: 30, taxRate: 1.1, insurance: 1200 });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.monthly.principalAndInterest - 2661) < 5);
    assert.ok(r.result.monthly.total > r.result.monthly.principalAndInterest);
    assert.ok(r.result.totalInterest > 0);
  });
});
