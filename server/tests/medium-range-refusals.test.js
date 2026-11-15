import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMining from "../domains/mining.js";
import registerPlumbing from "../domains/plumbing.js";
import registerLogistics from "../domains/logistics.js";
import registerBlackMarket from "../domains/black-market.js";
import registerCrisis from "../domains/crisis.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function callLens(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}
function callMacro(domain, name, input) {
  return actions.get(`${domain}.${name}`)(ctx, input);
}

before(() => {
  registerMining(register);
  registerPlumbing(register);
  registerLogistics(register);
  registerBlackMarket(register);
  registerCrisis(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("out-of-range values are refused instead of rewritten", () => {
  it("refuses a negative pit depth", () => {
    const bad = callLens("mining", "pit-design", { pitDepth: -120 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Pit depth/);
    const ok = callLens("mining", "pit-design", { pitDepth: 120, benchHeight: 15 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.pitDepth, 120);
  });

  it("refuses a price-book cost above one million", () => {
    const bad = callLens("plumbing", "priceItemAdd", { name: "Huge", cost: 99999999, markupPct: 0 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /1,000,000/);
    const ok = callLens("plumbing", "priceItemAdd", { name: "Valve", cost: 10, markupPct: 0 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.item.cost, 10);
  });

  it("refuses a non-positive shipment weight", async () => {
    const bad = await callLens("logistics", "rates-quote", { origin: "10001", destination: "94105", weightLbs: -5 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Weight/);
  });

  it("refuses a non-positive watch price", () => {
    const bad = callLens("black-market", "watch-add", { keyword: "cipher", maxPrice: -5 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Max price/);
    const ok = callLens("black-market", "watch-add", { keyword: "cipher", maxPrice: 12 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.watch.maxPrice, 12);
  });

  it("refuses a zero, negative, or huge asset quantity", async () => {
    for (const quantity of [0, -5, 99999999999]) {
      const bad = await callMacro("crisis", "resource_upsert", { name: "boats", quantity });
      assert.equal(bad.ok, false);
      assert.match(bad.message, /1 to 1,000,000/);
    }
    const ok = await callMacro("crisis", "resource_upsert", { name: "boats", quantity: 4 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.resource.quantity, 4);
  });
});
