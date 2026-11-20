/**
 * SXE-28 — libRoadRunner entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-roadrunner.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-roadrunner.py");
const ABSENT = { CONKAY_ENGINE_ROADRUNNER_BIN: "/nonexistent/roadrunner/bin/python" };

test("roadrunner entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("roadrunner");
  assert.ok(entry, "roadrunner entry registered");
  assert.equal(entry.version, "2.8.0");
  assert.equal(entry.licence, "Apache-2.0");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "roadrunner");
  assert.ok(row, "report carries the roadrunner row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:roadrunner", async () => {
  const r = await runEngine("roadrunner", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:roadrunner");
  assert.equal(r.provenance.version, "2.8.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("roadrunner", "decay", { x0: "lots", k: 0.3, tEnd: 5 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:roadrunner");
  const noOp = await runEngine("roadrunner", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:roadrunner:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /roadrunner import failed/);
});

test("real lane: libRoadRunner health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_ROADRUNNER_BIN) {
    t.skip("CONKAY_ENGINE_ROADRUNNER_BIN unset — real libRoadRunner legs run in the CI lane");
    return;
  }
  const h = await runEngine("roadrunner", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 1e-3, `SBML decay matches the closed form (rel ${h.outputs.relError})`);
});
