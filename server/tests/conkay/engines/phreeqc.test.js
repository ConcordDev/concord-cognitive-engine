/**
 * SXE-24 — PHREEQC (via phreeqpy) entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-phreeqc.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-phreeqc.py");
const ABSENT = { CONKAY_ENGINE_PHREEQC_BIN: "/nonexistent/phreeqc/bin/python" };

test("phreeqc entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("phreeqc");
  assert.ok(entry, "phreeqc entry registered");
  assert.equal(entry.version, "3.8.6");
  assert.equal(entry.licence, "Public domain (USGS)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "phreeqc");
  assert.ok(row, "report carries the phreeqc row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:phreeqc", async () => {
  const r = await runEngine("phreeqc", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:phreeqc");
  assert.equal(r.provenance.version, "3.8.6");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("phreeqc", "example1", { tempC: "warm" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:phreeqc");
  const noOp = await runEngine("phreeqc", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:phreeqc:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /phreeqpy import failed/);
});

test("real lane: PHREEQC (via phreeqpy) health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_PHREEQC_BIN) {
    t.skip("CONKAY_ENGINE_PHREEQC_BIN unset — real PHREEQC (via phreeqpy) legs run in the CI lane");
    return;
  }
  const h = await runEngine("phreeqc", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.absError <= 0.1, `Example 1 seawater pH ${h.outputs.ph} within 0.1 of the manual's 8.22`);
});
