/**
 * SXE-37 — EnergyPlus entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-energyplus.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-energyplus.py");
const ABSENT = { CONKAY_ENGINE_ENERGYPLUS_BIN: "/nonexistent/energyplus/bin/python" };

test("energyplus entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("energyplus");
  assert.ok(entry, "energyplus entry registered");
  assert.equal(entry.version, "25.1.0");
  assert.equal(entry.licence, "BSD-3-Clause (EnergyPlus licence)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "energyplus");
  assert.ok(row, "report carries the energyplus row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:energyplus", async () => {
  const r = await runEngine("energyplus", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:energyplus");
  assert.equal(r.provenance.version, "25.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("energyplus", "run", { idfName: 5 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:energyplus");
  const noOp = await runEngine("energyplus", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:energyplus:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin", CONKAY_ENERGYPLUS_DIR: "/nonexistent" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /energyplus install not provisioned/);
});

test("real lane: EnergyPlus health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_ENERGYPLUS_BIN) {
    t.skip("CONKAY_ENGINE_ENERGYPLUS_BIN unset — real EnergyPlus legs run in the CI lane");
    return;
  }
  const h = await runEngine("energyplus", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.converged === true && h.outputs.esoLines > 100, `1ZoneUncontrolled completed with a real output series (${h.outputs.esoLines} eso lines)`);
});
