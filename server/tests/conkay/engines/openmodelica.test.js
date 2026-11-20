/**
 * SXE-15 — OpenModelica + MSL entry + kernel suite (built under SXE-53).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-openmodelica.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-openmodelica.py");
const ABSENT = { CONKAY_ENGINE_OPENMODELICA_BIN: "/nonexistent/openmodelica/bin/python" };

test("openmodelica entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("openmodelica");
  assert.ok(entry, "openmodelica entry registered");
  assert.equal(entry.version, "1.25.0");
  assert.equal(entry.licence, "OSMC-PL/GPL-3.0-only (process); MSL BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "openmodelica");
  assert.ok(row, "report carries the openmodelica row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:openmodelica", async () => {
  const r = await runEngine("openmodelica", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:openmodelica");
  assert.equal(r.provenance.version, "1.25.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("openmodelica", "first", { inertia: "big" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:openmodelica");
  const noOp = await runEngine("openmodelica", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:openmodelica:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /omc executable not found/);
});

test("real lane: OpenModelica + MSL health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OPENMODELICA_BIN) {
    t.skip("CONKAY_ENGINE_OPENMODELICA_BIN unset — real OpenModelica + MSL legs run in the CI lane");
    return;
  }
  const h = await runEngine("openmodelica", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError < 1e-3, `driven-inertia w(1) rel error ${h.outputs.relError} within 1e-3 of the exact 1.0`);
});
