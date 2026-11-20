/**
 * SXE-27 — OpenMM entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-openmm.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-openmm.py");
const ABSENT = { CONKAY_ENGINE_OPENMM_BIN: "/nonexistent/openmm/bin/python" };

test("openmm entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("openmm");
  assert.ok(entry, "openmm entry registered");
  assert.equal(entry.version, "8.2.0");
  assert.equal(entry.licence, "MIT (OpenMM licence)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "openmm");
  assert.ok(row, "report carries the openmm row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:openmm", async () => {
  const r = await runEngine("openmm", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:openmm");
  assert.equal(r.provenance.version, "8.2.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("openmm", "oscillator", { springK: "stiff" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:openmm");
  const noOp = await runEngine("openmm", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:openmm:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /openmm import failed/);
});

test("real lane: OpenMM health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OPENMM_BIN) {
    t.skip("CONKAY_ENGINE_OPENMM_BIN unset — real OpenMM legs run in the CI lane");
    return;
  }
  const h = await runEngine("openmm", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 0.02, `harmonic period within 2% of 2*pi*sqrt(m/k) (rel err ${h.outputs.relError})`);
});
