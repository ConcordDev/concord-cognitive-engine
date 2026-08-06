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

test("executeToolCall surfaces a graceful failure when the action is in NEITHER registry", async () => {
  // Real runMacro throws "macro not found: domain.name" for an unregistered
  // pair (server.js:12876) — this fake mirrors that so the test reflects
  // production behavior post-fix (run_lens_action now falls back to
  // runMacro/MACROS, not just LENS_ACTIONS — see the dual-registry test
  // below). A fake that just returns null (the old version of this test)
  // no longer distinguishes "truly not found" from "found via MACROS".
  const fakeRunMacro = async (domain, name) => {
    throw new Error(`macro not found: ${domain}.${name}`);
  };
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_lens_action", params: { domain: "ghost", action: "noop" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
});

test("executeToolCall run_lens_action falls back to runMacro/MACROS when the pair isn't in LENS_ACTIONS (register()-only macro reachability fix)", async () => {
  // This pins the fix for the gap docs/CONKAY_TOOL_AUTHORING_SPEC.md's
  // "Corrections to the task's framing" section found: a macro registered
  // via plain register() (populating MACROS) — including every loaded
  // plugin's macros — was previously UNREACHABLE through this tool because
  // it checked only the injected LENS_ACTIONS map. It's reachable through
  // runMcpTool (server.js) today; this test proves run_lens_action now
  // reaches the same macro the same way.
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input, ctx) => {
    calledWith = { domain, name, input, ctx };
    return { ok: true, echoed: input };
  };
  const ctx = { db: null, actor: { userId: "u1" } };
  const result = await executeToolCall(ctx, fakeRunMacro, new Map(), {
    tool: "run_lens_action",
    params: { domain: "plugin_demo", action: "compute", params: { x: 1 } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.key, "plugin_demo.compute");
  assert.deepEqual(result.result, { ok: true, echoed: { x: 1 } });
  assert.deepEqual(calledWith, { domain: "plugin_demo", name: "compute", input: { x: 1 }, ctx });
});

test("executeToolCall run_lens_action still prefers LENS_ACTIONS over MACROS when both could resolve the pair (no regression vs runMcpTool's precedence)", async () => {
  const lensActions = new Map();
  lensActions.set("legal.summarize", async (_ctx, _u, params) => ({ ok: true, via: "lens_action", summary: params?.text }));
  const fakeRunMacro = async () => ({ ok: true, via: "macro" });
  const result = await executeToolCall({}, fakeRunMacro, lensActions, {
    tool: "run_lens_action",
    params: { domain: "legal", action: "summarize", params: { text: "hi" } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.via, "lens_action");
  assert.equal(result.result.summary, "hi");
});

test("executeToolCall run_lens_action reports lens_actions_unavailable only when NEITHER registry is usable", async () => {
  const result = await executeToolCall({}, null, null, {
    tool: "run_lens_action", params: { domain: "ghost", action: "noop" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "lens_actions_unavailable");
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

test("run_python delegates to code.exec with language:python", async () => {
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input) => {
    calledWith = { domain, name, input };
    return { ok: true, result: { stdout: "hi\n", stderr: "", exitCode: 0, returnValue: "42" } };
  };
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "print('hi')\n42" },
  });
  assert.equal(result.ok, true);
  assert.equal(calledWith.domain, "code");
  assert.equal(calledWith.name, "exec");
  assert.equal(calledWith.input.language, "python");
  assert.equal(calledWith.input.code, "print('hi')\n42");
  assert.equal(result.stdout, "hi\n");
  assert.equal(result.returnValue, "42");
});

test("run_python requires non-empty code", async () => {
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "run_python", params: { code: "" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /non-empty code/);
});

test("run_python surfaces a real execution failure honestly, including stderr", async () => {
  const fakeRunMacro = async () => ({
    ok: false, error: "python_exec_failed",
    result: { stdout: "", stderr: "ZeroDivisionError: division by zero", exitCode: 1 },
  });
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "1/0" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "python_exec_failed");
  assert.match(result.stderr, /ZeroDivisionError/);
});

test("run_python respects the code_exec/python_exec_disabled kill-switch response", async () => {
  const fakeRunMacro = async () => ({
    ok: false, error: "python_exec_disabled",
    result: { supported: false, stdout: "", stderr: "Live Python execution is disabled in this environment.", exitCode: -1 },
  });
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "print(1)" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "python_exec_disabled");
});

test("run_python passes the packages param through to code.exec", async () => {
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input) => {
    calledWith = { domain, name, input };
    return { ok: true, result: { stdout: "", stderr: "", exitCode: 0, returnValue: null, images: [] } };
  };
  await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "import numpy as np", packages: ["numpy"] },
  });
  assert.deepEqual(calledWith.input.packages, ["numpy"]);
});

