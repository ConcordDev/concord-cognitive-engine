/**
 * SXE-30 — Geant4 (reduced library) entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-geant4.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-geant4.py");
const ABSENT = { CONKAY_ENGINE_GEANT4_BIN: "/nonexistent/geant4/bin/python" };

test("geant4 entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("geant4");
  assert.ok(entry, "geant4 entry registered");
  assert.equal(entry.version, "11.3.0");
  assert.equal(entry.licence, "Geant4 Licence");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "geant4");
  assert.ok(row, "report carries the geant4 row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:geant4", async () => {
  const r = await runEngine("geant4", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:geant4");
  assert.equal(r.provenance.version, "11.3.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("geant4", "b1", { events: "many" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:geant4");
  const noOp = await runEngine("geant4", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:geant4:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin", CONKAY_GEANT4_B1: "/nonexistent" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /does not name a provisioned exampleB1/);
});

test("real lane: Geant4 (reduced library) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_GEANT4_BIN) {
    t.skip("CONKAY_ENGINE_GEANT4_BIN unset — real Geant4 (reduced library) legs run in the CI lane");
    return;
  }
  const h = await runEngine("geant4", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.doseMicroGy > 0, "B1 serves a positive cumulated dose in the scoring volume");
});
