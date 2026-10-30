// Brief D item 5: a streaming chat turn reports real steps and answer tokens as
// they happen instead of one burst at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { chatProgress, withToolProgress, toolLabel, readOllamaChatStream } from "../lib/chat/progress.js";

test("progress is a no-op without a writer and never throws", () => {
  chatProgress({}, { stage: "thinking" });
  chatProgress({ chatProgress() { throw new Error("socket closed"); } }, { stage: "thinking" });
});

test("a tool call reports running then done, in order, around the real work", async () => {
  const seen = [];
  const ctx = { chatProgress: (e) => seen.push(`${e.stage}:${e.tool}:${e.status}`) };
  const out = await withToolProgress(ctx, { tool: "run_compute", params: { key: "engineering.columnBuckling" } }, async () => { seen.push("work"); return { ok: true }; });
  assert.equal(out.ok, true);
  assert.deepEqual(seen, ["tool:run_compute:running", "work", "tool:run_compute:done"]);
});

test("a failed or throwing tool is reported failed, and the error still propagates", async () => {
  const seen = [];
  const ctx = { chatProgress: (e) => seen.push(e.status) };
  await withToolProgress(ctx, { tool: "web_search" }, async () => ({ ok: false }));
  await assert.rejects(withToolProgress(ctx, { tool: "web_search" }, async () => { throw new Error("x"); }));
  assert.deepEqual(seen, ["running", "failed", "running", "failed"]);
});

test("labels name the tool and, for compute, the function", () => {
  assert.equal(toolLabel({ tool: "dtu_search" }), "Searching your knowledge base");
  assert.match(toolLabel({ tool: "run_compute", params: { key: "physics.beamDeflection" } }), /physics\.beamDeflection/);
  assert.match(toolLabel({ tool: "mystery" }), /mystery/);
});

test("readOllamaChatStream forwards each delta as it arrives and returns the full message", async () => {
  const lines = [
    JSON.stringify({ message: { content: "Hel" } }) + "\n",
    JSON.stringify({ message: { content: "lo " } }) + "\n" + JSON.stringify({ message: { content: "wor" } }).slice(0, 10),
    JSON.stringify({ message: { content: "wor" } }).slice(10) + "\n",
    JSON.stringify({ message: { content: "ld" }, done: true, done_reason: "stop", eval_count: 4 }) + "\n",
  ];
  const res = { body: (async function* () { for (const l of lines) yield new TextEncoder().encode(l); })() };
  const tokens = [];
  const out = await readOllamaChatStream(res, (t) => tokens.push(t));
  assert.deepEqual(tokens, ["Hel", "lo ", "wor", "ld"]);
  assert.equal(out.message.content, "Hello world");
  assert.equal(out.done_reason, "stop");
});

test("a throwing preview callback does not lose the answer", async () => {
  const res = { body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ message: { content: "ok" }, done: true }) + "\n"); })() };
  const out = await readOllamaChatStream(res, () => { throw new Error("client gone"); });
  assert.equal(out.message.content, "ok");
});
