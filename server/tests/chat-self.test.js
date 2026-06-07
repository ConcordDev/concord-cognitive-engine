// Contract test for "living chat" Layer 1 — the assistant's persistent felt self.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAffect } from "../migrations/110_affect_state.js";
import { classifyChatTurn, appraiseChatTurn, chatHookContext, feelChatTurn, readChatMood, assistantEntityId } from "../lib/chat-self.js";

function setupDb() {
  const db = new Database(":memory:");
  migAffect(db);
  return db;
}

test("Living chat — the assistant's felt self", async (t) => {
  await t.test("classifies the exchange from the user's tone", () => {
    assert.equal(classifyChatTurn("thank you so much, this is amazing"), "social_warm");
    assert.equal(classifyChatTurn("this is useless, you're wrong again"), "social_snub");
    assert.equal(classifyChatTurn("it works now, figured it out!"), "victory");
    assert.equal(classifyChatTurn("why does gravity bend light?"), "explore");
    assert.equal(classifyChatTurn("ok"), "idle");
  });

  await t.test("a warm exchange feels positive, a hostile one stings (mood-congruent)", () => {
    const warm = appraiseChatTurn("thank you, that was brilliant", { v: 0, a: 0.2 });
    const sting = appraiseChatTurn("this is garbage, you're useless", { v: 0, a: 0.2 });
    assert.ok(warm.valence > 0 && sting.valence < 0);
    assert.ok(warm.intensity > 0 && sting.intensity > 0);
  });

  await t.test("feelChatTurn persists a felt self that accumulates across turns", () => {
    const db = setupDb();
    const before = readChatMood(db, "u1");
    assert.equal(before.lit, false, "a fresh assistant is neutral");
    // a run of warm exchanges lifts its mood (affect is resilient, so it takes a few)
    for (let i = 0; i < 5; i++) feelChatTurn(db, "u1", "thank you so much, this is genuinely amazing work");
    const warm = readChatMood(db, "u1");
    assert.ok(warm.valence > before.valence, "the assistant's mood actually moved");
    assert.ok(warm.lit, "and is now lit (has a quale label)");
    assert.ok(typeof warm.quale === "string");
  });

  await t.test("hostility pulls the felt self negative; the state is per-user", () => {
    const db = setupDb();
    for (let i = 0; i < 6; i++) feelChatTurn(db, "u2", "you're stupid and useless, this is terrible garbage");
    const sour = readChatMood(db, "u2");
    assert.ok(sour.valence < 0, "a hostile user leaves the assistant's mood low");
    // a different user's assistant is untouched
    assert.equal(readChatMood(db, "u3").lit, false, "felt self is per-user");
    assert.equal(assistantEntityId("u2"), "assistant:u2");
  });

  await t.test("the dead hookChat now fires into the qualia engine", () => {
    const db = setupDb();
    const channels = {};
    globalThis.qualiaEngine = { batchUpdate: (_id, u) => Object.assign(channels, u) };
    try {
      feelChatTurn(db, "u4", "I'm so frustrated, this still doesn't work and I'm stuck again");
      assert.ok("emotional_resonance_os.distress_level" in channels, "hookChat moved the distress channel");
      assert.ok("delivery_os.directness" in channels, "hookChat moved the delivery channel");
    } finally { delete globalThis.qualiaEngine; }
  });

  await t.test("hookContext maps valence → distress/hope", () => {
    const sad = chatHookContext({ valence: -0.7, arousal: 0.6 }, "x");
    const glad = chatHookContext({ valence: 0.7, arousal: 0.3 }, "x");
    assert.ok(sad.distressLevel > 0 && sad.hopeLevel === 0);
    assert.ok(glad.hopeLevel > 0 && glad.distressLevel === 0);
  });

  await t.test("totality on garbage", () => {
    const db = setupDb();
    assert.doesNotThrow(() => feelChatTurn(db, null, null));
    assert.ok(readChatMood(db, null));
  });
});
