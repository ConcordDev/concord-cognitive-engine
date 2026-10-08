// lib/inference/ollama-client.js: a thinking-only response (no content) is an
// error, never an empty successful reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ollamaChat } from "../lib/inference/ollama-client.js";

test("thinking-only output is reported as empty_answer; real content passes", async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: { content: "", thinking: "Let me think..." }, done_reason: "length", eval_count: 200 }));
    const bad = await ollamaChat("conscious", [{ role: "user", content: "hi" }]);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /empty_answer/);

    globalThis.fetch = async () => new Response(JSON.stringify({ message: { content: "Hello there." }, eval_count: 3 }));
    const good = await ollamaChat("conscious", [{ role: "user", content: "hi" }]);
    assert.equal(good.ok, true);
    assert.equal(good.text, "Hello there.");
  } finally { globalThis.fetch = orig; }
});
