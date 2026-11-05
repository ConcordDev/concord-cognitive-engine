import { test } from "node:test";
import assert from "node:assert/strict";
import { chatAgentRoute, agentByDefault, routeHint } from "../lib/chat/agent-route.js";

test("unmatched work asks go through the tool loop by default", () => {
  delete process.env.CONCORD_CHAT_AGENT_DEFAULT;
  for (const p of ["build me a workout plan for next week", "work on the concordia hub layout", "Concord isnt working", "I need to add more protein to my meals"]) {
    assert.equal(chatAgentRoute(p), "general", p);
  }
  assert.ok(routeHint("general").includes("run_lens_action"));
});

test("small talk, questions about the assistant, creative and feelings stay conversational", () => {
  delete process.env.CONCORD_CHAT_AGENT_DEFAULT;
  for (const p of ["yo", "thanks", "who are you", "write me a poem about rain", "I feel tired today"]) {
    assert.equal(chatAgentRoute(p), null, p);
  }
});

test("CONCORD_CHAT_AGENT_DEFAULT=0 restores the old fall-through", () => {
  process.env.CONCORD_CHAT_AGENT_DEFAULT = "0";
  try {
    assert.equal(agentByDefault("build me a workout plan for next week"), false);
    assert.equal(chatAgentRoute("build me a workout plan for next week"), null);
  } finally { delete process.env.CONCORD_CHAT_AGENT_DEFAULT; }
});
