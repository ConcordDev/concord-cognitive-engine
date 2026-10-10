/**
 * chat.respond synonym expansion threw "syns is not iterable" in production
 * (macro_uncaught_throw, domain chat, name respond). SYN_MAP is a plain
 * object, so a user token that is an Object.prototype key — "constructor"
 * survives tokenization; "toString" / "valueOf" / "hasOwnProperty" do the
 * same on a direct lookup — resolves to a function. That function is
 * truthy, and `for...of` throws because it is not iterable.
 *
 * Both expansion sites run on a live chat turn: expandQueryTokens on the
 * user message, expandTokensFromTokens on retrieved DTU text. The lens
 * affinity map in the same scoring block is the sibling lookup.
 *
 * One it() on purpose: the depth harness force-exits shortly after the
 * test that first booted the server finishes (see chat-style-learning-wire).
 *
 * Run: node --test tests/chat-syn-map-prototype.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

const PROTOTYPE_WORDS = [
  "constructor",
  "constructors",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
].join(" ");

describe("chat.respond synonym expansion ignores prototype keys", () => {
  it("does not throw when the message, a retrieved DTU, or the lens id is a prototype key", async () => {
    const { runMacro, STATE, ctx } = await macroRuntime("chat-syn-proto");

    STATE.dtus.set("dtu-proto-keys", {
      id: "dtu-proto-keys",
      title: `Notes on ${PROTOTYPE_WORDS}`,
      tags: ["constructor", "toString", "valueOf", "hasOwnProperty"],
      human: { summary: `A note whose tokens include ${PROTOTYPE_WORDS}.` },
      cretiHuman: PROTOTYPE_WORDS,
      ownerId: ctx.actor.userId,
      meta: { visibility: "public" },
    });

    const r1 = await runMacro("chat", "respond", {
      sessionId: `sess-proto-${ctx.actor.userId}`,
      prompt: `please explain ${PROTOTYPE_WORDS} in plain language`,
      llm: false,
      lens: "constructor",
    }, ctx);
    assert.equal(
      r1.ok,
      true,
      `chat.respond threw or failed: ${r1.error || ""} ${r1.message || ""}`,
    );
    assert.notEqual(r1.message, "syns is not iterable");

    const r2 = await runMacro("chat", "respond", {
      sessionId: `sess-proto-lens-${ctx.actor.userId}`,
      prompt: "toString valueOf hasOwnProperty",
      llm: false,
      lens: "toString",
    }, ctx);
    assert.equal(
      r2.ok,
      true,
      `chat.respond threw or failed for lens toString: ${r2.error || ""} ${r2.message || ""}`,
    );
    assert.notEqual(r2.message, "syns is not iterable");
  });
});
