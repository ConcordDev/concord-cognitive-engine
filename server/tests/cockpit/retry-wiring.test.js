import test from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../../lib/chat-agent.js";

function fakes() {
  let brainCalls = 0;
  const brain = async () => {
    brainCalls += 1;
    return brainCalls === 1
      ? { ok: true, text: 'Looking.\n[TOOL_CALL: {"tool":"web_search","params":{"query":"x"}}]', provider: "test", model: "test-model" }
      : { ok: true, text: "Here is the plain answer.", provider: "test", model: "test-model" };
  };
  let searches = 0;
  const runMacro = async (domain, name) => {
    if (domain === "expert_mode" && name === "web_search") {
      searches += 1;
      return searches === 1 ? { ok: false, reason: "HTTP 503" } : { ok: true, results: [{ title: "t", url: "http://a.test", snippet: "s" }] };
    }
    return { ok: true };
  };
  return { brain, runMacro, searches: () => searches };
}

test("with RETRY on, a 503 is retried in place and the turn answers", async () => {
  process.env.CONCORD_COCKPIT_RETRY = "1";
  try {
    const f = fakes();
    const r = await runAgentLoop({
      db: null, userId: "u1", message: "search x", runMacro: f.runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 3, brainChat: f.brain, shadowContext: false, memory: false, actionMemory: false },
    });
    assert.equal(r.ok, true);
    assert.equal(r.answer, "Here is the plain answer.");
    assert.equal(r.toolCalls[0].ok, true);
    assert.equal(f.searches(), 2);
  } finally { delete process.env.CONCORD_COCKPIT_RETRY; }
});
