import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctDtuSummaries } from "../lib/chat-offline-reply.js";

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
