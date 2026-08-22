// Regression pinning: runAgentLoop used to leave the user with a stub
// lead-in sentence ("Let me check that...") as the ENTIRE reply whenever a
// compound, multi-step request needed more tool round trips than
// AGENT_MAX_TURNS allows — the loop simply exited with `finalAnswer` still
// set to whatever pre-tool-call text the brain emitted on the last turn,
// which the tool schema's own rules ("STOP and wait for results. Do not
// continue the response in the same turn.") deliberately keep short/
// incomplete. This is a real, reproducible source of ConKay appearing to
// "not complete its sentences." Fix: when the loop exhausts every turn
// while tool calls are still pending, force one final synthesis-only brain
// call (no tool markers) and use ITS text as the answer instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../lib/chat-agent.js";

describe("chat-agent.js#runAgentLoop — turn-exhaustion wrap-up", () => {
  it("forces a synthesis-only final turn when maxTurns is exhausted mid-tool-use", async () => {
    let calls = 0;
    const brain = async ({ messages }) => {
      calls += 1;
      const lastMsg = messages[messages.length - 1];
      // The wrap-up call appends this exact instruction as the final user
      // message — detect it so the stub always keeps calling tools otherwise.
      if (lastMsg?.content?.includes("Do not call any more tools")) {
        return { ok: true, text: "Here is the complete synthesized answer.", provider: "test", model: "test-model" };
      }
      return {
        ok: true,
        text: `Let me check that.\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "x"}}]`,
        provider: "test", model: "test-model",
      };
    };
    const runMacro = async () => ({ ok: true, summary: "irrelevant" });

    const r = await runAgentLoop({
      db: null, userId: "u1", message: "do a 6-step compound task",
      runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 2, brainChat: brain },
    });

    assert.equal(r.ok, true);
    assert.equal(r.answer, "Here is the complete synthesized answer.");
    // maxTurns(2) real turns + 1 forced wrap-up turn = 3 brain calls total.
    assert.equal(calls, 3);
  });

  it("does NOT make an extra wrap-up call when the loop ends normally (no pending tool calls)", async () => {
    let calls = 0;
    const brain = async () => {
      calls += 1;
      return { ok: true, text: "A complete, ordinary answer with no tool calls.", provider: "test", model: "test-model" };
    };
    const runMacro = async () => ({ ok: true });

    const r = await runAgentLoop({
      db: null, userId: "u1", message: "simple question",
      runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 5, brainChat: brain },
    });

    assert.equal(r.ok, true);
    assert.equal(r.answer, "A complete, ordinary answer with no tool calls.");
    assert.equal(calls, 1, "should return on the very first turn, no wrap-up call needed");
  });

  it("falls back to the stub answer (never throws) if the wrap-up call itself fails", async () => {
    const brain = async ({ messages }) => {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.content?.includes("Do not call any more tools")) {
        return { ok: false, text: "", error: "brain_down" };
      }
      return {
        ok: true,
        text: `Working on it.\n[TOOL_CALL: {"tool": "web_search", "params": {"query": "x"}}]`,
        provider: "test", model: "test-model",
      };
    };
    const runMacro = async () => ({ ok: true, summary: "x" });

    const r = await runAgentLoop({
      db: null, userId: "u1", message: "compound task",
      runMacro, lensActions: new Map(), history: [],
      opts: { maxTurns: 1, brainChat: brain },
    });

    assert.equal(r.ok, true);
    assert.equal(r.answer, "Working on it."); // stripped of the TOOL_CALL marker
  });
});
