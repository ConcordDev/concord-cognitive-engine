import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerCodeActions from "../domains/code.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn({ actor: { userId: "ada" } }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCodeActions(register); });
afterEach(() => { delete process.env.CONCORD_CODE_EXEC_ENABLED; });

describe("code.exec-status", () => {
  it("reports execution disabled, with a reason, when the flag is off", async () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "0";
    const r = call("exec-status");
    assert.equal(r.ok, true);
    assert.equal(r.result.enabled, false);
    assert.match(r.result.reason, /disabled/i);
    const exec = await call("exec", { code: "1+1", language: "javascript" });
    assert.equal(exec.ok, false);
    assert.equal(exec.error, "code_exec_disabled");
  });

  it("reports execution enabled when the flag is on", () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "1";
    const r = call("exec-status");
    assert.equal(r.ok, true);
    assert.equal(r.result.enabled, true);
  });
});
