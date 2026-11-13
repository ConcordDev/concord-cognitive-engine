import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_TOOL_NAMES, TOOL_REQUIRED_PARAMS } from "../../lib/chat-agent.js";
import { AGENT_TOOL_SPECS } from "../../lib/cockpit/agent-tool-specs.js";
import { getToolSpec, resolveLensRisk, cockpitAgentToolIds, parseLensToolId } from "../../lib/cockpit/tool-spec.js";

test("every spec key is a real agent tool", () => {
  for (const id of Object.keys(AGENT_TOOL_SPECS)) assert.ok(AGENT_TOOL_NAMES.includes(id), id);
  assert.equal(cockpitAgentToolIds().length, 20);
});

test("required keys match TOOL_REQUIRED_PARAMS as sets", () => {
  for (const [id, s] of Object.entries(AGENT_TOOL_SPECS)) {
    const want = new Set(TOOL_REQUIRED_PARAMS[id] || []);
    const got = new Set(s.inputSchema.required);
    assert.deepEqual([...got].sort(), [...want].sort(), id);
  }
});

test("every agent spec is strict, plain-titled, and short", () => {
  for (const [id, s] of Object.entries(AGENT_TOOL_SPECS)) {
    assert.equal(s.inputSchema.additionalProperties, false, id);
    assert.ok(!s.title.includes("_"), id);
    assert.ok(s.description.length <= 160, id);
  }
});

test("every fallback is itself a spec", () => {
  for (const [id, s] of Object.entries(AGENT_TOOL_SPECS)) {
    for (const f of s.fallbacks) assert.ok(AGENT_TOOL_SPECS[f], `${id} -> ${f}`);
  }
});

test("unknown id is null", () => {
  assert.equal(getToolSpec("nope"), null);
});

test("lens spec for a registered action", () => {
  const s = getToolSpec("lens:physics.power", { lensActions: new Map([["physics.power", () => {}]]) });
  assert.equal(s.id, "lens:physics.power");
  assert.equal(s.risk, "compute");
});

test("lens risk classification", () => {
  assert.equal(resolveLensRisk("billing", "pay-invoice"), "high");
  assert.equal(resolveLensRisk("tasks", "task-add"), "write");
  assert.equal(resolveLensRisk("tasks", "list"), "read");
});

test("negative control: a lens action that is not registered is null", () => {
  assert.equal(getToolSpec("lens:physics.nope", { lensActions: new Map() }), null);
});

test("parseLensToolId", () => {
  assert.deepEqual(parseLensToolId("lens:a.b-c"), { domain: "a", action: "b-c" });
  assert.equal(parseLensToolId("web_search"), null);
});
