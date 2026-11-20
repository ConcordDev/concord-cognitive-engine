/**
 * SXE-19 — PyPSA entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pypsa.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pypsa.py");
const ABSENT = { CONKAY_ENGINE_PYPSA_BIN: "/nonexistent/pypsa/bin/python" };

test("pypsa entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pypsa");
  assert.ok(entry, "pypsa entry registered");
  assert.equal(entry.version, "0.35.2");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pypsa");
  assert.ok(row, "report carries the pypsa row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pypsa", async () => {
  const r = await runEngine("pypsa", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pypsa");
  assert.equal(r.provenance.version, "0.35.2");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pypsa", "dispatch", { loadMW: "heavy" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pypsa");
  const noOp = await runEngine("pypsa", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pypsa:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pypsa import failed/);
});

test("real lane: PyPSA health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PYPSA_BIN) {
    t.skip("CONKAY_ENGINE_PYPSA_BIN unset — real PyPSA legs run in the CI lane");
    return;
  }
  const h = await runEngine("pypsa", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 1e-6 && h.outputs.genCheapMW === 40 && h.outputs.genDearMW === 30, `dispatch matches the closed form (objective ${h.outputs.objective})`);
});
