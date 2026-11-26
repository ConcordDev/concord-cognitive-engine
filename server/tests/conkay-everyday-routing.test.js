// ConKay takes everyday asks seriously (owner, 2026-11-26: "ConKay doesn't
// take me serious"). Before: "is this a good idea: quitting my job to trade
// crypto" was answered "You don't have any background jobs yet."; "your
// honest opinion on my startup idea" became a forced web search; "make a bar
// chart of my sales" went to the CAD part designer. Each ask below lands on
// the route that answers it, and only fact-hungry asks force a tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conkayTurnPlan, isDesignAsk, conkayToolPolicy } from "../lib/conkay/agent-turn.js";
import { chatAgentRoute } from "../lib/chat/agent-route.js";
import { isLongTaskStatusAsk } from "../lib/long-task.js";

const plan = (m, h = []) => conkayTurnPlan(m, h) || { route: null, fallbackCall: null };
const tool = (p) => p.fallbackCall?.tool || null;

test("life, opinion and advice asks get Kay's own thinking — no job status, no forced search", () => {
  for (const m of [
    "is this a good idea: quitting my job to trade crypto",
    "give me your honest opinion on my startup idea: an app for dog walkers",
    "is my research paper any good? here's the intro: ...",
    "how is my job interview prep looking?",
    "can you check my business plan?",
    "can you help me study for my exam",
    "explain quantum computing like I'm five",
    "explain how a bridge loan works",
    "help me plan a trip to Japan",
    "what should I eat tonight",
    "give me feedback on this poem: roses are red",
  ]) {
    const p = plan(m);
    assert.equal(p.route, "think", m);
    assert.equal(tool(p), null, `${m} must not force a tool`);
    assert.match(p.hint, /real view|reasons/, m);
  }
});

test("background-job status only for real job-status questions", () => {
  for (const m of ["how's my research going?", "is my report ready?", "how are my background jobs going", "status of my background task"]) assert.equal(isLongTaskStatusAsk(m), true, m);
  for (const m of ["is this a good idea: quitting my job to trade crypto", "is my research paper any good?", "how is my job interview prep looking?", "check on my report card grades", "update on my research: I found 3 papers"]) assert.equal(isLongTaskStatusAsk(m), false, m);
});

test("everyday words are not engineering parts", () => {
  for (const m of ["make a bar chart of my sales: Jan 10, Feb 14, Mar 9", "make a table of my expenses this month", "I need a frame for my argument in the essay", "help me stand up for myself at work", "build me a workout plan"]) {
    assert.equal(isDesignAsk(m), false, m);
    assert.notEqual(tool(plan(m)), "conkay_design", m);
  }
  for (const m of ["I want to build a shelf for my garage, 1.2 m wide, holds 50 kg", "design a 3 m steel beam carrying 5 kN", "size a bracket for 200 N", "build a wooden table 1.8 m long that holds 100 kg"]) {
    assert.equal(isDesignAsk(m), true, m);
    assert.equal(tool(plan(m)), "conkay_design", m);
  }
});

test("facts that change or must be exact still get a search; stable knowledge does not", () => {
  for (const m of ["what's the weather in Chicago", "how much is a Tesla model 3", "compare iPhone and Pixel", "look up the best laptop under 1000", "research the best electric cars for me"]) assert.equal(tool(plan(m)), "web_search", m);
  for (const m of ["what is resonance in music", "how do I fix a leaky faucet", "how strong is a 2x4"]) {
    const p = plan(m);
    assert.equal(tool(p), null, m);
    assert.match(p.hint, /stable knowledge/, m);
  }
});

test("the user's own Concord data goes to their lenses, never the web", () => {
  const p = plan("what's the load on my schedule this week");
  assert.equal(p.route, "own-data");
  assert.equal(tool(p), "find_lens_actions");
});

test("arithmetic is computed, personal facts are recalled, 'can you remember' is stored", () => {
  assert.equal(chatAgentRoute("what's 15% of 240"), "compute");
  assert.equal(chatAgentRoute("when is my birthday?"), "recall");
  assert.equal(chatAgentRoute("show me what you made earlier"), "recall");
  assert.equal(chatAgentRoute("can you remember my birthday is May 3"), "remember");
});

test("the policy tells Kay to think first and take the person seriously", () => {
  const pol = conkayToolPolicy();
  assert.match(pol, /Take the person seriously/);
  assert.match(pol, /Think first, then look up/);
  assert.doesNotMatch(pol, /you answer with tools, not from memory/);
});
