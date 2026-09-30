// server/tests/organ-call-epipe.test.js — an organ that is missing or exits
// before reading its input must yield an honest { ok:false }, never crash the
// backend. On the GPU pod (2026-09-27) the unhandled stdin EPIPE took the whole
// server down, because the ORGANS paths only exist on the owner's Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const lib = path.resolve(import.meta.dirname, "../lib/mcp-tools.js");

function runChild(env) {
  // Separate process: a regression shows up as a crashed child, not a crashed runner.
  const code = `
    const { _organCallForTest } = await import(${JSON.stringify(lib)});
    const big = "x".repeat(512 * 1024); // larger than a pipe buffer → the write must hit EPIPE
    const r = await _organCallForTest("/nonexistent/organ.py", "probe", { big }, "TEST_ORGAN");
    await new Promise((res) => setTimeout(res, 200)); // let any late 'error' event fire
    console.log(JSON.stringify({ ok: r.ok, error: String(r.error || "") }));
    process.exit(0);`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000 });
}

test("an organ that exits without reading stdin resolves ok:false and the process survives", () => {
  const r = runChild({ ORGAN_PYTHON: "/usr/bin/true" });
  assert.equal(r.status, 0, `child crashed: ${r.stderr.slice(-400)}`);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.ok, false);
});

test("a missing organ script resolves ok:false and the process survives", () => {
  const r = runChild({});
  assert.equal(r.status, 0, `child crashed: ${r.stderr.slice(-400)}`);
  assert.equal(JSON.parse(r.stdout.trim().split("\n").pop()).ok, false);
});
