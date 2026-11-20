/**
 * SXE-33 — HCIPy entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-hcipy.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-hcipy.py");
const ABSENT = { CONKAY_ENGINE_HCIPY_BIN: "/nonexistent/hcipy/bin/python" };

test("hcipy entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("hcipy");
  assert.ok(entry, "hcipy entry registered");
  assert.equal(entry.version, "0.6.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "hcipy");
  assert.ok(row, "report carries the hcipy row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:hcipy", async () => {
  const r = await runEngine("hcipy", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:hcipy");
  assert.equal(r.provenance.version, "0.6.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("hcipy", "airy", { focalM: "far" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:hcipy");
  const noOp = await runEngine("hcipy", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:hcipy:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /hcipy import failed/);
});

test("real lane: HCIPy health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_HCIPY_BIN) {
    t.skip("CONKAY_ENGINE_HCIPY_BIN unset — real HCIPy legs run in the CI lane");
    return;
  }
  const h = await runEngine("hcipy", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 0.10, `Airy null radius within 10% of 1.22*lambda*f/D (rel err ${h.outputs.relError})`);
});
