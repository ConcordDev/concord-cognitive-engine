/**
 * SXE-37 — pvlib entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pvlib.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pvlib.py");
const ABSENT = { CONKAY_ENGINE_PVLIB_BIN: "/nonexistent/pvlib/bin/python" };

test("pvlib entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pvlib");
  assert.ok(entry, "pvlib entry registered");
  assert.equal(entry.version, "0.13.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pvlib");
  assert.ok(row, "report carries the pvlib row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pvlib", async () => {
  const r = await runEngine("pvlib", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pvlib");
  assert.equal(r.provenance.version, "0.13.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pvlib", "clear-sky", { linkeTurbidity: "murky" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pvlib");
  const noOp = await runEngine("pvlib", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pvlib:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pvlib import failed/);
});

test("real lane: pvlib health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PVLIB_BIN) {
    t.skip("CONKAY_ENGINE_PVLIB_BIN unset — real pvlib legs run in the CI lane");
    return;
  }
  const h = await runEngine("pvlib", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.zenithErrorDeg <= 0.15 && h.outputs.ghiRelDiff <= 0.10, `solar position matches NOAA and the clear-sky models agree (zenith err ${h.outputs.zenithErrorDeg} deg, GHI diff ${h.outputs.ghiRelDiff})`);
});
