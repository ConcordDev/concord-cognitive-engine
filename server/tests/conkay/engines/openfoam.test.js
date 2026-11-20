/**
 * SXE-11 — OpenFOAM entry + kernel suite.
 *
 * Locally provable legs: registration + GPL process-only
 * discipline (with the F3 distribution pin of record), the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (blockMesh absent on this machine: the kernel must
 * exit naming it, never print a result). The value leg —
 * the Re=100 cavity centreline against Ghia, Ghia & Shin
 * 1982 within the 0.05 band — runs in the CI lane
 * (conkay-engine-openfoam.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-openfoam.py");
const ABSENT = { CONKAY_ENGINE_OPENFOAM_BIN: "/nonexistent/openfoam/bin/python" };

test("openfoam entry is registered, valid, GPL process-only, F3 pin of record", () => {
  const entry = getEngine("openfoam");
  assert.ok(entry, "openfoam entry registered");
  assert.equal(entry.version, "2406", "ESI v2406 — the F3 safe default, pending the founder's ruling");
  assert.equal(entry.licence, "GPL-3.0-only");
  assert.equal(entry.linkMode, "process", "GPL engine stays across the process boundary");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "openfoam");
  assert.ok(row, "report carries the openfoam row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:openfoam", async () => {
  const r = await runEngine("openfoam", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:openfoam");
  assert.equal(r.provenance.version, "2406");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("openfoam", "cavity", { endTime: "later" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:openfoam");
  const noOp = await runEngine("openfoam", "solve-the-ocean", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:openfoam:solve-the-ocean");
});

test("kernel: missing blockMesh is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    // blockMesh absent BY CONSTRUCTION in any environment:
    // the lane sources the OpenFOAM bashrc before running
    // this suite, so an ambient-PATH spawn would find the
    // tools and run the case instead of naming the absence.
    env: { ...process.env, PATH: "/nonexistent-bin" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /blockMesh executable not found/);
});

test("real lane: cavity centreline vs Ghia 1982 within band (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_OPENFOAM_BIN) {
    t.skip("CONKAY_ENGINE_OPENFOAM_BIN unset — real OpenFOAM leg runs in the CI lane");
    return;
  }
  const h = await runEngine("openfoam", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(Math.abs(h.outputs.uLid - 1) < 0.05, `lid value served (${h.outputs.uLid})`);
  assert.ok(h.outputs.maxDeviation <= 0.05,
    `centreline within the 0.05 band of Ghia et al. 1982 (max dev ${h.outputs.maxDeviation})`);
});
