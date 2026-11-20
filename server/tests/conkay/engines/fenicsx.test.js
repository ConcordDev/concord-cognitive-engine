/**
 * SXE-09 — FEniCSx/DOLFINx entry + kernel suite.
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (dolfinx absent on this machine: the kernel must
 * exit naming the import failure, never print a result).
 * The value legs — Poisson L2 error < 1e-3 against the
 * manufactured solution, elasticity within band of beam
 * theory — run in the CI lane (conkay-engine-fenicsx.yml,
 * manual dispatch per F8), which fails if this suite skips
 * there.
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-fenicsx.py");
const ABSENT = { CONKAY_ENGINE_FENICSX_BIN: "/nonexistent/fenicsx/bin/python" };

test("fenicsx entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("fenicsx");
  assert.ok(entry, "fenicsx entry registered");
  assert.equal(entry.version, "0.11.0");
  assert.equal(entry.licence, "LGPL-3.0-or-later");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "fenicsx");
  assert.ok(row, "report carries the fenicsx row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:fenicsx", async () => {
  const r = await runEngine("fenicsx", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:fenicsx");
  assert.equal(r.provenance.version, "0.11.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("fenicsx", "poisson", { nx: "fine" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:fenicsx");
  const noOp = await runEngine("fenicsx", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:fenicsx:solve-everything");
});

test("kernel: unprovisioned dolfinx stack is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /fenicsx stack import failed/);
});

test("real lane: Poisson health + elasticity band (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_FENICSX_BIN) {
    t.skip("CONKAY_ENGINE_FENICSX_BIN unset — real DOLFINx legs run in the CI lane");
    return;
  }
  const h = await runEngine("fenicsx", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.l2Error < 1e-3, `L2 error ${h.outputs.l2Error} within the plan bound 1e-3`);
  const e = await runEngine("fenicsx", "elasticity", { traction: -0.25 }, { fresh: true });
  assert.equal(e.status, "PASS", JSON.stringify(e));
  assert.ok(e.outputs.relDeviation < 0.12,
    `tip deflection within 12% of beam theory (got ${(e.outputs.relDeviation * 100).toFixed(1)}%)`);
});
