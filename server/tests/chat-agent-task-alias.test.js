/**
 * F3 — chat_agent.do accepts input.task as an alias for input.message
 * (ActionPanels fleet-wide post `task`; handler historically required message).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentMessage } from "../domains/chat-agent.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOMAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../domains/chat-agent.js");

describe("chat_agent.do task alias (kingdoms F3)", () => {
  it("resolveAgentMessage prefers message, accepts task, rejects empty", () => {
    assert.equal(resolveAgentMessage({ message: "from message" }), "from message");
    assert.equal(resolveAgentMessage({ task: "from task" }), "from task");
    assert.equal(resolveAgentMessage({ message: "m", task: "t" }), "m");
    assert.equal(resolveAgentMessage({}), null);
    assert.equal(resolveAgentMessage({ message: "", task: "" }), null);
  });

  it("handler wires resolveAgentMessage into missing_message gate", () => {
    const src = fs.readFileSync(DOMAIN, "utf8");
    assert.match(src, /resolveAgentMessage\(input\)/);
    assert.match(src, /missing_message/);
    assert.match(src, /message: resolvedMessage/);
  });
});
