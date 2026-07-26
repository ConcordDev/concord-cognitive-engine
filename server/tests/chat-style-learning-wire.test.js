/**
 * Living chat / style learning — wiring test for the chat.respond → learnStyle
 * gap a grounding audit found: server/lib/initiative-engine.js#learnStyle
 * (EMA-based per-user style profile: message length, formality, emoji rate,
 * vocabulary) previously only ever fired from INSIDE the initiative
 * subsystem itself (generateDoubleText → _generateFollowUpText), or via the
 * real-but-uncalled POST /api/initiative/style/learn route (zero frontend
 * caller). A user's own chat turns never fed it.
 *
 * This boots the real server (in-memory, via the depth harness — the
 * established pattern for `register()`-family macros like `chat.respond`,
 * see tests/chat-intent-router-dispatch.test.js) and asserts, against the
 * REAL `user_style_profile` table, that a live `chat.respond` turn actually
 * persists a learned profile from the real message text — not a mock, not a
 * re-implemented copy of the logic.
 *
 * `llm: false` is passed so the macro takes its fully-supported no-LLM path
 * (the same flag server.js's own internal agent-mode caller uses,
 * `ctx.macro.run("chat","respond", {..., llm:false}, ctx)`) — the style-
 * learning block runs unconditionally, before the LLM branch is even
 * reached, so this proves the wiring without touching the network.
 *
 * NOTE on structure: every scenario below runs inside ONE `it()`, not one
 * `it()` per scenario. This harness's after()-hook teardown (tests/depth/
 * _harness.js) arms an unref'd 200ms force-exit watchdog once the test that
 * first called load() finishes; a SECOND full `chat.respond` call (each
 * takes several real seconds — DTU context harvest, token-budget assembly,
 * tool-call scaffolding, etc.) started in a sibling `it()` loses that race
 * and gets killed mid-flight (confirmed empirically: splitting these into
 * separate `it()`s truncates the run after test 1 with no error reported).
 * Keeping every chat.respond call inside the single test that owns the
 * boot avoids the race entirely — this is the same reason tests/depth/
 * chat-behavior.test.js's own header comment excludes chat.respond from its
 * many small its (it deliberately never calls the live macro at all).
 *
 * Run: node --test tests/chat-style-learning-wire.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime, load } from "./depth/_harness.js";

describe("chat.respond → initiative-engine.learnStyle wiring", () => {
  it("real chat.respond turns persist, EMA-update, and honestly no-op the learned style profile", async () => {
    const { runMacro, STATE, ctx } = await macroRuntime("chat-style-wire");
    const userId = ctx.actor.userId;
    const getProfile = () => STATE.db.prepare("SELECT * FROM user_style_profile WHERE user_id = ?").get(userId);

    // ── (a) no profile before any real chat turn ──────────────────────
    assert.equal(getProfile(), undefined);

    // ── (b) a live chat.respond turn persists a REAL learned profile
    //        derived from the actual message text (not a mock) ────────
    const casualMsg = "hey lol 😀😂 whats up dude gonna check this out no cap";
    const r1 = await runMacro("chat", "respond", { sessionId: `sess-${userId}`, prompt: casualMsg, llm: false }, ctx);
    assert.equal(r1.ok, true);

    const afterFirst = getProfile();
    assert.ok(afterFirst, "expected a user_style_profile row after a real chat turn");
    assert.ok(afterFirst.avg_message_length > 0);
    assert.ok(afterFirst.formality_level < 0.5, `expected casual formality, got ${afterFirst.formality_level}`);
    assert.ok(afterFirst.emoji_rate > 0, `expected nonzero emoji rate, got ${afterFirst.emoji_rate}`);
    const vocabAfterFirst = JSON.parse(afterFirst.vocabulary_json);
    assert.ok("dude" in vocabAfterFirst || "gonna" in vocabAfterFirst, "expected real vocabulary extracted from the message");
    const sharedAfterFirst = JSON.parse(afterFirst.shared_context_json);
    assert.equal(sharedAfterFirst.messageCount, 1);

    // ── (c) a SECOND real turn from the SAME user updates via EMA
    //        (blends toward the new message, doesn't overwrite) ────────
    const formalMsg = "Good afternoon. I would like to formally request an update, at your earliest convenience.";
    const r2 = await runMacro("chat", "respond", { sessionId: `sess-${userId}`, prompt: formalMsg, llm: false }, ctx);
    assert.equal(r2.ok, true);

    const afterSecond = getProfile();
    // EMA (alpha=0.2) blends toward formal but doesn't jump all the way —
    // it must move UP from the casual baseline, never all the way to the
    // single-message formal value (which was ~0.82 per the engine itself).
    assert.ok(afterSecond.formality_level > afterFirst.formality_level, "formality should have moved toward formal");
    assert.ok(afterSecond.formality_level < 0.82, "EMA must not overwrite — it should blend, not jump to the raw single-message value");
    const sharedAfterSecond = JSON.parse(afterSecond.shared_context_json);
    assert.equal(sharedAfterSecond.messageCount, 2, "both real turns should be counted");

    // ── (d) a chat turn with no resolvable userId degrades honestly:
    //        no crash, and it writes nothing (verified via count) ──────
    // Use a real, fully-formed internal ctx (same shape chat.respond needs
    // elsewhere — ctx.macro, ctx.llm, ctx.affect, etc.) and only null out
    // actor.userId, so this isolates the "no resolvable user" branch instead
    // of also tripping over an incomplete ctx shape.
    const { makeInternalCtx } = await load();
    const anonCtx = makeInternalCtx("chat-style-wire-anon");
    anonCtx.actor.userId = null;
    const beforeAnonCount = STATE.db.prepare("SELECT COUNT(*) as c FROM user_style_profile").get().c;
    const r3 = await runMacro("chat", "respond", { sessionId: "sess-anon-style", prompt: "hello there", llm: false }, anonCtx);
    assert.equal(r3.ok, true, "chat.respond must not throw when userId is unresolvable");
    const afterAnonCount = STATE.db.prepare("SELECT COUNT(*) as c FROM user_style_profile").get().c;
    assert.equal(afterAnonCount, beforeAnonCount, "no style profile should be written for an unresolvable user");
  });
});
