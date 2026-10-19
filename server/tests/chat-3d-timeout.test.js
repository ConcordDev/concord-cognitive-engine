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
import { fallbackDesignCall, toolFor3dAsk } from "../lib/chat/route-3d-ask.js";
import { generate3dFromPrompt } from "../lib/chat/generate-3d.js";
import { chatGenerationBudget, JSON_TURN_BUDGET_MS } from "../lib/chat/gen-budget.js";
import { composeToolTurnReply, isRecoverableToolFailure, sanitizeUserReply, scrubUserFacingToolNames, userFacingMeshReply } from "../lib/chat/tool-turn-reply.js";
import { visibleChatReply } from "../lib/chat-governance-leak.js";
import {
  assessGpuHealth,
  GEN_BUSY_WAIT_CAP_MS,
  GEN_HEALTH_TIMEOUT_MS,
  generatePollinationsImage,
  generateViaLocalGpu,
  GPU_BUSY_REPLY,
  IMAGE_TIMEOUT_REPLY,
  isGlb,
  isPngOrJpeg,
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
    assert.match(body, /chatGenerationBudget/);
    assert.match(body, /chatGenDeadlineMs/);
    assert.match(body, /case "conkay_design":/);
    assert.match(body, /case "generate_3d":/);
    assert.match(body, /case "generate_image":/);
    assert.match(body, /_lensTool\(_toolCtx,/);
    assert.match(body, /_imageTool\(_toolCtx,/);
    assert.match(body, /_runtimeTool\(_toolCtx,/);
    assert.doesNotMatch(body, /_imageTool\(ctx,/);
    const src = readFileSync(SERVER_JS, "utf8");
    assert.match(src, /chatTurnStartedAt/);
    assert.match(src, /userFacingMeshReply/);
    assert.match(src, /scrubUserFacingToolNames/);
    assert.match(src, /reason !== "wants_3d"/);
    assert.match(src, /toolFor3dAsk/);
    assert.match(src, /userFacingGenerationError/);
    const routes = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes/chat.js"), "utf8");
    assert.match(routes, /chatTransport: "json"/);
    assert.match(routes, /chatTransport = "sse"/);
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
    assert.equal(assessGpuHealth({ ok: true, loading: true }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, status: "loading" }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, state: "warming" }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, on_gpu: null }).ok, true);
    assert.equal(assessGpuHealth({ ok: true, on_gpu: "flux" }).ok, true);
    assert.equal(assessGpuHealth({ ok: true, busy: false, on_gpu: "trellis1" }).reason, "gpu_busy");
    assert.equal(assessGpuHealth({ ok: true, on_gpu: "trellis1" }).error, GPU_BUSY_REPLY);
    assert.ok(GEN_HEALTH_TIMEOUT_MS <= GEN_BUSY_WAIT_CAP_MS);
    assert.ok(GEN_HEALTH_TIMEOUT_MS <= 5_000);
    const sig = Buffer.from("iVBORw0KGgo=", "base64");
    assert.equal(isPngOrJpeg(sig), true);
    assert.equal(isPngOrJpeg(Buffer.from(GPU_BUSY_REPLY)), false);
    assert.equal(Buffer.from(GPU_BUSY_REPLY).length, 56);
    const glb = Buffer.alloc(12);
    glb.write("glTF", 0, "ascii");
    assert.equal(isGlb(glb), true);
    assert.equal(isGlb(Buffer.from(GPU_BUSY_REPLY)), false);
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
      preflight: false,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/health")) return { json: async () => ({ ok: true, on_gpu: "flux" }) };
        throw abort;
      },
    });
    assert.equal(timed.ok, false);
    assert.equal(timed.reason, "timeout");
    assert.match(timed.error, /timed out before the GPU finished/);
    assert.doesNotMatch(timed.error, /aborted due to timeout/i);
    const reply = composeToolTurnReply([timed.ok ? timed : { tool: "generate_3d", ok: false, error: abort.message }]);
    assert.match(reply, /timed out before the GPU finished/);
    assert.doesNotMatch(reply, /aborted due to timeout/i);
    assert.doesNotMatch(reply, /\bgenerate_3d\b|\bconkay_design\b|\bgenerate_image\b/);

    const calls = [];
    const busy = await generate3dFromPrompt("a small owl", {
      preflight: false,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return { json: async () => ({ ok: true, busy: true }) };
      },
    });
    assert.equal(busy.reason, "gpu_busy");
    assert.deepEqual(calls.map((u) => u.slice(u.lastIndexOf("/"))), ["/health"]);
    assert.doesNotMatch(busy.error, /aborted due to timeout/i);

    const hungHealth = await generate3dFromPrompt("a small owl", {
      fetchImpl: async () => { throw abort; },
    });
    assert.equal(hungHealth.reason, "gpu_busy");
    assert.equal(hungHealth.error, GPU_BUSY_REPLY);
    assert.doesNotMatch(hungHealth.error, /aborted due to timeout/i);
  });
});

