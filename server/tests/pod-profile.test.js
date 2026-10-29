// CONCORD_POD_PROFILE: pod-sized brain limits when on, unchanged lean (Mac fallback) values when off.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { podProfile, podNumber, podPick } from "../lib/pod-profile.js";

test("podProfile reads the switch; podNumber picks profile defaults, honours env, clamps to the ceiling", () => {
  assert.equal(podProfile({}), false);
  assert.equal(podProfile({ CONCORD_POD_PROFILE: "0" }), false);
  assert.equal(podProfile({ CONCORD_POD_PROFILE: "1" }), true);
  assert.equal(podPick(1, 2, { CONCORD_POD_PROFILE: "on" }), 2);
  const spec = { lean: 4096, pod: 8192, leanMax: 4096, podMax: 32768 };
  assert.equal(podNumber("X", spec, {}), 4096);
  assert.equal(podNumber("X", spec, { CONCORD_POD_PROFILE: "1" }), 8192);
  assert.equal(podNumber("X", spec, { X: "16000" }), 4096, "lean ceiling still applies off the pod");
  assert.equal(podNumber("X", spec, { CONCORD_POD_PROFILE: "1", X: "16000" }), 16000);
  assert.equal(podNumber("X", spec, { CONCORD_POD_PROFILE: "1", X: "99999" }), 32768);
  assert.equal(podNumber("X", spec, { CONCORD_POD_PROFILE: "1", X: "junk" }), 8192);
});

function brain(env) {
  const code = `import("./lib/brain-config.js").then((m)=>{const c=m.BRAIN_CONFIG;console.log(JSON.stringify({sub:c.subconscious.contextWindow,subT:c.subconscious.timeout,subTok:c.subconscious.maxTokens,util:c.utility.contextWindow,rep:c.repair.contextWindow,vis:(c.multimodal||c.vision).contextWindow,con:c.conscious.contextWindow}))})`;
  const r = spawnSync(process.execPath, ["-e", code], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, NODE_ENV: "test", ...env }, encoding: "utf8" });
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

test("brain-config: lean values off the pod, pod values on it, env still wins", () => {
  const lean = brain({ CONCORD_POD_PROFILE: "" });
  assert.deepEqual([lean.sub, lean.util, lean.rep, lean.vis, lean.subT, lean.subTok], [4096, 2048, 2048, 4096, 30000, 1200]);
  const pod = brain({ CONCORD_POD_PROFILE: "1" });
  assert.deepEqual([pod.sub, pod.util, pod.rep, pod.vis, pod.subT, pod.subTok], [8192, 4096, 4096, 8192, 90000, 2400]);
  assert.equal(pod.con, 32768, "conscious unchanged");
  assert.equal(brain({ CONCORD_POD_PROFILE: "1", BRAIN_SUBCONSCIOUS_CONTEXT: "16384" }).sub, 16384);
  assert.equal(brain({ BRAIN_SUBCONSCIOUS_CONTEXT: "16384" }).sub, 4096, "off the pod the lean ceiling holds");
});

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
