/**
 * Item 2 contract tests — the agent loop records tool calls into long-term memory
 * and injects prior-action recall into its context. Drives runAgentLoop with an
 * injected brainChat (offline) + a fake runMacro, against a real in-memory DB.
 *
 * Run: node --test server/tests/agent-action-memory-wire.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runAgentLoop } from "../lib/chat-agent.js";
import { up as migrate334 } from "../migrations/334_agent_action_log.js";
import { recordAction } from "../lib/agent-action-log.js";

let db;
beforeEach(() => { db = new Database(":memory:"); migrate334(db); });
afterEach(() => { db.close(); });

// A scripted brain: returns the queued responses turn by turn, and captures the
// system message it was given (to assert recall injection).
function scriptedBrain(responses) {
  const seenSystem = [];
  const fn = async ({ messages }) => {
    seenSystem.push(messages[0]?.content || "");
    const text = responses.shift() ?? "done.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
  fn.seenSystem = seenSystem;
  return fn;
}

const fakeRunMacro = async () => ({ ok: true, result: { hits: ["x"] } });

describe("Item 2 — action recording", () => {
  it("records a row in agent_action_log for each executed tool call", async () => {
    const brain = scriptedBrain([
      `Let me search. [TOOL_CALL: {"tool":"web_search","params":{"query":"weather in paris"}}]`,
      `The weather is mild.`,
    ]);
    const out = await runAgentLoop({
      db, userId: "u1", message: "what's the weather in paris?",
      runMacro: fakeRunMacro, lensActions: new Map(),
      opts: { brainChat: brain, shadowContext: false, sessionId: "s1", maxTurns: 3 },
    });
    assert.equal(out.ok, true);
    await new Promise((r) => { setTimeout(r, 200); }); // let the fire-and-forget record settle
    const rows = db.prepare("SELECT * FROM agent_action_log WHERE user_id = ?").all("u1");
    assert.equal(rows.length, 1, "one action recorded");
    assert.equal(rows[0].action, "tool:web_search");
    assert.equal(rows[0].session_id, "s1");
    assert.equal(rows[0].outcome, "ok");
  });
});

describe("Item 2 — action recall injection", () => {
  it("injects a prior-action recall block into the agent's system context", async () => {
    // seed a prior action
    await recordAction(db, { userId: "u1", action: "tool:web_search", input: { query: "paris weather" }, output: "mild", tool: "web_search", outcome: "ok" });
    const brain = scriptedBrain([`done.`]); // no tool calls → single turn
    await runAgentLoop({
      db, userId: "u1", message: "remind me what I looked up about paris",
      runMacro: fakeRunMacro, lensActions: new Map(),
      opts: { brainChat: brain, shadowContext: false, maxTurns: 2 },
    });
    const sys = brain.seenSystem[0];
    assert.match(sys, /long-term memory/);
    assert.match(sys, /tool:web_search/);
  });

  it("no recall block when there are no prior actions", async () => {
    const brain = scriptedBrain([`done.`]);
    await runAgentLoop({
      db, userId: "u_fresh", message: "hello",
      runMacro: fakeRunMacro, lensActions: new Map(),
      opts: { brainChat: brain, shadowContext: false, maxTurns: 2 },
    });
    assert.doesNotMatch(brain.seenSystem[0], /long-term memory/);
  });
});
