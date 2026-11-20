/**
 * SXE-36 — Astropy entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-astropy.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-astropy.py");
const ABSENT = { CONKAY_ENGINE_ASTROPY_BIN: "/nonexistent/astropy/bin/python" };

test("astropy entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("astropy");
  assert.ok(entry, "astropy entry registered");
  assert.equal(entry.version, "7.1.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "astropy");
  assert.ok(row, "report carries the astropy row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:astropy", async () => {
  const r = await runEngine("astropy", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:astropy");
  assert.equal(r.provenance.version, "7.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("astropy", "position", { epochYear: "soon" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:astropy");
  const noOp = await runEngine("astropy", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:astropy:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /astropy import failed/);
});

test("real lane: Astropy health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_ASTROPY_BIN) {
    t.skip("CONKAY_ENGINE_ASTROPY_BIN unset — real Astropy legs run in the CI lane");
    return;
  }
  const h = await runEngine("astropy", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.distanceKm >= 0.98 * 149597870.7 && h.outputs.distanceKm <= 1.02 * 149597870.7, `Earth barycentric distance inside the physical envelope (${h.outputs.distanceKm} km)`);
});
