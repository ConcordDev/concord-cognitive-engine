/**
 * SXE-51 engine RPC transport tests (CI-only scope, F1 ruling).
 *
 * The transport is proven against a loopback host running
 * a fixture kernel through the real runProcessKernel —
 * the same contract a provisioned H2 host will serve.
 * Reference behaviours are the ticket's own: health ops
 * green over the transport; engine removed → NOT_COMPUTED,
 * no crash; one heavy run at a time, queue honoured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineEngine, _clearEngines } from "../../../lib/conkay/engines/manifest.js";
import { createEngineHost, runRemoteEngine, resolveRpcEndpoint } from "../../../lib/conkay/engines/rpc.js";

const KERNEL = `
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const { op, request } = JSON.parse(raw);
  const fs = require("node:fs");
  if (op === "health") return void process.stdout.write(JSON.stringify({ ok: true }));
  if (op === "double") return void process.stdout.write(JSON.stringify({ y: request.x * 2 }));
  if (op === "slow") {
    fs.appendFileSync(request.marker, "start " + request.tag + "\\n");
    return void setTimeout(() => {
      fs.appendFileSync(request.marker, "end " + request.tag + "\\n");
      process.stdout.write(JSON.stringify({ tag: request.tag }));
    }, request.ms);
  }
  process.stderr.write("unknown op\\n");
  process.exit(2);
});
`;

const dir = mkdtempSync(join(tmpdir(), "sxe51-test-"));
const kernelPath = join(dir, "kernel.cjs");
writeFileSync(kernelPath, KERNEL);
const markerPath = join(dir, "markers.txt");
writeFileSync(markerPath, "");

const ENTRY = {
  id: "rpc-fixture",
  version: "0.9.0",
  licence: "MIT",
  linkMode: "process",
  envVar: "RPC_FIXTURE_BIN",
  defaultPath: process.execPath,
  healthOp: "health",
  ops: ["health", "double", "slow"],
  kernel: kernelPath,
  installHint: "Provision a compute host (H2) and set CONKAY_ENGINE_RPC_FIXTURE_RPC_URL.",
  footprint: { threads: 1 },
  opSchemas: {
    health: { result: { ok: "boolean" } },
    double: { request: { x: "number" }, result: { y: "number" } },
    slow: { request: { ms: "number", tag: "string", marker: "string" }, result: { tag: "string" } },
  },
};

const TOKEN = "test-token-sxe51";
let server;
let baseUrl;

test.before(async () => {
  _clearEngines();
  defineEngine(ENTRY);
  server = createEngineHost({ token: TOKEN });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/run`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const env = () => ({
  CONKAY_ENGINE_RPC_FIXTURE_RPC_URL: baseUrl,
  CONKAY_ENGINE_RPC_TOKEN: TOKEN,
});

test("the host refuses to exist without a token", () => {
  assert.throws(() => createEngineHost({}), /requires a token/);
  assert.throws(() => createEngineHost({ token: "" }), /requires a token/);
});

test("endpoint resolution is per-engine env, unset means absent", () => {
  assert.equal(resolveRpcEndpoint("rpc-fixture", env()), baseUrl);
  assert.equal(resolveRpcEndpoint("rpc-fixture", {}), null);
});

test("health and a compute op round-trip through the transport verbatim", async () => {
  const health = await runRemoteEngine("rpc-fixture", "health", {}, { env: env() });
  assert.equal(health.status, "PASS", health.reason || "");
  assert.equal(health.outputs.ok, true);
  assert.equal(health.via, "engine-rpc");
  assert.equal(health.provenance.engine, "rpc-fixture");
  const dbl = await runRemoteEngine("rpc-fixture", "double", { x: 21 }, { env: env() });
  assert.equal(dbl.status, "PASS");
  assert.equal(dbl.outputs.y, 42);
});

test("no endpoint configured is honest absence — the prod posture until H2", async () => {
  const r = await runRemoteEngine("rpc-fixture", "double", { x: 1 }, { env: { CONKAY_ENGINE_RPC_TOKEN: TOKEN } });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:rpc-fixture");
});

test("auth failures are named, never mistaken for absence, and never sent bare", async () => {
  const wrong = await runRemoteEngine("rpc-fixture", "double", { x: 1 },
    { env: { CONKAY_ENGINE_RPC_FIXTURE_RPC_URL: baseUrl, CONKAY_ENGINE_RPC_TOKEN: "wrong-token" } });
  assert.equal(wrong.status, "NOT_COMPUTED");
  assert.equal(wrong.reason, "engine_rpc_auth_failed:rpc-fixture");
  const bare = await runRemoteEngine("rpc-fixture", "double", { x: 1 },
    { env: { CONKAY_ENGINE_RPC_FIXTURE_RPC_URL: baseUrl } });
  assert.equal(bare.reason, "engine_rpc_auth_failed:rpc-fixture");
});

test("an engine the host does not carry answers unavailable, never a crash", async () => {
  const r = await runRemoteEngine("ghost-engine", "double", { x: 1 }, { env: env() });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.equal(r.reason, "engine_unavailable:ghost-engine");
});

test("the queue serializes heavy runs FIFO, one at a time", async () => {
  writeFileSync(markerPath, "");
  const p1 = runRemoteEngine("rpc-fixture", "slow", { ms: 250, tag: "first", marker: markerPath }, { env: env() });
  const p2 = runRemoteEngine("rpc-fixture", "slow", { ms: 250, tag: "second", marker: markerPath }, { env: env() });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.status, "PASS", r1.reason || "");
  assert.equal(r2.status, "PASS", r2.reason || "");
  const markers = readFileSync(markerPath, "utf8").trim().split("\n");
  assert.deepEqual(markers, ["start first", "end first", "start second", "end second"]);
});

test("a run that cannot start within its queue budget is refused by name", async () => {
  writeFileSync(markerPath, "");
  const blocker = runRemoteEngine("rpc-fixture", "slow", { ms: 700, tag: "blocker", marker: markerPath }, { env: env() });
  const queued = await runRemoteEngine("rpc-fixture", "slow", { ms: 10, tag: "late", marker: markerPath },
    { env: env(), queueTimeoutMs: 120 });
  assert.equal(queued.status, "NOT_COMPUTED");
  assert.equal(queued.reason, "engine_rpc_queue_timeout:rpc-fixture");
  const done = await blocker;
  assert.equal(done.status, "PASS");
  // the timed-out run never executed late
  assert.ok(!readFileSync(markerPath, "utf8").includes("late"));
});
