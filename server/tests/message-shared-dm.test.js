import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMessageActions from "../domains/message.js";

const ACTIONS = new Map();
function call(name, ctx, params = {}) {
  return ACTIONS.get(`message.${name}`)(ctx, {}, params);
}
before(() => { registerMessageActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn)); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ana = { actor: { userId: "ana" }, userId: "ana" };
const bea = { actor: { userId: "bea" }, userId: "bea" };
const cam = { actor: { userId: "cam" }, userId: "cam" };

describe("message lens DMs deliver to every participant", () => {
  it("a dm channel message is visible to the other person and hidden from everyone else", () => {
    const ch = call("channels-create", ana, { name: "ana-bea", kind: "dm", participants: ["bea"] });
    assert.equal(ch.ok, true);
    const channelId = ch.result.channel.id;
    const sent = call("messages-send", ana, { channelId, body: "hello bea" });
    assert.equal(sent.ok, true);
    const seen = call("messages-list", bea, { channelId });
    assert.equal(seen.ok, true);
    assert.equal(seen.result.messages.length, 1);
    assert.equal(seen.result.messages[0].body, "hello bea");
    const outsider = call("messages-list", cam, { channelId });
    assert.equal(outsider.ok, false);
    assert.match(outsider.error, /not a participant/);
    const sneak = call("messages-send", cam, { channelId, body: "nope" });
    assert.equal(sneak.ok, false);
  });
});
