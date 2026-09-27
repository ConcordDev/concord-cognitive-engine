// server/tests/chat-v6-contract-guard.test.js
//
// chat.respond must never show a user the raw V6 JSON contract. Found by a
// new-user chat QA run (2026-09-27): the brain answered "What is 1234*5678?"
// with {"intent":"multiply","confidence":1.0,…,"action":"none"} and that JSON
// was rendered as the reply. Pins the detector and that chat.respond uses it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v6ContractOnly as detect } from "../lib/chat-v6-contract.js";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");

test("detects a bare V6 contract (plain or fenced) with no runnable tool", () => {
  assert.ok(detect('{"intent":"multiply","confidence":1.0,"evidence":["math"],"action":"none","status":"verified"}'));
  assert.ok(detect('```json\n{"intent":"x","status":"ok","tool":"none"}\n```'));
});

test("leaves real tool calls, prose, and unrelated JSON alone", () => {
  assert.equal(detect('{"intent":"x","confidence":0.8,"tool":"web_search","args":{}}'), null);
  assert.equal(detect("Sure — it's 7,006,652."), null);
  assert.equal(detect('Here: {"intent":"x","status":"y"}'), null);
  assert.equal(detect('{"a":1}'), null);
});

test("chat.respond routes contract-only replies through the guard", () => {
  assert.match(src, /const _v6Only = _v6ContractOnly\(finalReply\)/);
  assert.match(src, /I couldn't put together an answer for that one/);
});
