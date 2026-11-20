/**
 * SXE-35 — EPANET entry + kernel suite (built under SXE-54).
 *
 * Locally provable legs: registration + report shape, the
 * engine_unavailable absence, schema refusal before spawn,
 * unknown-op refusal, and the kernel's provisioning-defect
 * shape (engine absent on this machine: the kernel must exit
 * naming it, never print a result). The value legs run in the
 * CI lane (conkay-engine-epanet.yml, manual dispatch per F8),
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
const KERNEL = join(HERE, "..", "..", "..", "lib", "conkay", "engines", "kernels", "kernel-epanet.py");
const ABSENT = { CONKAY_ENGINE_EPANET_BIN: "/nonexistent/epanet/bin/python" };

test("epanet entry is registered, valid, and reported engine-dependent", () => {
  const entry = getEngine("epanet");
  assert.ok(entry, "epanet entry registered");
  assert.equal(entry.version, "2.3.0");
  assert.equal(entry.licence, "Public domain (US EPA)");
  assert.equal(entry.linkMode, "process");
  assert.deepEqual(validateManifestEntry(entry), []);
  const row = engineListReport(ABSENT).engines.find((e) => e.id === "epanet");
  assert.ok(row, "report carries the epanet row");
  assert.equal(row.engineDependent, true);
  assert.equal(row.present, false);
});

test("absent env answers NOT_COMPUTED engine_unavailable:epanet", async () => {
  const r = await runEngine("epanet", "health", {}, { env: ABSENT, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:epanet");
  assert.equal(r.provenance.version, "2.3.0");
});

test("malformed request is refused before spawn; unknown op is refused", async () => {
  const bad = await runEngine("epanet", "pipe", { demandM3s: "lots" }, { env: ABSENT, fresh: true });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.reason, "engine_request_invalid:epanet");
  const noOp = await runEngine("epanet", "solve-everything", {}, { env: ABSENT, fresh: true });
  assert.equal(noOp.status, "FAIL");
  assert.equal(noOp.reason, "engine_unknown_op:epanet:solve-everything");
});

test("kernel: unprovisioned engine is named, never fabricated around", () => {
  const r = spawnSync("/usr/bin/python3", [KERNEL], {
    env: { ...process.env, PATH: "/nonexistent-bin", CONKAY_EPANET_LIB: "/nonexistent" },
    input: JSON.stringify({ op: "health", request: {} }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /does not name a provisioned EPANET/);
});

test("real lane: EPANET health (CI lane only)", async (t) => {
  if (!process.env.CONKAY_ENGINE_EPANET_BIN) {
    t.skip("CONKAY_ENGINE_EPANET_BIN unset — real EPANET legs run in the CI lane");
    return;
  }
  const h = await runEngine("epanet", "health", {}, { fresh: true });
  assert.equal(h.status, "PASS", JSON.stringify(h));
  assert.ok(h.outputs.relError <= 0.01, `junction head matches the Hazen-Williams closed form (rel ${h.outputs.relError})`);
});
