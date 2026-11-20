/**
 * SXE-14 — Pinocchio rigid-body dynamics entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pinocchio.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pinocchio.py");
const ABSENT = { CONKAY_ENGINE_PINOCCHIO_BIN: "/nonexistent/pinocchio/bin/python" };

test("pinocchio entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pinocchio");
  assert.ok(entry, "pinocchio entry registered");
  assert.equal(entry.version, "3.3.0");
  assert.equal(entry.licence, "BSD-2-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pinocchio");
  assert.ok(row, "report carries the pinocchio row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pinocchio", async () => {
  const r = await runEngine("pinocchio", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pinocchio");
  assert.equal(r.provenance.version, "3.3.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pinocchio", "rnea", { massKg: "heavy" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pinocchio");
  const noOp = await runEngine("pinocchio", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pinocchio:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pinocchio import failed/);
});

test("real lane: Pinocchio rigid-body dynamics health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PINOCCHIO_BIN) {
    t.skip("CONKAY_ENGINE_PINOCCHIO_BIN unset — real Pinocchio rigid-body dynamics legs run in the CI lane");
    return;
  }
  const h = await runEngine("pinocchio", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError < 1e-6, `RNEA torque matches the closed form (rel ${h.outputs.relError})`);
});