test("run_python defaults to an empty packages array when the brain omits it", async () => {
  let calledWith = null;
  const fakeRunMacro = async (domain, name, input) => {
    calledWith = { domain, name, input };
    return { ok: true, result: { stdout: "hi", stderr: "", exitCode: 0, returnValue: null, images: [] } };
  };
  await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "print('hi')" },
  });
  assert.deepEqual(calledWith.input.packages, []);
});

test("run_python surfaces a python_package_not_vendored failure with the missing list intact (no fabricated success)", async () => {
  const fakeRunMacro = async () => ({
    ok: false, error: "python_package_not_vendored",
    result: { supported: true, stdout: "", stderr: "Package(s) not vendored: numpy.", exitCode: -1, missing: ["numpy"] },
  });
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "import numpy", packages: ["numpy"] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "python_package_not_vendored");
  assert.deepEqual(result.missing, ["numpy"]);
});

test("run_python turns matplotlib figures into real image artifacts, never inlining the base64 bytes into the text the brain reads back", async () => {
  const fakeRunMacro = async () => ({
    ok: true,
    result: {
      stdout: "", stderr: "", exitCode: 0, returnValue: null,
      images: [{ mime: "image/png", dataB64: "AAAA" }, { mime: "image/png", dataB64: "BBBB" }],
    },
  });
  const result = await executeToolCall({}, fakeRunMacro, new Map(), {
    tool: "run_python", params: { code: "plt.plot([1,2,3]); plt.show()", packages: ["matplotlib"] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.imageCount, 2);
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.artifacts[0].kind, "image");
  assert.equal(result.artifacts[0].image_b64, "AAAA");
  assert.ok(!JSON.stringify({ stdout: result.stdout, stderr: result.stderr }).includes("AAAA"), "base64 bytes must not leak into the text fields the brain re-reads");
});

test("formatToolResults tells the brain figures were generated without leaking base64 into the prompt text", () => {
  const rendered = formatToolResults([
    { tool: "run_python", ok: true, stdout: "", stderr: "", returnValue: null, imageCount: 2 },
  ]);
  assert.match(rendered, /2 figure\(s\) generated/);
  assert.doesNotMatch(rendered, /AAAA|BBBB/);
});

test("formatToolResults renders run_python stdout/stderr/return value", () => {
  const rendered = formatToolResults([
    { tool: "run_python", ok: true, stdout: "hello\n", stderr: "", returnValue: "42" },
  ]);
  assert.match(rendered, /\[TOOL_RESULT: run_python\]/);
  assert.match(rendered, /stdout:\nhello/);
  assert.match(rendered, /return value: 42/);
});

test("mcp_connect requires serverId and url", async () => {
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "mcp_connect", params: { serverId: "", url: "" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /requires serverId and url/);
});

test("mcp_connect is SSRF-guarded — a loopback URL is blocked via the real mcp-bridge.js chokepoint (no mocking)", async () => {
  // Deliberately calls through the REAL mcp-bridge.js (this case does a raw
  // dynamic import, same as the pre-existing mcp_call/mcp_list cases) so
  // this pins the actual security boundary, not a stand-in.
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "mcp_connect", params: { serverId: "t-agent-loopback", url: "http://127.0.0.1:1/mcp" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /private|reserved|blocked|invalid/i);
});

test("mcp_connect always dispatches as kind='http' — a brain-supplied kind:'stdio' has zero effect (no subprocess is ever spawned from this tool)", async () => {
  // If this case honored an attacker/brain-supplied `kind`, this call would
  // try to spawn `command` as a local subprocess. Since the case hardcodes
  // kind:"http" regardless of params, it hits the SSRF guard on `url`
  // instead — proving `kind` and `command` are ignored.
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "mcp_connect",
    params: { serverId: "t-agent-stdio-attempt", url: "http://127.0.0.1:1/mcp", kind: "stdio", command: "/bin/true" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /private|reserved|blocked|invalid/i);
});

test("formatToolResults renders mcp_connect success with server id + tool count", () => {
  const rendered = formatToolResults([
    { tool: "mcp_connect", ok: true, serverId: "github", toolCount: 2, tools: [{ name: "read_file" }, { name: "list_prs" }] },
  ]);
  assert.match(rendered, /\[TOOL_RESULT: mcp_connect github\]/);
  assert.match(rendered, /Connected/);
  assert.match(rendered, /read_file, list_prs/);
});

test("browse_url rejects non-http URLs", async () => {
  // Use a non-http scheme that isn't in the eslint script-url denylist.
  const result = await executeToolCall({}, () => null, new Map(), {
    tool: "browse_url", params: { url: "ftp://example.com/file" },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /valid http/);
});
