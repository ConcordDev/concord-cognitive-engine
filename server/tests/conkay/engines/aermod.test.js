/**
 * SXE-35 — AERMOD entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-aermod.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-aermod.py");
const ABSENT = { CONKAY_ENGINE_AERMOD_BIN: "/nonexistent/aermod/bin/python" };

test("aermod entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("aermod");
  assert.ok(entry, "aermod entry registered");
  assert.equal(entry.version, "24142");
  assert.equal(entry.licence, "Public domain (US EPA)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "aermod");
  assert.ok(row, "report carries the aermod row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:aermod", async () => {
  const r = await runEngine("aermod", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:aermod");
  assert.equal(r.provenance.version, "24142");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("aermod", "plume", { emissionRate: "lots" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:aermod");
  const noOp = await runEngine("aermod", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:aermod:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /aermod executable not found/);
});

test("real lane: AERMOD health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_AERMOD_BIN) {
    t.skip("CONKAY_ENGINE_AERMOD_BIN unset — real AERMOD legs run in the CI lane");
    return;
  }
  const h = await runEngine("aermod", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxConcUgM3 > 0, "the plume case serves a positive maximum concentration");
});
