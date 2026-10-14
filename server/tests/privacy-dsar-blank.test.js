// INC-SWEEP strategic-adds F1 — blank DSAR note must refuse; noted request
// survives privacyLens serialize/hydrate (restart).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPrivacyActions from "../domains/privacy.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  return ACTIONS.get(`privacy.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPrivacyActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("strategic-adds F1 privacy.dsarSubmit blank reject + restart", () => {
  it("refuses missing, empty, and whitespace-only notes (422)", () => {
    for (const params of [
      { kind: "access" },
      { kind: "access", note: "" },
      { kind: "access", note: "   " },
      { kind: "export", note: null },
    ]) {
      const r = call("dsarSubmit", ctxA, params);
      assert.equal(r.ok, false, JSON.stringify(params));
      assert.match(r.error, /note required/i);
      assert.equal(shapeLensRunHttp(r).status, 422);
    }
    const list = call("dsarList", ctxA, {});
    assert.equal(list.result.totalRequests, 0);
  });

  it("stores a noted request and survives privacyLens rehydrate", () => {
    const r = call("dsarSubmit", ctxA, {
      kind: "access",
      note: "DSAR strategic-adds F1 access note",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const id = r.result.request.id;
    assert.equal(r.result.request.note, "DSAR strategic-adds F1 access note");
    assert.equal(r.result.request.kind, "access");
    assert.equal(r.result.request.status, "received");

    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    const next = {};
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;

    const list = call("dsarList", ctxA, {});
    assert.equal(list.ok, true);
    const row = list.result.requests.find((q) => q.id === id);
    assert.ok(row, "request must survive rehydrate");
    assert.equal(row.note, "DSAR strategic-adds F1 access note");
  });
});
