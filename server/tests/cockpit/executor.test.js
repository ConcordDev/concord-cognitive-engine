import test from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./_helpers.js";
import { runTool, toAgentCall } from "../../lib/cockpit/executor.js";

const run = { id: "run_t", userId: "u1", chatSessionId: null, surface: "chat", budget: { stepWallMs: 50 } };
const step = { id: "stp_1" };

test("toAgentCall: lens id and plain id", () => {
  assert.deepEqual(toAgentCall({ tool: "lens:tasks.task-add", args: { title: "x" } }),
    { tool: "run_lens_action", params: { domain: "tasks", action: "task-add", params: { title: "x" } } });
  assert.deepEqual(toAgentCall({ tool: "web_search", args: { query: "q" } }), { tool: "web_search", params: { query: "q" } });
});

test("a success returns the result and no error", async () => {
  const r = await runTool({ db: memDb(), run: { ...run, budget: { stepWallMs: 5000 } }, step, call: { tool: "web_search", args: { query: "q" } }, deps: { exec: async () => ({ ok: true, result: { a: 1 } }) } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { a: 1 });
  assert.equal(r.errorClass, null);
});

test("an exec that never resolves times out", async () => {
  const r = await runTool({ db: memDb(), run, step, call: { tool: "web_search", args: { query: "q" } }, deps: { exec: () => new Promise(() => {}) } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "timeout");
});

test("a throwing exec becomes tool_error", async () => {
  const r = await runTool({ db: memDb(), run: { ...run, budget: { stepWallMs: 5000 } }, step, call: { tool: "web_search", args: { query: "q" } }, deps: { exec: async () => { throw new Error("boom"); } } });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, "tool_error");
});

test("tool names are scrubbed from the error text", async () => {
  const r = await runTool({ db: memDb(), run: { ...run, budget: { stepWallMs: 5000 } }, step, call: { tool: "conkay_design", args: { text: "x" } }, deps: { exec: async () => ({ ok: false, error: "conkay_design failed" }) } });
  assert.ok(!r.error.includes("conkay_design"));
});

test("an unknown tool is refused without calling exec", async () => {
  let called = false;
  const r = await runTool({ db: memDb(), run, step, call: { tool: "nope", args: {} }, deps: { exec: async () => { called = true; return { ok: true }; } } });
  assert.equal(r.errorClass, "unknown_tool");
  assert.equal(called, false);
});
