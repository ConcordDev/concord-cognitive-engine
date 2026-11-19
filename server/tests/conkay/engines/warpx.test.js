/**
 * SXE-31 — WarpX (CPU) entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-warpx.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-warpx.py");
const ABSENT = { CONKAY_ENGINE_WARPX_BIN: "/nonexistent/warpx/bin/python" };

test("warpx entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("warpx");
  assert.ok(entry, "warpx entry registered");
  assert.equal(entry.version, "25.10");
  assert.equal(entry.licence, "BSD-3-Clause (BSD-3-LBNL)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "warpx");
  assert.ok(row, "report carries the warpx row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:warpx", async () => {
  const r = await runEngine("warpx", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:warpx");
  assert.equal(r.provenance.version, "25.10");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("warpx", "langmuir", { densityM3: "dense" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:warpx");
  const noOp = await runEngine("warpx", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:warpx:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /warpx executable \(warpx.1d\) not found/);
});

test("real lane: WarpX (CPU) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_WARPX_BIN) {
    t.skip("CONKAY_ENGINE_WARPX_BIN unset — real WarpX (CPU) legs run in the CI lane");
    return;
  }
  const h = await runEngine("warpx", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 0.10, `Langmuir frequency within 10% of omega_p (rel ${h.outputs.relError})`);
});
