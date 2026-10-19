// Non-streaming chat budget, end to end (2026-10-19).
// Live: POST /api/chat?full=1 "Yes generate a 3d cad of an iron man like robot"
// went through the design agent route (lib/chat/agent-route.js →
// chat_agent.do → runAgentLoop). That loop never saw the #1404 budget: brain
// rounds used the >=120s chat timeout and generate_3d ran with the 120s
// concept default, so Cloudflare answered 524 at 125s and the server finished
// at 175s. These tests run the real loop with a slow brain and a gen server
// that never answers, on a scaled budget, and assert the wall time.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

import { runAgentLoop, GEN_3D_FALLBACK_RESERVE_MS } from "../lib/chat-agent.js";
import { answerViaAgent } from "../lib/chat/agent-route.js";
import { JSON_TURN_BUDGET_MS, raceDeadline, budgetLeftMs, clampGenerate3dBudget, GEN_3D_FALLBACK_RESERVE_MS as RESERVE } from "../lib/chat/gen-budget.js";
import { wantsExplicitMeshLook, isEngineered3dAsk, isOrganic3dAsk } from "../lib/chat/route-3d-ask.js";
import { budgetExhaustedReply } from "../lib/chat/tool-turn-reply.js";

const IRON_MAN = "Yes generate a 3d cad of an iron man like robot";
const TOOL_NAME_RE = /\b(?:generate_3d|conkay_design|generate_image|run_lens_action|TOOL_CALL)\b/;
const HERE = path.dirname(fileURLToPath(import.meta.url));

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
// A hung brain must not keep the test process alive after the loop gave up on it.
const hang = (ms) => new Promise((r) => { setTimeout(r, ms).unref(); });

/** Brain stub: each entry is [delayMs, text]. Past the end it hangs for 10 minutes. */
function slowBrain(script) {
  const calls = [];
  const fn = async ({ opts }) => {
    calls.push({ at: Date.now(), timeoutMs: opts?.timeoutMs });
    const step = script.shift();
    if (!step) { await hang(600_000); return { ok: true, text: "late", provider: "t", model: "t" }; }
    await sleep(step[0]);
    return { ok: true, text: step[1], provider: "t", model: "t" };
  };
  fn.calls = calls;
  return fn;
}

const LOOP_OPTS = { shadowContext: false, memory: false, actionMemory: false, deepen: false };

