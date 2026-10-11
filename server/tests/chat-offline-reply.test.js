import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctDtuSummaries, aiUnavailableChat, AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_NOTICE } from "../lib/chat-offline-reply.js";

test("numbered copies of one note collapse to a single bullet", () => {
  const note = "Economic dynamics are modeled with buffers, damage, and repair.";
  const dtus = [609, 619, 629, 639, 649].map((n) => ({ human: { summary: `Redistribution as Risk Smoothing #${n}: ${note}` } }));
  assert.deepEqual(distinctDtuSummaries(dtus), [`Redistribution as Risk Smoothing #609: ${note}`]);
});

test("distinct notes keep rank order and the limit", () => {
  const dtus = ["a", "b", "a", "c", "d", "e", "f"].map((t) => ({ title: `Note ${t}` }));
  assert.deepEqual(distinctDtuSummaries(dtus, 3), ["Note a", "Note b", "Note c"]);
});

test("falls back from summary to content to title and skips empties", () => {
  const dtus = [{ human: { summary: "" }, content: "from content" }, {}, { title: "from title" }];
  assert.deepEqual(distinctDtuSummaries(dtus), ["from content", "from title"]);
  assert.deepEqual(distinctDtuSummaries(null), []);
});

test("unavailable chat is a notice, and stored notes stay labelled retrieval", () => {
  const bare = aiUnavailableChat();
  assert.equal(bare.ok, false);
  assert.equal(bare.code, AI_UNAVAILABLE_CODE);
  assert.equal(bare.llmUsed, false);
  assert.equal(bare.reply, AI_UNAVAILABLE_NOTICE);
  assert.equal(bare.notice, AI_UNAVAILABLE_NOTICE);
  assert.equal(bare.retrieval, undefined);
  assert.doesNotMatch(bare.reply, /Based on what I know/);

  const withNotes = aiUnavailableChat({ items: ["A stored note", ""] });
  assert.equal(withNotes.reply, AI_UNAVAILABLE_NOTICE);
  assert.equal(withNotes.retrieval.label, "Stored notes");
  assert.equal(withNotes.retrieval.kind, "stored_notes");
  assert.deepEqual(withNotes.retrieval.items, ["A stored note"]);
  assert.equal(withNotes.reply.includes("A stored note"), false);
});
