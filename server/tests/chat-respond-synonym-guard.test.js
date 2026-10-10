/**
 * chat.respond must reach the LLM even when the prompt or a context DTU
 * contains a prototype-key token. Before the null-prototype synonym map,
 * any such token threw `syns is not iterable` inside query expansion and
 * runMacro returned macro_uncaught_throw. A fresh member searches the
 * global DTU corpus, so one document that says "constructor" took down
 * every prompt, including "hello".
 *
 * The LLM is replaced on the ctx the macro actually calls. No network.
 *
 * Every scenario lives in one it() because the depth harness arms an
 * unref'd force-exit watchdog when the file finishes; a second it() that
 * calls chat.respond can lose that race. See chat-style-learning-wire.test.js.
 *
 * Run: node --test --test-timeout=180000 tests/chat-respond-synonym-guard.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

describe("chat.respond survives prototype-key synonym expansion", () => {
  it("hello and a constructor prompt both reach the mocked LLM", async () => {
    const { runMacro, STATE, ctx } = await macroRuntime("chat-syn-guard");

    // Global corpus hit. A fresh member with an empty universe falls
    // through to dtusArray(), so this document is expanded on every turn.
    STATE.dtus.set("dtu-proto-poison", {
      id: "dtu-proto-poison",
      title: "constructor",
      tags: ["constructors", "prototype"],
      cretiHuman: "The constructor and constructors pattern, plus toString and __proto__.",
      ownerId: "system",
      tier: "regular",
      human: { summary: "constructor", bullets: ["valueOf", "hasOwnProperty"] },
    });

    let calls = 0;
    ctx.llm = {
      enabled: true,
      async chat() {
        calls += 1;
        return { ok: true, content: "mocked-brain-reply" };
      },
    };

    const hello = await runMacro("chat", "respond", {
      sessionId: "sess-syn-hello",
      prompt: "hello",
      llm: true,
      lens: "constructor",
    }, ctx);
    assert.equal(hello.error, undefined, JSON.stringify(hello));
    assert.equal(hello.ok, true, JSON.stringify(hello));
    assert.notEqual(hello.message, "syns is not iterable");
    assert.ok(calls >= 1, `hello must reach the LLM, calls=${calls}, reply=${hello.reply}`);
    assert.match(String(hello.reply || ""), /mocked-brain-reply/);

    const poisoned = await runMacro("chat", "respond", {
      sessionId: "sess-syn-poison",
      prompt: "explain constructor toString __proto__ valueOf hasOwnProperty",
      llm: true,
      lens: "toString",
    }, ctx);
    assert.equal(poisoned.ok, true, JSON.stringify(poisoned));
    assert.notEqual(poisoned.error, "macro_uncaught_throw");
    assert.ok(calls >= 2, `prototype-key prompt must reach the LLM, calls=${calls}`);
    assert.match(String(poisoned.reply || ""), /mocked-brain-reply/);
  });
});
