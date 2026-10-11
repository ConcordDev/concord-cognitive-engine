// 2026-10-10 live audit: chat-agent tool use.
// Nested [TOOL_CALL:] JSON was cut at the first `}`, governance envelopes
// hid markers inside `payload`, generate_image crashed on ctx.state,
// data: URLs in lens results were sliced, and list_lens_actions led with
// an empty name then an alphabetical tail.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseToolCalls, stripToolCalls, executeToolCall, formatToolResults,
  TOOL_SCHEMA_BLOCK,
} from "../lib/chat-agent.js";
import {
  parseObserveCalls, findToolCallSpans, scanJsonEnd, governancePayloads,
} from "../lib/v6-observe-bridge.js";

// These two tests swap process-global registries. node:test runs cases in
// one file concurrently, so they have to take turns.
let registryChain = Promise.resolve();
function withRegistries(fn) {
  const run = registryChain.then(fn, fn);
  registryChain = run.then(() => {}, () => {});
  return run;
}

const NESTED = `[TOOL_CALL: {"tool":"create_document","params":{"title":"Q","files":[{"name":"a.md","content":"brace } and bracket ] here"}]}}]`;

test("parseToolCalls keeps repeated identical markers as separate calls", () => {
  const marker = `[TOOL_CALL: {"tool":"web_search","params":{"query":"x"}}]`;
  const calls = parseToolCalls(`${marker}\n${marker}`);
  assert.equal(calls.length, 2);
});

test("parseToolCalls keeps nested arrays, objects, and braces inside strings", () => {
  const text = `Working.\n${NESTED}\n[TOOL_CALL: {"tool":"web_search","params":{"query":"a } b"}}]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, "create_document");
  assert.equal(calls[0].params.files[0].name, "a.md");
  assert.equal(calls[0].params.files[0].content, "brace } and bracket ] here");
  assert.equal(calls[1].tool, "web_search");
  assert.equal(calls[1].params.query, "a } b");

  const stripped = stripToolCalls(text);
  assert.equal(stripped, "Working.");
  assert.ok(!stripped.includes("TOOL_CALL"));
  assert.ok(!stripped.includes("}]"));
});

test("parseToolCalls pulls markers out of a governance payload string", () => {
  const payload = `Checking the docs.\n[TOOL_CALL: {"tool":"web_search","params":{"query":"node.js","files":[{"n":1}]}}]`;
  const envelope = JSON.stringify({
    toneLock: "Proceeding.",
    anchor: { mode: "governed-response" },
    invariants: ["RealityGateBeforeEffects"],
    payload,
    nextLoop: { name: "lookup", why: "need the page" },
    reality: { facts: [], assumptions: [], unknowns: [] },
  });
  const fenced = "```json\n" + envelope + "\n```";

  for (const src of [envelope, fenced]) {
    const calls = parseToolCalls(src);
    assert.equal(calls.length, 1, src.slice(0, 12));
    assert.equal(calls[0].tool, "web_search");
    assert.equal(calls[0].params.query, "node.js");
    assert.equal(calls[0].params.files[0].n, 1);
    const stripped = stripToolCalls(src);
    assert.equal(stripped, "Checking the docs.");
    assert.ok(!stripped.includes("toneLock"));
    assert.ok(!stripped.includes("TOOL_CALL"));
  }

  const observed = parseObserveCalls(envelope);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].tool, "web_search");
  assert.equal(observed[0].params.files[0].n, 1);
});

test("parseObserveCalls reads a nested tool call and still reads bare compute JSON", () => {
  const calls = parseObserveCalls(NESTED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.files[0].content, "brace } and bracket ] here");
  const bare = parseObserveCalls('{"key":"multiply","input":{"a":2,"b":3}}');
  assert.equal(bare[0].tool, "run_compute");
  assert.deepEqual(bare[0].params, { key: "multiply", input: { a: 2, b: 3 } });
});

test("unclosed or bracket-less markers are skipped instead of swallowing the next call", () => {
  const text = `[TOOL_CALL: not-json]\n[TOOL_CALL: {"tool":"web_search" ]\n[TOOL_CALL: {"tool":"web_search","params":{"query":"kept"}}]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.query, "kept");
  const stripped = stripToolCalls(`[TOOL_CALL: {not valid json}]\nKept.`);
  assert.equal(stripped, "Kept.");

  // An unclosed object must not stop the scan, and a junk marker whose
  // span would reach into the next real marker must not eat that marker.
  const unclosed = `[TOOL_CALL: {"tool":"web_search","params":{"query":"never"\n[TOOL_CALL: {"tool":"web_search","params":{"query":"after-unclosed"}}]`;
  assert.equal(parseToolCalls(unclosed)[0].params.query, "after-unclosed");
  assert.equal(scanJsonEnd('{"a":', 0), -1);
  assert.equal(scanJsonEnd("nope", 0), -1);

  const overlap = `[TOOL_CALL: {"a":"[TOOL_CALL:"}] [TOOL_CALL: {"tool":"web_search","params":{"query":"kept","note":"say \\"hi\\""}}]`;
  const overlapped = parseToolCalls(overlap);
  assert.equal(overlapped.length, 1);
  assert.equal(overlapped[0].params.query, "kept");
  assert.equal(overlapped[0].params.note, 'say "hi"');
  const spans = findToolCallSpans(overlap);
  assert.ok(spans.some((s) => s.parsed?.tool === "web_search"));
});

