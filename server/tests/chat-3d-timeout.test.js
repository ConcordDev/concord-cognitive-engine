// Chat-mode 3D timeout (2026-10-19).
// "Yes generate a 3d cad" called generate_image, waited the 300s GPU default,
// and saved "The operation was aborted due to timeout" because chat never
// passed the user prompt and never flushed SSE keep-alives.
// Live pod e2e is not run here. These tests cover the catalog, the bounce,
// the short timeout, the plain-English error, and the keep-alive flush.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CHAT_RESPOND_TOOLS } from "../lib/chat-tool-surface.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { chatAgentRoute } from "../lib/chat/agent-route.js";
import { toolFor3dAsk } from "../lib/chat/route-3d-ask.js";
import { generate3dFromPrompt } from "../lib/chat/generate-3d.js";
import { composeToolTurnReply } from "../lib/chat/tool-turn-reply.js";
import {
  assessGpuHealth,
  generatePollinationsImage,
  generateViaLocalGpu,
  IMAGE_TIMEOUT_REPLY,
} from "../lib/pollinations-image.js";

const SERVER_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js");

function chatExecuteToolCallSource() {
  const src = readFileSync(SERVER_JS, "utf8");
  const start = src.indexOf("const _executeToolCall = async");
  const end = src.indexOf("const _executeToolCalls = async");
  assert.ok(start > 0 && end > start);
  return src.slice(start, end);
}

