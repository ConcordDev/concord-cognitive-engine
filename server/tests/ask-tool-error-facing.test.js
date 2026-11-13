import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeToolTurnReply } from "../lib/chat/tool-turn-reply.js";

describe("ask tool errors are user-facing", () => {
  it("does not show an admin-role tool failure as a raw run_lens_action error", () => {
    const reply = composeToolTurnReply([{
      tool: "run_lens_action",
      ok: false,
      error: "forbidden: db.status requires an admin role",
    }]);
    assert.match(reply, /this sign-in/i);
    assert.equal(reply.includes("run_lens_action"), false);
    assert.equal(reply.includes("db.status"), false);
  });

  it("explains a missing lens record without the tool name", () => {
    const reply = composeToolTurnReply([{
      tool: "run_lens_action",
      ok: false,
      error: "needs_artifact_input",
    }]);
    assert.match(reply, /specific record/i);
    assert.equal(reply.includes("run_lens_action"), false);
  });

  it("does not show handler_error as a raw tool name", () => {
    const reply = composeToolTurnReply([{
      tool: "run_lens_action",
      ok: false,
      error: "handler_error",
    }]);
    assert.match(reply, /didn't get an answer/i);
    assert.equal(reply.includes("run_lens_action"), false);
  });
});
