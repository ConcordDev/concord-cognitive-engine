/**
 * SXE-33 — Radiance entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-radiance.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-radiance.py");
const ABSENT = { CONKAY_ENGINE_RADIANCE_BIN: "/nonexistent/radiance/bin/python" };

test("radiance entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("radiance");
  assert.ok(entry, "radiance entry registered");
  assert.equal(entry.version, "5.4");
  assert.equal(entry.licence, "Radiance License");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "radiance");
  assert.ok(row, "report carries the radiance row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:radiance", async () => {
  const r = await runEngine("radiance", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:radiance");
  assert.equal(r.provenance.version, "5.4");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("radiance", "trace", { intensity: "bright" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:radiance");
  const noOp = await runEngine("radiance", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:radiance:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /radiance binaries/);
});

test("real lane: Radiance health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_RADIANCE_BIN) {
    t.skip("CONKAY_ENGINE_RADIANCE_BIN unset — real Radiance legs run in the CI lane");
    return;
  }
  const h = await runEngine("radiance", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 0.01, `glow-source radiance served exactly (rel err ${h.outputs.relError})`);
});
