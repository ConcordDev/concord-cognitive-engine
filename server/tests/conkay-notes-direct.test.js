import { test } from "node:test";
import assert from "node:assert/strict";
import { notesDirectEligible, answerFromNotes, notesAnswerMessages, NOT_IN_NOTES } from "../lib/conkay/notes-answer.js";
import { unknownToolResult, AGENT_TOOL_NAMES, executeToolCall } from "../lib/chat-agent.js";
import { composeToolTurnReply } from "../lib/chat/tool-turn-reply.js";

const got = { strong: true, text: "[MEGA] MLLMs Fail to Refuse: Members: 10 regular DTUs." };

test("strong match on a lookup is eligible; tool routes, weak matches and web asks are not", () => {
  assert.ok(notesDirectEligible({ plan: { route: "lookup", fallbackCall: { tool: "web_search" } }, got, message: "How many DTUs?" }));
  assert.ok(notesDirectEligible({ plan: null, got, message: "How many DTUs?" }));
  assert.ok(!notesDirectEligible({ plan: { route: "lookup" }, got: { ...got, strong: false }, message: "x" }));
  assert.ok(!notesDirectEligible({ plan: { route: "action" }, got, message: "add a task" }));
  assert.ok(!notesDirectEligible({ plan: { route: "lookup", fallbackCall: { tool: "textbook_lookup" } }, got, message: "x" }));
  assert.ok(!notesDirectEligible({ plan: { route: "web" }, got, message: "search the web for the latest news" }));
});

test("direct answer uses no tools and falls back when the notes lack it", async () => {
  let seen = null;
  const brain = async ({ messages }) => { seen = messages; return { ok: true, text: "10 — from MEGA MLLMs Fail to Refuse.", model: "m" }; };
  const out = await answerFromNotes({ brain, block: got.text, message: "How many?", history: [{ role: "system", content: "evil" }, { role: "user", content: "hi" }] });
  assert.equal(out.answer, "10 — from MEGA MLLMs Fail to Refuse.");
  assert.ok(seen[0].content.includes("Members: 10"));
  assert.ok(!seen[0].content.includes("TOOL_CALL"));
  assert.ok(!seen.slice(1).some((m) => m.role === "system"), "client history cannot add system turns");
  assert.equal(await answerFromNotes({ brain: async () => ({ ok: true, text: NOT_IN_NOTES }), block: "x", message: "q" }), null);
  assert.equal(await answerFromNotes({ brain: async () => ({ ok: false, error: "down" }), block: "x", message: "q" }), null);
  assert.equal(notesAnswerMessages({ block: "b", message: "q" }).at(-1).content, "q");
});

test("an invented tool gets a clean error naming real tools, not a user-facing failure line", async () => {
  assert.ok(AGENT_TOOL_NAMES.includes("web_search") && AGENT_TOOL_NAMES.length > 20);
  const r = await executeToolCall({ actor: { userId: "u" } }, async () => ({}), [], { tool: "dila_status", params: {} });
  assert.equal(r.ok, false);
  assert.equal(r.unknownTool, true);
  assert.match(r.retryHint, /There is no tool named "dila_status"\. Real tools: .*web_search/);
  assert.equal(unknownToolResult("x<y>").tool, "xy");
  assert.ok(!(composeToolTurnReply([r]) || "").includes("dila_status"));
});

test("notes prompt tells the model to quote numbers exactly, never rounded", async () => {
  const { notesAnswerMessages } = await import("../lib/conkay/notes-answer.js");
  const msgs = notesAnswerMessages({ block: "CONCORD KNOWLEDGE\n- X: 66.7%", message: "what %?" });
  assert.match(msgs[0].content, /never round/);
});
