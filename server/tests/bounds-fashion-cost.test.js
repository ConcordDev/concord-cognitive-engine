// GB-1539 bounds enforcement — FIX-fashion-006 (closet item cost / name).
// The walk: Cost ($) accepted -5 and 99999999999 in the field silently
// (never submitted). The server now consumes the ONE bounds policy:
// cost refuses negatives and anything over the 1,000,000 money cap in
// the invalid_input shape; a name over the 200 title limit refuses
// instead of truncating; in-policy items add and update as before.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFashionActions from "../domains/fashion.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`fashion.${name}`);
  if (!fn) throw new Error(`fashion.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFashionActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "bnd_fash_a" }, userId: "bnd_fash_a" };

describe("fashion item bounds (FIX-fashion-006)", () => {
  it("cost -5 refuses with invalid_input", () => {
    const r = call("item-add", ctxA, { name: "Coat", cost: -5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /cost/);
  });

  it("cost 99999999999 refuses (money cap), as does 9,999,999 (over the policy cap)", () => {
    assert.equal(call("item-add", ctxA, { name: "Coat", cost: 99999999999 }).error, "invalid_input");
    assert.equal(call("item-add", ctxA, { name: "Coat", cost: 9999999 }).error, "invalid_input");
  });

  it("cost at the cap and ordinary costs add fine", () => {
    assert.equal(call("item-add", ctxA, { name: "Coat", cost: 1000000 }).ok, true);
    assert.equal(call("item-add", ctxA, { name: "Tee", cost: 25 }).ok, true);
  });

  it("a 300-character name refuses instead of truncating to 120", () => {
    const r = call("item-add", ctxA, { name: "x".repeat(300), cost: 10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("a refused add writes nothing", () => {
    call("item-add", ctxA, { name: "Coat", cost: -5 });
    const r = call("item-list", ctxA, {});
    assert.equal(r.result.count, 0);
  });

  it("item-update with a negative cost refuses and leaves the item unchanged", () => {
    const added = call("item-add", ctxA, { name: "Coat", cost: 40 });
    const id = added.result.item.id;
    const r = call("item-update", ctxA, { id, cost: -1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    const after = call("item-list", ctxA, {});
    assert.equal(after.result.items.find((i) => i.id === id).cost, 40);
  });
});