const IRON_MAN = "Yes generate a 3d cad of an iron man like robot";

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

describe("generate_3d failure falls back to a layout", () => {
  const saved = process.env.CONCORD_GEN_URL;
  const savedBudget = process.env.CONCORD_CHAT_JSON_BUDGET_MS;
  after(() => {
    if (saved === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = saved;
    if (savedBudget === undefined) delete process.env.CONCORD_CHAT_JSON_BUDGET_MS;
    else process.env.CONCORD_CHAT_JSON_BUDGET_MS = savedBudget;
  });

  it("a busy pod on an engineered ask returns a biped layout without naming tools", async () => {
    let conceptHits = 0;
    const srv = await listen((req, res) => {
      if (req.url !== "/health") conceptHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy: true, on_gpu: "trellis1" }));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const t0 = Date.now();
      const r = await executeToolCall(
        { userPrompt: IRON_MAN, chatTransport: "json", chatGenTimeoutMs: 30_000, chatGenDeadlineMs: Date.now() + 30_000, actor: { userId: "u1" } },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "iron man robot" } },
      );
      assert.ok(Date.now() - t0 < 5_000);
      assert.equal(conceptHits, 0);
      assert.equal(r.ok, true);
      assert.equal(r.fellBackFrom, "generate_3d");
      assert.equal(r.artifact.kind, "mesh");
      assert.equal(r.result.spec.base, "legs");
      assert.equal(r.result.spec.wheels, 0);
      assert.ok(r.artifact.positions.length > 100);
      const reply = userFacingMeshReply(r);
      assert.match(reply, /robot layout is shown below/);
      assert.match(reply, /approximation/);
      assert.doesNotMatch(reply, /\bgenerate_3d\b|\bconkay_design\b|\bgenerate_image\b/);
      assert.equal(userFacingMeshReply({ artifact: { kind: "mesh", meshKind: "i-beam" }, result: { part: "beam" } }), "The 3D model is shown below.");
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("a free-form ask does not fall back to a robot, and the failure names no tool", async () => {
    const srv = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, busy: true, on_gpu: "trellis1" }));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const r = await executeToolCall(
        { userPrompt: "generate a 3d model of a dragon", chatGenTimeoutMs: 30_000, chatGenDeadlineMs: Date.now() + 30_000, actor: { userId: "u1" } },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "a small dragon figurine" } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.reason, "gpu_busy");
      assert.equal(fallbackDesignCall("generate a 3d model of a dragon", "a dragon", r), null);
      const reply = composeToolTurnReply([r]);
      assert.match(reply, /busy/i);
      assert.doesNotMatch(reply, /\bgenerate_3d\b|\bconkay_design\b|\bgenerate_image\b/);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("scrubs a failure that tells the user to use conkay_design", () => {
    const reply = composeToolTurnReply([{
      tool: "generate_3d",
      ok: false,
      error: "use conkay_design with a detailed spec",
    }]);
    assert.match(reply, /describe the part in more detail/);
    assert.match(reply, /Agent mode/);
    assert.doesNotMatch(reply, /\bconkay_design\b|\bgenerate_3d\b|\bgenerate_image\b|\brun_lens_action\b/);
    const echoed = scrubUserFacingToolNames("That failed. Try conkay_design with a detailed spec, or call generate_3d.");
    assert.doesNotMatch(echoed, /\bconkay_design\b|\bgenerate_3d\b/);
    assert.match(echoed, /describe the part in more detail/);
  });

  it("a non-streaming turn against a slow gen server stays under the 90s budget", { timeout: 20_000 }, async () => {
    assert.ok(JSON_TURN_BUDGET_MS <= 90_000);
    assert.ok(JSON_TURN_BUDGET_MS >= 60_000);
    const open = chatGenerationBudget({ transport: "json", startedAt: Date.now() });
    assert.equal(open.capMs, JSON_TURN_BUDGET_MS);
    assert.ok(open.timeoutMs < 90_000);
    assert.equal(chatGenerationBudget({ transport: "sse", startedAt: Date.now() }).capMs, 120_000);
    const late = chatGenerationBudget({ transport: "json", startedAt: Date.now() - 80_000 });
    assert.ok(late.timeoutMs < 10_000);

    process.env.CONCORD_CHAT_JSON_BUDGET_MS = "6000";
    let conceptHits = 0;
    let meshHits = 0;
    const srv = await listen((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, busy: false, on_gpu: "flux" }));
        return;
      }
      if (req.url === "/concept") conceptHits += 1;
      else meshHits += 1;
      // Never respond. The deadline has to abort the socket.
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const startedAt = Date.now();
      const budget = chatGenerationBudget({ transport: "json", startedAt });
      assert.equal(budget.capMs, 6000);
      assert.ok(budget.timeoutMs > 0 && budget.timeoutMs < 90_000);
      const r = await executeToolCall(
        {
          userPrompt: IRON_MAN,
          chatTransport: "json",
          chatGenDeadlineMs: budget.deadlineMs,
          chatGenTimeoutMs: budget.timeoutMs,
          actor: { userId: "u1" },
        },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "iron man cad robot" } },
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < 90_000, `wall ${elapsed}ms`);
      assert.ok(elapsed < budget.capMs + 3_000, `wall ${elapsed}ms exceeded the json budget`);
      assert.equal(r.ok, true);
      assert.equal(r.artifact.kind, "mesh");
      assert.equal(r.result.spec.base, "legs");
      assert.equal(r.result.parts.filter((p) => p.name.startsWith("wheel")).length, 0);
      assert.equal(conceptHits, 1);
      assert.equal(meshHits, 0);
      const reply = userFacingMeshReply(r);
      assert.doesNotMatch(reply, /\bconkay_design\b|\bgenerate_3d\b/);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });
});

