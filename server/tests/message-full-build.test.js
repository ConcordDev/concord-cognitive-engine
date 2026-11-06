// message-full-build.test.js — B6 F-B build(message) server pins.
//
// (S3/F2) messages-delete routes through the same store messages-send
// uses: a DM (shared-bucket) message can be deleted by its sender — the
// per-user-only search reported "message not found" for a visible message.
// (S4/F6) command-run produces app messages the stream can list: /shrug is
// non-ephemeral and lands in app-messages-list; unknown commands refuse.
// (S5/F8) react/reactions-for round-trip the tally the chips render.
// (S2/F1) messages-send stamps the caller-supplied senderName.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMessageActions from "../domains/message.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`message.${name}`);
  if (!fn) throw new Error(`message.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const ctxA = { actor: { userId: "user_a", displayName: "Alice" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", displayName: "Bob" }, userId: "user_b" };

let generalId;
let dmId;
let dmMsgId;
let chanMsgId;

before(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  registerMessageActions(register);

  const chans = call("channels-list", ctxA).result.channels;
  generalId = chans.find((c) => c.name === "general").id;

  const dm = call("channels-create", ctxA, { name: "dm-bob", kind: "dm", participants: ["user_a", "user_b"] });
  assert.equal(dm.ok, true);
  dmId = dm.result.channel.id;

  const sentDm = call("messages-send", ctxB, { channelId: dmId, body: "hi from bob", senderName: "Bob" });
  assert.equal(sentDm.ok, true);
  dmMsgId = sentDm.result.message.id;

  const sentCh = call("messages-send", ctxA, { channelId: generalId, body: "channel hello", senderName: "Alice" });
  assert.equal(sentCh.ok, true);
  chanMsgId = sentCh.result.message.id;
  assert.equal(sentCh.result.message.senderName, "Alice"); // S2: the stamp
});

describe("S3 — delete routes through the message's own store (F2)", () => {
  it("a DM (shared-bucket) message deletes for its sender", () => {
    const r = call("messages-delete", ctxB, { channelId: dmId, id: dmMsgId });
    assert.equal(r.ok, true);
    const list = call("messages-list", ctxB, { channelId: dmId }).result.messages;
    assert.equal(list.find((m) => m.id === dmMsgId), undefined);
  });

  it("a channel (per-user bucket) message still deletes", () => {
    const r = call("messages-delete", ctxA, { channelId: generalId, id: chanMsgId });
    assert.equal(r.ok, true);
  });

  it("a non-sender delete is refused in words", () => {
    const sent = call("messages-send", ctxA, { channelId: dmId, body: "alice in dm", senderName: "Alice" });
    const r = call("messages-delete", ctxB, { channelId: dmId, id: sent.result.message.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /only sender/);
  });
});

describe("S4 — command output is listable by the stream (F6)", () => {
  it("/shrug posts a non-ephemeral app message", () => {
    const r = call("command-run", ctxA, { channelId: generalId, text: "/shrug whatever" });
    assert.equal(r.ok, true);
    assert.equal(r.result.appMessage.ephemeral, false);
    assert.ok(r.result.appMessage.body.includes("¯\\_(ツ)_/¯"));
    const list = call("app-messages-list", ctxA, { channelId: generalId }).result.appMessages;
    assert.ok(list.some((a) => a.id === r.result.appMessage.id));
  });

  it("an unknown command is refused, never posted", () => {
    const beforeCount = call("app-messages-list", ctxA, { channelId: generalId }).result.count;
    const r = call("command-run", ctxA, { channelId: generalId, text: "/boguscmd x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown command/);
    assert.equal(call("app-messages-list", ctxA, { channelId: generalId }).result.count, beforeCount);
  });
});

describe("S5 — reaction tallies round-trip (F8)", () => {
  it("react then reactions-for shows the tally; unreact clears it", () => {
    const sent = call("messages-send", ctxA, { channelId: generalId, body: "react to me", senderName: "Alice" });
    const id = sent.result.message.id;
    assert.equal(call("react", ctxA, { messageId: id, emoji: "👍" }).result.count, 1);
    assert.deepEqual(call("reactions-for", ctxA, { messageId: id }).result.reactions, { "👍": 1 });
    call("unreact", ctxA, { messageId: id, emoji: "👍" });
    assert.deepEqual(call("reactions-for", ctxA, { messageId: id }).result.reactions, {});
  });
});
