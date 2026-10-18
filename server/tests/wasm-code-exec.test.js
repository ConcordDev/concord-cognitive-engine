import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isCodeExecRole,
  wasmExecEnabled,
  WASM_LANGUAGES,
  normalizeWasmLanguage,
  runWasmCodeExec,
  appendCodeExecAudit,
  wasmExecSelfTest,
} from "../lib/wasm-code-exec.js";
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

function makeFakeQueue(onEnqueue) {
  return {
    calls: [],
    async enqueue(kind, payload, opts) {
      this.calls.push({ kind, payload, opts });
      if (onEnqueue) return onEnqueue(kind, payload, opts);
      return { ok: true, result: { ok: true, stdout: "42\n", stderr: "", exitCode: 0, timedOut: false, durationMs: 10 } };
    },
  };
}

function makeCapturingAudit() {
  const lines = [];
  return {
    lines,
    audit(entry, { env } = {}) {
      lines.push({ entry, env });
      appendCodeExecAudit(entry, { env });
    },
  };
}

before(() => {
  registerCodeActions(register);
});

afterEach(() => {
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
  delete process.env.CONCORD_CODE_EXEC_AUDIT;
  delete process.env.CONCORD_CODE_EXEC_ENABLED;
});

after(() => {
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
  delete process.env.CONCORD_CODE_EXEC_AUDIT;
  delete process.env.CONCORD_CODE_EXEC_ENABLED;
});

describe("wasm-code-exec exports", () => {
  it("isCodeExecRole is true only for founder/sovereign", () => {
    assert.equal(isCodeExecRole(founderCtx()), true);
    assert.equal(isCodeExecRole(sovereignCtx()), true);
    assert.equal(isCodeExecRole(ownerCtx()), false);
    assert.equal(isCodeExecRole(adminCtx()), false);
    assert.equal(isCodeExecRole(memberCtx()), false);
    assert.equal(isCodeExecRole({ actor: { userId: "x", role: "viewer" } }), false);
    assert.equal(isCodeExecRole({ actor: { userId: "x", role: "system", internal: true } }), false);
    assert.equal(isCodeExecRole(undefined), false);
  });

  it("wasmExecEnabled respects pod-jobs and kill switch", () => {
    process.env.CONCORD_POD_JOBS = "1";
    assert.equal(wasmExecEnabled(), true);

    process.env.CONCORD_WASM_EXEC_ENABLED = "0";
    assert.equal(wasmExecEnabled(), false);
    process.env.CONCORD_WASM_EXEC_ENABLED = "false";
    assert.equal(wasmExecEnabled(), false);
    process.env.CONCORD_WASM_EXEC_ENABLED = "off";
    assert.equal(wasmExecEnabled(), false);

    delete process.env.CONCORD_WASM_EXEC_ENABLED;
    assert.equal(wasmExecEnabled(), true);

    process.env.CONCORD_POD_JOBS = "0";
    assert.equal(wasmExecEnabled(), false);

    delete process.env.CONCORD_POD_JOBS;
    assert.equal(wasmExecEnabled(), false);
  });

  it("WASM_LANGUAGES has the expected aliases", () => {
    assert.deepEqual([...WASM_LANGUAGES.python], ["python", "py", "python3"]);
    assert.deepEqual([...WASM_LANGUAGES.wat], ["wat", "wasm-text"]);
  });

  it("normalizeWasmLanguage maps aliases and rejects unknowns", () => {
    assert.equal(normalizeWasmLanguage("python"), "python");
    assert.equal(normalizeWasmLanguage("py"), "python");
    assert.equal(normalizeWasmLanguage("python3"), "python");
    assert.equal(normalizeWasmLanguage("wat"), "wat");
    assert.equal(normalizeWasmLanguage("wasm-text"), "wat");
    assert.equal(normalizeWasmLanguage("ruby"), null);
    assert.equal(normalizeWasmLanguage(""), null);
    assert.equal(normalizeWasmLanguage(null), null);
  });
});

