/**
 * SXE-10 — Elmer FEM entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-elmer.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-elmer.py");
const ABSENT = { CONKAY_ENGINE_ELMER_BIN: "/nonexistent/elmer/bin/python" };

test("elmer entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("elmer");
  assert.ok(entry, "elmer entry registered");
  assert.equal(entry.version, "9.0");
  assert.equal(entry.licence, "GPL-2.0-only/LGPL-2.1-only (process)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "elmer");
  assert.ok(row, "report carries the elmer row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:elmer", async () => {
  const r = await runEngine("elmer", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:elmer");
  assert.equal(r.provenance.version, "9.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("elmer", "coil", { caseName: 42 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:elmer");
  const noOp = await runEngine("elmer", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:elmer:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /ElmerSolver executable not found/);
});

test("real lane: Elmer FEM health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_ELMER_BIN) {
    t.skip("CONKAY_ENGINE_ELMER_BIN unset — real Elmer FEM legs run in the CI lane");
    return;
  }
  const h = await runEngine("elmer", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(Number.isFinite(h.outputs.scalar), "shipped mgdyn_steady_coil case completed with finite saved data");
});
