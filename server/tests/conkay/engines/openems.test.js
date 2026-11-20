/**
 * SXE-17 — openEMS entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-openems.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-openems.py");
const ABSENT = { CONKAY_ENGINE_OPENEMS_BIN: "/nonexistent/openems/bin/python" };

test("openems entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("openems");
  assert.ok(entry, "openems entry registered");
  assert.equal(entry.version, "0.0.35");
  assert.equal(entry.licence, "GPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "openems");
  assert.ok(row, "report carries the openems row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:openems", async () => {
  const r = await runEngine("openems", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:openems");
  assert.equal(r.provenance.version, "0.0.35");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("openems", "dipole-impedance", { freqGHz: "high" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:openems");
  const noOp = await runEngine("openems", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:openems:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /openEMS import failed/);
});

test("real lane: openEMS health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OPENEMS_BIN) {
    t.skip("CONKAY_ENGINE_OPENEMS_BIN unset — real openEMS legs run in the CI lane");
    return;
  }
  const h = await runEngine("openems", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(Number.isFinite(h.outputs.resistanceOhm), "openEMS serves a finite dipole resistance (completion-class case)");
});
