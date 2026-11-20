/**
 * SXE-20 — python-control (+ slycot) entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-control.yml, manual dispatch per F8),
 * which fails if this suite skips there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getEngine, validateManifestEntry, runEngine, engineListReport,
} from "../../../lib/conkay/engines/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-control.py");
const ABSENT = { CONKAY_ENGINE_CONTROL_BIN: "/nonexistent/control/bin/python" };

test("control entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("control");
  assert.ok(entry, "control entry registered");
  assert.equal(entry.version, "0.10.1");
  assert.equal(entry.licence, "BSD-3-Clause; slycot GPL-2.0-only (child process)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "control");
  assert.ok(row, "report carries the control row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:control", async () => {
  const r = await runEngine("control", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:control");
  assert.equal(r.provenance.version, "0.10.1");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("control", "lqr", { q1: "identity" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:control");
  const noOp = await runEngine("control", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:control:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /python-control import failed/);
});

test("real lane: python-control (+ slycot) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CONTROL_BIN) {
    t.skip("CONKAY_ENGINE_CONTROL_BIN unset — real python-control (+ slycot) legs run in the CI lane");
    return;
  }
  const h = await runEngine("control", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.maxRelError < 1e-6, `LQR gain matches the analytic Riccati solution (rel ${h.outputs.maxRelError})`);
  assert.equal(h.outputs.closedLoopStable, true);
});
