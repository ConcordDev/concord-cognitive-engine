import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerCodeActions from "../domains/code.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerCodeActions(register); });
afterEach(() => {
  delete process.env.CONCORD_CODE_EXEC_ENABLED;
  delete process.env.CONCORD_PYTHON_EXEC_ENABLED;
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
  delete process.env.NODE_ENV;
});

describe("code.exec-status", () => {
  it("reports execution disabled for a non-founder/sovereign role even when all flags are on", () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "1";
    process.env.CONCORD_PYTHON_EXEC_ENABLED = "1";
    process.env.CONCORD_POD_JOBS = "1";
    process.env.NODE_ENV = "development";

    const r = call("exec-status", { actor: { userId: "ada" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.enabled, false);
    assert.match(r.result.reason, /WASM sandbox/i);
    assert.equal(r.result.hostExec.enabled, false);
    assert.equal(r.result.hostExec.retired, "INC-145");
  });

  it("reports execution enabled only for founder/sovereign when pod jobs are on", () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "0";
    process.env.CONCORD_PYTHON_EXEC_ENABLED = "0";
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_WASM_EXEC_ENABLED = "1";
    process.env.NODE_ENV = "production";

    const founder = call("exec-status", { actor: { userId: "f", role: "founder" } });
    assert.equal(founder.result.enabled, true);
    assert.equal(founder.result.wasm.enabled, true);
    assert.equal(founder.result.wasm.allowed, true);

    const member = call("exec-status", { actor: { userId: "m", role: "member" } });
    assert.equal(member.result.enabled, false);
    assert.equal(member.result.wasm.allowed, false);
  });

  it("reports disabled when the WASM kill switch is off", () => {
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_WASM_EXEC_ENABLED = "0";

    const founder = call("exec-status", { actor: { userId: "f", role: "founder" } });
    assert.equal(founder.result.enabled, false);
    assert.equal(founder.result.wasm.enabled, false);
  });

  it("host JavaScript exec is refused regardless of CONCORD_CODE_EXEC_ENABLED", async () => {
    process.env.CONCORD_CODE_EXEC_ENABLED = "1";
    process.env.CONCORD_POD_JOBS = "1";

    const exec = await call("exec", { actor: { userId: "ada" } }, { code: "1+1", language: "javascript" });
    assert.equal(exec.ok, false);
    assert.equal(exec.error, "code_exec_host_retired");
  });
});
