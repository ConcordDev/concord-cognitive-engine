/**
 * SXE-35 — SPECFEM2D entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-specfem.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-specfem.py");
const ABSENT = { CONKAY_ENGINE_SPECFEM_BIN: "/nonexistent/specfem/bin/python" };

test("specfem entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("specfem");
  assert.ok(entry, "specfem entry registered");
  assert.equal(entry.version, "8.1.0");
  assert.equal(entry.licence, "GPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "specfem");
  assert.ok(row, "report carries the specfem row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:specfem", async () => {
  const r = await runEngine("specfem", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:specfem");
  assert.equal(r.provenance.version, "8.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("specfem", "example", { timeoutS: "ages" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:specfem");
  const noOp = await runEngine("specfem", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:specfem:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /xmeshfem2D executable not found/);
});

test("real lane: SPECFEM2D health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_SPECFEM_BIN) {
    t.skip("CONKAY_ENGINE_SPECFEM_BIN unset — real SPECFEM2D legs run in the CI lane");
    return;
  }
  const h = await runEngine("specfem", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.traces > 0 && h.outputs.maxAmplitude > 0, "the example run serves finite non-zero seismograms");
});
