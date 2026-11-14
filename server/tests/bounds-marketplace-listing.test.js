// GB-1539 bounds enforcement — FIX-market-004 (listing title).
// The walk: a 250-character listing title was accepted with Submit
// enabled — no max length or counter. listings-create and
// listings-update now consume the bounds policy: the title refuses
// over 200 with invalid_input, the description over the note class,
// and price/stock over their caps. Validation only — no money paths
// are touched (money OFF).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketplaceActions from "../domains/marketplace.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`marketplace.${name}`);
  if (!fn) throw new Error(`marketplace.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketplaceActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_mkt_a" }, userId: "bnd_mkt_a" };

describe("listing bounds (FIX-market-004)", () => {
  it("a 250-character title refuses with invalid_input naming 200", () => {
    const r = call("listings-create", ctxA, { title: "x".repeat(250), priceUsd: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("a title at the limit creates", () => {
    const r = call("listings-create", ctxA, { title: "x".repeat(200), priceUsd: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.listing.title.length, 200);
  });

  it("a price over the money cap refuses", () => {
    const r = call("listings-create", ctxA, { title: "Thing", priceUsd: 99999999999 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
  });

  it("a refused create writes nothing", () => {
    call("listings-create", ctxA, { title: "x".repeat(250), priceUsd: 10 });
    const list = call("listings-list", ctxA, {});
    const items = list.result?.listings || list.result?.items || [];
    assert.equal(items.length, 0);
  });

  it("listings-update refuses an over-limit title and keeps the old one", () => {
    const created = call("listings-create", ctxA, { title: "Wooden chair", priceUsd: 40 });
    const id = created.result.listing.id;
    const r = call("listings-update", ctxA, { id, title: "y".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    const list = call("listings-list", ctxA, {});
    const items = list.result?.listings || list.result?.items || [];
    assert.equal(items.find((i) => i.id === id).title, "Wooden chair");
  });
});
