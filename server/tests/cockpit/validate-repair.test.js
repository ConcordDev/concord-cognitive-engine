import test from "node:test";
import assert from "node:assert/strict";
import { validateAndRepair } from "../../lib/cockpit/validate-repair.js";
import { getToolSpec, cockpitAgentToolIds } from "../../lib/cockpit/tool-spec.js";
import { executeToolCall } from "../../lib/chat-agent.js";

const ctx = (extra = {}) => ({ menuIds: cockpitAgentToolIds(), getSpec: getToolSpec, ...extra });
const kinds = (r) => r.repairs.map((x) => x.kind);

test("alias + key normalize", () => {
  const r = validateAndRepair({ tool: "websearch", args: { q: "heat pumps" } }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.call.tool, "web_search");
  assert.deepEqual(r.call.args, { query: "heat pumps" });
  assert.ok(kinds(r).includes("alias") && kinds(r).includes("key_normalize"));
});
test("fuzzy name", () => {
  const r = validateAndRepair({ tool: "web_serach", args: { query: "x" } }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.call.tool, "web_search");
  assert.ok(kinds(r).includes("fuzzy_name"));
});
test("coerce string to integer", () => {
  const r = validateAndRepair({ tool: "web_search", args: { query: "x", limit: "5" } }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.call.args.limit, 5);
  assert.ok(kinds(r).includes("coerce"));
});
test("run_compute expression becomes input.expression", () => {
  const r = validateAndRepair({ tool: "run_compute", args: { key: "symbolic.evaluate", expression: "2+2" } }, ctx());
  assert.equal(r.ok, true);
  assert.deepEqual(r.call.args.input, { expression: "2+2" });
});
test("default from a prior value", () => {
  const r = validateAndRepair({ tool: "web_search", args: {} }, ctx({ prior: [{ values: { query: "beam sizing" } }] }));
  assert.equal(r.ok, true);
  assert.equal(r.call.args.query, "beam sizing");
  assert.ok(kinds(r).includes("default"));
});
test("missing required with no default fails with a reask", () => {
  const r = validateAndRepair({ tool: "web_search", args: {} }, ctx());
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === "query" && e.code === "missing"));
  assert.ok(r.reask.includes("query"));
});
test("unknown tool lists allowed", () => {
  const r = validateAndRepair({ tool: "dila_status", args: {} }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, "tool");
  assert.equal(r.errors[0].code, "enum");
  assert.ok(r.errors[0].allowed.includes("web_search"));
});
test("model-written approval is stripped", () => {
  const r = validateAndRepair({ tool: "run_lens_action", args: { domain: "tasks", action: "task-add", approval: true, params: { title: "x", approval: true } } }, ctx());
  assert.equal(r.ok, true);
  assert.equal("approval" in r.call.args, false);
  assert.equal("approval" in r.call.args.params, false);
});
test("enum violation reports allowed values", () => {
  const r = validateAndRepair({ tool: "get_live_data", args: { kind: "stocks" } }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "enum");
  assert.deepEqual(r.errors[0].allowed, ["compound", "fx"]);
});
test("negative control: an already-valid call is untouched", () => {
  const r = validateAndRepair({ tool: "create_dtu", args: { title: "A" } }, ctx());
  assert.equal(r.ok, true);
  assert.equal(r.repairs.length, 0);
  assert.deepEqual(r.call.args, { title: "A" });
});

test("executeToolCall wiring follows the REPAIR flag", async () => {
  process.env.CONCORD_COCKPIT_REPAIR = "1";
  try {
    const on = await executeToolCall({}, null, new Map(), { tool: "get_live_data", params: { kind: "stocks" } });
    assert.equal(on.ok, false);
    assert.equal(on.errors[0].code, "enum");
  } finally { process.env.CONCORD_COCKPIT_REPAIR = "0"; }
  try {
    const off = await executeToolCall({}, null, new Map(), { tool: "get_live_data", params: { kind: "stocks" } }).catch(() => ({}));
    assert.equal(Array.isArray(off.errors), false);
  } finally { delete process.env.CONCORD_COCKPIT_REPAIR; }
});