const TOOL_LEAK_RE = /\b(?:generate_3d|generate_image|conkay_design|conkay_solve|run_lens_action|run_compute|TOOL_CALL|TOOL_RESULT)\b|FLAT 2D|say exactly|DALL-E/i;
const PARROT = "GPU image generation is offline. It makes FLAT 2D pictures only — never use it for a 3D model, CAD model, STL or printable part.";

describe("organic 3D asks do not become a bookshelf", () => {
  const saved = process.env.CONCORD_GEN_URL;
  after(() => {
    if (saved === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = saved;
  });

  it("seeds a robot layout from the user's words and refuses a creature", () => {
    const busy = { ok: false, reason: "gpu_busy", error: "busy" };
    assert.equal(fallbackDesignCall("generate a 3d model of a dragon", "a bookshelf", busy), null);
    assert.equal(fallbackDesignCall("sculpt a statue of a horse", "a bookshelf", busy), null);
    assert.equal(fallbackDesignCall("a 3d model of a fern plant", "phone stand", busy), null);
    const robot = fallbackDesignCall("generate a 3d model of a robot", "a bookshelf", busy);
    assert.equal(robot.tool, "conkay_design");
    assert.match(robot.params.text, /robot/i);
    assert.doesNotMatch(robot.params.text, /bookshelf|shelf/i);
    assert.equal(isRecoverableToolFailure({ ok: false, terminal: true, retryHint: "call conkay_design", error: "3D generation is busy right now." }), false);
  });

  it("a creature ask with generate_3d failing does not substitute conkay", async () => {
    const srv = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, loading: true }));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const r = await executeToolCall(
        { userPrompt: "generate a 3d model of a dragon", chatTransport: "json", chatGenTimeoutMs: 30_000, chatGenDeadlineMs: Date.now() + 30_000, actor: { userId: "u1" } },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "a bookshelf" } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.fellBackFrom, undefined);
      assert.equal(r.artifact, undefined);
      assert.equal(r.terminal, true);
      assert.match(r.error, /3D generation is busy/);
      assert.match(r.error, /minute/);
      assert.doesNotMatch(r.error, /shelf|bookshelf|FLAT 2D/i);
      const reply = composeToolTurnReply([r]);
      assert.match(reply, /3D generation is busy/);
      assert.match(reply, /minute/);
      assert.doesNotMatch(reply, TOOL_LEAK_RE);
      assert.doesNotMatch(reply, /shelf|bookshelf/i);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("conkay_design will not return a bookshelf for a dragon", async () => {
    const r = await executeToolCall(
      { userPrompt: "generate a 3d model of a dragon" },
      async () => ({}),
      new Map(),
      { tool: "conkay_design", params: { text: "a bookshelf" } },
    );
    assert.equal(r.ok, false);
    assert.equal(r.terminal, true);
    assert.equal(r.artifact, undefined);
    assert.match(r.error, /3D generation is (?:busy|unavailable)/);
    assert.match(r.error, /minute/);
    assert.doesNotMatch(JSON.stringify(r.result || {}), /shelf/i);
    const reply = composeToolTurnReply([r]);
    assert.doesNotMatch(reply, TOOL_LEAK_RE);
    assert.doesNotMatch(reply, /shelf|bookshelf/i);
  });
});

