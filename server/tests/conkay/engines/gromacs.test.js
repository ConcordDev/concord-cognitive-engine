/**
 * SXE-27 — GROMACS entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-gromacs.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-gromacs.py");
const ABSENT = { CONKAY_ENGINE_GROMACS_BIN: "/nonexistent/gromacs/bin/python" };

test("gromacs entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("gromacs");
  assert.ok(entry, "gromacs entry registered");
  assert.equal(entry.version, "2024.4");
  assert.equal(entry.licence, "LGPL-2.1-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "gromacs");
  assert.ok(row, "report carries the gromacs row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:gromacs", async () => {
  const r = await runEngine("gromacs", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:gromacs");
  assert.equal(r.provenance.version, "2024.4");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("gromacs", "minimize", { caseDir: 5 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:gromacs");
  const noOp = await runEngine("gromacs", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:gromacs:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /gmx executable not found|gromacs case dir not provisioned/);
});

test("real lane: GROMACS health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_GROMACS_BIN) {
    t.skip("CONKAY_ENGINE_GROMACS_BIN unset — real GROMACS legs run in the CI lane");
    return;
  }
  const h = await runEngine("gromacs", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.converged === true && Number.isFinite(h.outputs.potentialEnergy), "lysozyme EM converged to the Fmax criterion");
});
