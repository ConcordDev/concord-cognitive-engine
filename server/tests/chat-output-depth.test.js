// chat-output-depth 2026-10-18
// Pin token budgets, timeouts, multi-call agent turns, deepen nudge,
// mixed-batch follow-up policy, and evidence-is-thin logic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveChatMaxTokens,
  resolveAgentMaxTokens,
  resolveChatTimeoutMs,
  resolveAgentMaxTurns,
  resolveAgentMaxCallsPerTurn,
  resolveAgentMaxToolCalls,
} from "../lib/chat-reply-policy.js";
import { shouldSkipToolFollowup } from "../lib/chat/tool-turn-reply.js";
import { runAgentLoop, evidenceIsThin, DEEPEN_NUDGE } from "../lib/chat-agent.js";

function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("chat-reply-policy token and timeout helpers", () => {
  it("resolveChatMaxTokens uses new defaults and ceiling", () => {
    withEnv({}, () => {
      assert.equal(resolveChatMaxTokens({ verbosity: 0.5 }), 4096);
      assert.equal(resolveChatMaxTokens({ env: "20000", verbosity: 0.5 }), 16384);
      assert.equal(resolveChatMaxTokens({ verbosity: 1 }), 5734); // 4096 * (0.6 + 0.8)
    });
  });

  it("resolveAgentMaxTokens respects agent env and clamps", () => {
    assert.equal(resolveAgentMaxTokens({ env: {} }), 4096);
    assert.equal(resolveAgentMaxTokens({ env: { CONCORD_AGENT_MAX_TOKENS: "100" } }), 512);
  });

  it("resolveChatTimeoutMs scales by token budget and honors explicit env", () => {
    assert.equal(resolveChatTimeoutMs(4096, { env: {} }), 439600);
    assert.equal(resolveChatTimeoutMs(500, { env: {} }), 120000);
    assert.equal(resolveChatTimeoutMs(4096, { env: { CONCORD_CHAT_LLM_TIMEOUT_MS: "200000" } }), 200000);
    assert.equal(resolveChatTimeoutMs(999999, { env: {} }), 900000);
  });

  it("resolveAgentMaxTurns defaults, clamps requested, and honors ceiling env", () => {
    assert.equal(resolveAgentMaxTurns({ env: {} }), 8);
    assert.equal(resolveAgentMaxTurns({ requested: 100, env: {} }), 12);
    assert.equal(resolveAgentMaxTurns({ requested: 3, env: {} }), 3);
    assert.equal(resolveAgentMaxTurns({ requested: 15, env: { CONCORD_AGENT_MAX_TURNS_CEILING: "20" } }), 15);
  });

  it("resolveAgentMaxCallsPerTurn and resolveAgentMaxToolCalls use defaults", () => {
    assert.equal(resolveAgentMaxCallsPerTurn({ env: {} }), 6);
    assert.equal(resolveAgentMaxToolCalls({ env: {} }), 24);
  });
});

describe("shouldSkipToolFollowup mixed-batch policy", () => {
  it("mixed ok+failed does not skip follow-up", () => {
    assert.equal(shouldSkipToolFollowup([
      { tool: "web_search", ok: true },
      { tool: "browse_url", ok: false, error: "blocked" },
    ], { allowRetry: false }), false);
  });

  it("all-failed non-retryable skips follow-up", () => {
    assert.equal(shouldSkipToolFollowup([
      { tool: "web_search", ok: false, error: "blocked" },
    ], { allowRetry: false }), true);
  });

  it("create_dtu ok + web_search failed still skips", () => {
    assert.equal(shouldSkipToolFollowup([
      { tool: "create_dtu", ok: true, dtuId: "d1" },
      { tool: "web_search", ok: false, error: "blocked" },
    ], { allowRetry: false }), true);
  });

  it("create_dtu-only batch skips follow-up", () => {
    assert.equal(shouldSkipToolFollowup([
      { tool: "create_dtu", ok: true, dtuId: "d1" },
    ]), true);
  });
});

describe("evidenceIsThin deepen gate", () => {
  it("empty tool calls are not thin", () => {
    assert.equal(evidenceIsThin([]), false);
  });

  it("non-research tool calls are not thin", () => {
    assert.equal(evidenceIsThin([{ tool: "run_compute", ok: true, result: "4" }]), false);
  });

  it("single short web_search with no urls is thin", () => {
    assert.equal(evidenceIsThin([{ tool: "web_search", ok: true, result: "short" }]), true);
  });

  it("two ok web_search calls with urls are enough evidence", () => {
    assert.equal(evidenceIsThin([
      { tool: "web_search", ok: true, result: "https://a.com article one" },
      { tool: "web_search", ok: true, result: "https://b.com article two" },
    ]), false);
  });

  it("one long web_search with a url is enough evidence", () => {
    const text = "https://a.com " + "word ".repeat(900);
    assert.equal(evidenceIsThin([{ tool: "web_search", ok: true, result: text }]), false);
  });
});

