import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { requestStepCall, packetMessages } from "../../lib/cockpit/step-llm.js";
import { fillSchema } from "../../lib/cockpit/call-schema.js";
import { getToolSpec } from "../../lib/cockpit/tool-spec.js";
import { createMockModel, loadMockFromEnv } from "../../lib/cockpit/mock-model.js";

const spec = getToolSpec("web_search");
const packet = (extra = {}) => ({
  presetId: "cockpit.step", goal: "find prices", runGoal: "price a heat pump", evidence: [], prior: [],
  constraints: [], doneWhen: "the tool returns a result", tokenBudgetIn: 2500, estTokens: 0,
  menu: [{ id: "web_search", description: spec.description, inputSchema: spec.inputSchema }],
  ...extra,
});

function fakeChat(replies) {
  const seen = [];
  const fn = async (arg) => { seen.push(arg); const r = replies.shift(); return typeof r === "string" ? { ok: true, text: r, provider: "ollama", model: "m", tokensIn: 10, tokensOut: 5 } : r; };
  fn.seen = seen;
  return fn;
}
const run = (over) => requestStepCall({ db: null, userId: "u1", profile: "local-2b", packet: packet(), deps: { mock: null }, ...over });

test("format transport: pick then fill", async () => {
  const chat = fakeChat(['{"tool":"web_search","why":"x"}', '{"query":"q"}']);
  const r = await run({ deps: { brainChat: chat, mock: null } });
  assert.equal(r.ok, true);
  assert.equal(r.call.tool, "web_search");
  assert.equal(r.call.args.query, "q");
  assert.equal(r.modelCalls, 2);
  assert.ok(chat.seen[0].opts.format.properties.tool.enum.includes("web_search"));
  assert.equal(chat.seen[0].opts.temperature, 0);
});

test("forcedTool skips phase 1", async () => {
  const chat = fakeChat(['{"query":"q"}']);
  const r = await run({ forcedTool: "web_search", deps: { brainChat: chat, mock: null } });
  assert.equal(r.ok, true);
  assert.equal(r.modelCalls, 1);
  assert.deepEqual(chat.seen[0].opts.format, fillSchema(spec));
});

test("empty text is model_empty", async () => {
  const r = await run({ deps: { brainChat: fakeChat([""]), mock: null } });
  assert.equal(r.errorClass, "model_empty");
});
test("unknown tool is model_malformed", async () => {
  const r = await run({ deps: { brainChat: fakeChat(['{"tool":"nope","why":"x"}']), mock: null } });
  assert.equal(r.errorClass, "model_malformed");
});
test("non-JSON is model_malformed", async () => {
  const r = await run({ deps: { brainChat: fakeChat(["not json"]), mock: null } });
  assert.equal(r.errorClass, "model_malformed");
});
test("a timeout error is classed timeout", async () => {
  const r = await run({ deps: { brainChat: fakeChat([{ ok: false, text: "", error: "request timed out" }]), mock: null } });
  assert.equal(r.errorClass, "timeout");
});

test("marker-only profile parses [TOOL_CALL]", async () => {
  const chat = fakeChat(['[TOOL_CALL: {"tool":"web_search","params":{"query":"q"}}]']);
  const r = await run({ profile: "marker-only", deps: { brainChat: chat, mock: null } });
  assert.equal(r.ok, true);
  assert.equal(r.transport, "marker");
  assert.equal(r.call.args.query, "q");
});

test("native profile maps the safe name back", async () => {
  const chat = fakeChat([{ ok: true, text: "", toolCalls: [{ id: "1", name: "web_search", args: { query: "q" } }] }]);
  const r = await run({ profile: "byo-openai", deps: { brainChat: chat, mock: null } });
  assert.equal(r.ok, true);
  assert.equal(r.transport, "native");
  assert.equal(chat.seen[0].opts.toolChoice, "required");
  assert.equal(chat.seen[0].opts.parallelToolCalls, false);
});

test("mock: replies are consumed in order and the last repeats", async () => {
  const mock = createMockModel({ steps: { "find prices": [{ tool: "web_search", args: { query: "a" } }, { tool: "done", args: { summary: "s" } }] } });
  const a = await requestStepCall({ packet: packet(), deps: { mock } });
  const b = await requestStepCall({ packet: packet(), deps: { mock } });
  const c = await requestStepCall({ packet: packet(), deps: { mock } });
  assert.equal(a.call.tool, "web_search");
  assert.equal(b.call.tool, "done");
  assert.equal(c.call.tool, "done");
  assert.equal(a.transport, "mock");
  assert.equal(mock.calls.length, 3);
});

test("mock fixture file loads outside production", () => {
  const path = fileURLToPath(new URL("./fixtures/mock-basic.json", import.meta.url));
  const m = loadMockFromEnv({ CONCORD_COCKPIT_MOCK_MODEL: path, NODE_ENV: "test" });
  assert.equal(typeof m.next, "function");
});

test("negative control: mock refused in production", () => {
  assert.throws(() => loadMockFromEnv({ CONCORD_COCKPIT_MOCK_MODEL: "/x", NODE_ENV: "production" }), /refused/);
});

test("packetMessages includes Known values and stays small", () => {
  const p = packet({
    evidence: [{ id: "d1", title: "T1", snippet: "s1", source: "dtu" }, { id: "d2", title: "T2", snippet: "s2", source: "dtu" }],
    prior: [{ stepId: "s0", goal: "size beam", values: { width: 40, unit: "mm" } }],
  });
  const msgs = packetMessages(p);
  assert.equal(msgs.length, 2);
  assert.ok(msgs[1].content.includes("Known values:"));
  assert.ok(msgs.map((m) => m.content).join("").length < 2500 * 4);
});
