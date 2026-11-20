/**
 * SXE-33 — POPPY entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-poppy.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-poppy.py");
const ABSENT = { CONKAY_ENGINE_POPPY_BIN: "/nonexistent/poppy/bin/python" };

test("poppy entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("poppy");
  assert.ok(entry, "poppy entry registered");
  assert.equal(entry.version, "1.1.0");
  assert.equal(entry.licence, "BSD-3-Clause");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "poppy");
  assert.ok(row, "report carries the poppy row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:poppy", async () => {
  const r = await runEngine("poppy", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:poppy");
  assert.equal(r.provenance.version, "1.1.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("poppy", "airy", { wavelengthNm: "red" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:poppy");
  const noOp = await runEngine("poppy", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:poppy:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /poppy import failed/);
});

test("real lane: POPPY health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_POPPY_BIN) {
    t.skip("CONKAY_ENGINE_POPPY_BIN unset — real POPPY legs run in the CI lane");
    return;
  }
  const h = await runEngine("poppy", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 0.15, `Airy null within 15% of 1.22*lambda/D (rel err ${h.outputs.relError})`);
});
