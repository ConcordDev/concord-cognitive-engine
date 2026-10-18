// tests/depth/code-exec-python-behavior.test.js
//
// After INC-145, code.exec no longer runs Python on the host via Pyodide.
// Instead it routes all Python through the WASM sandbox gate. This file proves
// that routing happens end-to-end through the real macro registry, and that
// the internal (non-founder) harness ctx is refused at the WASM gate rather than
// falling back to host Python execution.

import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

before(() => {
  process.env.CONCORD_PYTHON_EXEC_ENABLED = "1";
  process.env.CONCORD_POD_JOBS = "1";
});

afterEach(() => {
  delete process.env.CONCORD_PYTHON_EXEC_ENABLED;
  delete process.env.CONCORD_POD_JOBS;
  delete process.env.CONCORD_WASM_EXEC_ENABLED;
});

test("code.exec routes language:'python' through the WASM gate", async () => {
  const r = await lensRun("code", "exec", { params: { language: "python", code: "print('hi from python')\n2 + 2" } });
  const res = r.result ?? r;
  // The depth harness ctx is not founder/sovereign, so the WASM gate denies it.
  assert.equal(r.ok, false);
  assert.equal(r.error, "code_exec_forbidden");
  assert.equal(res.sandbox, "wasm");
  assert.ok(!res.stdout?.includes("hi from python"), "python must not run on the host");
  assert.ok(!res.stdout?.includes("42"), "python must not fall back to host Pyodide");
});
