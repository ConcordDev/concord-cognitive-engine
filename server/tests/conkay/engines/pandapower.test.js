/**
 * SXE-19 — pandapower entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-pandapower.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-pandapower.py");
const ABSENT = { CONKAY_ENGINE_PANDAPOWER_BIN: "/nonexistent/pandapower/bin/python" };

test("pandapower entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("pandapower");
  assert.ok(entry, "pandapower entry registered");
  assert.equal(entry.version, "2.14.11");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "pandapower");
  assert.ok(row, "report carries the pandapower row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:pandapower", async () => {
  const r = await runEngine("pandapower", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:pandapower");
  assert.equal(r.provenance.version, "2.14.11");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("pandapower", "load-flow", { scaleLoad: "double" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:pandapower");
  const noOp = await runEngine("pandapower", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:pandapower:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pandapower import failed/);
});

test("real lane: pandapower health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PANDAPOWER_BIN) {
    t.skip("CONKAY_ENGINE_PANDAPOWER_BIN unset — real pandapower legs run in the CI lane");
    return;
  }
  const h = await runEngine("pandapower", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxVmError <= 0.005, `IEEE 14-bus voltages within 0.005 pu of the published solution (max err ${h.outputs.maxVmError})`);
});
