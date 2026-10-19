// INC-17: normal Chat and the agent loop route an explicit image request
// to the pod GPU. "GPU image generation is offline" only when the gen
// server is actually down. Outside services are never a substitute.
// The image tool must not surface macro_uncaught_throw.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  explicitImagePrompt, fulfillImageRequest, produceGpuImage, publishPrivateImage, GPU_OFFLINE_REPLY, markdownImageReply,
  getMediaDTU, canAccessMediaDTU, retrieveArtifact,
} from "../lib/chat/image-router.js";
import { GPU_BUSY_REPLY } from "../lib/pollinations-image.js";
import { runAgentLoop } from "../lib/chat-agent.js";

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

test("explicit image phrasing is recognized and idioms are not", () => {
  assert.equal(explicitImagePrompt("make an image of a red bicycle").prompt, "a red bicycle");
  assert.equal(explicitImagePrompt("Please can you generate a photo of a red bicycle?").prompt, "a red bicycle");
  assert.equal(explicitImagePrompt("draw me a red bicycle").prompt, "red bicycle");
  assert.equal(explicitImagePrompt("paint a picture of a red bicycle at dusk").prompt, "a red bicycle at dusk");
  const sized = explicitImagePrompt("render an illustration of a red bicycle 512x512");
  assert.equal(sized.prompt, "a red bicycle");
  assert.equal(sized.width, 512);
  assert.equal(sized.height, 512);
  for (const q of [
    "draw a conclusion about bicycles",
    "draw a distinction",
    "draw attention to the budget",
    "draw a line between the two ideas",
    "draw on your experience",
    "what is an image of a red bicycle",
    "explain how an image of a bicycle is made",
    "don't make an image of a red bicycle",
    "hello",
    "",
    "make an image of ab",
  ]) {
    assert.equal(explicitImagePrompt(q), null, q);
  }
});

test("a healthy GPU stores a private artifact and the reply contains no data URL", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const srv = await startGen((url) => (url === "/health"
    ? { ok: true, weights: { flux_schnell: true } }
    : { ok: true, png_b64: png, provider: "local_gpu_flux" }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-route-"));
  const saved = { gen: process.env.CONCORD_GEN_URL, data: process.env.DATA_DIR, force: process.env.CONCORD_FORCE_POLLINATIONS };
  process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.DATA_DIR = dataDir;
  process.env.CONCORD_FORCE_POLLINATIONS = "1";
  const urls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input?.url || input);
    urls.push(url);
    return origFetch(input, init);
  };
  try {
    const state = { dtus: new Map() };
    const hit = await fulfillImageRequest("make an image of a red bicycle", { ownerId: "owner-1", state });
    assert.equal(hit.ok, true);
    assert.equal(hit.offline, false);
    assert.equal(hit.reply, markdownImageReply("a red bicycle", hit.artifact.url));
    assert.match(hit.reply, /^!\[a red bicycle\]\(\/api\/media\/media-[^)]+\/stream\)$/);
    assert.equal(hit.reply.includes("data:image"), false);
    assert.equal(JSON.stringify(hit).includes("data:image"), false);
    assert.equal(hit.artifact.kind, "image");
    assert.equal(hit.artifact.image_b64, undefined);
    const stored = getMediaDTU(state, hit.artifact.mediaId);
    assert.equal(stored.ok, true);
    assert.equal(stored.mediaDTU.privacy, "private");
    assert.equal(canAccessMediaDTU(state, stored.mediaDTU, "owner-1").allowed, true);
    assert.equal(canAccessMediaDTU(state, stored.mediaDTU, "someone-else").allowed, false);
    const bytes = retrieveArtifact(stored.mediaDTU.id, stored.mediaDTU.storageRef.artifactRef);
    assert.equal(Buffer.isBuffer(bytes) && bytes.toString("base64"), png);
    try { fs.unlinkSync(stored.mediaDTU.storageRef.artifactRef.diskPath); } catch { /* test cleanup */ }
    assert.equal(await fulfillImageRequest("what is the capital of France"), null);
    assert.ok(urls.every((u) => !/pollinations/i.test(u)));
    assert.ok(!/dall-?e|stable diffusion|midjourney|pollinations/i.test(hit.reply));
  } finally {
    globalThis.fetch = origFetch;
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.data === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved.data;
    if (saved.force === undefined) delete process.env.CONCORD_FORCE_POLLINATIONS; else process.env.CONCORD_FORCE_POLLINATIONS = saved.force;
  }
});

