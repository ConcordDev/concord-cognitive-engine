import test from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "../depth/_harness.js";

test("chat.threadSummarize returns the fields the drawer renders", async () => {
  const messages = [
    { author: "ana", text: "We decided to ship the beam calculator on Friday." },
    { author: "bo", text: "Please update the docs before then, @ana." },
    { author: "ana", text: "Is there a plan for the load tables?" },
  ];
  const r = await lensRun("chat", "threadSummarize", { data: { messages } });
  const res = r.result ?? r;
  assert.equal(typeof res.summary, "string");
  assert.ok(res.summary.length > 0);
  assert.ok(Array.isArray(res.keyPoints) && res.keyPoints.length > 0);
  assert.equal(res.participants, 2);
  assert.equal(res.messageCount, 3);
});
