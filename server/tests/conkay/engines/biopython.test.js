/**
 * SXE-28 — Biopython entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-biopython.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-biopython.py");
const ABSENT = { CONKAY_ENGINE_BIOPYTHON_BIN: "/nonexistent/biopython/bin/python" };

test("biopython entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("biopython");
  assert.ok(entry, "biopython entry registered");
  assert.equal(entry.version, "1.85");
  assert.equal(entry.licence, "BSD-3-Clause (Biopython License Agreement)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "biopython");
  assert.ok(row, "report carries the biopython row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:biopython", async () => {
  const r = await runEngine("biopython", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:biopython");
  assert.equal(r.provenance.version, "1.85");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("biopython", "analyze", { sequence: 42 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:biopython");
  const noOp = await runEngine("biopython", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:biopython:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /biopython import failed/);
});

test("real lane: Biopython health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_BIOPYTHON_BIN) {
    t.skip("CONKAY_ENGINE_BIOPYTHON_BIN unset — real Biopython legs run in the CI lane");
    return;
  }
  const h = await runEngine("biopython", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(Math.abs(h.outputs.gcFraction - h.outputs.expectedGcFraction) <= 1e-9, "GC fraction matches the hand count exactly");
  assert.ok(h.outputs.protein.length > 0, "a translation is served");
});