describe("tool-description text never reaches the user", () => {
  it("strips the image-tool sentence and tool names, and keeps a real image failure", () => {
    const dragon = "generate a 3d model of a dragon";
    const cleaned = sanitizeUserReply(PARROT, { prompt: dragon });
    assert.match(cleaned, /3D generation is (?:busy|unavailable)/);
    assert.match(cleaned, /minute/);
    assert.doesNotMatch(cleaned, TOOL_LEAK_RE);
    assert.doesNotMatch(cleaned, /GPU image generation is offline/);
    assert.equal(sanitizeUserReply("GPU image generation is offline", { prompt: "draw a red bike" }), "GPU image generation is offline");
    const named = sanitizeUserReply("Try generate_3d, then conkay_design, or generate_image.", { prompt: dragon });
    assert.doesNotMatch(named, TOOL_LEAK_RE);
    const shown = visibleChatReply(PARROT, dragon);
    assert.match(shown, /3D generation is (?:busy|unavailable)/);
    assert.doesNotMatch(shown, TOOL_LEAK_RE);
    assert.equal(visibleChatReply("Plain answer.", "q"), "Plain answer.");
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
    const sse = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/sse.js"), "utf8");
    assert.match(sse, /SSE_HEARTBEAT_MS = Number\(process\.env\.CONCORD_SSE_HEARTBEAT_MS\) \|\| 15000/);
  });
});

