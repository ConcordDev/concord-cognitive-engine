// FIX-materials-006 — the three Materials Project actions refused a
// missing operator key with a plain error string, which the lens-run
// shaper turned into a 422 failure and the panels rendered as a red
// error (with Search/Render effectively dead). Key-gated panels have
// an established platform shape for exactly this state —
// { reason: 'missing_api_key', envVar, signupUrl, message } from
// key-required-live.js — which stays HTTP 200 and renders as the calm
// operator note. The MP actions now return it.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMaterialsActions from "../domains/materials.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`materials.${name}`);
  assert.ok(fn, `materials.${name} not registered`);
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMaterialsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  delete process.env.MATERIALS_PROJECT_API_KEY;
});

describe("materials missing-key shape (FIX-materials-006)", () => {
  for (const action of ["mp-search", "mp-material", "mp-structure"]) {
    it(`${action} returns the missing_api_key operator shape, shaped to HTTP 200`, async () => {
      const r = await call(action, { formula: "Al2O3", materialId: "mp-1" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "missing_api_key");
      assert.equal(r.envVar, "MATERIALS_PROJECT_API_KEY");
      assert.match(r.signupUrl, /materialsproject\.org/);
      assert.match(r.message, /MATERIALS_PROJECT_API_KEY/);
      const shaped = shapeLensRunHttp(r);
      assert.equal(shaped.status, 200);
      assert.equal(shaped.body.reason, "missing_api_key");
    });
  }
});
