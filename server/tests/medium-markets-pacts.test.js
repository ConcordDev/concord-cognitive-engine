import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketsActions from "../domains/markets.js";
import registerInsuranceActions from "../domains/insurance.js";

const MARKETS = new Map();
const INSURANCE = new Map();
function register(domain, name, fn) {
  if (domain === "markets") MARKETS.set(name, fn);
  if (domain === "insurance") INSURANCE.set(name, fn);
}
function market(name, params = {}) {
  return MARKETS.get(name)({ actor: { userId: "user_a" } }, { id: null, data: {}, meta: {} }, params);
}
function pact(name, params = {}) {
  return INSURANCE.get(name)({ actor: { userId: "ins_alpha" } }, params);
}

before(() => {
  registerMarketsActions(register);
  registerInsuranceActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("markets — closing and category order", () => {
  it("lists a still-open market before one whose close is already past", () => {
    const soon = market("market-create", {
      question: "Open market still ahead?",
      resolutionCriteria: "Resolves from the recorded close time.",
      category: "politics",
      closesAt: Date.now() + 86_400_000,
    });
    const later = market("market-create", {
      question: "Open market further out?",
      resolutionCriteria: "Resolves from the recorded close time.",
      category: "sports",
      closesAt: Date.now() + 8 * 86_400_000,
    });
    assert.equal(soon.ok, true);
    assert.equal(later.ok, true);
    const past = globalThis._concordSTATE.predictionMarkets.markets.get(soon.result.market.id);
    past.closesAt = Date.now() - 86_400_000;
    const list = market("market-list", { sort: "closing" });
    assert.equal(list.result.markets[0].id, later.result.market.id);
    const politics = market("market-list", { category: "Politics" });
    assert.equal(politics.result.markets.length, 1);
    assert.equal(politics.result.markets[0].category, "politics");
  });

  it("orders volume by recorded trades, not only the seed pool", () => {
    const quiet = market("market-create", {
      question: "Quiet pool market?",
      resolutionCriteria: "Resolves from recorded trades.",
      category: "tech",
    });
    const busy = market("market-create", {
      question: "Busy traded market?",
      resolutionCriteria: "Resolves from recorded trades.",
      category: "tech",
    });
    const row = globalThis._concordSTATE.predictionMarkets.markets.get(busy.result.market.id);
    row.priceHistory.push({ t: Date.now(), yesProbability: 0.6, poolYes: 12, poolNo: 8 });
    const list = market("market-list", { sort: "volume" });
    assert.equal(list.result.markets[0].id, busy.result.market.id);
    assert.notEqual(quiet.result.market.id, list.result.markets[0].id);
  });
});

describe("death-insurance — a split and a renewal say what they stored", () => {
  it("refuses a share that is not a positive part of 100", () => {
    const zero = pact("pact-write", {
      beneficiaryUserId: "bene_a",
      beneficiaries: [{ userId: "bene_a", sharePct: 0 }],
      payoutSparks: 100, premiumSparks: 10,
    });
    assert.equal(zero.ok, false);
    assert.match(zero.message, /greater than 0/);
    const uneven = pact("pact-write", {
      beneficiaries: [
        { userId: "bene_a", sharePct: 40 },
        { userId: "bene_b", sharePct: 40 },
      ],
      payoutSparks: 100, premiumSparks: 10,
    });
    assert.equal(uneven.ok, false);
    assert.match(uneven.message, /add up to 100/);
  });

  it("refuses a 0-day term on write and on renew", () => {
    const wrote = pact("pact-write", {
      beneficiaryUserId: "bene_a",
      payoutSparks: 100, premiumSparks: 10, durationDays: 0,
    });
    assert.equal(wrote.ok, false);
    assert.match(wrote.message, /1 or greater/);
    const ok = pact("pact-write", {
      beneficiaryUserId: "bene_a",
      payoutSparks: 100, premiumSparks: 10, durationDays: 14,
    });
    assert.equal(ok.ok, true);
    const renew = pact("pact-renew", { pactId: ok.result.pact.id, durationDays: 0 });
    assert.equal(renew.ok, false);
    assert.match(renew.message, /1 or greater/);
    assert.equal(ok.result.pact.durationDays, 14);
  });
});