test("an embedded governance payload is unwrapped even when prose surrounds it", () => {
  const inner = `[TOOL_CALL: {"tool":"run_compute","params":{"key":"symbolic.simplify","input":{"expression":"x"}}}]`;
  const blob = `preamble ${JSON.stringify({
    toneLock: "Proceeding.",
    payload: inner,
  })} tail`;
  const payloads = governancePayloads(blob);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0], inner);
  const calls = parseToolCalls(blob);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "run_compute");
  assert.equal(calls[0].params.input.expression, "x");
});

test("parseObserveCalls reads Ollama native tool_calls, including a non-JSON arguments string", () => {
  const calls = parseObserveCalls("no marker", {
    tool_calls: [
      { function: { name: "web_search", arguments: "{\"query\":\"from-native\"}" } },
      { function: { name: "browse_url", arguments: "not-json" } },
      { name: "expert_mode", arguments: { query: "plain" } },
      { function: { name: "none", arguments: {} } },
    ],
  });
  assert.deepEqual(calls.map((c) => c.tool), ["web_search", "browse_url", "expert_mode"]);
  assert.equal(calls[0].params.query, "from-native");
  assert.equal(calls[1].params.query, "not-json");
  assert.equal(calls[2].params.query, "plain");
  assert.equal(calls[0].raw, "ollama-native");
});

test("a governance reply with no tool call shows the payload, not the envelope", () => {
  const envelope = JSON.stringify({
    toneLock: "Acknowledged.",
    payload: "Just the answer.",
    nextLoop: { name: "done", why: "nothing to call" },
  });
  assert.equal(stripToolCalls(envelope), "Just the answer.");
  assert.deepEqual(parseToolCalls(envelope), []);
});

test("agent prompt names design, tasks, calendar, and music, and forbids invented sources", () => {
  assert.match(TOOL_SCHEMA_BLOCK, /conkay_design/);
  assert.match(TOOL_SCHEMA_BLOCK, /productivity\.task-add/);
  assert.match(TOOL_SCHEMA_BLOCK, /events-create/);
  assert.match(TOOL_SCHEMA_BLOCK, /music\.render/);
  assert.match(TOOL_SCHEMA_BLOCK, /Never claim a source you did not actually retrieve/);
  assert.match(TOOL_SCHEMA_BLOCK, /Wikipedia/);
  assert.match(TOOL_SCHEMA_BLOCK, /official Node\.js page/);
});

test("list_lens_actions drops the empty name, ranks preferred and top-level first, and includes fields", async () => {
  await withRegistries(async () => {
  const { MACRO_REGISTRY } = await import("../lib/macro-reflection.js");
  const prevMacro = MACRO_REGISTRY.get("announcements");
  const prevLive = globalThis._concordMACROS;
  MACRO_REGISTRY.set("announcements", new Map([
    ["", { name: "" }],
    ["from-registry", { name: "from-registry" }],
  ]));
  globalThis._concordMACROS = new Map([
    ["announcements", new Map([["macro-only", {}], ["", {}]])],
    ["other", new Map([["task-add", {}]])],
  ]);
  try {
    const lens = new Map([
      ["announcements.", async () => ({})],
      ["announcements", async () => ({})],
      ["announcements.zzz-obscure", async () => ({})],
      ["announcements.get", async () => ({})],
      ["announcements.nested.deep", async () => ({})],
      ["announcements.task-add", async () => ({})],
      ["other.task-add", async () => ({})],
    ]);
    const result = await executeToolCall({}, async () => ({}), lens, {
      tool: "list_lens_actions", params: { domain: "announcements" },
    });
    assert.equal(result.ok, true);
    const names = result.actions.map((a) => a.action);
    assert.ok(!names.includes(""), "empty registry entry must not be listed");
    assert.ok(!names.includes("other.task-add") && !names.some((n) => n.startsWith("other")));
    assert.deepEqual(names, [
      "task-add", "get", "from-registry", "macro-only", "zzz-obscure", "nested.deep",
    ]);
    const get = result.actions.find((a) => a.action === "get");
    assert.ok(Array.isArray(get.fields) && get.fields.some((f) => f.name === "id"));
    const rendered = formatToolResults([result]);
    assert.match(rendered, /get \{id\}/);
    const head = rendered.split("actions: ")[1];
    assert.ok(head.indexOf("task-add") < head.indexOf("zzz-obscure"));
    assert.ok(head.indexOf("zzz-obscure") < head.indexOf("nested.deep"));
  } finally {
    if (prevMacro === undefined) MACRO_REGISTRY.delete("announcements");
    else MACRO_REGISTRY.set("announcements", prevMacro);
    if (prevLive === undefined) delete globalThis._concordMACROS;
    else globalThis._concordMACROS = prevLive;
  }
  });
});

