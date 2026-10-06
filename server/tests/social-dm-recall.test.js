/**
 * Recall window for DMs (max-polish pass) — pins the contract for
 * `recallMessage()`: only the sender can recall, only inside the window,
 * and the message body becomes empty + tagged recalled.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sendMessage, recallMessage, getMessages, markMessagesRead, getConversations } from "../emergent/social-layer.js";

function makeSTATE() { return { dtus: new Map() }; }

describe("social-layer: recallMessage", () => {
  it("recalls a message within the window and blanks the body", () => {
    const STATE = makeSTATE();
    const sent = sendMessage(STATE, { fromUserId: "u1", toUserId: "u2", content: "oops" });
    assert.equal(sent.ok, true);
    const id = sent.message.id;
    const r = recallMessage(STATE, { messageId: id, userId: "u1" });
    assert.equal(r.ok, true);
    assert.equal(r.messageId, id);
    // Body must be wiped and the recalled flag set.
    const msgs = getMessages(STATE, sent.message.conversationId, { userId: "u1" });
    const found = msgs.messages.find((m) => m.id === id);
    assert.ok(found, "recalled message should still be returned");
    assert.equal(found.content, "");
    assert.equal(found.mediaUrl, null);
  });

  it("rejects recall by a non-sender", () => {
    const STATE = makeSTATE();
    const sent = sendMessage(STATE, { fromUserId: "u1", toUserId: "u2", content: "private" });
    const r = recallMessage(STATE, { messageId: sent.message.id, userId: "u2" });
    assert.equal(r.ok, false);
    assert.match(r.error, /only the sender/);
  });

  it("rejects recall after the window has elapsed", () => {
    const STATE = makeSTATE();
    const sent = sendMessage(STATE, { fromUserId: "u1", toUserId: "u2", content: "too late" });
    const r = recallMessage(STATE, { messageId: sent.message.id, userId: "u1", windowSeconds: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /recall window/);
  });

  it("returns a clean error for unknown messages", () => {
    const STATE = makeSTATE();
    const r = recallMessage(STATE, { messageId: "msg-missing", userId: "u1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("requires both messageId and userId", () => {
    const STATE = makeSTATE();
    const r1 = recallMessage(STATE, { messageId: "", userId: "u1" });
    assert.equal(r1.ok, false);
    const r2 = recallMessage(STATE, { messageId: "msg-x", userId: "" });
    assert.equal(r2.ok, false);
  });

  it("hides message bodies from a non-participant", () => {
    const STATE = makeSTATE();
    const sent = sendMessage(STATE, { fromUserId: "u1", toUserId: "u2", content: "PRIVATE_DM secret do-not-leak" });
    const convId = sent.message.conversationId;
    const outsider = getMessages(STATE, convId, { userId: "u3" });
    assert.equal(outsider.ok, false);
    assert.equal(outsider.status, 404);
    assert.equal(JSON.stringify(outsider).includes("PRIVATE_DM"), false);
    assert.equal(JSON.stringify(outsider).includes("do-not-leak"), false);
    const reader = getMessages(STATE, convId, { userId: "u2" });
    assert.equal(reader.ok, true);
    assert.equal(reader.messages[0].content, "PRIVATE_DM secret do-not-leak");
    const missingUser = getMessages(STATE, convId);
    assert.equal(missingUser.ok, false);
    assert.equal(missingUser.status, 404);
  });

  it("does not mark or recall a thread for a non-participant", () => {
    const STATE = makeSTATE();
    const sent = sendMessage(STATE, { fromUserId: "u1", toUserId: "u2", content: "PRIVATE_DM secret do-not-leak" });
    const convId = sent.message.conversationId;
    const marked = markMessagesRead(STATE, { userId: "u3", conversationId: convId });
    assert.equal(marked.ok, false);
    assert.equal(marked.status, 404);
    const convos = getConversations(STATE, "u3");
    assert.equal(convos.conversations.length, 0);
    const recalled = recallMessage(STATE, { messageId: sent.message.id, userId: "u3" });
    assert.equal(recalled.ok, false);
    assert.equal(recalled.status, 404);
    assert.equal(JSON.stringify(recalled).includes("do-not-leak"), false);
    const still = getMessages(STATE, convId, { userId: "u1" });
    assert.equal(still.messages[0].content, "PRIVATE_DM secret do-not-leak");
  });
});
