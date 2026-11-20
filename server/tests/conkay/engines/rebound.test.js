/**
 * SXE-36 — REBOUND entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-rebound.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-rebound.py");
const ABSENT = { CONKAY_ENGINE_REBOUND_BIN: "/nonexistent/rebound/bin/python" };

test("rebound entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("rebound");
  assert.ok(entry, "rebound entry registered");
  assert.equal(entry.version, "4.4.0");
  assert.equal(entry.licence, "GPL-3.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "rebound");
  assert.ok(row, "report carries the rebound row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:rebound", async () => {
  const r = await runEngine("rebound", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:rebound");
  assert.equal(r.provenance.version, "4.4.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("rebound", "orbit", { semiMajor: "wide" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:rebound");
  const noOp = await runEngine("rebound", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:rebound:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /rebound import failed/);
});

test("real lane: REBOUND health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_REBOUND_BIN) {
    t.skip("CONKAY_ENGINE_REBOUND_BIN unset — real REBOUND legs run in the CI lane");
    return;
  }
  const h = await runEngine("rebound", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.ok(h.outputs.relError <= 1e-6 && h.outputs.closureError <= 1e-3, `period matches Kepler and the orbit closes (rel err ${h.outputs.relError}, closure ${h.outputs.closureError})`);
});
