import test from "node:test";
import assert from "node:assert/strict";
import { nextAction, runWithRetry, MAX_STEP_ATTEMPTS } from "../../lib/cockpit/retry-policy.js";
import { getToolSpec } from "../../lib/cockpit/tool-spec.js";

const spec = getToolSpec("web_search");
const na = (errorClass, attempt, extra = {}) => nextAction({ errorClass, attempt, required: true, spec, triedTools: [], ...extra });

test("bad_args row", () => {
  assert.equal(na("bad_args", 1).kind, "repair");
  assert.equal(na("bad_args", 2).kind, "reask");
  assert.deepEqual(na("bad_args", 3), { kind: "fallback_tool", tool: "browse_url" });
  assert.equal(na("bad_args", 4).kind, "ask_user");
});
test("external row", () => {
  assert.deepEqual(na("external", 1), { kind: "retry", delayMs: 1000 });
  assert.deepEqual(na("external", 2), { kind: "retry", delayMs: 2000 });
  assert.equal(na("external", 3).kind, "fallback_tool");
  assert.equal(na("external", 4).kind, "ask_user");
});
test("hard_stop and rate_limited never change", () => {
  for (let a = 1; a <= 5; a++) {
    assert.equal(na("hard_stop", a).kind, "stop_run");
    assert.equal(na("rate_limited", a).kind, "pause");
  }
});
test("tool_error row", () => {
  assert.deepEqual(na("tool_error", 1), { kind: "retry", delayMs: 1000 });
  assert.equal(na("tool_error", 2).kind, "fallback_tool");
  assert.equal(na("tool_error", 3).kind, "ask_user");
});
test("past the attempt limit: skip when optional, ask when required", () => {
  assert.equal(MAX_STEP_ATTEMPTS, 4);
  assert.equal(na("bad_args", 5, { required: false }).kind, "skip");
  assert.equal(na("bad_args", 5).kind, "ask_user");
  assert.equal(na("external", 5, { required: false }).kind, "skip");
});
test("a fallback already tried is not offered again", () => {
  assert.equal(na("bad_args", 3, { triedTools: ["browse_url"] }).kind, "ask_user");
});

const noSleep = async () => {};

test("runWithRetry: 503 twice then ok", async () => {
  let n = 0;
  const exec = async () => (++n < 3 ? { tool: "web_search", ok: false, error: "HTTP 503" } : { tool: "web_search", ok: true });
  const r = await runWithRetry(exec, { tool: "web_search", params: { query: "x" } }, { sleep: noSleep });
  assert.equal(r.result.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(r.actions.map((a) => a.kind), ["retry", "retry"]);
});

test("runWithRetry: 404 without a url cannot fall back", async () => {
  const exec = async () => ({ tool: "web_search", ok: false, error: "HTTP 404" });
  const r = await runWithRetry(exec, { tool: "web_search", params: { query: "x" } }, { sleep: noSleep });
  assert.equal(r.result.ok, false);
  assert.ok(["skip", "ask_user"].includes(r.result.nextAction.kind));
});

test("runWithRetry: 404 with a url falls back to browse_url", async () => {
  const tools = [];
  const exec = async (c) => { tools.push(c.tool); return c.tool === "browse_url" ? { tool: "browse_url", ok: true } : { tool: c.tool, ok: false, error: "HTTP 404" }; };
  const r = await runWithRetry(exec, { tool: "web_search", params: { query: "x", url: "http://a.test" } }, { sleep: noSleep });
  assert.equal(r.result.ok, true);
  assert.equal(tools.at(-1), "browse_url");
});

test("negative control: a hard stop runs exactly once", async () => {
  let n = 0;
  const exec = async () => { n++; return { tool: "web_search", ok: false, error: "forbidden_by_governance" }; };
  const r = await runWithRetry(exec, { tool: "web_search", params: { query: "x" } }, { sleep: noSleep });
  assert.equal(n, 1);
  assert.equal(r.result.nextAction.kind, "stop_run");
});

test("a non-idempotent write is never retried in place", async () => {
  let n = 0;
  const exec = async () => { n++; return { tool: "create_dtu", ok: false, error: "HTTP 503" }; };
  const r = await runWithRetry(exec, { tool: "create_dtu", params: { title: "A" } }, { sleep: noSleep });
  assert.equal(n, 1);
  assert.equal(r.result.ok, false);
});