describe("chat 3D tool routing", () => {
  it("offers conkay_design and generate_3d immediately before generate_image", () => {
    const names = CHAT_RESPOND_TOOLS.filter((t) => !t.operatorOnly).map((t) => t.name);
    const image = names.indexOf("generate_image");
    assert.equal(names[image - 1], "generate_3d");
    assert.equal(names[image - 2], "conkay_design");
    const src = readFileSync(SERVER_JS, "utf8");
    const block = src.slice(src.indexOf("const _toolSystemPrompt"), src.indexOf("const _DOMAIN_KW"));
    assert.match(block, /- conkay_design:/);
    assert.match(block, /- generate_3d:/);
    assert.match(block, /Do not answer those with generate_image/);
    const prompted = [...block.matchAll(/^- ([a-z0-9_]+):/gm)].map((m) => m[1]);
    assert.deepEqual(prompted, names);
  });

  it("passes the user prompt and a 120s concept budget into executeToolCall", () => {
    const body = chatExecuteToolCallSource();
    assert.match(body, /userPrompt:/);
    assert.match(body, /chatGenTimeoutMs:\s*120_000/);
    assert.match(body, /case "conkay_design":/);
    assert.match(body, /case "generate_3d":/);
    assert.match(body, /case "generate_image":/);
    assert.match(body, /_lensTool\(_toolCtx,/);
    assert.match(body, /_imageTool\(_toolCtx,/);
    assert.match(body, /_runtimeTool\(_toolCtx,/);
    assert.doesNotMatch(body, /_imageTool\(ctx,/);
    const src = readFileSync(SERVER_JS, "utf8");
    assert.match(src, /reason !== "wants_3d"/);
    assert.match(src, /toolFor3dAsk/);
    assert.match(src, /userFacingGenerationError/);
  });

  it("routes a 3d cad ask to the design agent path and to conkay_design", () => {
    assert.equal(chatAgentRoute("Yes generate a 3d cad"), "design");
    assert.equal(chatAgentRoute("generate a 3d cad"), "design");
    assert.equal(toolFor3dAsk("Yes generate a 3d cad").tool, "conkay_design");
    assert.equal(toolFor3dAsk("generate a 3d model of a dragon").tool, "generate_3d");
    assert.equal(toolFor3dAsk("make a 3d model of a phone stand").tool, "conkay_design");
  });

  it("bounces generate_image when the user asked for 3D, and only then", async () => {
    const bounced = await executeToolCall(
      { userPrompt: "Yes generate a 3d cad" },
      null,
      new Map(),
      { tool: "generate_image", params: { prompt: "a cad model" } },
    );
    assert.equal(bounced.ok, false);
    assert.equal(bounced.reason, "wants_3d");
    assert.match(bounced.retryHint, /generate_3d/);
  });
});

describe("GPU concept timeout is plain English", () => {
  const saved = process.env.CONCORD_GEN_URL;
  after(() => {
    if (saved === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = saved;
  });

  it("assessGpuHealth proceeds on {ok:true} and fails fast on busy or a non-FLUX model", () => {
    assert.equal(assessGpuHealth({ ok: true }).ok, true);
    assert.equal(assessGpuHealth({ ok: true, weights: { flux_schnell: true } }).ok, true);
    assert.equal(assessGpuHealth({ ok: true, model: "FLUX.1-schnell" }).ok, true);
    assert.equal(assessGpuHealth({ ok: true, busy: true }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, status: "busy" }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, model: "sdxl" }).reason, "gpu_wrong_model");
    assert.equal(assessGpuHealth(null).reason, "local_gpu_unreachable");
  });

  it("a short timeout does not save the raw abort text or fall back to Pollinations", async () => {
    let conceptHits = 0;
    const srv = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        conceptHits += 1;
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const r = await generateViaLocalGpu({ prompt: "a red cube", timeoutMs: 80 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "timeout");
      assert.equal(r.error, IMAGE_TIMEOUT_REPLY);
      assert.doesNotMatch(r.error, /aborted due to timeout/i);
      assert.equal(conceptHits, 1);
      const wrapped = await generatePollinationsImage({ prompt: "a red cube", timeoutMs: 80 });
      assert.equal(wrapped.ok, false);
      assert.equal(wrapped.reason, "timeout");
      assert.equal(wrapped.provider_attempted, "local_gpu_flux");
      assert.doesNotMatch(JSON.stringify(wrapped), /pollinations\.ai/);
      assert.doesNotMatch(String(wrapped.error), /aborted due to timeout/i);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("does not call /concept when the pod says it is busy or the wrong model is loaded", async () => {
    for (const health of [{ ok: true, busy: true }, { ok: true, model: "sdxl" }]) {
      let conceptHits = 0;
      const srv = await new Promise((resolve) => {
        const s = http.createServer((req, res) => {
          if (req.url !== "/health") conceptHits += 1;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(req.url === "/health" ? health : { ok: true, png_b64: "aa" }));
        });
        s.listen(0, "127.0.0.1", () => resolve(s));
      });
      try {
        process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
        const r = await generateViaLocalGpu({ prompt: "a red cube", timeoutMs: 5000 });
        assert.equal(r.ok, false);
        assert.ok(r.reason === "gpu_busy" || r.reason === "gpu_wrong_model");
        assert.doesNotMatch(r.error, /aborted due to timeout/i);
        assert.match(r.error, /Try again in a moment/);
        assert.equal(conceptHits, 0);
      } finally {
        srv.closeAllConnections?.();
        srv.close();
      }
    }
  });

  it("generate_3d turns a concept abort into a plain sentence and fails fast on a busy pod", async () => {
    const abort = new Error("The operation was aborted due to timeout");
    abort.name = "TimeoutError";
    const timed = await generate3dFromPrompt("a small owl", {
      conceptTimeoutMs: 50,
      fetchImpl: async () => { throw abort; },
    });
    assert.equal(timed.ok, false);
    assert.equal(timed.reason, "timeout");
    assert.match(timed.error, /timed out before the GPU finished/);
    assert.doesNotMatch(timed.error, /aborted due to timeout/i);
    const reply = composeToolTurnReply([timed.ok ? timed : { tool: "generate_3d", ok: false, error: abort.message }]);
    assert.match(reply, /timed out before the GPU finished/);
    assert.doesNotMatch(reply, /aborted due to timeout/i);

    const calls = [];
    const busy = await generate3dFromPrompt("a small owl", {
      preflight: true,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return { json: async () => ({ ok: true, busy: true }) };
      },
    });
    assert.equal(busy.reason, "gpu_busy");
    assert.deepEqual(calls.map((u) => u.slice(u.lastIndexOf("/"))), ["/health"]);
    assert.doesNotMatch(busy.error, /aborted due to timeout/i);
  });
});

describe("chat stream keep-alives", () => {
  it("startSSE is called before the chat.respond await on /api/chat/stream", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes/chat.js"), "utf8");
    const start = src.indexOf('app.post("/api/chat/stream"');
    const end = src.indexOf("app.get(\"/api/chicken3/status\"", start);
    const body = src.slice(start, end);
    const sseAt = body.indexOf("startSSE(res)");
    // The disabled-streaming branch calls chat.respond before startSSE.
    // The live stream calls it after, which is the path that must keep alive.
    const respondAt = body.indexOf('runMacro("chat","respond"', sseAt);
    assert.ok(sseAt >= 0 && respondAt > sseAt);
  });
});