describe("runWasmCodeExec", () => {
  it("denies non-founder/sovereign roles with 403 and writes a denied audit", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    for (const ctx of [memberCtx(), ownerCtx(), adminCtx()]) {
      const queue = makeFakeQueue();
      const { lines, audit } = makeCapturingAudit();
      const auditFile = path.join(os.tmpdir(), `wasm-audit-${process.pid}-${Date.now()}.jsonl`);
      process.env.CONCORD_CODE_EXEC_AUDIT = auditFile;

      const r = await runWasmCodeExec(ctx, { code: "print(1)", language: "python" }, { queue, audit });
      assert.equal(r.ok, false);
      assert.equal(r.error, "code_exec_forbidden");
      assert.equal(r.status, 403);
      assert.equal(r.result.supported, false);
      assert.equal(queue.calls.length, 0, `${ctx.actor.role} must not enqueue`);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].entry.decision, "denied");
      assert.equal(lines[0].entry.error, "role");

      fs.rmSync(auditFile, { force: true });
    }
  });

  it("allows founder and returns stdout from the queue", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue();
    const { lines, audit } = makeCapturingAudit();
    const auditFile = path.join(os.tmpdir(), `wasm-audit-${process.pid}-${Date.now()}.jsonl`);
    process.env.CONCORD_CODE_EXEC_AUDIT = auditFile;

    const r = await runWasmCodeExec(founderCtx(), { code: "print(6*7)", language: "python" }, { queue, audit });
    assert.equal(r.ok, true);
    assert.equal(r.result.stdout, "42\n");
    assert.equal(r.result.supported, true);
    assert.equal(r.result.sandbox, "wasm");
    assert.equal(r.result.language, "python");

    assert.equal(queue.calls.length, 1);
    const call = queue.calls[0];
    assert.equal(call.kind, "exec");
    const payload = call.payload;
    assert.equal(payload.language, "python");
    assert.equal(payload.code, "print(6*7)");
    assert.equal(payload.role, "founder");
    assert.equal(payload.actor, "founder-1");
    assert.equal(typeof payload.codeSha256, "string");
    assert.match(payload.codeSha256, /^[a-f0-9]{64}$/);
    assert.equal(payload.timeoutS, 10);
    assert.equal(payload.memMb, 256);
    assert.deepStrictEqual(Object.keys(payload).sort(), ["actor", "code", "codeSha256", "language", "memMb", "role", "timeoutS"]);

    assert.equal(lines.length, 1);
    const entry = lines[0].entry;
    assert.equal(entry.decision, "ran");
    assert.equal(entry.ok, true);
    assert.equal(entry.via, "lens");
    assert.equal(entry.role, "founder");
    assert.equal(entry.bytesOut, 3);
    assert.equal(entry.error, null);
    assert.equal(entry.code, undefined);
    assert.equal(entry.stdout, undefined);
    assert.equal(entry.stderr, undefined);

    fs.rmSync(auditFile, { force: true });
  });

  it("allows sovereign", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue();
    const r = await runWasmCodeExec(sovereignCtx(), { code: "print(1)", language: "python" }, { queue });
    assert.equal(r.ok, true);
  });

  it("returns disabled without enqueue when the kill switch is off", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_WASM_EXEC_ENABLED = "0";
    const queue = makeFakeQueue();
    const { lines, audit } = makeCapturingAudit();

    const r = await runWasmCodeExec(founderCtx(), { code: "print(1)", language: "python" }, { queue, audit });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_disabled");
    assert.equal(queue.calls.length, 0);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].entry.decision, "disabled");
  });

  it("returns unavailable when the queue reports no worker", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = {
      calls: [],
      async enqueue(kind, payload, opts) {
        this.calls.push({ kind, payload, opts });
        return { ok: false, error: "pod_worker_unavailable" };
      },
    };
    const { lines, audit } = makeCapturingAudit();

    const r = await runWasmCodeExec(founderCtx(), { code: "print(1)", language: "python" }, { queue, audit });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_unavailable");
    assert.equal(r.detail, "pod_worker_unavailable");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].entry.decision, "error");
  });

  it("returns timeout error when the sandbox times out", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue(() => ({ ok: true, result: { ok: false, stdout: "", stderr: "timed out", exitCode: 1, timedOut: true, durationMs: 2000 } }));
    const r = await runWasmCodeExec(founderCtx(), { code: "while True: pass", language: "python", timeoutMs: 2000 }, { queue });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_timeout");
    assert.equal(r.result.timedOut, true);
  });

  it("rejects unsupported language 'ruby'", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue();
    const { lines, audit } = makeCapturingAudit();

    const r = await runWasmCodeExec(founderCtx(), { code: "puts 1", language: "ruby" }, { queue, audit });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_language_unsupported");
    assert.match(r.result.stderr, /python, wat/);
    assert.equal(queue.calls.length, 0);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].entry.decision, "error");
  });

  it("clamps huge timeoutMs to payload.timeoutS 30", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue();
    const r = await runWasmCodeExec(founderCtx(), { code: "print(1)", language: "python", timeoutMs: 999_999 }, { queue });
    assert.equal(r.ok, true);
    assert.equal(queue.calls[0].payload.timeoutS, 30);
    assert.equal(queue.calls[0].opts.timeoutMs, 50_000);
  });

  it("does not audit empty code", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const queue = makeFakeQueue();
    const { lines, audit } = makeCapturingAudit();
    const r = await runWasmCodeExec(founderCtx(), { code: "   ", language: "python" }, { queue, audit });
    assert.equal(r.ok, true);
    assert.equal(lines.length, 0);
    assert.equal(queue.calls.length, 0);
  });
});

