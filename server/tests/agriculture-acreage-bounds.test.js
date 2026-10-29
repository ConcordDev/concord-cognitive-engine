// server/tests/agriculture-acreage-bounds.test.js
//
// Q23 (E-96): field-update must enforce field-create's acreage
// bounds. It previously assigned any finite number (-50 and 5e9 both
// landed) and silently zeroed the field on a null acreage. Pins:
// every invalid provided value is rejected with create's error
// strings and the stored value is untouched; valid updates apply;
// omitting acreage preserves it.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`agriculture.${name}`);
  if (!fn) throw new Error(`agriculture.${name} not registered`);
  return fn({ actor: { userId: "farmer-1" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAgricultureActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

function makeField() {
  const r = call("field-create", { name: "North 40", acreage: 40, lat: 41.7, lng: -73.9 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.field;
}
const storedAcreage = (id) => call("field-list", {}).result.fields.find((f) => f.id === id).acreage;

describe("agriculture field-update acreage bounds (Q23)", () => {
  it("rejects out-of-bounds and malformed acreage, leaving the stored value unchanged", () => {
    const field = makeField();
    const cases = [
      [-50, "acreage must be > 0"],
      [0, "acreage must be > 0"],
      [5e9, "acreage too large (max 100000)"],
      [100_001, "acreage too large (max 100000)"],
      ["abc", "acreage must be > 0"],
      [NaN, "acreage must be > 0"],
    ];
    for (const [acreage, error] of cases) {
      const r = call("field-update", { id: field.id, acreage });
      assert.equal(r.ok, false, `acreage ${String(acreage)} must be rejected`);
      assert.equal(r.error, error);
      assert.equal(storedAcreage(field.id), 40, `stored acreage unchanged after ${String(acreage)}`);
    }
  });

  it("applies a valid in-bounds update, including the boundary value", () => {
    const field = makeField();
    const r = call("field-update", { id: field.id, acreage: 100_000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.field.acreage, 100_000);
    assert.equal(call("field-update", { id: field.id, acreage: 12.5 }).result.field.acreage, 12.5);
  });

  it("an explicit null acreage is a no-op (the codebase's != null idiom), never a silent zero", () => {
    const field = makeField();
    const r = call("field-update", { id: field.id, acreage: null });
    assert.equal(r.ok, true);
    assert.equal(storedAcreage(field.id), 40, "null must not zero the field (the pre-fix defect)");
  });

  it("a name-only update preserves acreage", () => {
    const field = makeField();
    const r = call("field-update", { id: field.id, name: "North 41" });
    assert.equal(r.ok, true);
    assert.equal(r.result.field.acreage, 40);
    assert.equal(r.result.field.name, "North 41");
  });
});