describe("runAgentLoop depth/cap behavior", () => {
  it("executes all tool calls in a multi-call turn and returns the final answer", async () => {
    let brainCalls = 0;
    const runMacro = async (domain, name, input) => {
      if (domain === "expert_mode" && name === "web_search") {
        return { ok: true, summary: `answer for ${input.query}`, results: [{ title: "T", url: "https://x.com", snippet: "s" }] };
      }
      return { ok: false, error: "unexpected" };
    };
    const brain = async ({ messages }) => {
      brainCalls += 1;
      if (brainCalls === 1) {
        return {
          ok: true, provider: "test", model: "test-model",
          text: `Plan:\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "a"}}]\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "b"}}]\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "c"}}]`,
        };
      }
      return { ok: true, provider: "test", model: "test-model", text: "final answer after three searches" };
    };

    const r = await runAgentLoop({
      db: null, userId: "u1", message: "research a b c",
      runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 3, brainChat: brain },
    });

    assert.equal(r.ok, true);
    assert.equal(r.answer, "final answer after three searches");
    assert.equal(r.toolCalls.length, 3);
  });

  it("sends DEEPEN_NUDGE when evidence is thin", async () => {
    let brainCalls = 0;
    let deepenSeen = false;
    const runMacro = async (domain, name, input) => {
      if (domain === "expert_mode" && name === "web_search") {
        return { ok: true, summary: "nothing", results: [] };
      }
      return { ok: false, error: "unexpected" };
    };
    const brain = async ({ messages }) => {
      brainCalls += 1;
      if (messages.some((m) => m.content === DEEPEN_NUDGE)) deepenSeen = true;
      if (brainCalls === 1) {
        return {
          ok: true, provider: "test", model: "test-model",
          text: `[TOOL_CALL: {"tool": "web_search", "params": {"query": "x"}}]`,
        };
      }
      if (brainCalls === 2) {
        return { ok: true, provider: "test", model: "test-model", text: "I think the answer is X." };
      }
      return { ok: true, provider: "test", model: "test-model", text: "final answer after deepening" };
    };

    const r = await runAgentLoop({
      db: null, userId: "u1", message: "what about x",
      runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 5, brainChat: brain },
    });

    assert.equal(deepenSeen, true);
    assert.equal(r.answer, "final answer after deepening");
  });

  it("passes maxTokens 4096 and a timeout >= 120000 to the brain", async () => {
    let seenOpts = null;
    const brain = async ({ opts }) => {
      seenOpts = opts;
      return { ok: true, provider: "test", model: "test-model", text: "ok" };
    };

    await runAgentLoop({
      db: null, userId: "u1", message: "hi",
      runMacro: async () => ({ ok: true }),
      lensActions: new Map(), history: [],
      opts: { brainChat: brain },
    });

    assert.equal(seenOpts.maxTokens, 4096);
    assert.ok(seenOpts.timeoutMs >= 120000);
  });

  it("honors total tool-call budget and triggers wrap-up", async () => {
    const prevMaxToolCalls = process.env.CONCORD_AGENT_MAX_TOOL_CALLS;
    process.env.CONCORD_AGENT_MAX_TOOL_CALLS = "2";
    try {
      let brainCalls = 0;
      let wrapUpSeen = false;
      const runMacro = async (domain, name, input) => {
        if (domain === "expert_mode" && name === "web_search") {
          return { ok: true, summary: `r ${input.query}`, results: [{ title: "T", url: "https://x.com", snippet: "s" }] };
        }
        return { ok: false, error: "unexpected" };
      };
      const brain = async ({ messages }) => {
        brainCalls += 1;
        const lastMsg = messages[messages.length - 1]?.content || "";
        if (lastMsg.includes("Do not call any more tools")) wrapUpSeen = true;
        return {
          ok: true, provider: "test", model: "test-model",
          text: `Plan:\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "a"}}]\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "b"}}]`,
        };
      };

      const r = await runAgentLoop({
        db: null, userId: "u1", message: "keep searching",
        runMacro, lensActions: new Map(), history: [],
        opts: { maxTurns: 5, brainChat: brain },
      });

      assert.equal(r.ok, true);
      assert.equal(r.toolCalls.length, 2);
      assert.equal(wrapUpSeen, true);
    } finally {
      if (prevMaxToolCalls === undefined) delete process.env.CONCORD_AGENT_MAX_TOOL_CALLS;
      else process.env.CONCORD_AGENT_MAX_TOOL_CALLS = prevMaxToolCalls;
    }
  });
});
