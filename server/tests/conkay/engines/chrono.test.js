/**
 * SXE-14 — Project Chrono (PyChrono) entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-chrono.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-chrono.py");
const ABSENT = { CONKAY_ENGINE_CHRONO_BIN: "/nonexistent/chrono/bin/python" };

test("chrono entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("chrono");
  assert.ok(entry, "chrono entry registered");
  assert.equal(entry.version, "9.0.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "chrono");
  assert.ok(row, "report carries the chrono row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:chrono", async () => {
  const r = await runEngine("chrono", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:chrono");
  assert.equal(r.provenance.version, "9.0.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("chrono", "pendulum", { lengthM: "long" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:chrono");
  const noOp = await runEngine("chrono", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:chrono:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pychrono import failed/);
});

test("real lane: Project Chrono (PyChrono) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CHRONO_BIN) {
    t.skip("CONKAY_ENGINE_CHRONO_BIN unset — real Project Chrono (PyChrono) legs run in the CI lane");
    return;
  }
  const h = await runEngine("chrono", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError < 0.02, `pendulum period rel error ${h.outputs.relError} within 2% of the corrected closed form`);
});
