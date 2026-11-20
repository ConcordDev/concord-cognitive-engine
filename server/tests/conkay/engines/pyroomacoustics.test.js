/**
 * SXE-34 — pyroomacoustics entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pyroomacoustics.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pyroomacoustics.py");
const ABSENT = { CONKAY_ENGINE_PYROOMACOUSTICS_BIN: "/nonexistent/pyroomacoustics/bin/python" };

test("pyroomacoustics entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pyroomacoustics");
  assert.ok(entry, "pyroomacoustics entry registered");
  assert.equal(entry.version, "0.8.3");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pyroomacoustics");
  assert.ok(row, "report carries the pyroomacoustics row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pyroomacoustics", async () => {
  const r = await runEngine("pyroomacoustics", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pyroomacoustics");
  assert.equal(r.provenance.version, "0.8.3");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pyroomacoustics", "rir", { distanceM: "far" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pyroomacoustics");
  const noOp = await runEngine("pyroomacoustics", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pyroomacoustics:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pyroomacoustics import failed/);
});

test("real lane: pyroomacoustics health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PYROOMACOUSTICS_BIN) {
    t.skip("CONKAY_ENGINE_PYROOMACOUSTICS_BIN unset — real pyroomacoustics legs run in the CI lane");
    return;
  }
  const h = await runEngine("pyroomacoustics", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.absErrorSamples <= 2, `direct-path arrival within 2 samples of distance/c*fs (err ${h.outputs.absErrorSamples})`);
});