describe("JSON chat budget holds through the agent loop", () => {
  const savedGen = process.env.CONCORD_GEN_URL;
  after(() => {
    if (savedGen === undefined) delete process.env.CONCORD_GEN_URL;
    else process.env.CONCORD_GEN_URL = savedGen;
  });

  it("JSON budget stays at or under 85s", () => {
    assert.ok(JSON_TURN_BUDGET_MS <= 85_000);
    assert.ok(GEN_3D_FALLBACK_RESERVE_MS > 0 && GEN_3D_FALLBACK_RESERVE_MS < JSON_TURN_BUDGET_MS / 4);
  });

  it("slow brain + hung generate_3d: falls back to a layout inside the budget, no tool names", { timeout: 30_000 }, async () => {
    let conceptHits = 0;
    const srv = await listen((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, busy: false, on_gpu: "flux" }));
        return;
      }
      conceptHits += 1; // never answers: the deadline must abort it
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const budgetMs = 8_000;
      const startedAt = Date.now();
      const brain = slowBrain([
        [1_500, 'Building it now. [TOOL_CALL: {"tool": "generate_3d", "params": {"prompt": "iron man like robot, cad"}}]'],
        // The summary round is slower than what is left; the loop must not wait for it.
      ]);
      const r = await runAgentLoop({
        db: new Database(":memory:"), userId: "u1", message: IRON_MAN,
        runMacro: async () => ({ ok: true }), lensActions: new Map(),
        opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: 4, deadlineMs: startedAt + budgetMs, chatTransport: "json" },
      });
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < budgetMs + 1_500, `wall ${elapsed}ms over the ${budgetMs}ms budget`);
      assert.equal(r.ok, true);
      assert.equal(conceptHits, 0, "an 8s turn has no GPU window after the layout reserve");
      const call = r.toolCalls.find((t) => t.tool === "generate_3d" || t.fellBackFrom === "generate_3d");
      assert.ok(call, "generate_3d ran");
      assert.equal(call.ok, true, `fallback layout expected, got ${call.error || call.reason}`);
      assert.equal(call.fellBackFrom, "generate_3d");
      assert.ok(r.artifacts.some((a) => a?.kind === "mesh"));
      assert.match(r.answer, /shown below/);
      assert.doesNotMatch(r.answer, TOOL_NAME_RE);
      // Every brain round was handed a timeout inside the budget.
      for (const c of brain.calls) assert.ok(c.timeoutMs <= budgetMs, `brain timeout ${c.timeoutMs}`);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("a brain that never answers still returns a plain reply before the deadline", { timeout: 20_000 }, async () => {
    const budgetMs = 9_000;
    const startedAt = Date.now();
    const brain = slowBrain([]);
    const r = await runAgentLoop({
      db: new Database(":memory:"), userId: "u1", message: IRON_MAN,
      runMacro: async () => ({ ok: true }), lensActions: new Map(),
      opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: 4, deadlineMs: startedAt + budgetMs, chatTransport: "json" },
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < budgetMs, `wall ${elapsed}ms`);
    assert.ok(elapsed > 5_000, "the brain round was actually started and abandoned");
    assert.equal(brain.calls.length, 1);
    assert.ok(brain.calls[0].timeoutMs <= budgetMs);
    assert.equal(r.ok, true);
    assert.equal(r.budgetStopped, true);
    assert.match(r.answer, /still running|try again/i);
    assert.doesNotMatch(r.answer, TOOL_NAME_RE);
  });

  it("answerViaAgent passes the deadline to chat_agent.do and does not fall through when time is up", { timeout: 20_000 }, async () => {
    const budgetMs = 9_000;
    const startedAt = Date.now();
    const seen = [];
    const brain = slowBrain([]);
    const runMacro = async (domain, name, input) => {
      if (domain === "chat_agent" && name === "do") {
        seen.push(input);
        return runAgentLoop({
          db: new Database(":memory:"), userId: "u1", message: input.message,
          runMacro: async () => ({ ok: true }), lensActions: new Map(),
          opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: input.maxTurns, deadlineMs: input.deadlineMs, chatTransport: "json" },
        });
      }
      return { ok: true };
    };
    const out = await answerViaAgent({
      runMacro, ctx: { db: new Database(":memory:"), actor: { userId: "u1" } },
      prompt: IRON_MAN, route: "design", deadlineMs: startedAt + budgetMs,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < budgetMs, `wall ${elapsed}ms`);
    assert.equal(seen.length, 1, "no retry after the budget ran out");
    assert.equal(seen[0].deadlineMs, startedAt + budgetMs);
    assert.ok(out, "a reply, not null (null falls through to another brain call)");
    assert.equal(out.budgetStopped, true);
    assert.doesNotMatch(out.reply, TOOL_NAME_RE);
  });

  it("no deadline: the loop keeps its normal brain timeout (stream path unchanged)", async () => {
    const brain = slowBrain([[0, "Hi there."]]);
    const r = await runAgentLoop({
      db: new Database(":memory:"), userId: "u1", message: "hello",
      runMacro: async () => ({ ok: true }), lensActions: new Map(),
      opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: 1 },
    });
    assert.equal(r.ok, true);
    assert.ok(brain.calls[0].timeoutMs >= 120_000);
    assert.equal(r.budgetStopped, undefined);
  });

  it("raceDeadline and budgetExhaustedReply", async () => {
    assert.equal(budgetLeftMs(0), Infinity);
    const late = await raceDeadline(sleep(5_000).then(() => "slow"), Date.now() + 50, () => "late");
    assert.equal(late, "late");
    const fast = await raceDeadline(Promise.resolve("fast"), Date.now() + 5_000, () => "late");
    assert.equal(fast, "fast");
    const mesh = budgetExhaustedReply([{ tool: "conkay_design", ok: true, artifact: { kind: "mesh", meshKind: "robot" }, result: { kind: "robot" } }]);
    assert.match(mesh, /robot layout is shown below/);
    const none = budgetExhaustedReply([{ tool: "generate_3d", ok: false, reason: "timeout" }]);
    assert.match(none, /still running/);
    assert.doesNotMatch(none, TOOL_NAME_RE);
  });

  it("iron man JSON turn with a slow-but-free gen server returns the conkay layout under 85s", { timeout: 30_000 }, async () => {
    let conceptHits = 0;
    let healthHits = 0;
    const srv = await listen((req, res) => {
      if (req.url === "/health") {
        healthHits += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, busy: false, on_gpu: "flux" }));
        return;
      }
      conceptHits += 1; // free pod, but the mesh never finishes
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      // A full 85s deadline would also try TRELLIS (window = 85s − reserve).
      // This scaled JSON deadline still has a GPU window, so the hung concept
      // must be cut at the reserve and the layout must come back.
      const budgetMs = 20_000;
      const startedAt = Date.now();
      const brain = slowBrain([
        [200, 'On it. [TOOL_CALL: {"tool": "generate_3d", "params": {"prompt": "iron man like robot"}}]'],
      ]);
      const r = await runAgentLoop({
        db: new Database(":memory:"), userId: "u1", message: IRON_MAN,
        runMacro: async () => ({ ok: true }), lensActions: new Map(),
        opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: 4, deadlineMs: startedAt + budgetMs, chatTransport: "json" },
      });
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < JSON_TURN_BUDGET_MS, `wall ${elapsed}ms reached the 85s JSON budget`);
      assert.ok(elapsed < budgetMs, `wall ${elapsed}ms ran to the turn deadline`);
      assert.ok(elapsed > 2_000, "the free pod was actually attempted");
      assert.equal(r.ok, true);
      assert.equal(healthHits >= 1, true);
      assert.equal(conceptHits, 1);
      const call = r.toolCalls.find((t) => t.fellBackFrom === "generate_3d" || t.tool === "conkay_design");
      assert.ok(call?.ok, call?.error || "no layout");
      assert.equal(call.layoutFirst, true);
      assert.equal(call.result.spec.base, "legs");
      assert.ok(r.artifacts.some((a) => a?.kind === "mesh" && /robot/i.test(String(a.meshKind || ""))));
      assert.match(r.answer, /robot layout is shown below/);
      assert.doesNotMatch(r.answer, TOOL_NAME_RE);
      assert.doesNotMatch(r.answer, /still running and didn't finish/i);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("a dragon ask still uses generate_3d and does not substitute a layout", { timeout: 20_000 }, async () => {
    let conceptHits = 0;
    const srv = await listen((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, busy: false, on_gpu: "flux" }));
        return;
      }
      conceptHits += 1;
    });
    try {
      process.env.CONCORD_GEN_URL = `http://127.0.0.1:${srv.address().port}`;
      const budgetMs = 8_000;
      const startedAt = Date.now();
      const dragon = "generate a 3d model of a dragon";
      const brain = slowBrain([
        [100, 'Sure. [TOOL_CALL: {"tool": "generate_3d", "params": {"prompt": "a small dragon"}}]'],
      ]);
      const r = await runAgentLoop({
        db: new Database(":memory:"), userId: "u1", message: dragon,
        runMacro: async () => ({ ok: true }), lensActions: new Map(),
        opts: { ...LOOP_OPTS, brainChat: brain, maxTurns: 2, deadlineMs: startedAt + budgetMs, chatTransport: "json" },
      });
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < JSON_TURN_BUDGET_MS, `wall ${elapsed}ms`);
      assert.equal(conceptHits, 1, "organic asks still go to generate_3d");
      assert.equal(r.toolCalls.some((t) => t.tool === "conkay_design" || t.layoutFirst), false);
      assert.equal(r.artifacts.some((a) => a?.kind === "mesh"), false);
      assert.doesNotMatch(r.answer, /robot layout|layout approximation/i);
      assert.doesNotMatch(r.answer, TOOL_NAME_RE);
    } finally {
      srv.closeAllConnections?.();
      srv.close();
    }
  });

  it("the layout reserve clamps JSON and stream, and an 85s window still tries TRELLIS", () => {
    const now = 1_000_000;
    const full = clampGenerate3dBudget({ deadlineMs: now + JSON_TURN_BUDGET_MS, timeoutMs: 80_000, now });
    assert.equal(full.reserveMs, RESERVE);
    assert.equal(full.deadlineMs, now + JSON_TURN_BUDGET_MS - RESERVE);
    assert.ok(full.timeoutMs <= JSON_TURN_BUDGET_MS - RESERVE);
    assert.equal(full.enough, true);
    const stream = clampGenerate3dBudget({ deadlineMs: now + 120_000, timeoutMs: 120_000, now });
    assert.equal(stream.deadlineMs, now + 120_000 - RESERVE);
    assert.equal(stream.enough, true);
    const tight = clampGenerate3dBudget({ deadlineMs: now + 8_000, timeoutMs: 6_000, now });
    assert.equal(tight.enough, false);
    assert.equal(isEngineered3dAsk(IRON_MAN), true);
    assert.equal(isOrganic3dAsk("generate a 3d model of a dragon"), true);
    assert.equal(isEngineered3dAsk("generate a 3d model of a dragon"), false);
    assert.equal(wantsExplicitMeshLook(IRON_MAN), false);
    assert.equal(wantsExplicitMeshLook("make a mesh with an organic look of an iron man robot"), true);
    assert.equal(wantsExplicitMeshLook("sculpt a statue of a horse"), false);
  });

  it("server.js hands the JSON deadline to the agent route; stream keeps keepalives and the 120s cap", () => {
    const src = readFileSync(path.join(HERE, "../server.js"), "utf8");
    const at = src.indexOf("_ar.answerViaAgent(");
    const block = src.slice(at - 900, at + 600);
    assert.match(block, /chatGenerationBudget\(/);
    assert.match(block, /transport === "json" \? \{ deadlineMs/);
    assert.match(block, /_agentRouteKind === "design"/);
    assert.match(src, /chatTransport: _agentBudget\.transport/);
    assert.match(src, /source: "chat_budget"/);
    const route = readFileSync(path.join(HERE, "../routes/chat.js"), "utf8");
    assert.match(route, /chatTurnStartedAt: _turnStartedAt/);
    const domain = readFileSync(path.join(HERE, "../domains/chat-agent.js"), "utf8");
    assert.match(domain, /deadlineMs: Number\(input\.deadlineMs\)/);
    const budget = readFileSync(path.join(HERE, "../lib/chat/gen-budget.js"), "utf8");
    assert.match(budget, /STREAM_TURN_BUDGET_MS = 120_000/);
  });
});
