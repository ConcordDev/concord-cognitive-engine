// "It keeps saying lens.action undefined when trying to use lens tools."
// Two sources: (1) tool cards labelled `${params.domain}.${params.action}`
// from records that keep domain/action at the top level or (after a reload)
// not at all, which renders "Lens Action undefined.undefined"; (2) model
// tool calls that put the lens/action under other keys, a combined
// "domain.action" string, or JSON-string arguments, so domain/action resolved
// to nothing. Both are covered here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeToolCall, normalizeLensActionParams, normalizeCallParams, lensActionLabel, persistToolCall,
} from "../lib/chat/tool-call-normalize.js";
import { parseToolCalls, executeToolCall, AGENT_TOOL_NAMES } from "../lib/chat-agent.js";

const canon = (p) => { const n = normalizeLensActionParams(p); return [n.domain, n.action, n.params]; };

test("aliased lens/action keys map onto domain/action", () => {
  assert.deepEqual(canon({ lens: "Fitness", actionName: "plan-create", params: { name: "x" } }), ["fitness", "plan-create", { name: "x" }]);
  assert.deepEqual(canon({ lensId: "realestate", action_name: "cap-rate" }), ["realestate", "cap-rate", {}]);
  assert.deepEqual(canon({ domain: "fitness lens", macro: "plan-list" }), ["fitness", "plan-list", {}]);
});

test("a combined 'domain.action' string is split wherever it appears", () => {
  assert.deepEqual(canon({ action: "fitness.plan-create" }), ["fitness", "plan-create", {}]);
  assert.deepEqual(canon({ domain: "fitness.plan-create" }), ["fitness", "plan-create", {}]);
  assert.deepEqual(canon({ key: "fitness.workout-plan-generate" }), ["fitness", "workout-plan-generate", {}]);
  assert.deepEqual(canon({ domain: "fitness", action: "fitness.plan-list" }), ["fitness", "plan-list", {}]);
});

test("JSON-string params/arguments and flat inputs are accepted", () => {
  assert.deepEqual(canon('{"domain":"a","action":"b","params":{"n":1}}'), ["a", "b", { n: 1 }]);
  assert.deepEqual(canon({ domain: "fitness", action: "plan-create", params: '{"name":"y"}' }), ["fitness", "plan-create", { name: "y" }]);
  assert.deepEqual(canon({ arguments: '{"domain":"fitness","action":"plan-create"}' }), ["fitness", "plan-create", {}]);
  assert.deepEqual(canon({ domain: "realestate", action: "cap-rate", noi: 120000, value: 1500000, name: "Main St" }),
    ["realestate", "cap-rate", { noi: 120000, value: 1500000, name: "Main St" }]);
  assert.deepEqual(canon({ domain: "fitness", action: "plan-create", input: { name: "z" } }), ["fitness", "plan-create", { name: "z" }]);
  assert.deepEqual(normalizeCallParams({ tool: "x", arguments: '{"q":1}' }), { q: 1 });
  assert.deepEqual(normalizeCallParams({ tool: "x", domain: "a", action: "b" }), { domain: "a", action: "b" });
});

test("lens tool aliases and a dotted tool name become run_lens_action", () => {
  const a = normalizeToolCall({ tool: "lens.action", params: { lens: "fitness", action: "plan-list" } }, AGENT_TOOL_NAMES);
  assert.equal(a.tool, "run_lens_action");
  assert.equal(a.params.domain, "fitness");
  const b = normalizeToolCall({ tool: "fitness.plan-create", params: { name: "Leg day" } }, AGENT_TOOL_NAMES);
  assert.deepEqual([b.tool, b.params.domain, b.params.action, b.params.params], ["run_lens_action", "fitness", "plan-create", { name: "Leg day" }]);
  const c = normalizeToolCall({ tool: "web_search", params: { query: "q" } }, AGENT_TOOL_NAMES);
  assert.deepEqual(c, { tool: "web_search", params: { query: "q" } }, "other tools are untouched");
});

test("parseToolCalls reads arguments strings and bare top-level params", () => {
  const [a] = parseToolCalls('[TOOL_CALL: {"tool": "run_lens_action", "arguments": "{\\"lens\\":\\"fitness\\",\\"actionName\\":\\"plan-list\\"}"}]');
  assert.deepEqual([a.tool, a.params.domain, a.params.action], ["run_lens_action", "fitness", "plan-list"]);
  const [b] = parseToolCalls('[TOOL_CALL: {"tool": "run_lens_action", "domain": "fitness", "action": "plan-list"}]');
  assert.deepEqual([b.params.domain, b.params.action], ["fitness", "plan-list"]);
});

test("an aliased call reaches the real lens handler", async () => {
  const seen = [];
  const lensActions = new Map([["fitness.plan-list", (ctx, _a, params) => { seen.push(params); return { ok: true, result: { plans: [] } }; }]]);
  const r = await executeToolCall({ actor: { userId: "u1", role: "member" } }, async () => ({ ok: false, error: "no macro" }), lensActions,
    { tool: "run_lens_action", params: { lens: "fitness", actionName: "plan-list", input: { limit: 3 } } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.domain, "fitness");
  assert.equal(r.action, "plan-list");
  assert.deepEqual(seen[0], { limit: 3 });
});

test("a call with no lens or action names the missing fields, never 'undefined'", async () => {
  const r = await executeToolCall({}, async () => ({}), new Map(), { tool: "run_lens_action", params: { foo: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.error, /missing "domain" \(the lens/);
  assert.match(r.error, /"action"/);
  assert.match(r.error, /find_lens_actions/);
  assert.ok(!/undefined/.test(r.error + r.retryHint));
});

test("saved tool-call records keep the lens label, so a reloaded card never reads undefined.undefined", () => {
  const executed = { tool: "run_lens_action", ok: true, key: "fitness.workout-plan-generate", domain: "fitness", action: "workout-plan-generate", result: { big: "x".repeat(5000) } };
  const saved = persistToolCall(executed);
  assert.deepEqual(saved.params, { domain: "fitness", action: "workout-plan-generate" });
  assert.equal(saved.result, undefined, "results are not persisted");
  assert.equal(lensActionLabel(saved), "fitness.workout-plan-generate");
  assert.equal(lensActionLabel(persistToolCall({ tool: "run_lens_action", ok: false, error: "x" })), "");
  assert.deepEqual(persistToolCall({ tool: "web_search", ok: true, params: { query: "cap rate" } }).params, { query: "cap rate" });
  assert.ok(!JSON.stringify(persistToolCall({ tool: "run_lens_action", ok: false })).includes("undefined"));
});
