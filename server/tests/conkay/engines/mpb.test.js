/**
 * SXE-18 — MPB (Meep band structure) entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-mpb.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-mpb.py");
const ABSENT = { CONKAY_ENGINE_MPB_BIN: "/nonexistent/mpb/bin/python" };

test("mpb entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("mpb");
  assert.ok(entry, "mpb entry registered");
  assert.equal(entry.version, "1.12.0");
  assert.equal(entry.licence, "GPL-2.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "mpb");
  assert.ok(row, "report carries the mpb row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:mpb", async () => {
  const r = await runEngine("mpb", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:mpb");
  assert.equal(r.provenance.version, "1.12.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("mpb", "bands", { epsHigh: "high" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:mpb");
  const noOp = await runEngine("mpb", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:mpb:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /mpb import failed/);
});

test("real lane: MPB (Meep band structure) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_MPB_BIN) {
    t.skip("CONKAY_ENGINE_MPB_BIN unset — real MPB (Meep band structure) legs run in the CI lane");
    return;
  }
  const h = await runEngine("mpb", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxRelError < 0.02, `zone-edge band frequencies match the analytic dispersion roots (rel ${h.outputs.maxRelError})`);
});
