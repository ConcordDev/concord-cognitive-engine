// server/tests/chat-agent.test.js
//
// Sprint 11A acceptance — agent loop logic.
//
// We can't actually call live Ollama / external providers in this
// test, so we mock brainChat by stubbing module-level imports the
// way the existing repo tests stub LLM paths. Here we just pin the
// pure logic that doesn't require a brain: parser, stripper,
// formatter, executor.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseToolCalls, stripToolCalls,
  executeToolCall, formatToolResults,
  CHAT_AGENT_CONSTANTS,
} from "../lib/chat-agent.js";

test("parseToolCalls extracts a single tool call", () => {
  const text = `I'll look that up.\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "concord cognitive engine"}}]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "web_search");
  assert.equal(calls[0].params.query, "concord cognitive engine");
});

test("parseToolCalls handles multiple tool calls in one response", () => {
  const text = `[TOOL_CALL: {"tool": "web_search", "params": {"query": "x"}}]\n[TOOL_CALL: {"tool": "run_compute", "params": {"key": "math.solve"}}]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool, "web_search");
  assert.equal(calls[1].tool, "run_compute");
});

test("parseToolCalls skips malformed JSON without throwing", () => {
  const text = `[TOOL_CALL: {not valid json}]\n[TOOL_CALL: {"tool": "ok", "params": {}}]`;
  const calls = parseToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, "ok");
});

test("parseToolCalls returns empty array for plain text", () => {
  assert.deepEqual(parseToolCalls("just a normal answer"), []);
});

test("stripToolCalls removes markers + collapses whitespace", () => {
  const text = `Answer:\n\n[TOOL_CALL: {"tool": "x", "params": {}}]\n\nMore text.`;
  const stripped = stripToolCalls(text);
  assert.ok(!stripped.includes("TOOL_CALL"));
  assert.ok(stripped.includes("Answer"));
  assert.ok(stripped.includes("More text"));
});

test("formatToolResults shapes web_search output", () => {
  const formatted = formatToolResults([{
    tool: "web_search", ok: true, result: "Search result content here",
  }]);
  assert.ok(formatted.includes("[TOOL_RESULT: web_search]"));
  assert.ok(formatted.includes("Search result content here"));
});

test("formatToolResults reports errors clearly", () => {
  const formatted = formatToolResults([{
    tool: "browse_url", ok: false, error: "404 not found",
  }]);
  assert.ok(formatted.includes("Error: 404 not found"));
});

test("executeToolCall handles unknown tool", async () => {
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "made_up_tool", params: {},
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown tool/);
});

test("executeToolCall surfaces unknown lens action gracefully", async () => {
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "run_lens_action", params: { domain: "ghost", action: "noop" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown lens action/);
});

test("executeToolCall invokes a known lens action via the injected map", async () => {
  const lensActions = new Map();
  lensActions.set("legal.summarize", async (_ctx, _u, params) => ({ ok: true, summary: params?.text || "" }));
  const result = await executeToolCall({}, () => null, lensActions, {
    tool: "run_lens_action",
    params: { domain: "legal", action: "summarize", params: { text: "hello" } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.key, "legal.summarize");
  assert.equal(result.result.summary, "hello");
});

test("executeToolCall web_search delegates to runMacro", async () => {
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input) => {
    calledWith = { domain, name, input };
    return { ok: true, summary: "result text" };
  };
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "web_search", params: { query: "test query" },
  });
  assert.equal(result.ok, true);
  assert.equal(calledWith.domain, "tools");
  assert.equal(calledWith.name, "web_search");
  assert.equal(calledWith.input.query, "test query");
});

test("executeToolCall create_dtu surfaces an artifact for inline UI render", async () => {
  const fakeRunMacro = async () => ({ ok: true, id: "dtu_xyz" });
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "create_dtu", params: { title: "My DTU" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifact, { kind: "dtu", id: "dtu_xyz", title: "My DTU" });
});

test("CHAT_AGENT_CONSTANTS exports caps", () => {
  assert.ok(CHAT_AGENT_CONSTANTS.AGENT_MAX_TURNS >= 3);
  assert.ok(CHAT_AGENT_CONSTANTS.MAX_TOOL_RESULT_LEN > 0);
});

test("expert_mode tool delegates to expert_mode.answer macro", async () => {
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input) => {
    calledWith = { domain, name, input };
    return { ok: true, answer: "synthesized answer", sources: [], citationsRecorded: 2 };
  };
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "expert_mode", params: { query: "what is X" },
  });
  assert.equal(result.ok, true);
  assert.equal(calledWith.domain, "expert_mode");
  assert.equal(calledWith.name, "answer");
  assert.equal(result.citationsRecorded, 2);
});

test("run_compute requires module.function key format", async () => {
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "run_compute", params: { key: "no_dot" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /module\.function/);
});

test("browse_url rejects non-http URLs", async () => {
  // Use a non-http scheme that isn't in the eslint script-url denylist.
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "browse_url", params: { url: "ftp://example.com/file" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /valid http/);
});
