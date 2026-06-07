// Contract test for Wave 7 / B4+D1 dialogue path — the NPC dialogue salience gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { npcDialogueSalience } from "../lib/npc-dialogue-salience.js";

test("NPC dialogue salience gate", async (t) => {
  await t.test("a calm, neutral, routine greeting is NOT salient (deterministic → zero LLM)", () => {
    const r = npcDialogueSalience({ mood: "neutral", opinion: 0.1, questCount: 0, asymmetry: null });
    assert.equal(r.salient, false);
    assert.equal(r.reason, "routine");
  });

  await t.test("hostility / grief / fear wake the LLM", () => {
    assert.equal(npcDialogueSalience({ mood: "hostile" }).salient, true);
    assert.equal(npcDialogueSalience({ isHostileRep: true }).salient, true);
    assert.equal(npcDialogueSalience({ mood: "grieving" }).salient, true);
    assert.equal(npcDialogueSalience({ mood: "fearful" }).salient, true);
  });

  await t.test("an asymmetric charge toward this player is salient", () => {
    assert.equal(npcDialogueSalience({ asymmetry: { grudge: "an old grievance" } }).salient, true);
    assert.equal(npcDialogueSalience({ asymmetry: { desire: "a quiet want" } }).salient, true);
  });

  await t.test("a quest to offer or a conscious NPC always deliberates", () => {
    assert.equal(npcDialogueSalience({ questCount: 1 }).salient, true);
    const conscious = npcDialogueSalience({ isConscious: true, mood: "neutral" });
    assert.equal(conscious.salient, true);
    assert.equal(conscious.reason, "conscious");
  });

  await t.test("a strong opinion (love or loathing) is more than small talk", () => {
    assert.equal(npcDialogueSalience({ opinion: -0.8 }).salient, true);
    assert.equal(npcDialogueSalience({ opinion: 0.05 }).salient, false);
  });

  await t.test("totality on garbage", () => {
    assert.equal(npcDialogueSalience(null).salient, false);
    assert.ok(npcDialogueSalience({}).score >= 0);
  });
});
