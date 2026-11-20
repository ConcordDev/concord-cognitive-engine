/**
 * SXE-38 — PrusaSlicer additive slicer entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-prusaslicer.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-prusaslicer.py");
const ABSENT = { CONKAY_ENGINE_PRUSASLICER_BIN: "/nonexistent/prusaslicer/bin/python" };

test("prusaslicer entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("prusaslicer");
  assert.ok(entry, "prusaslicer entry registered");
  assert.equal(entry.version, "2.9.0");
  assert.equal(entry.licence, "AGPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "prusaslicer");
  assert.ok(row, "report carries the prusaslicer row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:prusaslicer", async () => {
  const r = await runEngine("prusaslicer", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:prusaslicer");
  assert.equal(r.provenance.version, "2.9.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("prusaslicer", "slice", { sizeMm: "cube-ish" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:prusaslicer");
  const noOp = await runEngine("prusaslicer", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:prusaslicer:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /prusa-slicer executable not found/);
});

test("real lane: PrusaSlicer additive slicer health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PRUSASLICER_BIN) {
    t.skip("CONKAY_ENGINE_PRUSASLICER_BIN unset — real PrusaSlicer additive slicer legs run in the CI lane");
    return;
  }
  const h = await runEngine("prusaslicer", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.timeS > 0, "20 mm cube sliced with a real estimated print time");
});
