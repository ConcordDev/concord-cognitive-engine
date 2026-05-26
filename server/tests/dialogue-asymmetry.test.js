// server/tests/dialogue-asymmetry.test.js
//
// Verifies that NPC grudges/preoccupations/desires actually reach the
// LLM dialogue prompt. Before this commit the asymmetry was composed
// from the DB but never surfaced — `oracleDialogueTreeComposer` ignored
// the four asymmetry fields and the worlds.js dialogue endpoint built
// its prompt inline without calling buildNPCTraits.
//
// This test pins both fixes:
//   1. The prompt template includes the grudge/preoccupation/desire/opinion
//      lines when the traits are populated.
//   2. The template omits those lines when traits are absent (no empty noise).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

describe("oracleDialogueTreeComposer surfaces NPC asymmetry", () => {
  it("includes the four asymmetry lines when traits are populated", () => {
    const prompt = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: {
        name: "Maerith",
        personality: "guarded",
        role: "guard",
        persistent_grudge: "You took my brother in the Forge raid.",
        current_preoccupation: "My faction is at war.",
        desire_for_this_player: "Vouch for my cousin at the council vote.",
        current_opinion: -0.4,
      },
      playerRelationship: "neutral",
    });
    assert.ok(prompt.includes("Persistent grudge"), "grudge line missing");
    assert.ok(prompt.includes("You took my brother in the Forge raid."), "grudge text missing");
    assert.ok(prompt.includes("Current preoccupation"), "preoccupation line missing");
    assert.ok(prompt.includes("My faction is at war."), "preoccupation text missing");
    assert.ok(prompt.includes("What you privately want from this player"), "desire line missing");
    assert.ok(prompt.includes("Vouch for my cousin"), "desire text missing");
    assert.ok(prompt.includes("opinion of this player"), "opinion line missing");
    assert.ok(prompt.includes("-0.40"), "opinion value missing");
  });

  it("omits asymmetry lines when traits are absent (no empty noise)", () => {
    const prompt = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: {
        name: "Generic",
        personality: "neutral",
        role: "citizen",
      },
      playerRelationship: "neutral",
    });
    assert.ok(!prompt.includes("Persistent grudge"), "grudge line should not appear with empty trait");
    assert.ok(!prompt.includes("Current preoccupation"), "preoccupation line should not appear");
    assert.ok(!prompt.includes("What you privately want"), "desire line should not appear");
    assert.ok(!prompt.includes("opinion of this player"), "opinion line should not appear");
  });

  it("omits opinion when it's null/undefined but includes when it's 0", () => {
    const promptNull = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: { name: "X", current_opinion: null },
    });
    assert.ok(!promptNull.includes("opinion of this player"), "null opinion should omit");

    const promptZero = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: { name: "X", current_opinion: 0 },
    });
    assert.ok(promptZero.includes("opinion of this player"), "zero opinion should include (it's a valid value)");
    assert.ok(promptZero.includes("0.00"), "zero opinion should render");
  });

  it("includes partial asymmetry — grudge only, no preoccupation/desire", () => {
    const prompt = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: {
        name: "Echo",
        persistent_grudge: "You bought my rival's shipment.",
      },
    });
    assert.ok(prompt.includes("Persistent grudge"));
    assert.ok(prompt.includes("You bought my rival's shipment."));
    assert.ok(!prompt.includes("Current preoccupation"));
    assert.ok(!prompt.includes("What you privately want"));
  });
});
