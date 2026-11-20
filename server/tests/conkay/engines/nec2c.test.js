/**
 * SXE-17 — NEC2 (nec2c) entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-nec2c.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-nec2c.py");
const ABSENT = { CONKAY_ENGINE_NEC2C_BIN: "/nonexistent/nec2c/bin/python" };

test("nec2c entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("nec2c");
  assert.ok(entry, "nec2c entry registered");
  assert.equal(entry.version, "1.3.1");
  assert.equal(entry.licence, "Public domain");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "nec2c");
  assert.ok(row, "report carries the nec2c row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:nec2c", async () => {
  const r = await runEngine("nec2c", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:nec2c");
  assert.equal(r.provenance.version, "1.3.1");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("nec2c", "dipole-impedance", { frequencyMHz: "fast" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:nec2c");
  const noOp = await runEngine("nec2c", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:nec2c:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /nec2c executable not found/);
});

test("real lane: NEC2 (nec2c) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_NEC2C_BIN) {
    t.skip("CONKAY_ENGINE_NEC2C_BIN unset — real NEC2 (nec2c) legs run in the CI lane");
    return;
  }
  const h = await runEngine("nec2c", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.absErrorR <= 3 && h.outputs.absErrorX <= 5, `dipole impedance within band of the recorded 84.8 + j48.0 ohm reference (got ${h.outputs.resistanceOhm} + j${h.outputs.reactanceOhm})`);
});
