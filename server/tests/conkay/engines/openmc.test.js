/**
 * SXE-30 — OpenMC entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-openmc.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-openmc.py");
const ABSENT = { CONKAY_ENGINE_OPENMC_BIN: "/nonexistent/openmc/bin/python" };

test("openmc entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("openmc");
  assert.ok(entry, "openmc entry registered");
  assert.equal(entry.version, "0.15.2");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "openmc");
  assert.ok(row, "report carries the openmc row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:openmc", async () => {
  const r = await runEngine("openmc", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:openmc");
  assert.equal(r.provenance.version, "0.15.2");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("openmc", "godiva", { batches: "many", particles: 2000 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:openmc");
  const noOp = await runEngine("openmc", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:openmc:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /openmc import failed/);
});

test("real lane: OpenMC health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OPENMC_BIN) {
    t.skip("CONKAY_ENGINE_OPENMC_BIN unset — real OpenMC legs run in the CI lane");
    return;
  }
  const h = await runEngine("openmc", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(Math.abs(h.outputs.keff - 1.0) <= 0.015, `Godiva k_eff ${h.outputs.keff} within 0.015 of critical`);
});
