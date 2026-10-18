// Long-chat probe 2026-10-17: a 37-turn phone session lost everything older than
// 6 exchanges ("what did I say my budget was?" → "you didn't mention a budget"),
// and an action turn with no write tool replied "Task added (ID: tsk_…)".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatHistoryMessages, CHAT_HISTORY_TURNS, CHAT_HISTORY_TOTAL_CHARS, CHAT_HISTORY_OLDER_CHAR_CAP,
} from "../lib/chat-reply-policy.js";
import { WRITE_CLAIM_RE } from "../lib/chat/agent-route.js";

function session(n, assistantText = (i) => `Answer number ${i}.`) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({ role: "user", content: i === 10 ? "plan a 3 day nyc trip, budget is like $1200" : `user turn ${i}` });
    rows.push({ role: "assistant", content: assistantText(i) });
  }
  return rows;
}

test("a turn 19 exchanges back is still replayed", () => {
  const rows = session(28);
  rows.push({ role: "user", content: "wait what did I say my budget was?" });
  const h = buildChatHistoryMessages(rows, "wait what did I say my budget was?");
  assert.ok(h.some((m) => m.content.includes("$1200")), "budget turn kept");
  assert.equal(h[h.length - 1].content, "wait what did I say my budget was?");
  assert.ok(h.length - 1 <= CHAT_HISTORY_TURNS);
});

test("current user turn is last and not duplicated; roles alternate", () => {
  const rows = session(5);
  rows.push({ role: "user", content: "next" });
  const h = buildChatHistoryMessages(rows, "next");
  assert.equal(h.filter((m) => m.content === "next").length, 1);
  assert.equal(h[h.length - 1].role, "user");
  assert.equal(h.length, 11);
});

test("total budget drops the oldest rows first, newest kept in full", () => {
  const long = (i) => `Day plan ${i}. ` + "Go eat somewhere good and hear music. ".repeat(40);
  const rows = session(30, long);
  const h = buildChatHistoryMessages(rows, "now");
  const total = h.slice(0, -1).reduce((a, m) => a + m.content.length, 0);
  assert.ok(total <= CHAT_HISTORY_TOTAL_CHARS, `total ${total}`);
  const lastAssistant = h[h.length - 2];
  assert.equal(lastAssistant.content, long(30).trim());
  // older assistant rows are compacted to a sentence-bounded gist
  const older = h.slice(0, -14).filter((m) => m.role === "assistant");
  assert.ok(older.length > 0);
  for (const m of older) {
    assert.ok(m.content.length <= CHAT_HISTORY_OLDER_CHAR_CAP + 2, `len ${m.content.length}`);
    assert.match(m.content, /[.!?…]$/);
  }
});

test("an older bulleted plan keeps a short gist", () => {
  const listy = () => "**Day 1**\n" + Array.from({ length: 60 }, (_, k) => `- Stop ${k}: grab food in Brooklyn.`).join("\n") + "\nHave fun.";
  const rows = session(20, listy);
  const h = buildChatHistoryMessages(rows, "now");
  const first = h.find((m) => m.role === "assistant");
  assert.ok(first.content.length > 50);
  assert.ok(first.content.length <= CHAT_HISTORY_OLDER_CHAR_CAP + 2);
});

test("write-claim detector", () => {
  assert.ok(WRITE_CLAIM_RE.test('Task added: "Call mom Sunday" (ID: tsk_zqlongmvd6jkrp).'));
  assert.ok(WRITE_CLAIM_RE.test("Done, I've created the recipe."));
  assert.ok(!WRITE_CLAIM_RE.test("Which day should I put the task on?"));
  assert.ok(!WRITE_CLAIM_RE.test("What should the task say?"));
});

test("a reply ending in a number stays in history; a bare list number does not", () => {
  const rows = [
    { role: "user", content: "whats 18% tip on 247.50" }, { role: "assistant", content: "18% tip on $247.50 is $44.55." },
    { role: "user", content: "steps?" }, { role: "assistant", content: "Here are the steps:\n1." },
    { role: "user", content: "and convert 5 miles to km" },
  ];
  const h = buildChatHistoryMessages(rows, "and convert 5 miles to km");
  assert.ok(h.some((m) => m.content === "18% tip on $247.50 is $44.55."));
  assert.ok(!h.some((m) => m.content.endsWith("\n1.")));
});
