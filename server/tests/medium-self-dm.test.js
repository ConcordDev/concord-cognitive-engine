import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendMessage } from "../emergent/social-layer.js";

describe("a direct message to yourself is refused", () => {
  it("does not store a message when the sender and recipient are the same", () => {
    const STATE = { dtus: new Map(), social: { profiles: new Map(), messages: [], conversations: new Map() } };
    const r = sendMessage(STATE, { fromUserId: "ada", toUserId: "ada", content: "note to self" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot message yourself");
    assert.match(r.message, /not delivered/);
  });
});