describe("busy gen server fails fast and stores no fake artifact", () => {
  const saved = process.env.CONCORD_GEN_URL;
  after(() => {
    if (saved === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = saved;
  });

  it("an empty stream ctx returns the busy sentence in a few seconds and does not post", async () => {
    for (const health of [
      { ok: true, busy: true },
      { ok: true, loading: true },
      { ok: true, busy: false, on_gpu: "trellis1" },
    ]) {
      let posts = 0;
      const srv = await listen((req, res) => {
        if (req.url !== "/health") posts += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
      });
      try {
        process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
        const t0 = Date.now();
        const state = { dtus: new Map() };
        const r = await executeToolCall(
          { mediaState: state },
          async () => ({}),
          new Map(),
          { tool: "generate_3d", params: { prompt: "generate a 3d model of a dragon statue" } },
        );
        const elapsed = Date.now() - t0;
        assert.ok(elapsed < 5_000, `wall ${elapsed}ms`);
        assert.equal(posts, 0);
        assert.equal(r.ok, false);
        assert.equal(r.reason, "gpu_busy");
        assert.match(r.error, /3D generation is busy/);
        assert.equal(r.artifact, undefined);
        assert.equal(r.artifacts, undefined);
        assert.equal(state.dtus.size, 0);
      } finally {
        srv.closeAllConnections?.();
        srv.close();
      }
    }
  });

  it("a health check that never returns is busy within a few seconds and does not post", { timeout: 15_000 }, async () => {
    let posts = 0;
    const srv = await listen((req, res) => {
      if (req.url !== "/health") {
        posts += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      }
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const t0 = Date.now();
      const r = await generate3dFromPrompt("a dragon statue", { preflight: false });
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 8_000, `wall ${elapsed}ms`);
      assert.ok(elapsed < GEN_BUSY_WAIT_CAP_MS, `wall ${elapsed}ms waited out a running job`);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "gpu_busy");
      assert.equal(r.error, GPU_BUSY_REPLY);
      assert.equal(posts, 0);
      assert.equal(r.conceptB64, undefined);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("error text is not saved as a concept image or a mesh", async () => {
    const busyB64 = Buffer.from(GPU_BUSY_REPLY).toString("base64");
    assert.equal(Buffer.from(busyB64, "base64").length, 56);
    let meshHits = 0;
    const textSrv = await listen((req, res) => {
      if (req.url === "/mesh") meshHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      const body = req.url === "/health"
        ? { ok: true, busy: false, on_gpu: "flux" }
        : { ok: true, png_b64: busyB64 };
      res.end(JSON.stringify(body));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${textSrv.address().port}`;
      const state = { dtus: new Map() };
      const r = await executeToolCall(
        { userPrompt: "generate a 3d model of a dragon statue", mediaState: state, actor: { userId: "u1" } },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "a dragon statue" } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.reason, "gpu_busy");
      assert.match(r.error, /3D generation is busy/);
      assert.equal(meshHits, 0);
      assert.equal(r.artifact, undefined);
      assert.equal(state.dtus.size, 0);
    } finally {
      textSrv.closeAllConnections?.();
      textSrv.close();
    }

    const meshSrv = await listen((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      let body;
      if (req.url === "/health") body = { ok: true, busy: false, on_gpu: "flux" };
      else if (req.url === "/concept") body = { ok: true, png_b64: "iVBORw0KGgo=" };
      else body = { ok: true, glb_b64: busyB64 };
      res.end(JSON.stringify(body));
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${meshSrv.address().port}`;
      const state = { dtus: new Map() };
      const r = await executeToolCall(
        { userPrompt: "generate a 3d model of a dragon statue", mediaState: state, actor: { userId: "u1" } },
        async () => ({}),
        new Map(),
        { tool: "generate_3d", params: { prompt: "a dragon statue" } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.reason, "not_mesh");
      assert.equal(r.artifact, undefined);
      assert.equal(r.artifacts, undefined);
      assert.equal(state.dtus.size, 0);
    } finally {
      meshSrv.closeAllConnections?.();
      meshSrv.close();
    }
  });
});