test("GPU image generation is offline only when the gen server is down", async () => {
  const saved = { gen: process.env.CONCORD_GEN_URL, force: process.env.CONCORD_FORCE_POLLINATIONS };
  process.env.CONCORD_GEN_URL = "http://127.0.0.1:9";
  process.env.CONCORD_FORCE_POLLINATIONS = "1";
  try {
    const down = await fulfillImageRequest("make an image of a red bicycle");
    assert.equal(down.ok, false);
    assert.equal(down.offline, true);
    assert.equal(down.reply, GPU_OFFLINE_REPLY);
    assert.equal(down.reply, "GPU image generation is offline");
    assert.equal(down.artifact, undefined);
  } finally {
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.force === undefined) delete process.env.CONCORD_FORCE_POLLINATIONS; else process.env.CONCORD_FORCE_POLLINATIONS = saved.force;
  }
});

test("a live GPU error is reported as itself and outside-service advice is stripped", async () => {
  const oom = await startGen((url) => (url === "/health" ? { ok: true, weights: { flux_schnell: true } } : { ok: false, reason: "cuda_oom", error: "out of memory" }));
  const advised = await startGen((url) => (url === "/health"
    ? { ok: true, weights: { flux_schnell: true } }
    : { ok: false, reason: "gpu_concept_failed", error: "Try DALL-E 3 or Stable Diffusion instead" }));
  const missing = await startGen(() => ({ ok: true, weights: { flux_schnell: false } }));
  const saved = { gen: process.env.CONCORD_GEN_URL };
  try {
    process.env.CONCORD_GEN_URL = `http://127.0.0.1:${oom.address().port}`;
    const oomHit = await fulfillImageRequest("make an image of a red bicycle");
    assert.equal(oomHit.offline, false);
    assert.notEqual(oomHit.reply, GPU_OFFLINE_REPLY);
    assert.match(oomHit.reply, /out of memory|cuda_oom/);

    process.env.CONCORD_GEN_URL = `http://127.0.0.1:${advised.address().port}`;
    const stripped = await produceGpuImage({ prompt: "a red bicycle" });
    assert.equal(stripped.offline, false);
    assert.ok(!/dall-?e|stable diffusion/i.test(stripped.error));

    process.env.CONCORD_GEN_URL = `http://127.0.0.1:${missing.address().port}`;
    const weights = await fulfillImageRequest("draw me a red bicycle");
    assert.equal(weights.offline, true);
    assert.equal(weights.reply, "GPU image generation is offline");
    assert.equal(weights.reason, "weights_missing");
  } finally {
    oom.close();
    advised.close();
    missing.close();
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
  }
});

test("chat.respond and the agent loop route images before any model call", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const fulfillAt = server.indexOf("const { fulfillImageRequest: _fulfillImageRequest } = await import(\"./lib/chat/image-router.js\");");
  const brainAt = server.indexOf("} else if (llm && ctx.llm.enabled) {");
  assert.ok(fulfillAt > 0 && brainAt > fulfillAt, "chat.respond fulfills the image before the brain branch");
  assert.match(server, /if \(_deterministicAnswer\) \{\n\s+finalReply = _deterministicAnswer\.text;/);
  const macroAt = server.indexOf('register("multimodal","image_generate"');
  const voiceAt = server.indexOf('register("voice","transcribe"', macroAt);
  const macro = server.slice(macroAt, voiceAt);
  assert.equal(macro.includes("ctx.state"), false);
  assert.match(macro, /produceGpuImage/);
  assert.match(macro, /handler_error/);
  assert.doesNotMatch(macro, /SD_URL|Stable Diffusion|pollinations|data:image/i);
  assert.match(server, /_genImages\.find\(\(r\) => r\.artifact\?\.url\)/);
  const agent = fs.readFileSync(new URL("../lib/chat-agent.js", import.meta.url), "utf8");
  const loop = agent.slice(agent.indexOf("export async function runAgentLoop"));
  const at = loop.indexOf("explicitImagePrompt(message)");
  assert.ok(at > 0 && at < loop.indexOf("Shadow context prefetch"), "agent loop routes the image before any model turn");
});

test("runAgentLoop returns the GPU image and does not ask the brain", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const srv = await startGen((url) => (url === "/health" ? { ok: true, weights: { flux_schnell: true } } : { ok: true, png_b64: png, provider: "local_gpu_flux" }));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-loop-img-"));
  const saved = { gen: process.env.CONCORD_GEN_URL, data: process.env.DATA_DIR };
  process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.DATA_DIR = dataDir;
  let brainCalled = false;
  const events = [];
  try {
    const result = await runAgentLoop({
      db: { prepare() { throw new Error("db should not be touched"); } },
      userId: "u1",
      message: "make an image of a red bicycle",
      runMacro: async () => { throw new Error("macro_uncaught_throw"); },
      lensActions: new Map(),
      opts: {
        shadowContext: false,
        actionMemory: false,
        brainChat: async () => {
          brainCalled = true;
          return { ok: true, text: "I can't generate images. Try DALL-E 3 or Stable Diffusion." };
        },
      },
      onEvent: (type, payload) => events.push({ type, payload }),
    });
    assert.equal(brainCalled, false);
    assert.equal(result.ok, true);
    assert.equal(result.answer.includes("data:image"), false);
    assert.match(result.answer, /\/api\/media\/media-[^)]+\/stream/);
    assert.equal(result.artifacts[0].image_b64, undefined);
    assert.match(result.artifacts[0].url, /^\/api\/media\/media-/);
    assert.equal(result.turns, 0);
    assert.ok(!/dall-?e|stable diffusion|midjourney/i.test(result.answer));
    assert.equal(events.some((e) => e.type === "tool_call" && e.payload.tool === "generate_image" && e.payload.ok), true);
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.data === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved.data;
  }
});

