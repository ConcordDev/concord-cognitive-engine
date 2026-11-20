/**
 * SXE-31 — PlasmaPy entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-plasmapy.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-plasmapy.py");
const ABSENT = { CONKAY_ENGINE_PLASMAPY_BIN: "/nonexistent/plasmapy/bin/python" };

test("plasmapy entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("plasmapy");
  assert.ok(entry, "plasmapy entry registered");
  assert.equal(entry.version, "2025.1.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "plasmapy");
  assert.ok(row, "report carries the plasmapy row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:plasmapy", async () => {
  const r = await runEngine("plasmapy", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:plasmapy");
  assert.equal(r.provenance.version, "2025.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("plasmapy", "formulary", { densityM3: "dense" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:plasmapy");
  const noOp = await runEngine("plasmapy", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:plasmapy:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /plasmapy import failed/);
});

test("real lane: PlasmaPy health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PLASMAPY_BIN) {
    t.skip("CONKAY_ENGINE_PLASMAPY_BIN unset — real PlasmaPy legs run in the CI lane");
    return;
  }
  const h = await runEngine("plasmapy", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.maxRelError < 1e-6, `formulary matches the CODATA closed forms (rel ${h.outputs.maxRelError})`);
});
