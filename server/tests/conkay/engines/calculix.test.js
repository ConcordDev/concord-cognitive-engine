/**
 * SXE-07 — CalculiX entry + kernel suite.
 *
 * Locally provable legs: registration + GPL process-only
 * discipline, the engine_unavailable absence, schema
 * refusal before spawn, unknown-op refusal, and the
 * kernel's provisioning-defect shape (ccx absent on this
 * machine: the kernel must exit naming ccx, never print a
 * result). The value legs — single-element tension vs its
 * exact closed form (rel err < 1e-3), C3D20 cantilever vs
 * Euler-Bernoulli (band < 8%) — run in the CI lane
 * (conkay-engine-calculix.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-calculix.py");
const ABSENT = { CONKAY_ENGINE_CALCULIX_BIN: "/nonexistent/calculix/bin/python" };
const CANTILEVER = { length: 1, height: 0.05, load: 0.01, e: 1e6, nu: 0.3, nx: 10 };

test("calculix entry is registered, valid, GPL process-only", () => {
  const entry = getEngine("calculix");
  assert.ok(entry, "calculix entry registered");
  assert.equal(entry.version, "2.23");
  assert.equal(entry.licence, "GPL-2.0-only");
  assert.equal(entry.linkMode, "process", "GPL engine stays across the process boundary");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "calculix");
  assert.ok(row, "report carries the calculix row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:calculix", async () => {
  const r = await runEngine("calculix", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:calculix");
  assert.equal(r.provenance.version, "2.23");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("calculix", "cantilever",
    { ...CANTILEVER, length: "long" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:calculix");
  const noOp = await runEngine("calculix", "crash-the-beam", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:calculix:crash-the-beam");
});

test("kernel: missing ccx is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /ccx executable not found/);
});

test("real lane: tension vs exact closed form + cantilever band (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CALCULIX_BIN) {
    t.skip("CONKAY_ENGINE_CALCULIX_BIN unset — real CalculiX legs run in the CI lane");
    return;
  }
  const h = await runEngine("calculix", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxRelError < 1e-3,
    `single-element tension matches the closed form (rel err ${h.outputs.maxRelError})`);
  const c = await runEngine("calculix", "cantilever", CANTILEVER, { fresh: true });
  assert.equal(c.status, "PASS");
  assert.ok(c.outputs.relDeviation < 0.08,
    `cantilever tip within 8% of Euler-Bernoulli (got ${(c.outputs.relDeviation * 100).toFixed(1)}%)`);
});
