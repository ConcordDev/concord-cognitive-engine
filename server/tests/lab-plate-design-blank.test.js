// INC-SWEEP lab F1 — plate-design {} must refuse; named/well plates persist
// through labLens serialize/hydrate (restart).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLabActions from "../domains/lab.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  return ACTIONS.get(`lab.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLabActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("lab F1 plate-design blank reject + restart", () => {
  it("refuses {} and whitespace-only name with no wells (422)", () => {
    for (const params of [{}, { name: "   " }, { name: "", wells: [] }]) {
      const r = call("plate-design", ctxA, params);
      assert.equal(r.ok, false, JSON.stringify(params));
      assert.match(r.error, /plate name or wells required/i);
      assert.equal(shapeLensRunHttp(r).status, 422);
    }
    const list = call("plate-list", ctxA, {});
    assert.equal(list.result.total, 0);
  });

  it("stores a named plate and survives labLens rehydrate", () => {
    const r = call("plate-design", ctxA, {
      name: "Assay lab-f1",
      format: 96,
      wells: [{ well: "A1", sample: "std", role: "standard" }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const id = r.result.plate.id;
    assert.equal(r.result.plate.assignedWells, 1);

    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    const next = {};
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;

    const list = call("plate-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.plates.some((p) => p.id === id && p.name === "Assay lab-f1"));
  });
});
