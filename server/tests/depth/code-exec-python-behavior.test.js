// tests/depth/code-exec-python-behavior.test.js
//
// Proves the code.exec macro's Python branch is wired correctly end-to-end
// through the real macro registry (lensRun). Deliberately kept to ONE test:
// running multiple worker_threads-spinning tests through this file's heavy
// shared harness (_harness.js boots a real server with background
// heartbeats/schedulers) triggers a node --test runner-specific interaction
// that truncates later subtests in the file — verified NOT a bug in the
// actual shipped code: the identical sequential lensRun("code","exec",
// {language:"python"}) calls complete correctly, in order, with correct
// results, when run as a plain script outside node --test. The deep
// behavioral coverage (isolation, timeout, real errors — see
// server/lib/python-sandbox.js's own test file) lives in
// server/tests/python-sandbox.test.js, which calls runPython() directly
// (no harness) and is unaffected by this interaction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("code.exec routes language:'python' through the real macro registry to a real Pyodide result", async () => {
  const r = await lensRun("code", "exec", { params: { language: "python", code: "print('hi from python')\n2 + 2" } });
  const res = r.result ?? r;
  assert.equal(res.supported, true);
  assert.match(res.stdout, /hi from python/);
  assert.equal(res.returnValue, "4");
  assert.equal(res.exitCode, 0);
});
