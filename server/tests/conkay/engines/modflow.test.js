/**
 * SXE-35 — MODFLOW 6 (via FloPy) entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-modflow.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-modflow.py");
const ABSENT = { CONKAY_ENGINE_MODFLOW_BIN: "/nonexistent/modflow/bin/python" };

test("modflow entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("modflow");
  assert.ok(entry, "modflow entry registered");
  assert.equal(entry.version, "6.5.0");
  assert.equal(entry.licence, "Public domain (USGS)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "modflow");
  assert.ok(row, "report carries the modflow row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:modflow", async () => {
  const r = await runEngine("modflow", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:modflow");
  assert.equal(r.provenance.version, "6.5.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("modflow", "aquifer", { headLeft: "high", headRight: 0 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:modflow");
  const noOp = await runEngine("modflow", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:modflow:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin", CONKAY_MF6_BIN: "/nonexistent" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /flopy import failed/);
});

test("real lane: MODFLOW 6 (via FloPy) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_MODFLOW_BIN) {
    t.skip("CONKAY_ENGINE_MODFLOW_BIN unset — real MODFLOW 6 (via FloPy) legs run in the CI lane");
    return;
  }
  const h = await runEngine("modflow", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 0.02, `middle head matches the linear profile (rel ${h.outputs.relError})`);
});
