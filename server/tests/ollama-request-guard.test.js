// server/tests/ollama-request-guard.test.js — lib/ollama-request-guard.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildThreadMap, buildContextMap, guardBody, installOllamaRequestGuard, thinkingDisabled } from "../lib/ollama-request-guard.js";

const brains = {
  conscious: { url: "http://gpu0:11436", urls: ["http://gpu0:11436"], model: "concord-conscious:latest", contextWindow: 32768 },
  subconscious: { url: "http://gpu1:11437", urls: ["http://gpu1:11437"], model: "qwen2.5:7b", contextWindow: 4096 },
  utility: { url: "http://gpu1:11437", model: "qwen2.5:3b", contextWindow: 2048 },
  multimodal: { url: "http://gpu1:11437", model: "qwen2.5vl:7b" },
};

test("threads: opt-in; global default + per-brain override; shared endpoint takes the smallest", () => {
  assert.equal(buildThreadMap(brains, {}).size, 0);
  const m = buildThreadMap(brains, { OLLAMA_NUM_THREAD: "4", BRAIN_CONSCIOUS_NUM_THREAD: "3", BRAIN_VISION_NUM_THREAD: "2" });
  assert.equal(m.get("http://gpu0:11436"), 3);
  assert.equal(m.get("http://gpu1:11437"), 2);
  assert.equal(buildThreadMap(brains, { OLLAMA_NUM_THREAD: "-1", BRAIN_UTILITY_NUM_THREAD: "abc" }).size, 0);
});

test("ctx: one window per model from brain config, capped, larger window wins on a shared model, off switch", () => {
  const m = buildContextMap(brains, {});
  assert.equal(m.get("concord-conscious:latest"), 32768);
  assert.equal(m.get("qwen2.5:7b"), 4096);
  assert.equal(m.has("qwen2.5vl:7b"), false); // no window configured → untouched
  assert.equal(buildContextMap(brains, { CONCORD_NUM_CTX_CAP: "8192" }).get("concord-conscious:latest"), 8192);
  const shared = buildContextMap({ a: { model: "m", contextWindow: 4096 }, b: { model: "m", contextWindow: 16384 } }, {});
  assert.equal(shared.get("m"), 16384);
  assert.equal(buildContextMap(brains, { CONCORD_OLLAMA_PIN_CTX: "0" }).size, 0);
});

test("guardBody pins num_ctx whatever the caller sent — the reload-thrash case", () => {
  const ctx = buildContextMap(brains, {});
  // a conscious-sized request that fell back onto the subconscious model
  const out = JSON.parse(guardBody(JSON.stringify({ model: "qwen2.5:7b", options: { num_ctx: 32768, temperature: 0.2 } }), { ctxForModel: ctx }));
  assert.deepEqual(out.options, { num_ctx: 4096, temperature: 0.2 });
  // already correct → no rewrite
  assert.equal(guardBody(JSON.stringify({ model: "qwen2.5:7b", options: { num_ctx: 4096 } }), { ctxForModel: ctx }), null);
  // unknown model untouched
  assert.equal(guardBody(JSON.stringify({ model: "other", options: { num_ctx: 999 } }), { ctxForModel: ctx }), null);
});

test("guardBody adds num_thread, keeps an explicit one, ignores non-JSON", () => {
  assert.equal(JSON.parse(guardBody(JSON.stringify({ model: "x" }), { threads: 4 })).options.num_thread, 4);
  assert.equal(guardBody(JSON.stringify({ model: "x", options: { num_thread: 8 } }), { threads: 4 }), null);
  assert.equal(guardBody("not json", { threads: 4 }), null);
  assert.equal(guardBody("[1,2]", { threads: 4 }), null);
});

test("installed wrapper rewrites only brain-bound inference calls", async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => { seen.push({ input, body: init?.body }); return new Response("{}"); };
  try {
    installOllamaRequestGuard(brains, { OLLAMA_NUM_THREAD: "4" });
    const body = JSON.stringify({ model: "qwen2.5:7b", messages: [], options: { num_ctx: 32768 } });
    await fetch("http://gpu1:11437/api/chat", { method: "POST", body });
    await fetch("http://gpu1:11437/api/tags", { method: "POST", body });      // not inference
    await fetch("http://elsewhere:11437/api/chat", { method: "POST", body }); // not a brain
    const a = JSON.parse(seen[0].body).options;
    assert.equal(a.num_thread, 4);
    assert.equal(a.num_ctx, 4096);
    assert.equal(JSON.parse(seen[0].body).think, false, "thinking is off by default on brain chat calls");
    assert.equal(seen[1].body, body);
    assert.equal(seen[2].body, body);

    // embeddings never get a think flag; an explicit think is respected
    seen.length = 0;
    await fetch("http://gpu1:11437/api/embed", { method: "POST", body: JSON.stringify({ model: "qwen2.5:7b", input: "x" }) });
    await fetch("http://gpu1:11437/api/generate", { method: "POST", body: JSON.stringify({ model: "qwen2.5:7b", prompt: "x", think: true }) });
    assert.equal(JSON.parse(seen[0].body).think, undefined);
    assert.equal(JSON.parse(seen[1].body).think, true);
  } finally { globalThis.fetch = orig; }
});

test("think: guardBody only adds think:false when asked and the caller didn't set it; env switch", () => {
  const b = JSON.stringify({ model: "m", prompt: "hi" });
  assert.equal(JSON.parse(guardBody(b, { disableThink: true })).think, false);
  assert.equal(guardBody(b, { disableThink: false }), null);
  assert.equal(guardBody(JSON.stringify({ model: "m", think: true }), { disableThink: true }), null);
  assert.equal(thinkingDisabled({}), true);
  assert.equal(thinkingDisabled({ CONCORD_OLLAMA_THINK: "1" }), false);
});
