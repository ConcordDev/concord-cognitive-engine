// server/tests/compute-router.test.js
//
// lib/chat/compute-router.js — compute-don't-guess that works on any model.
// A 1.9B self-hosted model scored 10/20 on the eval set below (weather lookup
// for a heat-loss question, KE = "12", circle area "7.04"). With the router,
// fully specified questions are answered by Concord's engines. Expected values
// are textbook/definition results in tests/fixtures/compute-router-cases.json.
// Negatives must NOT be routed — conversation stays with the model.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { routeComputeQuestion, composeRoutedReply } from "../lib/chat/compute-router.js";

const CASES = JSON.parse(fs.readFileSync(new URL("./fixtures/compute-router-cases.json", import.meta.url), "utf8"));
const norm = (s) => s.replace(/,(?=\d{3})/g, "");
function correct(item, reply) {
  const r = norm(reply);
  if (item.expectText) return item.expectText.some((t) => r.includes(t));
  const nums = (r.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) || []).map(Number);
  return item.expect.some((e) => nums.some((n) => Math.abs(n - e) <= Math.max(Math.abs(e) * 0.005, 0.0005)));
}

for (const set of ["eval", "heldout"]) {
  test(`${set} set: every question is routed to an engine and answered correctly`, () => {
    for (const item of CASES[set]) {
      const r = routeComputeQuestion(item.q);
      assert.ok(r, `${item.id}: not routed — "${item.q}"`);
      const reply = composeRoutedReply(r);
      assert.ok(correct(item, reply), `${item.id}: wrong answer — ${reply}`);
      assert.match(reply, /Computed by Concord's .+ engine/, "every answer names its engine");
    }
  });
}

test("conversational messages are never routed (no false positives)", () => {
  for (const q of CASES.negatives) assert.equal(routeComputeQuestion(q), null, `false positive: "${q}"`);
});

test("assumptions are disclosed, never silent", () => {
  const r = routeComputeQuestion("What is the population standard deviation of 2, 4, 4, 4, 5, 5, 7, 9?");
  assert.equal(r.assumed.length, 0);
  const r2 = routeComputeQuestion("What is the standard deviation of 2, 4, 4, 4, 5, 5, 7, 9?");
  assert.match(composeRoutedReply(r2), /Assumed: population/);
});

test("both chat engines route before any model call", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const routeAt = server.indexOf("const _routed = _routeComputeQuestion(prompt);");
  const brainAt = server.indexOf("} else if (llm && ctx.llm.enabled) {");
  assert.ok(routeAt > 0 && brainAt > routeAt, "chat.respond routes before the brain branch");
  assert.match(server, /if \(_deterministicAnswer\) \{\n\s+finalReply = _deterministicAnswer\.text;/);
  const agent = fs.readFileSync(new URL("../lib/chat-agent.js", import.meta.url), "utf8");
  const loop = agent.slice(agent.indexOf("export async function runAgentLoop"));
  const at = loop.indexOf("routeComputeQuestion(message)");
  assert.ok(at > 0 && at < loop.indexOf("Shadow context prefetch"), "agent loop routes before any context fetch or model turn");
  assert.match(server, /if \(_isWeatherQuery\(prompt\) && !_routeComputeQuestion\(prompt\)\) \{/, "weather gate defers to the compute router");
});
