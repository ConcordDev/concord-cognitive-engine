// Sere ("Corrupt Earth") — the satirical homeworld the arks fled. Pins that the
// full content world seeds end-to-end against a freshly-migrated DB: the worlds
// row (with fiction provenance + rule modulators), authored NPCs WITH RESOLVED
// NAMES, the cross-world resonance edges (incl. the Sere->Tunya ark bridge), the
// intra-Sere Amon<->Pell arc bond, and the redacted secrets substrate.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedContent } from "../lib/content-seeder.js";

// seedContent() is idempotent via a module-level flag, so it only seeds once per
// process — memoize the seeded DB and share it across assertions.
let _dbPromise = null;
function seededDb() {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const db = new Database(":memory:");
      await runMigrations(db);
      globalThis._concordSTATE = { db };
      await seedContent({ db });
      return db;
    })();
  }
  return _dbPromise;
}

describe("Sere world seed", () => {
  it("registers the worlds row with fiction provenance + rule modulators", async () => {
    const db = await seededDb();
    const w = db.prepare("SELECT id, name, universe_type, rule_modulators, physics_modulators FROM worlds WHERE id='sere'").get();
    assert.ok(w, "worlds row 'sere' exists");
    assert.equal(w.name, "Corrupt Earth");
    assert.equal(w.universe_type, "sere");
    const rule = JSON.parse(w.rule_modulators || "{}");
    assert.equal(rule.fiction, "satire", "fiction provenance travels on the world row (drives the banner)");
    assert.equal(rule.combat, true);
    assert.equal(JSON.parse(w.physics_modulators || "{}").shape, "earth");
  });

  it("seeds the authored cast with real (resolved) names, not archetype fallbacks", async () => {
    const db = await seededDb();
    const rows = db.prepare("SELECT id, state FROM world_npcs WHERE world_id='sere'").all();
    assert.ok(rows.length >= 8, `at least 8 Sere NPCs (got ${rows.length})`);
    const names = Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.state || "{}").name]));
    assert.equal(names.pell_of_keshar, "Pell");
    assert.equal(names.dreamer_amon_dov, "Amon of the Reach");
    assert.equal(names.esha_of_the_open_table, "Esha Varan");
  });

  it("seeds cross-world resonance edges incl. the Sere->Tunya ark bridge", async () => {
    const db = await seededDb();
    const edges = db.prepare("SELECT from_npc_id, to_world_id, to_npc_id FROM cross_npc_relationships WHERE from_world_id='sere'").all();
    assert.ok(edges.length >= 6, `>=6 cross-world edges (got ${edges.length})`);
    assert.ok(edges.some((e) => e.to_world_id === "tunya" && e.to_npc_id === "warlord_iyatte_sanguire"),
      "Lysandra -> Tunya warlord (the Sere<->Tunya / ark-homeworld bridge)");
    assert.ok(edges.some((e) => e.to_world_id === "concordia-hub" && e.to_npc_id === "old_seam"),
      "Esha -> hub Old Seam (mentor of the failed coalition)");
  });

  it("seeds the intra-Sere Amon<->Pell arc bond (NOT a dead cross-world edge)", async () => {
    const db = await seededDb();
    const rels = db.prepare("SELECT npc_id, related_id, rel_type FROM npc_relationships WHERE npc_id IN ('dreamer_amon_dov','pell_of_keshar')").all();
    assert.ok(rels.some((r) => r.npc_id === "dreamer_amon_dov" && r.related_id === "pell_of_keshar" && r.rel_type === "friend"));
    assert.ok(rels.some((r) => r.npc_id === "pell_of_keshar" && r.related_id === "dreamer_amon_dov" && r.rel_type === "friend"));
    // and crucially NOT seeded as cross-world edges to non-worlds "keshar"/"dovrane"
    const bad = db.prepare("SELECT COUNT(*) n FROM cross_npc_relationships WHERE to_world_id IN ('keshar','dovrane')").get().n;
    assert.equal(bad, 0, "no dead cross-world edges to Sere factions mistaken for worlds");
  });

  it("ingests the authored NPC secrets into the redacted Curtain substrate", async () => {
    const db = await seededDb();
    const sereHolders = db.prepare(`
      SELECT COUNT(*) n FROM secrets s JOIN world_npcs w ON w.id = s.holder_npc_id WHERE w.world_id='sere'
    `).get().n;
    assert.ok(sereHolders >= 5, `Sere NPC secrets seeded redacted-by-default (got ${sereHolders})`);
  });
});
