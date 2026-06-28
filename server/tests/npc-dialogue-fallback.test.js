/**
 * T1.1 — deterministic NPC dialogue fallback. When the LLM is unavailable the
 * NPC must still read as a grounded person (mood + activity + asymmetry), not
 * collapse to a flat 1-liner. Pure + deterministic; never leaks secrets.
 *
 * Run: node --test tests/npc-dialogue-fallback.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeDeterministicDialogue, composeDeterministicResponse } from "../lib/npc-dialogue-fallback.js";

describe("T1.1 — composeDeterministicDialogue", () => {
  it("is deterministic for the same (npc, mood)", () => {
    const a = composeDeterministicDialogue({ npcId: "n1", archetype: "guard", mood: "neutral" });
    const b = composeDeterministicDialogue({ npcId: "n1", archetype: "guard", mood: "neutral" });
    assert.deepEqual(a, b);
    assert.ok(a.greeting.length > 0);
  });

  it("hostile reputation forces a hostile mood + line", () => {
    const r = composeDeterministicDialogue({ npcId: "n2", mood: "friendly", isHostileRep: true });
    assert.equal(r.mood, "hostile");
    assert.notEqual(r.greeting, "");
  });

  it("weaves the current activity into the greeting when present", () => {
    const r = composeDeterministicDialogue({ npcId: "n_act", archetype: "trader", mood: "neutral", currentActivity: "trade" });
    // at least one neutral template references {act}; if chosen, 'minding the stall' appears.
    // Determinism means we can assert the placeholder is never left raw.
    assert.ok(!r.greeting.includes("{act}"));
    assert.ok(!r.greeting.includes("{fac}"));
  });

  it("surfaces interiority in subtext without leaking a secret", () => {
    const SECRET = "killed the old captain in cold blood";
    const r = composeDeterministicDialogue({
      npcId: "n3", mood: "hostile", isHostileRep: true,
      asymmetry: { grudge: "an old grievance" },
    });
    assert.ok(r.subtext && r.subtext.length > 0);
    assert.ok(!r.subtext.includes(SECRET));
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });

  it("friendly + desire produces a wanting subtext", () => {
    const r = composeDeterministicDialogue({ npcId: "n4", mood: "friendly", asymmetry: { desire: "a quiet want" } });
    assert.equal(r.mood, "friendly");
    assert.ok(r.subtext && /want/i.test(r.subtext));
  });

  it("falls back cleanly with no context (still mood-appropriate)", () => {
    const r = composeDeterministicDialogue({});
    assert.equal(r.mood, "neutral");
    assert.ok(r.greeting.length > 0);
  });

  it("normalizes 'warm' → friendly", () => {
    assert.equal(composeDeterministicDialogue({ npcId: "n5", mood: "warm" }).mood, "friendly");
  });
});

describe("composeDeterministicResponse (PLAYTEST #1 — /dialogue/respond fallback)", () => {
  const CHOICES = ["quest", "trade", "ask_work", "ask_world", "goodbye"];

  it("produces a non-empty in-character reply for every valid choice", () => {
    for (const choice of CHOICES) {
      const r = composeDeterministicResponse({ npcId: "n1", npcName: "Maren", archetype: "trader", job: "merchant", choice });
      assert.equal(typeof r, "string");
      assert.ok(r.length > 0, `empty response for ${choice}`);
      // The flat stub must never appear.
      assert.ok(!/responds to your choice/i.test(r), `flat stub leaked for ${choice}`);
    }
  });

  it("is deterministic (same inputs → same line)", () => {
    const a = composeDeterministicResponse({ npcId: "n2", choice: "ask_world", faction: "iron_pact" });
    const b = composeDeterministicResponse({ npcId: "n2", choice: "ask_world", faction: "iron_pact" });
    assert.equal(a, b);
  });

  it("fills the quest title into the quest reply when present", () => {
    const r = composeDeterministicResponse({ npcId: "n3", choice: "quest", questTitle: "The Sunken Bell" });
    assert.ok(r.includes("The Sunken Bell"), `quest title not woven in: ${r}`);
    assert.ok(!r.includes("{quest}"), "unfilled {quest} placeholder");
  });

  it("never leaves unfilled placeholders and degrades with no context", () => {
    const r = composeDeterministicResponse({ choice: "trade" });
    assert.ok(!/\{(job|fac|quest)\}/.test(r), `unfilled placeholder: ${r}`);
    assert.ok(r.length > 0);
  });

  it("unknown choice degrades to a world-rumor reply (no throw)", () => {
    const r = composeDeterministicResponse({ npcId: "n6", choice: "not_a_real_choice" });
    assert.ok(r.length > 0);
  });
});
