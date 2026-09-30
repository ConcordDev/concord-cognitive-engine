// server/tests/inference/agent-loop.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../../lib/inference/agent-loop.js";

function makeBrain(responses) {
  let i = 0;
  return {
    name: "mock",
    model: "mock-model",
    chat: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

const BASE_MESSAGES = [{ role: "user", content: "test" }];

describe("@concord/inference — Agent Loop", () => {
  it("returns finalText when no tool calls", async () => {
    const brain = makeBrain([{ ok: true, text: "hello world", toolCalls: [], tokensIn: 10, tokensOut: 20 }]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], {});
    assert.equal(r.finalText, "hello world");
    assert.deepEqual(r.toolCalls, []);
    assert.equal(r.steps.length, 1);
    assert.equal(r.steps[0].type, "inference");
  });

  it("dispatches tool calls and reinjects result", async () => {
    const brain = makeBrain([
      { ok: true, text: "calling tool", toolCalls: [{ id: "tc1", name: "test_tool", args: { x: 1 } }], tokensIn: 5, tokensOut: 10 },
      { ok: true, text: "done after tool", toolCalls: [], tokensIn: 5, tokensOut: 8 },
    ]);

    let dispatched = false;
    const dispatchCtx = {
      dispatch: async (name, args) => { dispatched = true; return `result of ${name}`; },
    };

    const r = await runAgentLoop(brain, BASE_MESSAGES, [], { dispatchCtx });
    assert.ok(dispatched, "Tool should have been dispatched");
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.toolCalls[0].name, "test_tool");
    assert.equal(r.finalText, "done after tool");
    assert.ok(r.steps.some(s => s.type === "tool_call"), "Should have a tool_call step");
  });

  it("respects maxSteps limit", async () => {
    const brain = makeBrain([
      { ok: true, text: "x", toolCalls: [{ id: "t1", name: "loop", args: {} }], tokensIn: 1, tokensOut: 1 },
    ]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], { maxSteps: 3 });
    assert.equal(r.terminated, "max_steps");
  });

  it("stops on text_contains stop condition", async () => {
    const brain = makeBrain([{ ok: true, text: "the answer is STOP here", toolCalls: [], tokensIn: 5, tokensOut: 10 }]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], {
      stopWhen: { type: "text_contains", value: "STOP" },
    });
    assert.equal(r.finalText, "the answer is STOP here");
    assert.ok(!r.terminated);
  });

  it("stops on tool_called stop condition", async () => {
    const brain = makeBrain([
      { ok: true, text: "calling", toolCalls: [{ id: "t1", name: "finish_tool", args: {} }], tokensIn: 5, tokensOut: 5 },
      { ok: true, text: "more work", toolCalls: [], tokensIn: 5, tokensOut: 5 },
    ]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], {
      stopWhen: { type: "tool_called", value: "finish_tool" },
    });
    assert.equal(r.toolCalls[0].name, "finish_tool");
  });

  it("handles brain error gracefully", async () => {
    const brain = makeBrain([{ ok: false, text: "", toolCalls: [], tokensIn: 0, tokensOut: 0, error: "brain_down" }]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], {});
    assert.equal(r.terminated, "brain_error");
    // The error must never pose as the model's answer.
    assert.equal(r.finalText, "");
    assert.equal(r.error, "brain_down");
  });

  it("accumulates tokensIn and tokensOut across steps", async () => {
    const brain = makeBrain([
      { ok: true, text: "step 1", toolCalls: [{ id: "t1", name: "tool", args: {} }], tokensIn: 10, tokensOut: 20 },
      { ok: true, text: "step 2", toolCalls: [], tokensIn: 5, tokensOut: 8 },
    ]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], {});
    assert.equal(r.tokensIn, 15);
    assert.equal(r.tokensOut, 28);
  });

  it("aborts when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const brain = makeBrain([{ ok: true, text: "never", toolCalls: [], tokensIn: 0, tokensOut: 0 }]);
    const r = await runAgentLoop(brain, BASE_MESSAGES, [], { signal: controller.signal });
    assert.equal(r.terminated, "aborted");
  });
});