test("run_lens_action stores data: URLs as artifacts instead of slicing them", async () => {
  await withRegistries(async () => {
  const big = "A".repeat(81_000);
  const macros = new Map([["music", new Map([["render", { fn: async () => ({ ok: true }) }]])]]);
  const prevLive = globalThis._concordMACROS;
  globalThis._concordMACROS = macros;
  try {
    const result = await executeToolCall({}, async () => ({
      ok: true,
      preview: `caption data:image/png;base64,${big} end`,
      note: "data:text/plain;base64,SGk=",
      plain: "data:text/plain,hello",
      nested: { items: [{ svg: "data:image/svg+xml;base64,PHN2Zy8+" }] },
    }), new Map(), {
      tool: "run_lens_action",
      params: { domain: "music", action: "render", params: {} },
    });
    assert.equal(result.ok, true);
    assert.equal(result.artifact.kind, "image");
    assert.equal(result.artifact.image_b64.length, 81_000);
    assert.equal(result.artifacts.length, 4);
    assert.equal(result.artifacts[1].kind, "file");
    assert.equal(result.artifacts[1].data_b64, "SGk=");
    assert.equal(result.artifacts[2].text, "hello");
    assert.equal(result.artifacts[2].mimeType, "text/plain");
    assert.equal(result.result.plain, "[artifact:data_3 text/plain]");
    assert.equal(result.artifacts[3].mimeType, "image/svg+xml");
    const dumped = JSON.stringify(result.result);
    assert.ok(!dumped.includes(big.slice(0, 200)));
    assert.match(result.result.preview, /\[artifact:data_1 image\/png\]/);
    assert.match(result.result.preview, /caption /);
    assert.match(result.result.preview, / end/);

    const skipped = await executeToolCall({}, async () => ({
      ok: true,
      bad: "see data:not-a-url please",
      empty: "data:image/png;base64, next",
    }), new Map(), {
      tool: "run_lens_action",
      params: { domain: "music", action: "render", params: {} },
    });
    assert.equal(skipped.artifacts, undefined);
    assert.equal(skipped.result.bad, "see data:not-a-url please");
    assert.equal(skipped.result.empty, "data:image/png;base64, next");

    const rendered = formatToolResults([result]);
    assert.ok(rendered.length < 4000);
    assert.ok(!rendered.includes(big.slice(0, 80)));
    assert.match(rendered, /artifact:data_1/);
  } finally {
    if (prevLive === undefined) delete globalThis._concordMACROS;
    else globalThis._concordMACROS = prevLive;
  }
  });
});

function startGen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const out = handler(req.url, body ? JSON.parse(body) : null);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

