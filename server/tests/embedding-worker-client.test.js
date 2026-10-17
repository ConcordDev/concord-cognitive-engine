// lib/embedding-worker-client.js — request/response with the embedding child process.
// Uses small fake workers so the tests never download the real model.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startEmbeddingWorker, buildWorkerExecArgv } from "../lib/embedding-worker-client.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-worker-"));
function fakeWorker(name, body) {
  const f = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(f, `process.on("disconnect", () => process.exit(0));\n${body}\n`);
  return pathToFileURL(f);
}

const echo = fakeWorker("echo", `
process.on("message", (m) => {
  if (m.type === "init") return process.send({ type: "ready" });
  if (m.type === "embed") {
    if (m.text === "boom") return process.send({ type: "error", id: m.id, error: "bad input" });
    if (m.text === "hang") return;
    if (m.text === "die") process.exit(3);
    process.send({ type: "result", id: m.id, embedding: Float32Array.from([m.text.length, 1, 2]) });
  }
});`);

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("embeds via the worker and matches concurrent requests by id", async () => {
  const w = await startEmbeddingWorker({ workerUrl: echo });
  try {
    const [a, b] = await Promise.all([w.embed("abc"), w.embed("abcdef")]);
    assert.ok(a instanceof Float32Array);
    assert.deepEqual([...a], [3, 1, 2]);
    assert.deepEqual([...b], [6, 1, 2]);
    await assert.rejects(w.embed("boom"), /bad input/);
    assert.equal(w.pending(), 0);
  } finally {
    await w.terminate();
  }
});

test("a request with no reply times out instead of hanging", async () => {
  const w = await startEmbeddingWorker({ workerUrl: echo, requestTimeoutMs: 50 });
  try {
    await assert.rejects(w.embed("hang"), /embedding_timeout/);
    assert.equal(w.pending(), 0);
  } finally {
    await w.terminate();
  }
});

test("a worker that dies fails its pending and later requests", async () => {
  const w = await startEmbeddingWorker({ workerUrl: echo });
  await assert.rejects(w.embed("die"), /embedding_worker_exited_3/);
  await assert.rejects(w.embed("abc"), /embedding_worker_exited_3/);
});

test("init failure rejects startup (so the server can fall back)", async () => {
  const bad = fakeWorker("bad", `process.on("message", (m) => { if (m.type === "init") process.send({ type: "init_error", error: "no model" }); });`);
  await assert.rejects(startEmbeddingWorker({ workerUrl: bad }), /no model/);
});

test("terminate rejects further requests", async () => {
  const w = await startEmbeddingWorker({ workerUrl: echo });
  await w.terminate();
  await assert.rejects(w.embed("abc"), /terminated/);
});

test("buildWorkerExecArgv replaces inherited max-old-space-size and keeps other flags in order", () => {
  const parentArgv = ["--expose-gc", "--max-old-space-size=3072", "--import=x"];
  const res = buildWorkerExecArgv(parentArgv, 1024);
  assert.deepEqual(res, ["--expose-gc", "--import=x", "--max-old-space-size=1024"]);
  const maxOldFlags = res.filter((flag) => /^--max[_-]old[_-]space[_-]size/i.test(flag));
  assert.equal(maxOldFlags.length, 1);
});

test("buildWorkerExecArgv strips underscore form --max_old_space_size=3072", () => {
  const parentArgv = ["--max_old_space_size=3072"];
  const res = buildWorkerExecArgv(parentArgv, 512);
  assert.deepEqual(res, ["--max-old-space-size=512"]);
});

test("buildWorkerExecArgv clamps out-of-range heapMb and falls back to 1024 for NaN", () => {
  assert.deepEqual(buildWorkerExecArgv([], 10), ["--max-old-space-size=256"]);
  assert.deepEqual(buildWorkerExecArgv([], 99999), ["--max-old-space-size=4096"]);
  assert.deepEqual(buildWorkerExecArgv([], NaN), ["--max-old-space-size=1024"]);
  assert.deepEqual(buildWorkerExecArgv([], "invalid"), ["--max-old-space-size=1024"]);
});
