import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeExecHandler } from "../../scripts/pod-worker.mjs";

const DEFAULT_PYTHON_MODULE = "/opt/concord-wasm/runtimes/python-3.12.0.cwasm";
const DEFAULT_LAUNCHER = "/opt/concord-wasm/run-wasm-sandbox.sh";

function fakeExecFile(stdoutProducer) {
  let lastArgs = null;
  let calls = 0;
  function execFileImpl(file, args, opts, cb) {
    calls++;
    lastArgs = { file, args, opts };
    const stdout = typeof stdoutProducer === "function" ? stdoutProducer({ file, args, opts }) : stdoutProducer;
    cb(new Error("simulated non-zero exit"), stdout, "");
  }
  return { execFileImpl, getLastArgs: () => lastArgs, callCount: () => calls };
}

describe("pod-worker HANDLERS.exec", () => {
  before(() => {
    process.env.CONCORD_POD_JOB_TOKEN = "super-secret-token-must-not-leak";
  });

  after(() => {
    delete process.env.CONCORD_POD_JOB_TOKEN;
  });

  it("passes a child env with ONLY PATH, ignoring CONCORD_POD_JOB_TOKEN", async () => {
    const { execFileImpl, getLastArgs } = fakeExecFile(
      JSON.stringify({ ok: true, stdout: "ok\n", stderr: "", exitCode: 0, durationMs: 1, timedOut: false })
    );
    const env = { CONCORD_POD_JOB_TOKEN: "super-secret-token-must-not-leak" };
    const handler = makeExecHandler({ execFileImpl, env });

    await handler({ language: "python", code: "print(1)" });

    const opts = getLastArgs().opts;
    assert.deepStrictEqual(opts.env, { PATH: "/usr/bin:/bin" });
  });

  it("builds python argv with --stdin and '-' and writes code to the stdin file", async () => {
    const { execFileImpl, getLastArgs } = fakeExecFile(
      JSON.stringify({ ok: true, stdout: "1\n", stderr: "", exitCode: 0, durationMs: 1, timedOut: false })
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await handler({ language: "python", code: "print(1)" });

    const args = getLastArgs().args;
    const dashIdx = args.indexOf("--");
    assert.ok(dashIdx > 0, "argv must contain '--'");
    assert.equal(args[dashIdx + 1], DEFAULT_PYTHON_MODULE);
    assert.equal(args[args.length - 1], "-");

    const stdinIdx = args.indexOf("--stdin");
    assert.ok(stdinIdx >= 0, "python must use --stdin");
    const stdinFile = args[stdinIdx + 1];
    assert.ok(stdinFile.includes("concord-exec-"), stdinFile);
    assert.ok(stdinFile.endsWith("main.py"));
    // The file was removed in the finally block.
    assert.equal(fs.existsSync(stdinFile), false, "temp stdin file must be removed");
  });

  it("builds wat argv with the .wat file as the module", async () => {
    const { execFileImpl, getLastArgs } = fakeExecFile(
      JSON.stringify({ ok: true, stdout: "WAT_OK\n", stderr: "", exitCode: 0, durationMs: 1, timedOut: false })
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await handler({ language: "wat", code: "(module)" });

    const args = getLastArgs().args;
    const dashIdx = args.indexOf("--");
    assert.ok(dashIdx > 0);
    const moduleFile = args[dashIdx + 1];
    assert.ok(moduleFile.includes("concord-exec-"));
    assert.ok(moduleFile.endsWith("module.wat"));
    assert.equal(args.indexOf("--stdin"), -1, "wat must not use --stdin");
    assert.equal(fs.existsSync(moduleFile), false);
  });

  it("removes the temp directory even when execFile returns an error", async () => {
    const { execFileImpl, getLastArgs } = fakeExecFile(
      JSON.stringify({ ok: true, stdout: "ok\n", stderr: "", exitCode: 1, durationMs: 1, timedOut: false })
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await handler({ language: "python", code: "print(1)" });

    const args = getLastArgs().args;
    const stdinIdx = args.indexOf("--stdin");
    const stdinFile = args[stdinIdx + 1];
    const tmpDir = path.dirname(stdinFile);
    assert.equal(fs.existsSync(tmpDir), false, "temp directory must be removed");
  });

  it("throws exec_disabled_on_pod before calling execFile when POD_EXEC_DISABLED=1", async () => {
    const { execFileImpl, callCount } = fakeExecFile("");
    const handler = makeExecHandler({ execFileImpl, env: { POD_EXEC_DISABLED: "1" } });

    await assert.rejects(
      () => handler({ language: "python", code: "print(1)" }),
      /exec_disabled_on_pod/
    );
    assert.equal(callCount(), 0, "execFile must not be called");
  });

  it("throws parsed.error when the launcher returns a refusal JSON", async () => {
    const { execFileImpl } = fakeExecFile(
      JSON.stringify({ ok: false, error: "exec_disabled_on_pod" })
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await assert.rejects(
      () => handler({ language: "python", code: "print(1)" }),
      /exec_disabled_on_pod/
    );
  });

  it("resolves with parsed result even when the callback has an error", async () => {
    const { execFileImpl } = fakeExecFile(
      JSON.stringify({ ok: true, stdout: "ok\n", stderr: "", exitCode: 1, durationMs: 5, timedOut: false })
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    const r = await handler({ language: "python", code: "print(1)" });
    assert.equal(r.ok, true);
    assert.equal(r.stdout, "ok\n");
    assert.equal(r.exitCode, 1);
  });

  it("throws exec_launcher_no_result when stdout has no JSON line", async () => {
    const { execFileImpl } = fakeExecFile("garbage output\nno json here");
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await assert.rejects(
      () => handler({ language: "python", code: "print(1)" }),
      /exec_launcher_no_result/
    );
  });

  it("validates code length and language", async () => {
    const { execFileImpl, callCount } = fakeExecFile("");
    const handler = makeExecHandler({ execFileImpl, env: {} });

    await assert.rejects(() => handler({ language: "python", code: "x".repeat(20001) }), /exec_invalid_code/);
    await assert.rejects(() => handler({ language: "ruby", code: "puts 1" }), /exec_invalid_language/);
    assert.equal(callCount(), 0);
  });

  it("uses the last JSON line when the launcher prints prefix lines", async () => {
    const { execFileImpl } = fakeExecFile(
      "info: starting\n{\"ok\":false,\"error\":\"old\"}\n{\"ok\":true,\"stdout\":\"final\\n\",\"stderr\":\"\",\"exitCode\":0,\"durationMs\":1,\"timedOut\":false}"
    );
    const handler = makeExecHandler({ execFileImpl, env: {} });

    const r = await handler({ language: "python", code: "print(1)" });
    assert.equal(r.ok, true);
    assert.equal(r.stdout, "final\n");
  });
});
