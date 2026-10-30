// CONCORD_POD_PROFILE: pod-sized concurrency, queue and agent budgets (I2). Brain-limit cases live in pod-profile.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { resolveAgentMaxTurns, resolveAgentMaxCallsPerTurn, resolveAgentMaxToolCalls } from "../lib/chat-reply-policy.js";
import fs from "node:fs";

test("agent loop budgets: lean defaults off the pod, larger on it, explicit env still wins and the clamps hold", () => {
  assert.deepEqual([resolveAgentMaxTurns({ env: {} }), resolveAgentMaxCallsPerTurn({ env: {} }), resolveAgentMaxToolCalls({ env: {} })], [8, 6, 24]);
  const pod = { CONCORD_POD_PROFILE: "1" };
  assert.deepEqual([resolveAgentMaxTurns({ env: pod }), resolveAgentMaxCallsPerTurn({ env: pod }), resolveAgentMaxToolCalls({ env: pod })], [16, 10, 48]);
  assert.equal(resolveAgentMaxToolCalls({ env: { ...pod, CONCORD_AGENT_MAX_TOOL_CALLS: "60" } }), 60);
  assert.equal(resolveAgentMaxToolCalls({ env: { ...pod, CONCORD_AGENT_MAX_TOOL_CALLS: "500" } }), 100);
  assert.equal(resolveAgentMaxTurns({ requested: 40, env: pod }), 30, "request is capped by the pod ceiling");
});

test("governor, semaphore and server.js queue defaults follow the profile and keep the loop guards", async () => {
  const run = (env, code) => spawnSync(process.execPath, ["-e", code], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, NODE_ENV: "test", ...env }, encoding: "utf8" }).stdout.trim().split("\n").pop();
  const gov = 'import("./lib/background-governor.js").then((m)=>{const c=m.governorConfig();console.log(JSON.stringify([c.maxInflight,c.kindInflightCaps.dream,c.lagMs,c.apiP95Ms]))})';
  assert.equal(run({ CONCORD_POD_PROFILE: "" }, gov), "[4,1,200,1500]");
  assert.equal(run({ CONCORD_POD_PROFILE: "1" }, gov), "[12,3,200,1500]", "more in flight, same event-loop lag and API latency guards (#1839 pattern)");
  assert.equal(run({ CONCORD_POD_PROFILE: "1", CONCORD_BG_MAX_INFLIGHT: "6" }, gov), "[6,3,200,1500]");
  const sem = 'import("./lib/inference/semaphore.js").then((m)=>console.log(m.getInferenceStatus?m.getInferenceStatus().vramBudgetGB:"na"))';
  const src = fs.readFileSync(new URL("../lib/inference/semaphore.js", import.meta.url), "utf8");
  assert.match(src, /podPick\(32, 44\)/);
  const srv = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  for (const re of [/LLM_CONCURRENCY \|\| String\(_podPick\(32, 96\)\)/, /CONCORD_LLM_QUEUE_DEPTH \|\| String\(_podPick\(200, 1000\)\)/, /LLM_CONCURRENCY_LIMIT \|\| _podPick\(64, 192\)/]) assert.match(srv, re);
});