test("generate_image uses the pod image path and does not touch ctx.state", async () => {
  const png = Buffer.from("fake-png-bytes-for-agent-image").toString("base64");
  const srv = await startGen((url) => (url === "/health" ? { ok: true, weights: { flux_schnell: true } } : { ok: true, png_b64: png, provider: "local_gpu_flux" }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-img-"));
  const saved = {
    gen: process.env.CONCORD_GEN_URL,
    data: process.env.DATA_DIR,
  };
  process.env.DATA_DIR = dataDir;
  let macroCalled = false;
  try {
    process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
    const result = await executeToolCall({}, async () => { macroCalled = true; return { ok: false }; }, new Map(), {
      tool: "generate_image",
      params: { prompt: "a red cube", size: "512x512" },
    });
    assert.equal(macroCalled, false);
    assert.equal(result.ok, true);
    assert.equal(result.source, "local_gpu_flux");
    assert.equal(result.artifact.kind, "image");
    assert.equal(result.artifact.image_b64, png);
    assert.equal(result.artifact.width, 512);
    assert.equal(result.artifact.height, 512);
    assert.ok(!JSON.stringify(formatToolResults([result])).includes(png));
    assert.ok(!/pollinations/i.test(JSON.stringify(result)));

    const oom = await startGen((url) => (url === "/health" ? { ok: true } : { ok: false, reason: "cuda_oom", error: "out of memory" }));
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${oom.address().port}`;
      const failed = await executeToolCall({}, async () => ({ ok: true }), new Map(), {
        tool: "generate_image", params: { prompt: "a red cube" },
      });
      assert.equal(failed.ok, false);
      assert.match(failed.error, /cuda_oom|out of memory/);
    } finally { oom.close(); }
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    for (const [k, v] of [["CONCORD_GEN_URL", saved.gen], ["DATA_DIR", saved.data]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("generate_image reports GPU offline and never calls Pollinations", async () => {
  const saved = {
    gen: process.env.CONCORD_GEN_URL,
    force: process.env.CONCORD_FORCE_POLLINATIONS,
  };
  const origFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? String(input) : String(input?.url || input);
    urls.push(url);
    return origFetch(input, init);
  };
  // Force-flag must not reopen the watermarked fallback.
  process.env.CONCORD_GEN_URL = "http://127.0.0.1:9";
  process.env.CONCORD_FORCE_POLLINATIONS = "1";
  try {
    const offline = await executeToolCall({}, async () => { throw new Error("macro should not run"); }, new Map(), {
      tool: "generate_image",
      params: { prompt: "a red cube" },
    });
    assert.equal(offline.ok, false);
    assert.equal(offline.error, "GPU image generation is offline");
    assert.equal(offline.artifact, undefined);
    assert.ok(urls.some((u) => u.includes("127.0.0.1:9")));
    assert.ok(urls.every((u) => !/pollinations/i.test(u)));
    const rendered = formatToolResults([offline]);
    assert.match(rendered, /GPU image generation is offline/);
    assert.ok(!/pollinations/i.test(rendered));
    assert.ok(!/dall-?e|stable diffusion|midjourney/i.test(rendered));
  } finally {
    globalThis.fetch = origFetch;
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.force === undefined) delete process.env.CONCORD_FORCE_POLLINATIONS;
    else process.env.CONCORD_FORCE_POLLINATIONS = saved.force;
  }
});

test("generate_image and the lens image action never surface macro_uncaught_throw", async () => {
  await withRegistries(async () => {
    const png = Buffer.from("red-bicycle").toString("base64");
    const srv = await startGen((url) => (url === "/health" ? { ok: true, weights: { flux_schnell: true } } : { ok: true, png_b64: png, provider: "local_gpu_flux" }));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-img-throw-"));
    const saved = { gen: process.env.CONCORD_GEN_URL, data: process.env.DATA_DIR };
    const prev = globalThis._concordMACROS;
    const bucket = new Map([["image_generate", {}]]);
    globalThis._concordMACROS = new Map([["multimodal", bucket], ["chat", new Map([["image-generate", {}]])]]);
    const macroCalls = [];
    const runMacro = async (domain, action) => {
      macroCalls.push(`${domain}.${action}`);
      return { ok: false, error: "macro_uncaught_throw", message: "Cannot read properties of undefined (reading '__chicken3')" };
    };
    process.env.DATA_DIR = dataDir;
    process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
    try {
      const calls = [
        { tool: "generate_image", params: { prompt: "a red bicycle" } },
        { tool: "generate_image", params: { prompt: "a red bicycle" } },
        { tool: "run_lens_action", params: { domain: "multimodal", action: "image_generate", params: { prompt: "a red bicycle" } } },
        { tool: "run_lens_action", params: { domain: "chat", action: "image-generate", params: { prompt: "a red bicycle" } } },
      ];
      const results = [];
      for (const call of calls) results.push(await executeToolCall({}, runMacro, new Map(), call));
      assert.deepEqual(macroCalls, []);
      assert.equal(results.length, 4);
      for (const r of results) {
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.notEqual(r.error, "macro_uncaught_throw");
        assert.equal(r.artifact.kind, "image");
        assert.equal(r.artifact.image_b64, png);
        assert.ok(!/macro_uncaught_throw|dall-?e|stable diffusion|pollinations/i.test(JSON.stringify({ ...r, artifact: { ...r.artifact, image_b64: "png" } })));
      }
    } finally {
      srv.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      if (prev === undefined) delete globalThis._concordMACROS;
      else globalThis._concordMACROS = prev;
      if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL;
      else process.env.CONCORD_GEN_URL = saved.gen;
      if (saved.data === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = saved.data;
    }
  });
});
