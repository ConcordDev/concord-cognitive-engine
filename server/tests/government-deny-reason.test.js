import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGovernment from "../domains/government.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(name, params) {
  return actions.get(`government.${name}`)(
    { actor: { userId: "clerk" }, userId: "clerk" },
    { id: null, data: {}, meta: {} },
    params,
  );
}

before(() => { registerGovernment(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("permit denial requires a reason", () => {
  it("refuses an empty reason and does not mark the permit denied", () => {
    const made = call("permits-apply", {
      applicantName: "Ada", applicantEmail: "ada@example.com", kind: "building_residential",
    });
    assert.equal(made.ok, true);
    const id = made.result.permit.id;
    const denied = call("permits-deny", { id, reason: "   " });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /reason is required/);
    const listed = call("permits-list", {});
    assert.equal(listed.result.permits[0].status, "applied");
    const ok = call("permits-deny", { id, reason: "Setback is short." });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.permit.denialReason, "Setback is short.");
    assert.equal(ok.result.permit.status, "denied");
  });
});
