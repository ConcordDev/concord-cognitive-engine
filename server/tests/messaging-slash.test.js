// server/tests/messaging-slash.test.js
//
// Sprint B #16 — slash command parser. Pure-unit tests over
// lib/messaging/slash-commands.js + the messaging-slash dispatcher.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseSlash, listBuiltins } from "../lib/messaging/slash-commands.js";

describe("slash parser", () => {
  it("listBuiltins includes expected names", () => {
    const names = listBuiltins().map((b) => b.name);
    for (const n of ["summarize", "translate", "draft", "schedule", "remind", "poll", "snooze", "pin", "search", "triage"]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
  });
  it("rejects non-slash + empty", async () => {
    assert.equal(parseSlash("hi").error, "not_a_slash_command");
    assert.equal(parseSlash("/").error, "empty_command");
  });
  it("/summarize uses conversationId from ctx", async () => {
    const r = parseSlash("/summarize", { conversationId: "channel:abc" });
    assert.equal(r.macro, "summarize_thread");
    assert.equal(r.input.conversationId, "channel:abc");
  });
  it("/draft assembles full prompt", async () => {
    const r = parseSlash("/draft please decline politely", { conversationId: "x" });
    assert.equal(r.macro, "compose_in_my_voice");
    assert.equal(r.input.prompt, "please decline politely");
  });
  it("/schedule 2027-01-01T09:00:00Z hello there", async () => {
    const r = parseSlash("/schedule 2027-01-01T09:00:00Z hello there", { conversationId: "x" });
    assert.equal(r.macro, "msg_post");
    assert.equal(r.input.body, "hello there");
    assert.ok(r.input.scheduledFor > Math.floor(Date.now() / 1000));
  });
  it("/poll 'q? | a | b | c' formats body", async () => {
    const r = parseSlash('/poll "Best lunch?" | tacos | pizza | sushi', { conversationId: "x" });
    assert.equal(r.macro, "msg_post");
    assert.ok(r.input.body.includes("📊"));
    assert.ok(r.input.body.includes("tacos"));
  });
  it("/translate <id> <lang>", async () => {
    const r = parseSlash("/translate msg_abc es");
    assert.equal(r.macro, "translate");
    assert.equal(r.input.messageId, "msg_abc");
    assert.equal(r.input.targetLang, "es");
  });
  it("/help returns meta builtin list", async () => {
    const r = parseSlash("/help");
    assert.equal(r.domain, "_meta");
    assert.ok(Array.isArray(r.input.builtins));
  });
  it("unknown command surfaces error + name", async () => {
    const r = parseSlash("/wat");
    assert.equal(r.error, "unknown_command");
    assert.equal(r.name, "wat");
  });
});
