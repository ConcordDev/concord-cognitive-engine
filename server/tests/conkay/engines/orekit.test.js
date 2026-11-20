/**
 * SXE-36 — Orekit entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-orekit.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-orekit.py");
const ABSENT = { CONKAY_ENGINE_OREKIT_BIN: "/nonexistent/orekit/bin/python" };

test("orekit entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("orekit");
  assert.ok(entry, "orekit entry registered");
  assert.equal(entry.version, "13.1.0");
  assert.equal(entry.licence, "Apache-2.0");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "orekit");
  assert.ok(row, "report carries the orekit row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:orekit", async () => {
  const r = await runEngine("orekit", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:orekit");
  assert.equal(r.provenance.version, "13.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("orekit", "orbit", { semiMajorKm: "high" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:orekit");
  const noOp = await runEngine("orekit", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:orekit:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /orekit import failed/);
});

test("real lane: Orekit health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OREKIT_BIN) {
    t.skip("CONKAY_ENGINE_OREKIT_BIN unset — real Orekit legs run in the CI lane");
    return;
  }
  const h = await runEngine("orekit", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 1e-6 && h.outputs.closureErrorM <= 1.0, `period matches Kepler and the analytic orbit closes (rel err ${h.outputs.relError}, closure ${h.outputs.closureErrorM} m)`);
});
