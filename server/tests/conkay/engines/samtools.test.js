/**
 * SXE-28 — samtools + bcftools entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-samtools.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-samtools.py");
const ABSENT = { CONKAY_ENGINE_SAMTOOLS_BIN: "/nonexistent/samtools/bin/python" };

test("samtools entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("samtools");
  assert.ok(entry, "samtools entry registered");
  assert.equal(entry.version, "1.21");
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "samtools");
  assert.ok(row, "report carries the samtools row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:samtools", async () => {
  const r = await runEngine("samtools", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:samtools");
  assert.equal(r.provenance.version, "1.21");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("samtools", "count", { sam: 42 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:samtools");
  const noOp = await runEngine("samtools", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:samtools:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /samtools executable not found/);
});

test("real lane: samtools + bcftools health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_SAMTOOLS_BIN) {
    t.skip("CONKAY_ENGINE_SAMTOOLS_BIN unset — real samtools + bcftools legs run in the CI lane");
    return;
  }
  const h = await runEngine("samtools", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.equal(h.outputs.records, 5);
  assert.equal(h.outputs.records, h.outputs.expectedRecords);
});
