/**
 * SXE-18 — Meep FDTD entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-meep.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-meep.py");
const ABSENT = { CONKAY_ENGINE_MEEP_BIN: "/nonexistent/meep/bin/python" };

test("meep entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("meep");
  assert.ok(entry, "meep entry registered");
  assert.equal(entry.version, "1.31.0");
  assert.equal(entry.licence, "GPL-2.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "meep");
  assert.ok(row, "report carries the meep row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:meep", async () => {
  const r = await runEngine("meep", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:meep");
  assert.equal(r.provenance.version, "1.31.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("meep", "fabry-perot", { slabIndex: "glass" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:meep");
  const noOp = await runEngine("meep", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:meep:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /meep import failed/);
});

test("real lane: Meep FDTD health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_MEEP_BIN) {
    t.skip("CONKAY_ENGINE_MEEP_BIN unset — real Meep FDTD legs run in the CI lane");
    return;
  }
  const h = await runEngine("meep", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.maxAbsDiff < 0.03, `Fabry-Perot transmission matches the transfer-matrix spectrum (max diff ${h.outputs.maxAbsDiff})`);
});
