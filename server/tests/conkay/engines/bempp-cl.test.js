/**
 * SXE-34 — bempp-cl entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-bempp-cl.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-bempp-cl.py");
const ABSENT = { CONKAY_ENGINE_BEMPP_CL_BIN: "/nonexistent/bempp-cl/bin/python" };

test("bempp-cl entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("bempp-cl");
  assert.ok(entry, "bempp-cl entry registered");
  assert.equal(entry.version, "0.4.2");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "bempp-cl");
  assert.ok(row, "report carries the bempp-cl row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:bempp-cl", async () => {
  const r = await runEngine("bempp-cl", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:bempp-cl");
  assert.equal(r.provenance.version, "0.4.2");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("bempp-cl", "scatter", { wavenumber: "high" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:bempp-cl");
  const noOp = await runEngine("bempp-cl", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:bempp-cl:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /bempp import failed/);
});

test("real lane: bempp-cl health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_BEMPP_CL_BIN) {
    t.skip("CONKAY_ENGINE_BEMPP_CL_BIN unset — real bempp-cl legs run in the CI lane");
    return;
  }
  const h = await runEngine("bempp-cl", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 0.15, `sphere far field within 15% of the Mie series (rel err ${h.outputs.relError})`);
});
