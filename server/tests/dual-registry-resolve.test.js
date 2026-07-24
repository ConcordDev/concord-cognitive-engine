// server/tests/dual-registry-resolve.test.js
//
// Pins resolveDualRegistry — the shared "prefer LENS_ACTIONS, then MACROS"
// resolution helper now used by both server.js's runMcpTool (MCP server +
// /api/lens/run) and server/lib/chat-agent.js's run_lens_action tool. See
// docs/CONKAY_TOOL_AUTHORING_SPEC.md's "Corrections to the task's framing"
// section for the reachability gap this closed.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveDualRegistry } from "../lib/dual-registry-resolve.js";

test("resolveDualRegistry resolves via lens_action when the key is present in LENS_ACTIONS", () => {
  const handler = async () => ({ ok: true });
  const lensActions = new Map([["legal.summarize", handler]]);
  const result = resolveDualRegistry("legal", "summarize", { lensActions, runMacro: async () => ({ ok: true, via: "macro" }) });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, handler);
  assert.equal(result.key, "legal.summarize");
});

test("resolveDualRegistry falls back to macro when the key is absent from LENS_ACTIONS but runMacro is a function", () => {
  const lensActions = new Map(); // empty — nothing registered via registerLensAction
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
  assert.equal(result.key, "plugin_demo.compute");
  assert.equal(result.handler, undefined);
});

test("resolveDualRegistry falls back to macro when lensActions itself is missing/invalid but runMacro exists", () => {
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions: null, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
});

test("resolveDualRegistry falls back to macro when lensActions has no .get (malformed injection)", () => {
  const result = resolveDualRegistry("plugin_demo", "compute", { lensActions: {}, runMacro: async () => ({ ok: true }) });
  assert.equal(result.via, "macro");
});

test("resolveDualRegistry reports none when neither registry is usable", () => {
  const result = resolveDualRegistry("ghost", "noop", { lensActions: null, runMacro: null });
  assert.equal(result.via, "none");
  assert.equal(result.key, "ghost.noop");
});

test("resolveDualRegistry reports none when lensActions is empty and runMacro is not a function", () => {
  const result = resolveDualRegistry("ghost", "noop", { lensActions: new Map(), runMacro: undefined });
  assert.equal(result.via, "none");
});

test("resolveDualRegistry prefers lens_action over macro when both could resolve the same key", () => {
  const handler = async () => ({ ok: true, via: "lens_action" });
  const lensActions = new Map([["legal.summarize", handler]]);
  const result = resolveDualRegistry("legal", "summarize", { lensActions, runMacro: async () => ({ ok: true, via: "macro" }) });
  assert.equal(result.via, "lens_action");
  assert.equal(result.handler, handler);
});
