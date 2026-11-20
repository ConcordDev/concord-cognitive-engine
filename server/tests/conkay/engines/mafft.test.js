/**
 * SXE-28 — MAFFT entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-mafft.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-mafft.py");
const ABSENT = { CONKAY_ENGINE_MAFFT_BIN: "/nonexistent/mafft/bin/python" };

test("mafft entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("mafft");
  assert.ok(entry, "mafft entry registered");
  assert.equal(entry.version, "7.526");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "mafft");
  assert.ok(row, "report carries the mafft row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:mafft", async () => {
  const r = await runEngine("mafft", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:mafft");
  assert.equal(r.provenance.version, "7.526");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("mafft", "align", { sequences: "nope" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:mafft");
  const noOp = await runEngine("mafft", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:mafft:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /mafft executable not found/);
});

test("real lane: MAFFT health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_MAFFT_BIN) {
    t.skip("CONKAY_ENGINE_MAFFT_BIN unset — real MAFFT legs run in the CI lane");
    return;
  }
  const h = await runEngine("mafft", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.equal(h.outputs.rows, 3);
  assert.ok(h.outputs.conservedColumns > 0, "the homologous set shares conserved columns");
});
