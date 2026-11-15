/**
 * FIX-markets-002 exercise pin — market-create seed handling.
 *
 * The ticket: a market created through the lens UI "showed pool size 2"
 * regardless of the seed entered. This pin exercises the real handler:
 * the created market's totalPool must equal the seed the creator chose
 * (split symmetrically), the default seed is 10, and an out-of-range
 * seed is refused by name. Display/seed leg only — no economics change.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketsActions from "../domains/markets.js";
import { _resetMarketFeedForTests } from "../lib/market-feed-sources.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`markets.${name}`);
  if (!fn) throw new Error(`markets.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketsActions(register); });
beforeEach(() => {
  _resetMarketFeedForTests();
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const BASE = { question: "Will the seed pin hold?", resolutionCriteria: "Resolves on the pin outcome" };

describe("FIX-markets-002 — market-create seed → pool", () => {
  it("a chosen seed of 100 becomes a total pool of 100, split 50/50", () => {
    const r = call("market-create", ctxA, { ...BASE, seedSparks: 100 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = r.result?.market || r.result;
    assert.equal(m.totalPool, 100);
    assert.equal(m.poolYes, 50);
    assert.equal(m.poolNo, 50);
  });

  it("no seed chosen defaults to a total pool of 10", () => {
    const r = call("market-create", ctxA, { ...BASE });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = r.result?.market || r.result;
    assert.equal(m.totalPool, 10);
  });

  it("the minimum seed of 2 is honoured as 2 — not silently replaced", () => {
    const r = call("market-create", ctxA, { ...BASE, seedSparks: 2 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = r.result?.market || r.result;
    assert.equal(m.totalPool, 2);
  });

  it("an out-of-range seed is refused by name, not clamped", () => {
    const r = call("market-create", ctxA, { ...BASE, seedSparks: 500 });
    assert.equal(r.ok, false);
    assert.match(String(r.message || r.error || ""), /2 to 200/);
  });
});

describe("FIX-markets-015 — bet placement returns visible confirmation data", () => {
  it("position-open returns the placed position and the moved market", () => {
    const c = call("market-create", ctxA, { ...BASE, seedSparks: 100 });
    const mkt = c.result?.market || c.result;
    const r = call("position-open", ctxA, { marketId: mkt.id, side: "yes", stakeSparks: 25 });
    assert.equal(r.ok, true, JSON.stringify(r));
    // The FE flashes "✓ Staked 25 ⚡ YES" from exactly this payload and
    // renders failures from the ok:false error — both paths speak.
    assert.equal(r.result.position.stakeSparks, 25);
    assert.equal(r.result.position.side, "yes");
    assert.equal(r.result.market.totalPool, 125);
    const bad = call("position-open", ctxA, { marketId: mkt.id, side: "yes", stakeSparks: 0 });
    assert.equal(bad.ok, false);
    assert.ok(bad.error, "a refused bet names its error for the flash");
  });
});