test("runAgentLoop says the GPU is offline without calling the brain when the gen server is down", async () => {
  const saved = { gen: process.env.CONCORD_GEN_URL, force: process.env.CONCORD_FORCE_POLLINATIONS };
  process.env.CONCORD_GEN_URL = "http://127.0.0.1:9";
  process.env.CONCORD_FORCE_POLLINATIONS = "1";
  let brainCalled = false;
  try {
    const result = await runAgentLoop({
      db: { prepare() { throw new Error("db should not be touched"); } },
      userId: "u1",
      message: "make an image of a red bicycle",
      runMacro: async () => ({ ok: false, error: "macro_uncaught_throw" }),
      lensActions: new Map(),
      opts: {
        shadowContext: false,
        actionMemory: false,
        brainChat: async () => {
          brainCalled = true;
          return { ok: true, text: "Try DALL-E 3 or Stable Diffusion." };
        },
      },
    });
    assert.equal(brainCalled, false);
    assert.equal(result.answer, "GPU image generation is offline");
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.toolCalls[0].ok, false);
    assert.notEqual(result.toolCalls[0].error, "macro_uncaught_throw");
  } finally {
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.force === undefined) delete process.env.CONCORD_FORCE_POLLINATIONS; else process.env.CONCORD_FORCE_POLLINATIONS = saved.force;
  }
});

test("a busy GPU returns the busy sentence in a few seconds and saves no artifact", async () => {
  let conceptHits = 0;
  const srv = await startGen((url) => {
    if (url !== "/health") conceptHits += 1;
    return { ok: true, busy: true, on_gpu: "trellis1" };
  });
  const saved = { gen: process.env.CONCORD_GEN_URL };
  process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
  try {
    const state = { dtus: new Map() };
    const t0 = Date.now();
    const hit = await fulfillImageRequest("draw a picture of a sunset", { ownerId: "owner-1", state });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5_000, `wall ${elapsed}ms`);
    assert.equal(conceptHits, 0);
    assert.equal(hit.ok, false);
    assert.equal(hit.artifact, undefined);
    assert.equal(hit.reply, GPU_BUSY_REPLY);
    assert.equal(state.dtus.size, 0);
  } finally {
    srv.close();
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
  }
});

test("non-image bytes are never stored as an image artifact", async () => {
  assert.equal(Buffer.from(GPU_BUSY_REPLY).length, 56);
  const busyB64 = Buffer.from(GPU_BUSY_REPLY).toString("base64");
  const headers = [];
  const srv = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      headers.push(req.headers["x-concord-fail-if-busy"] || "");
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const out = req.url === "/health"
          ? { ok: true, busy: false, on_gpu: "flux", weights: { flux_schnell: true } }
          : { ok: true, png_b64: busyB64, provider: "local_gpu_flux" };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
        void body;
      });
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "img-busy-bytes-"));
  const saved = { gen: process.env.CONCORD_GEN_URL, data: process.env.DATA_DIR };
  process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.DATA_DIR = dataDir;
  try {
    const state = { dtus: new Map() };
    const hit = await fulfillImageRequest("draw a picture of a sunset", { ownerId: "owner-1", state });
    assert.equal(hit.ok, false);
    assert.equal(hit.artifact, undefined);
    assert.equal(hit.reply, GPU_BUSY_REPLY);
    assert.equal(state.dtus.size, 0);
    const artDir = path.join(dataDir, "gpu-art");
    assert.equal(fs.existsSync(artDir) ? fs.readdirSync(artDir).length : 0, 0);
    assert.ok(headers.includes("1"), "concept post asks the pod not to queue");

    const junk = await publishPrivateImage({
      imageB64: Buffer.from("this is not a png").toString("base64"),
      prompt: "a sunset", width: 512, height: 512, ownerId: "owner-1", state,
    });
    assert.equal(junk.ok, false);
    assert.equal(junk.reason, "not_image");
    assert.equal(state.dtus.size, 0);
  } finally {
    srv.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (saved.gen === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved.gen;
    if (saved.data === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = saved.data;
  }
});
