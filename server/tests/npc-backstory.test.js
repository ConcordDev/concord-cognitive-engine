// Phase H — backstory composer contract.
//
// Pins: (1) deterministic composer is stable for the same NPC id,
// (2) bloodline ancestry produces a "descendant of" sentence,
// (3) world flavor hint is inserted, (4) LLM path falls back to
// deterministic on failure, (5) ARCHETYPE_OPENERS covers all 7
// canonical archetypes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeDeterministicBackstory, composeLlmBackstory } from "../lib/npc-backstory.js";

describe("Phase H — npc backstory composer", () => {
  it("deterministic composer is stable across calls", () => {
    const npc = { id: "gen_42", archetype: "warrior", factionId: "iron-band" };
    const faction = { id: "iron-band", displayName: "Iron Band" };
    const world = { worldId: "crime" };
    const a = composeDeterministicBackstory(npc, faction, world);
    const b = composeDeterministicBackstory(npc, faction, world);
    assert.equal(a, b);
  });

  it("bloodline ancestry produces a descendant sentence", () => {
    const npc = {
      id: "gen_99",
      archetype: "scholar",
      factionId: "scribes",
      ancestry: { primary_bloodline: "elder-vesh", dilution: 0.5 },
    };
    const out = composeDeterministicBackstory(npc, { id: "scribes" }, { worldId: "fantasy" });
    assert.ok(out.includes("elder-vesh"), "bloodline name appears in prose");
  });

  it("world flavor hint is included", () => {
    const npc = { id: "gen_7", archetype: "trader" };
    const tunya = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "tunya" });
    assert.ok(tunya.includes("long rains") || tunya.includes("green hours"), "tunya hint present");
    const cyber = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "cyber" });
    assert.ok(cyber.includes("neon") || cyber.includes("corps"), "cyber hint present");
  });

  it("ARCHETYPE_OPENERS covers all canonical archetypes", async () => {
    for (const archetype of ["warrior", "scholar", "trader", "mystic", "guard", "healer", "hunter"]) {
      const out = composeDeterministicBackstory({ id: `gen_${archetype}`, archetype }, null, null);
      assert.ok(out.length > 30, `archetype ${archetype} returns substantive prose`);
    }
  });

  it("LLM path falls back to deterministic on failure", async () => {
    process.env.CONCORD_PROCGEN_BACKSTORY_LLM = "true";
    const npc = { id: "gen_llm_fail", archetype: "warrior" };
    const failingLlm = {
      chat: async () => { throw new Error("network down"); },
    };
    const out = await composeLlmBackstory(npc, { id: "f" }, { worldId: "crime" }, failingLlm);
    // Should match the deterministic output for this NPC.
    const det = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "crime" });
    assert.equal(out, det);
    delete process.env.CONCORD_PROCGEN_BACKSTORY_LLM;
  });

  it("LLM path falls back when env flag is not set", async () => {
    delete process.env.CONCORD_PROCGEN_BACKSTORY_LLM;
    const npc = { id: "gen_no_flag", archetype: "warrior" };
    const llm = { chat: async () => ({ ok: true, text: "this should not be used" }) };
    const out = await composeLlmBackstory(npc, { id: "f" }, { worldId: "crime" }, llm);
    const det = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "crime" });
    assert.equal(out, det);
  });
});
