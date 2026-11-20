/**
 * SXE-36 — sgp4 entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-sgp4.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-sgp4.py");
const ABSENT = { CONKAY_ENGINE_SGP4_BIN: "/nonexistent/sgp4/bin/python" };

test("sgp4 entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("sgp4");
  assert.ok(entry, "sgp4 entry registered");
  assert.equal(entry.version, "2.24");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "sgp4");
  assert.ok(row, "report carries the sgp4 row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:sgp4", async () => {
  const r = await runEngine("sgp4", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:sgp4");
  assert.equal(r.provenance.version, "2.24");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("sgp4", "propagate", { minutes: "later" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:sgp4");
  const noOp = await runEngine("sgp4", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:sgp4:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /sgp4 import failed/);
});

test("real lane: sgp4 health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_SGP4_BIN) {
    t.skip("CONKAY_ENGINE_SGP4_BIN unset — real sgp4 legs run in the CI lane");
    return;
  }
  const h = await runEngine("sgp4", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.energyDrift <= 0.005 && h.outputs.angMomDrift <= 0.005, `two-body invariants hold over 600 s (energy drift ${h.outputs.energyDrift})`);
});
