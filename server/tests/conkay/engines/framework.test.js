/**
 * SXE-00 engine framework tests.
 *
 * Exercises the manifest validator, the NOT_COMPUTED contract for absent
 * engines, and runProcessKernel against a fixture kernel (a small node
 * script standing in for an engine binary) for the success, cache,
 * crash, garbled-output, timeout and non-convergence paths.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineEngine, validateManifestEntry, getEngine, _clearEngines,
} from "../../../lib/conkay/engines/manifest.js";
import {
  runEngine, engineHealth, _clearEngineCache,
} from "../../../lib/conkay/engines/run-engine.js";
import { engineListReport } from "../../../lib/conkay/engines/index.js";

const KERNEL = `
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const { op, request } = JSON.parse(raw);
  const bump = () => {
    if (!request.counter) return;
    let n = 0;
    try { n = parseInt(readFileSyncSafe(request.counter), 10) || 0; } catch {}
    writeFileSyncSafe(request.counter, String(n + 1));
  };
  const fs = require("node:fs");
  function readFileSyncSafe(p) { return fs.readFileSync(p, "utf8"); }
  function writeFileSyncSafe(p, v) { fs.writeFileSync(p, v); }
  if (op === "health") return void process.stdout.write(JSON.stringify({ ok: true }));
  if (op === "double") { bump(); return void process.stdout.write(JSON.stringify({ y: request.x * 2 })); }
  if (op === "crash") { process.stderr.write("boom: kernel died\\n"); process.exit(3); }
  if (op === "garble") return void process.stdout.write("not json {");
  if (op === "badnum") return void process.stdout.write(JSON.stringify({ y: "twelve" }));
  if (op === "sleep") return void setTimeout(() => process.stdout.write(JSON.stringify({ y: 0 })), 5000);
  if (op === "diverge") return void process.stdout.write(JSON.stringify({ converged: false, residuals: [0.5, 0.25] }));
  process.stderr.write("unknown op\\n"); process.exit(2);
});
`;

const dir = mkdtempSync(join(tmpdir(), "sxe00-test-"));
const kernelPath = join(dir, "kernel.cjs");
const counterPath = join(dir, "counter.txt");
writeFileSync(kernelPath, KERNEL);
writeFileSync(counterPath, "0");

const ENTRY = {
  id: "fixture-engine",
  version: "1.2.3",
  licence: "MIT",
  linkMode: "process",
  envVar: "FIXTURE_ENGINE_BIN",
  defaultPath: process.execPath,
  healthOp: "health",
  ops: ["health", "double", "crash", "garble", "badnum", "sleep", "diverge"],
  kernel: kernelPath,
  installHint: "Install the fixture engine (test fixture; set FIXTURE_ENGINE_BIN).",
  footprint: { threads: 1 },
  opSchemas: {
    health: { result: { ok: "boolean" } },
    double: { request: { x: "number" }, result: { y: "number" } },
    badnum: { result: { y: "number" } },
  },
};

function setup() {
  _clearEngines();
  _clearEngineCache();
  defineEngine(ENTRY);
}

test("manifest validation: a complete entry is valid; licence and pin rules refuse", () => {
  assert.deepEqual(validateManifestEntry(ENTRY), []);
  const agplInProcess = { ...ENTRY, id: "agpl-x", licence: "AGPL-3.0", linkMode: "in-process", unmodified: true };
  assert.ok(validateManifestEntry(agplInProcess).some((e) => e.includes("AGPL")));
  const agplModified = { ...ENTRY, id: "agpl-y", licence: "AGPL-3.0", linkMode: "process" };
  assert.ok(validateManifestEntry(agplModified).some((e) => e.includes("unmodified")));
  const gplInProcess = { ...ENTRY, id: "gpl-x", licence: "GPL-3.0", linkMode: "in-process" };
  assert.ok(validateManifestEntry(gplInProcess).some((e) => e.includes("GPL")));
  const noPin = { ...ENTRY, id: "nopin", version: "" };
  assert.ok(validateManifestEntry(noPin).some((e) => e.includes("version")));
  setup();
  assert.equal(getEngine("fixture-engine").version, "1.2.3");
});

test("unknown engine is NOT_COMPUTED engine_unavailable", async () => {
  setup();
  const r = await runEngine("no-such-engine", "double", { x: 1 });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:no-such-engine");
});

test("absent binary is NOT_COMPUTED engine_unavailable with the install hint, never a number", async () => {
  setup();
  const r = await runEngine("fixture-engine", "double", { x: 21 },
    { env: { FIXTURE_ENGINE_BIN: join(dir, "not-installed") } });
  // defaultPath is process.execPath, which exists — override both routes:
  const r2 = await runEngine("fixture-engine", "double", { x: 21 },
    { env: { FIXTURE_ENGINE_BIN: "" }, fresh: true });
  assert.equal(r.status, "NOT_COMPUTED"); // env var path wins when set
  assert.equal(r.reason, "engine_unavailable:fixture-engine");
  assert.ok(r.failures.join(" ").includes("Install the fixture engine"));
  assert.equal(r.outputs, undefined);
  assert.equal(r2.status, "PASS"); // empty env var falls back to defaultPath
});

test("double: PASS with provenance (engine, version, kernel hash)", async () => {
  setup();
  const r = await runEngine("fixture-engine", "double", { x: 21 });
  assert.equal(r.status, "PASS");
  assert.equal(r.outputs.y, 42);
  assert.equal(r.provenance.engine, "fixture-engine");
  assert.equal(r.provenance.version, "1.2.3");
  const expectHash = createHash("sha256").update(readFileSync(kernelPath)).digest("hex");
  assert.equal(r.provenance.kernelHash, expectHash);
});

test("cache: same request + same kernel bytes = same run; changed kernel = new run", async () => {
  setup();
  writeFileSync(counterPath, "0");
  const req = { x: 5, counter: counterPath };
  const a = await runEngine("fixture-engine", "double", req);
  const b = await runEngine("fixture-engine", "double", req);
  assert.equal(a.status, "PASS");
  assert.equal(b.cached, true);
  assert.equal(readFileSync(counterPath, "utf8"), "1");
  appendFileSync(kernelPath, "\n// kernel changed\n");
  const c = await runEngine("fixture-engine", "double", req);
  assert.notEqual(c.provenance.kernelHash, a.provenance.kernelHash);
  assert.equal(readFileSync(counterPath, "utf8"), "2");
});

test("malformed request is refused BEFORE spawn", async () => {
  setup();
  writeFileSync(counterPath, "0");
  const r = await runEngine("fixture-engine", "double", { counter: counterPath });
  assert.equal(r.status, "FAIL");
  assert.equal(r.reason, "engine_request_invalid:fixture-engine");
  assert.equal(readFileSync(counterPath, "utf8"), "0");
});

test("crash, garbled stdout, and schema-failing numbers are engine_failed", async () => {
  setup();
  const crash = await runEngine("fixture-engine", "crash", {});
  assert.equal(crash.status, "FAIL");
  assert.ok(crash.reason.startsWith("engine_failed:fixture-engine:"));
  assert.ok(crash.reason.includes("boom"));
  const garble = await runEngine("fixture-engine", "garble", {});
  assert.equal(garble.status, "FAIL");
  assert.ok(garble.reason.includes("garbled stdout"));
  const badnum = await runEngine("fixture-engine", "badnum", {});
  assert.equal(badnum.status, "FAIL");
  assert.ok(badnum.reason.includes("schema validation"));
});

test("timeout is engine_failed with the cap named", async () => {
  setup();
  const r = await runEngine("fixture-engine", "sleep", {}, { timeoutMs: 200 });
  assert.equal(r.status, "FAIL");
  assert.ok(r.reason.includes("timeout after 200ms"));
});

test("non-convergence is NOT_COMPUTED engine_not_converged with residuals", async () => {
  setup();
  const r = await runEngine("fixture-engine", "diverge", {});
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_not_converged:fixture-engine");
  assert.ok(r.warnings.join(" ").includes("0.5"));
});

test("health + engine list report", async () => {
  setup();
  const h = await engineHealth("fixture-engine");
  assert.equal(h.present, true);
  assert.equal(h.healthy, true);
  const report = engineListReport();
  assert.equal(report.total, 1);
  assert.equal(report.engines[0].id, "fixture-engine");
  assert.equal(report.engines[0].engineDependent, true);
  assert.equal(report.engines[0].present, true);
});
