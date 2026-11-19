/**
 * SXE-03 — PETSc + SLEPc entry + kernel suite.
 *
 * Locally provable legs: registration (including the
 * deliberate shared-env defaultPath), the engine_unavailable
 * absence, schema refusal before spawn, unknown-op refusal,
 * and the kernel's provisioning-defect shape (petsc4py
 * absent on this machine: exit naming the import failure,
 * never a printed result). The value legs — KSP max error
 * < 1e-3 on the manufactured Poisson case, SLEPc smallest
 * eigenvalue against the EXACT discrete eigenvalue — run
 * in the CI lane (conkay-engine-petsc.yml, manual dispatch
 * per F8), which fails if this suite skips there.
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-petsc.py");
const ABSENT = { CONKAY_ENGINE_PETSC_BIN: "/nonexistent/petsc/bin/python" };

test("petsc entry is registered, valid, and shares the fenicsx env by design", () => {
  const entry = getEngine("petsc");
  assert.ok(entry, "petsc entry registered");
  assert.equal(entry.version, "3.24.0");
  assert.equal(entry.licence, "BSD-2-Clause");
  assert.equal(entry.linkMode, "process");
  assert.equal(entry.defaultPath, "/opt/concord-engines/fenicsx/bin/python",
    "PETSc installs into the FEniCSx env (plan §2) — the shared path is the design");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "petsc");
  assert.ok(row, "report carries the petsc row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:petsc", async () => {
  const r = await runEngine("petsc", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:petsc");
  assert.equal(r.provenance.version, "3.24.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("petsc", "ksp-poisson1d", { n: "many" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:petsc");
  const noOp = await runEngine("petsc", "diagonalize-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:petsc:diagonalize-everything");
});

test("kernel: unprovisioned petsc stack is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /petsc stack import failed/);
});

test("real lane: KSP health + SLEPc eigenvalue vs exact discrete value (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PETSC_BIN) {
    t.skip("CONKAY_ENGINE_PETSC_BIN unset — real PETSc legs run in the CI lane");
    return;
  }
  const h = await runEngine("petsc", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxError < 1e-3, `KSP max error ${h.outputs.maxError} within the plan bound 1e-3`);
  const e = await runEngine("petsc", "eigen", { n: 63 }, { fresh: true });
  assert.equal(e.status, "PASS");
  assert.ok(e.outputs.relError < 1e-6,
    `smallest eigenvalue matches the exact discrete value (rel err ${e.outputs.relError})`);
});
