/**
 * SXE-38 — CuraEngine additive slicer entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-curaengine.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-curaengine.py");
const ABSENT = { CONKAY_ENGINE_CURAENGINE_BIN: "/nonexistent/curaengine/bin/python" };

test("curaengine entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("curaengine");
  assert.ok(entry, "curaengine entry registered");
  assert.equal(entry.version, "5.9.0");
  assert.equal(entry.licence, "AGPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "curaengine");
  assert.ok(row, "report carries the curaengine row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:curaengine", async () => {
  const r = await runEngine("curaengine", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:curaengine");
  assert.equal(r.provenance.version, "5.9.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("curaengine", "slice", { sizeMm: "cube-ish" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:curaengine");
  const noOp = await runEngine("curaengine", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:curaengine:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /CuraEngine executable not found/);
});

test("real lane: CuraEngine additive slicer health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CURAENGINE_BIN) {
    t.skip("CONKAY_ENGINE_CURAENGINE_BIN unset — real CuraEngine additive slicer legs run in the CI lane");
    return;
  }
  const h = await runEngine("curaengine", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.timeS > 0 && h.outputs.layers > 0, "20 mm cube sliced with a real print time");
});