describe("appendCodeExecAudit", () => {
  it("writes a 0600 JSONL line to CONCORD_CODE_EXEC_AUDIT", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-audit-test-"));
    const auditFile = path.join(tmpDir, "audit.jsonl");
    process.env.CONCORD_CODE_EXEC_AUDIT = auditFile;

    const entry = {
      ts: new Date().toISOString(),
      via: "test",
      actorId: "a",
      role: "founder",
      language: "python",
      codeSha256: "0".repeat(64),
      codeBytes: 5,
      decision: "ran",
      ok: true,
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      bytesOut: 2,
      error: null,
    };
    appendCodeExecAudit(entry);

    const stat = fs.statSync(auditFile);
    assert.equal(stat.mode & 0o777, 0o600);

    const line = fs.readFileSync(auditFile, "utf8").trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.decision, "ran");
    assert.equal(parsed.via, "test");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("wasmExecSelfTest", () => {
  it("returns skipped when disabled", async () => {
    const r = await wasmExecSelfTest();
    assert.equal(r.ok, false);
    assert.equal(r.skipped, "disabled");
    assert.deepEqual(r.checks, []);
  });

  it("passes all 8 checks against a fake sandbox", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    const seen = [];
    const queue = {
      async enqueue(kind, payload, opts) {
        seen.push({ kind, payload, opts });
        const { code, language } = payload;
        let stdout = "";
        let timedOut = false;
        let exitCode = 0;
        let ok = true;

        if (language === "python") {
          if (code.includes("print(6*7)")) {
            stdout = "42\n";
          } else if (code.includes('os.environ')) {
            stdout = "0\nFalse\n";
          } else if (code.includes("socket.create_connection")) {
            stdout = "NET_BLOCKED\n";
          } else if (code.includes("/etc/shadow")) {
            stdout = "FS_BLOCKED\n";
          } else if (code.includes("while True:")) {
            stdout = "";
            timedOut = true;
            exitCode = 1;
            ok = false;
          } else {
            stdout = "?\n";
          }
        } else if (language === "wat") {
          stdout = "WAT_OK\n";
        }

        return { ok: true, result: { ok, stdout, stderr: "", exitCode, timedOut, durationMs: 1 } };
      },
    };

    const r = await wasmExecSelfTest({ queue });
    assert.equal(r.ok, true);
    assert.equal(r.checks.length, 8);
    for (const c of r.checks) {
      assert.equal(c.pass, true, `${c.name} failed: ${JSON.stringify(c.detail)}`);
    }
    // member/owner refused checks must never have reached the queue.
    const refusedEnqueues = seen.filter((s) => s.payload.actor?.includes("selftest-member") || s.payload.actor?.includes("selftest-owner"));
    assert.equal(refusedEnqueues.length, 0);
  });
});

describe("code.js wasm wiring", () => {
  it("routes sandbox:wasm from code.exec to wasm-code-exec and denies members", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_CODE_EXEC_AUDIT = path.join(os.tmpdir(), `wasm-audit-code-${process.pid}-${Date.now()}.jsonl`);

    const r = await call("exec", memberCtx(), { sandbox: "wasm", language: "python", code: "print(1)" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_forbidden");

    const r2 = await call("sandbox-exec", memberCtx(), { language: "python", code: "print(1)" });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "code_exec_forbidden");
  });

  it("returns code_exec_unavailable for founder when no pod worker is connected", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_CODE_EXEC_AUDIT = path.join(os.tmpdir(), `wasm-audit-code-${process.pid}-${Date.now()}.jsonl`);

    const r = await call("exec", founderCtx(), { sandbox: "wasm", language: "python", code: "print(1)" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_unavailable");
    assert.equal(r.result.supported, true);
  });

  it("keeps the old javascript path untouched without sandbox param", async () => {
    process.env.CONCORD_POD_JOBS = "1";
    process.env.CONCORD_CODE_EXEC_ENABLED = "0";
    process.env.CONCORD_CODE_EXEC_AUDIT = path.join(os.tmpdir(), `wasm-audit-code-${process.pid}-${Date.now()}.jsonl`);

    const r = await call("exec", founderCtx(), { language: "javascript", code: "1+1" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "code_exec_disabled");
    assert.equal(r.result.supported, false);
  });

  it("exec-status reports wasm.enabled and wasm.allowed per role", () => {
    process.env.CONCORD_POD_JOBS = "1";
    const founder = call("exec-status", founderCtx());
    assert.equal(founder.result.wasm.enabled, true);
    assert.equal(founder.result.wasm.allowed, true);
    assert.deepEqual(founder.result.wasm.languages, ["python", "wat"]);
    assert.deepEqual(founder.result.wasm.roles, ["founder", "sovereign"]);

    const member = call("exec-status", memberCtx());
    assert.equal(member.result.wasm.enabled, true);
    assert.equal(member.result.wasm.allowed, false);
  });
});
