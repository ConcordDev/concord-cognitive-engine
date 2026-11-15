import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMasonry from "../domains/masonry.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(name, params) {
  return actions.get(`masonry.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMasonry(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("masonry price book tells the truth when it is empty", () => {
  it("says the book has no rows after the starter items are removed", () => {
    const first = call("pricebook-list", {});
    assert.equal(first.ok, true);
    assert.ok(first.result.count > 0);
    assert.equal(first.result.note, null);
    for (const id of first.result.items.map((item) => item.id)) call("pricebook-delete", { id });
    const empty = call("pricebook-list", {});
    assert.equal(empty.result.count, 0);
    assert.match(empty.result.note, /no rows/);
  });

  it("renders a saved proposal as text", () => {
    const created = call("proposal-create", {
      client: "Ada", projectTitle: "North wall", scopeOfWork: "Lay the wall",
      lineItems: [{ description: "Brick", unit: "each", quantity: 10, unitCost: 1 }],
    });
    assert.equal(created.ok, true);
    const rendered = call("proposal-render", { id: created.result.id || created.result.proposal?.id });
    assert.equal(rendered.ok, true);
    assert.match(rendered.result.document, /PROPOSAL/);
    assert.match(rendered.result.document, /North wall/);
  });
});
