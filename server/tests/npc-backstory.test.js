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

  // 2026-07 depth pass — widened trait/secret pools + varied closer + genre
  // filtering. Pins: (1) real variety across many seeded NPCs in the same
  // world/archetype (not a single recycled sentence), (2) genre-tagged pool
  // selection keeps hub theology out of non-hub worlds and vice versa,
  // (3) the closer line is drawn from a pool, not a single fixed sentence,
  // (4) determinism survives the widened pools.
  describe("widened pool variety + genre-flavor filtering (2026-07)", () => {
    it("produces varied output across many seeded NPCs of the same archetype/world (not all-identical)", () => {
      const outputs = new Set();
      for (let i = 0; i < 40; i++) {
        const npc = { id: `varietycheck_cyber_${i}`, archetype: "trader" };
        outputs.add(composeDeterministicBackstory(npc, { id: "f" }, { worldId: "cyber" }));
      }
      // With 5 openers x 3 world hints x 10 quirks x 8 secrets x 6 closers,
      // 40 distinct seeds should produce well more than a handful of unique
      // paragraphs — a single recycled template would collapse this to 1.
      assert.ok(outputs.size > 20, `expected strong variety, got ${outputs.size}/40 unique outputs`);
    });

    it("varies the closing line across seeded NPCs (not a single fixed sentence every time)", () => {
      const closers = new Set();
      for (let i = 0; i < 30; i++) {
        const npc = { id: `closercheck_${i}`, archetype: "guard" };
        const out = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "fantasy" });
        // Closer is always the final sentence of the composed prose.
        const sentences = out.split(". ");
        closers.add(sentences[sentences.length - 1]);
      }
      assert.ok(closers.size > 1, "expected more than one distinct closer across 30 seeded NPCs");
    });

    it("cyber-world NPCs never draw hub-theology flavor (Refusal/hymn language)", () => {
      for (let i = 0; i < 30; i++) {
        const npc = { id: `genrecheck_cyber_${i}`, archetype: "scholar" };
        const out = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "cyber" });
        assert.ok(!/refusal|hymn|sovereign's first/i.test(out), `hub theology leaked into a cyber NPC: ${out}`);
      }
    });

    it("hub-world NPCs can draw the hub theology pool (sanity check the pool is reachable at all)", () => {
      let sawTheologyFlavor = false;
      for (let i = 0; i < 40; i++) {
        const npc = { id: `genrecheck_hub_${i}`, archetype: "mystic" };
        const out = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "concordia-hub" });
        if (/refusal|hymn|glyph/i.test(out)) sawTheologyFlavor = true;
      }
      assert.ok(sawTheologyFlavor, "expected at least one hub NPC to draw hub-flavored theology language");
    });

    it("unknown/missing world falls back to the standard genre pool without throwing", () => {
      const npc = { id: "genrecheck_unknown_world", archetype: "hunter" };
      const out1 = composeDeterministicBackstory(npc, { id: "f" }, { worldId: "some-future-world" });
      const out2 = composeDeterministicBackstory(npc, { id: "f" }, null);
      assert.ok(out1.length > 30);
      assert.ok(out2.length > 30);
    });

    it("remains deterministic (same id → same output) even with the widened pools", () => {
      const npc = { id: "determinism_check_wide", archetype: "healer", ancestry: { primary_bloodline: "moss-kin", dilution: 0.6 } };
      const a = composeDeterministicBackstory(npc, { id: "f", displayName: "Moss Circle" }, { worldId: "fantasy" });
      const b = composeDeterministicBackstory(npc, { id: "f", displayName: "Moss Circle" }, { worldId: "fantasy" });
      assert.equal(a, b);
    });
  });
});
