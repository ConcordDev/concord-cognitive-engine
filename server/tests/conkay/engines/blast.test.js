/**
 * SXE-28 — BLAST+ entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-blast.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-blast.py");
const ABSENT = { CONKAY_ENGINE_BLAST_BIN: "/nonexistent/blast/bin/python" };

test("blast entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("blast");
  assert.ok(entry, "blast entry registered");
  assert.equal(entry.version, "2.16.0");
  assert.equal(entry.licence, "Public domain (NCBI)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "blast");
  assert.ok(row, "report carries the blast row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:blast", async () => {
  const r = await runEngine("blast", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:blast");
  assert.equal(r.provenance.version, "2.16.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("blast", "search", { sequence: 42 }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:blast");
  const noOp = await runEngine("blast", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:blast:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /makeblastdb executable not found/);
});

test("real lane: BLAST+ health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_BLAST_BIN) {
    t.skip("CONKAY_ENGINE_BLAST_BIN unset — real BLAST+ legs run in the CI lane");
    return;
  }
  const h = await runEngine("blast", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.equal(h.outputs.hitAccession, "planted-alpha");
  assert.ok(h.outputs.identityPct >= 99.9, "the exact-copy query hits its record at ~100% identity");
});
