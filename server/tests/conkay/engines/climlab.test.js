/**
 * SXE-35 — climlab entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-climlab.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-climlab.py");
const ABSENT = { CONKAY_ENGINE_CLIMLAB_BIN: "/nonexistent/climlab/bin/python" };

test("climlab entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("climlab");
  assert.ok(entry, "climlab entry registered");
  assert.equal(entry.version, "0.10.1");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "climlab");
  assert.ok(row, "report carries the climlab row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:climlab", async () => {
  const r = await runEngine("climlab", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:climlab");
  assert.equal(r.provenance.version, "0.10.1");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("climlab", "ebm", { solarFactor: "hot" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:climlab");
  const noOp = await runEngine("climlab", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:climlab:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /climlab import failed/);
});

test("real lane: climlab health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CLIMLAB_BIN) {
    t.skip("CONKAY_ENGINE_CLIMLAB_BIN unset — real climlab legs run in the CI lane");
    return;
  }
  const h = await runEngine("climlab", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.globalMeanTsK >= 270 && h.outputs.globalMeanTsK <= 300, "equilibrium Ts in the physical band");
  assert.ok(h.outputs.maxTendencyK < 0.01, "the budget is closed at equilibrium");
});
