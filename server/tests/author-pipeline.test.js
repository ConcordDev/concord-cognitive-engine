/**
 * P0 — offline authoring pipeline golden test.
 * Generated NPCs pass the validate-gate, have unique ids, are grounded in the
 * bible (faction/lore refs), carry a ctOS profile, and a dry-run never writes.
 * Run: node --test tests/author-pipeline.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { gateBatch, validateNpc, validateFaction } from "../../scripts/author/validate-gate.mjs";
import { generateNpcs } from "../../scripts/author/generators.mjs";
import { runAuthor } from "../../scripts/author/author-content.mjs";

const bible = {
  world: "tunya",
  npcs: [{ id: "p1", name: "Existing One" }],
  factions: [{ id: "fac_dune", name: "Dune Wardens" }, { id: "fac_salt", name: "Salt Guild" }],
  lore: [{ id: "l1", title: "The Long Drought" }],
};

describe("validate-gate", () => {
  it("accepts valid, rejects malformed + duplicate ids", () => {
    const cands = [
      { id: "a", name: "A" },
      { id: "b" },                         // missing name
      { id: "a", name: "A2" },             // dup id
      { name: "C" },                       // missing id
      { id: "d", name: "D", faction_id: 7 }, // bad faction_id type
    ];
    const { valid, rejected } = gateBatch("npc", cands);
    assert.equal(valid.length, 1);
    assert.equal(valid[0].id, "a");
    const reasons = rejected.map((r) => r.reason).sort();
    assert.deepEqual(reasons, ["duplicate_id", "invalid_faction_id", "missing_id", "missing_name"]);
  });
  it("faction visual hex validation", () => {
    assert.equal(validateFaction({ id: "f", name: "F", visual: { primary_color: "#aabbcc", secondary_color: "#001122", accent_color: "#ffffff" } }).ok, true);
    assert.equal(validateFaction({ id: "f", name: "F", visual: { primary_color: "red", secondary_color: "#001122", accent_color: "#fff" } }).ok, false);
  });
});

describe("generateNpcs (ctOS, grounded, deterministic)", () => {
  it("produces N valid, unique, bible-grounded NPCs with a ctOS profile", () => {
    const npcs = generateNpcs(bible, 25, { startIndex: 0 });
    assert.equal(npcs.length, 25);
    const ids = new Set();
    for (const n of npcs) {
      assert.equal(validateNpc(n).ok, true);
      assert.ok(!ids.has(n.id), "ids unique"); ids.add(n.id);
      // grounded: faction_id from the bible
      assert.ok(["fac_dune", "fac_salt", null].includes(n.faction_id));
      // ctOS profile present
      assert.ok(n.narrative_context?.secret && n.narrative_context?.bio && n.job && n.wealth_tier);
      assert.ok(n.backstory && n.backstory.length > 10);
    }
    // determinism
    const again = generateNpcs(bible, 25, { startIndex: 0 });
    assert.equal(again[0].id, npcs[0].id);
    assert.equal(again[10].name, npcs[10].name);
  });
});

describe("runAuthor dry-run", () => {
  it("gates + summarizes without writing when --write absent", () => {
    const { summary, valid } = runAuthor({ world: "tunya", type: "npc", count: 15, write: false });
    assert.equal(summary.write, false);
    assert.ok(summary.valid > 0 && summary.valid <= 15);
    assert.equal(summary.valid, valid.length);
    assert.ok(summary.sample.length > 0 && summary.sample[0].bio);
  });
});
