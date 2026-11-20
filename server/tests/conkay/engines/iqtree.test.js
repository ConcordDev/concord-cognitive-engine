/**
 * SXE-28 — IQ-TREE entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-iqtree.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-iqtree.py");
const ABSENT = { CONKAY_ENGINE_IQTREE_BIN: "/nonexistent/iqtree/bin/python" };

test("iqtree entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("iqtree");
  assert.ok(entry, "iqtree entry registered");
  assert.equal(entry.version, "2.3.6");
  assert.equal(entry.licence, "GPL-2.0-only");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "iqtree");
  assert.ok(row, "report carries the iqtree row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:iqtree", async () => {
  const r = await runEngine("iqtree", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:iqtree");
  assert.equal(r.provenance.version, "2.3.6");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("iqtree", "tree", { alignment: 42 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:iqtree");
  const noOp = await runEngine("iqtree", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:iqtree:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /iqtree2 executable not found/);
});

test("real lane: IQ-TREE health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_IQTREE_BIN) {
    t.skip("CONKAY_ENGINE_IQTREE_BIN unset — real IQ-TREE legs run in the CI lane");
    return;
  }
  const h = await runEngine("iqtree", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS");
  assert.equal(h.outputs.tips, 4);
  assert.ok(Number.isFinite(h.outputs.logLikelihood), "a finite log-likelihood is served");
});
