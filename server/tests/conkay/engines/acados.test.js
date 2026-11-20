/**
 * SXE-20 — acados entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-acados.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-acados.py");
const ABSENT = { CONKAY_ENGINE_ACADOS_BIN: "/nonexistent/acados/bin/python" };

test("acados entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("acados");
  assert.ok(entry, "acados entry registered");
  assert.equal(entry.version, "0.5.0");
  assert.equal(entry.licence, "BSD-2-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "acados");
  assert.ok(row, "report carries the acados row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:acados", async () => {
  const r = await runEngine("acados", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:acados");
  assert.equal(r.provenance.version, "0.5.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("acados", "ocp", { p0: "one" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:acados");
  const noOp = await runEngine("acados", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:acados:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /acados import failed/);
});

test("real lane: acados health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_ACADOS_BIN) {
    t.skip("CONKAY_ENGINE_ACADOS_BIN unset — real acados legs run in the CI lane");
    return;
  }
  const h = await runEngine("acados", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 0.05, `first control within 5% of the Riccati reference (rel ${h.outputs.relError})`);
  assert.ok(Math.abs(h.outputs.pFinal) < 0.1, "terminal position driven below 0.1 from p0 = 1");
});
