/**
 * SXE-25 — PyBaMM battery modelling entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pybamm.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pybamm.py");
const ABSENT = { CONKAY_ENGINE_PYBAMM_BIN: "/nonexistent/pybamm/bin/python" };

test("pybamm entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pybamm");
  assert.ok(entry, "pybamm entry registered");
  assert.equal(entry.version, "25.1.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pybamm");
  assert.ok(row, "report carries the pybamm row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pybamm", async () => {
  const r = await runEngine("pybamm", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pybamm");
  assert.equal(r.provenance.version, "25.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pybamm", "discharge", { cRate: "fast" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pybamm");
  const noOp = await runEngine("pybamm", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pybamm:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pybamm import failed/);
});

test("real lane: PyBaMM battery modelling health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PYBAMM_BIN) {
    t.skip("CONKAY_ENGINE_PYBAMM_BIN unset — real PyBaMM battery modelling legs run in the CI lane");
    return;
  }
  const h = await runEngine("pybamm", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relDeviation <= 0.08, `SPM 1C discharge capacity within 8% of the Chen2020 nominal (dev ${h.outputs.relDeviation})`);
});
