// tests/depth/code-exec-notebook-behavior.test.js
//
// Behavioral coverage for the productivity-notebook code execution wire after
// INC-145: host JavaScript execution is retired, the source alias still works,
// and Python routes through the WASM sandbox gate.

import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

before(() => {
  process.env.CONCORD_CODE_EXEC_ENABLED = "1";
  process.env.CONCORD_PYTHON_EXEC_ENABLED = "1";
  process.env.CONCORD_POD_JOBS = "1";
});

afterEach(() => {
  delete process.env.CONCORD_CODE_EXEC_ENABLED;
  delete process.env.CONCORD_PYTHON_EXEC_ENABLED;
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
});

test("code.exec retires host JS and returns code_exec_host_retired", async () => {
  const r = await lensRun("code", "exec", { params: { language: "javascript", code: "console.log(2 + 2)" } });
  const res = r.result ?? r;
  assert.equal(res.supported, false);
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_host_retired");
  assert.equal(res.stdout, "");
  assert.match(res.stderr, /INC-145/);
});

test("code.exec source alias still resolves and refuses retired JS", async () => {
  const r = await lensRun("code", "exec", { params: { language: "javascript", source: "console.log('hi from notebook')" } });
  const res = r.result ?? r;
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_host_retired");
  assert.equal(res.supported, false);
});

test("code.exec no longer exposes a JS sandbox for host globals checks", async () => {
  const r = await lensRun("code", "exec", {
    params: { language: "javascript", code: "typeof process" },
  });
  const res = r.result ?? r;
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_host_retired");
  assert.equal(res.supported, false);
});

test("code.exec ignores CONCORD_CODE_EXEC_ENABLED for JS and still retires it", async () => {
  process.env.CONCORD_CODE_EXEC_ENABLED = "1";
  const r = await lensRun("code", "exec", { params: { language: "javascript", code: "console.log(1)" } });
  const res = r.result ?? r;
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_host_retired");
  assert.equal(res.supported, false);
});

test("code.exec routes python through the WASM gate (member/anon forbidden in lens.run layer)", async () => {
  const r = await lensRun("code", "exec", { params: { language: "python", code: "print(6*7)" } });
  const res = r.result ?? r;
  // The depth harness creates an internal ctx with a non-founder role, so the
  // WASM gate should deny it with code_exec_forbidden — proving it reached the
  // WASM layer rather than Pyodide on the host.
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_forbidden");
  assert.equal(res.sandbox, "wasm");
  assert.ok(!res.stdout?.includes("42"), "python must not fall back to host Pyodide");
});
