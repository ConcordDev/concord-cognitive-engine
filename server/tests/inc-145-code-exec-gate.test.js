import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registerCodeActions from "../domains/code.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`code.${name}`);
  assert.ok(fn, `code.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function founderCtx() {
  return { actor: { userId: "founder-1", role: "founder" } };
}
function sovereignCtx() {
  return { actor: { userId: "sovereign-1", role: "sovereign" } };
}
function memberCtx() {
  return { actor: { userId: "member-1", role: "member" } };
}
function ownerCtx() {
  return { actor: { userId: "owner-1", role: "owner" } };
}
function adminCtx() {
  return { actor: { userId: "admin-1", role: "admin" } };
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREV_NODE_ENV = process.env.NODE_ENV;
let auditFile = null;

before(() => {
  registerCodeActions(register);
});

beforeEach(() => {
  process.env.CONCORD_PYTHON_EXEC_ENABLED = "1";
  process.env.CONCORD_CODE_EXEC_ENABLED = "1";
  process.env.NODE_ENV = "development";
  process.env.CONCORD_POD_JOBS = "1";
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
  auditFile = path.join(os.tmpdir(), `inc145-audit-${process.pid}-${Date.now()}.jsonl`);
  process.env.CONCORD_CODE_EXEC_AUDIT = auditFile;
});

afterEach(() => {
  delete process.env.CONCORD_PYTHON_EXEC_ENABLED;
  delete process.env.CONCORD_CODE_EXEC_ENABLED;
  if (PREV_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = PREV_NODE_ENV;
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
  delete process.env.CONCORD_CODE_EXEC_AUDIT;
  if (auditFile) {
    fs.rmSync(auditFile, { force: true });
    auditFile = null;
  }
});

function readAudit() {
  if (!auditFile || !fs.existsSync(auditFile)) return [];
  return fs.readFileSync(auditFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("INC-145 code.exec gate", () => {
  it("routes member python to the WASM gate and denies with code_exec_forbidden", async () => {
    for (const lang of ["python", "py", "python3"]) {
      fs.rmSync(auditFile, { force: true });
      const r = await call("exec", memberCtx(), { language: lang, code: "print(6*7)" });
      assert.equal(r.ok, false, `${lang}: ok should be false`);
      assert.equal(r.error, "code_exec_forbidden", `${lang}: error should be code_exec_forbidden`);
      assert.equal(r.result.sandbox, "wasm", `${lang}: sandbox should be wasm`);
      assert.ok(!r.result.stdout?.includes("42"), `${lang}: stdout must not contain 42`);

      const lines = readAudit();
      const denied = lines.find((e) => e.decision === "denied");
      assert.ok(denied, `${lang}: audit should contain a denied entry`);
      assert.equal(denied.role, "member", `${lang}: audit role should be member`);
      assert.equal(denied.via, "lens", `${lang}: audit via should be lens`);
    }
  });

  it("denies owner and admin python with code_exec_forbidden via the WASM gate", async () => {
    for (const ctx of [ownerCtx(), adminCtx()]) {
      fs.rmSync(auditFile, { force: true });
      const r = await call("exec", ctx, { language: "python", code: "print(1)" });
      assert.equal(r.ok, false);
      assert.equal(r.error, "code_exec_forbidden");
      assert.equal(r.result.sandbox, "wasm");
      const denied = readAudit().find((e) => e.decision === "denied");
      assert.ok(denied);
      assert.equal(denied.role, ctx.actor.role);
    }
  });

  it("refuses member javascript with code_exec_host_retired", async () => {
    const r = await call("exec", memberCtx(), { language: "javascript", code: "console.log(6*7)" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_host_retired");
    assert.equal(r.status, 403);
    assert.equal(r.result.stdout, "");
    assert.ok(r.result.stderr.includes("INC-145"));
  });

  it("refuses founder javascript with code_exec_host_retired (host JS retired for everyone)", async () => {
    const r = await call("exec", founderCtx(), { language: "javascript", code: "console.log(6*7)" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_host_retired");
    assert.equal(r.status, 403);
    assert.equal(r.result.stdout, "");
  });

  it("routes founder/sovereign python to WASM and reports code_exec_unavailable when no pod worker is connected", async () => {
    for (const ctx of [founderCtx(), sovereignCtx()]) {
      const r = await call("exec", ctx, { language: "python", code: "print(6*7)" });
      assert.equal(r.ok, false);
      assert.equal(r.error, "code_exec_unavailable");
      assert.equal(r.result.sandbox, "wasm");
      assert.ok(!r.result.stdout?.includes("42"), "founder python must not fall back to Pyodide");
    }
  });

  it("does not fall back to host python when the WASM kill switch is off", async () => {
    process.env.CONCORD_WASM_EXEC_ENABLED = "0";
    const r = await call("exec", founderCtx(), { language: "python", code: "print(6*7)" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_disabled");
    assert.equal(r.result.sandbox, "wasm");
    assert.ok(!r.result.stdout?.includes("42"), "must not fall back to host Pyodide");
  });

  it("refuses anonymous python with code_exec_forbidden", async () => {
    for (const ctx of [{}, { actor: { userId: "anon" } }]) {
      const r = await call("exec", ctx, { language: "python", code: "print(1)" });
      assert.equal(r.ok, false);
      assert.equal(r.error, "code_exec_forbidden");
    }
  });

  it("refuses debug-run for member and founder with code_exec_host_retired", () => {
    for (const ctx of [memberCtx(), founderCtx()]) {
      const r = call("debug-run", ctx, { language: "javascript", code: "console.log(1)", breakpoints: [1] });
      assert.equal(r.ok, false);
      assert.equal(r.error, "code_exec_host_retired");
      assert.equal(r.status, 403);
    }
  });
});

describe("INC-145 source assertions", () => {
  it("server.js contains the anonymous lens-action gate", () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, "server.js"), "utf8");
    assert.ok(/function _lensActionForbiddenForAnon\s*\(/.test(src), "gate helper missing");
    assert.ok(/app\.post\("\/api\/lens\/run"[\s\S]*?_lensActionForbiddenForAnon\(ctx\)/.test(src), "/api/lens/run must call gate");
  });

  it("code.js no longer contains raw host execution primitives", () => {
    const src = fs.readFileSync(path.join(SERVER_DIR, "domains", "code.js"), "utf8");
    assert.ok(!src.includes("runPython("), "code.js must not call runPython");
    assert.ok(!src.includes("vm.createContext"), "code.js must not create vm contexts");
    assert.ok(!src.includes("new vm.Script"), "code.js must not construct vm.Script");
  });
});

describe("INC-145 exec-status", () => {
  it("reports founder enabled, member disabled, hostExec always disabled", () => {
    const founder = call("exec-status", founderCtx());
    assert.equal(founder.result.enabled, true);
    assert.equal(founder.result.hostExec.enabled, false);
    assert.equal(founder.result.hostExec.retired, "INC-145");

    const member = call("exec-status", memberCtx());
    assert.equal(member.result.enabled, false);
    assert.equal(member.result.hostExec.enabled, false);
    assert.equal(member.result.hostExec.retired, "INC-145");
  });
});
