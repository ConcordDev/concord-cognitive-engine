// server/tests/chat-agent-extra-system-block.test.js
//
// Pins the ONE hook added to chat-agent.js#runAgentLoop in support of
// marathon-plan-context.js: an opt-in `opts.extraSystemBlock` string that
// gets appended to the composed system prompt. The load-bearing contract:
// when the caller does NOT supply it (every pre-existing caller, including
// the ordinary /api/chat-agent path and any unlinked marathon tick), the
// assembled system prompt must be BYTE-IDENTICAL to what it was before this
// hook existed.
//
// No DB/migrations needed — db is passed as null so the action-memory
// block (opts.actionMemory !== false && db && userId) short-circuits, and
// no runMacro is passed so the shadow-context prefetch is skipped too. That
// isolates the assertion to exactly the one line this change touches.
//
// Run: node --test server/tests/chat-agent-extra-system-block.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../lib/chat-agent.js";

function scriptedBrain(text) {
  const captured = [];
  const fn = async ({ messages }) => {
    captured.push(messages);
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
  fn.captured = captured;
  return fn;
}

function systemContentOf(messages) {
  return messages.find((m) => m.role === "system")?.content;
}

describe("chat-agent.js#runAgentLoop — opts.extraSystemBlock opt-in hook", () => {
  it("omitting opts.extraSystemBlock entirely produces the SAME system prompt as passing an explicit empty string", async () => {
    const brainA = scriptedBrain("all done, no tools needed.");
    const brainB = scriptedBrain("all done, no tools needed.");

    const resultOmitted = await runAgentLoop({
      db: null, userId: "u1", message: "do the thing", history: [],
      opts: { maxTurns: 1, brainChat: brainA }, // no extraSystemBlock key at all
    });
    const resultExplicitEmpty = await runAgentLoop({
      db: null, userId: "u1", message: "do the thing", history: [],
      opts: { maxTurns: 1, brainChat: brainB, extraSystemBlock: "" },
    });

    assert.equal(resultOmitted.ok, true);
    assert.equal(resultExplicitEmpty.ok, true);
    const sysOmitted = systemContentOf(brainA.captured[0]);
    const sysExplicit = systemContentOf(brainB.captured[0]);
    assert.equal(typeof sysOmitted, "string");
    assert.equal(sysOmitted, sysExplicit, "byte-identical regardless of whether extraSystemBlock is omitted or explicitly \"\"");
  });

  it("a non-empty opts.extraSystemBlock is appended verbatim to the system prompt (and is absent when unset)", async () => {
    const marker = "\n\n--- Linked project plan (goal tree: \"Test Tree\") ---\nProgress: 0/1 subgoal(s) done (0%).\n--- end plan context ---";
    const brainWith = scriptedBrain("ok");
    const brainWithout = scriptedBrain("ok");

    await runAgentLoop({ db: null, userId: "u1", message: "hi", history: [], opts: { maxTurns: 1, brainChat: brainWith, extraSystemBlock: marker } });
    await runAgentLoop({ db: null, userId: "u1", message: "hi", history: [], opts: { maxTurns: 1, brainChat: brainWithout } });

    const sysWith = systemContentOf(brainWith.captured[0]);
    const sysWithout = systemContentOf(brainWithout.captured[0]);
    assert.ok(sysWith.endsWith(marker), "extraSystemBlock is appended verbatim at the end");
    assert.equal(sysWith.slice(0, sysWith.length - marker.length), sysWithout, "everything BEFORE the block is unchanged");
    assert.ok(!sysWithout.includes("Linked project plan"), "absent when not supplied");
  });

  it("a non-string extraSystemBlock (defensive) is treated as empty, never crashes or gets stringified into the prompt", async () => {
    const brain = scriptedBrain("ok");
    const r = await runAgentLoop({ db: null, userId: "u1", message: "hi", history: [], opts: { maxTurns: 1, brainChat: brain, extraSystemBlock: { not: "a string" } } });
    assert.equal(r.ok, true);
    const sys = systemContentOf(brain.captured[0]);
    assert.ok(!sys.includes("[object Object]"));
  });
});
