// tests/depth/code-exec-notebook-behavior.test.js
//
// Behavioral coverage for the productivity-notebook code execution wire (lens-audit:
// the lens called code.execute with a `source` param; the real sandbox is code.exec
// reading `code`). Asserts the node:vm sandbox runs real JS, accepts the `source`
// alias, and stays isolated (no process/require/Buffer/global).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("code.exec runs real JS and captures stdout", async () => {
  const r = await lensRun("code", "exec", { params: { language: "javascript", code: "console.log(2 + 2)" } });
  const res = r.result ?? r;
  assert.equal(res.supported, true);
  assert.deepStrictEqual(res.stdout.trim(), "4");
  assert.equal(res.exitCode, 0);
});

test("code.exec accepts the `source` alias (productivity notebook shape)", async () => {
  const r = await lensRun("code", "exec", { params: { language: "javascript", source: "console.log('hi from notebook')" } });
  const res = r.result ?? r;
  assert.match(res.stdout, /hi from notebook/);
  assert.equal(res.exitCode, 0);
});

test("code.exec sandbox is isolated — no host globals leak", async () => {
  const r = await lensRun("code", "exec", {
    params: { language: "javascript", code: "console.log(typeof process + ',' + typeof require + ',' + typeof Buffer + ',' + typeof globalThis.fetch)" },
  });
  const res = r.result ?? r;
  // process/require/Buffer must be undefined inside the sandbox
  assert.match(res.stdout, /^undefined,undefined,undefined,/);
});

test("code.exec surfaces thrown errors as stderr with a non-zero exit", async () => {
  const r = await lensRun("code", "exec", { params: { language: "javascript", code: "throw new Error('boom')" } });
  const res = r.result ?? r;
  assert.match(res.stderr, /boom/);
  assert.equal(res.exitCode, 1);
});
