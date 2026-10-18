// server/tests/compute-router.test.js
//
// lib/chat/compute-router.js — compute-don't-guess that works on any model.
// A 1.9B self-hosted model scored 10/20 on the eval set below (weather lookup
// for a heat-loss question, KE = "12", circle area "7.04"). With the router,
// fully specified questions are answered by Concord's engines. Expected values
// are textbook/definition results in tests/fixtures/compute-router-cases.json.
// Negatives must NOT be routed — conversation stays with the model.

import { test, describe, it } from "node:test";
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

// INC-134: the stats fast path averaged every number in rate/word problems and called it engine-computed.
describe("INC-134 stats fast path only takes a plain list", () => {
  const R = (q) => routeComputeQuestion(q);
  it("distance ÷ time word problems get the speed, not a mean", () => {
    const a = R("A train travels 180 miles in 2.5 hours. What is its average speed in miles per hour?");
    assert.equal(a.route, "average-speed"); assert.equal(a.value, 72); assert.match(a.text, /72 mph/);
    const b = R("A car goes 120 km in 1.5 hours. What is its average speed?");
    assert.equal(b.value, 80); assert.match(b.text, /80 km\/h/);
    const c = R("What is the average speed of a cyclist who rides 30 km in 2 hours?");
    assert.equal(c.value, 15); assert.match(c.text, /15 km\/h/);
    assert.equal(R("drove 90 miles in 45 minutes, average speed?").value, 120);
    assert.equal(R("a runner covers 400 m in 50 seconds, how fast").value, 8);
  });
  it("mixed context (day numbers, clock times, units) is declined, never averaged", () => {
    const t = R("The average temperature was 70 degrees on day 1 and 80 on day 2 at 3 pm. What was the mean?");
    assert.ok(!t || t.value === 75, JSON.stringify(t));
    assert.ok(!t || t.route !== "stats");
    assert.equal(R("If 3 pencils cost $1.20, how much do 7 pencils cost?")?.route === "stats", false);
    assert.equal(R("my average commute is 40 minutes over 5 days"), null);
  });
  it("plain lists still go to the statistics engine", () => {
    const m = R("What is the average of 4, 8 and 12?");
    assert.equal(m.route, "stats"); assert.equal(m.value, 8);
    const md = R("What is the median of 3, 9, 1, 7?");
    assert.equal(md.route, "stats"); assert.equal(md.value, 5);
    assert.equal(R("mean of these numbers: 10 20 30").value, 20);
    assert.equal(R("standard deviation of 2, 4, 4, 4, 5, 5, 7, 9").value, 2);
  });
  it("the other engines that were right stay right", () => {
    assert.equal(R("What current flows through a 10 ohm resistor at 5 volts?").value, 0.5);
    assert.equal(R("What is the kinetic energy of a 2 kg ball moving at 3 m/s?").value, 9);
    assert.ok(Math.abs(R("What is the molar mass of H2O?").value - 18.015) < 0.01);
    assert.equal(R("What is 15% of 240?").value, 36);
  });
});

it("INC-134: a stats word problem with day numbers routes to the compute agent, not weather", async () => {
  const { isWordProblem, chatAgentRoute } = await import("../lib/chat/agent-route.js");
  const q = "The average temperature was 70 degrees on day 1 and 80 on day 2 at 3 pm. What was the mean?";
  assert.equal(isWordProblem(q), true);
  assert.equal(chatAgentRoute(q), "compute");
  assert.equal(routeComputeQuestion(q), null);
});
