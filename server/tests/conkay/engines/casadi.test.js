/**
 * SXE-20 — CasADi entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-casadi.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-casadi.py");
const ABSENT = { CONKAY_ENGINE_CASADI_BIN: "/nonexistent/casadi/bin/python" };

test("casadi entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("casadi");
  assert.ok(entry, "casadi entry registered");
  assert.equal(entry.version, "3.7.0");
  assert.equal(entry.licence, "LGPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "casadi");
  assert.ok(row, "report carries the casadi row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:casadi", async () => {
  const r = await runEngine("casadi", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:casadi");
  assert.equal(r.provenance.version, "3.7.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("casadi", "nlp", { cx: "two" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:casadi");
  const noOp = await runEngine("casadi", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:casadi:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /casadi import failed/);
});

test("real lane: CasADi health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_CASADI_BIN) {
    t.skip("CONKAY_ENGINE_CASADI_BIN unset — real CasADi legs run in the CI lane");
    return;
  }
  const h = await runEngine("casadi", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.maxRelError < 1e-6, `projection NLP matches the closed form (rel ${h.outputs.maxRelError})`);
});
