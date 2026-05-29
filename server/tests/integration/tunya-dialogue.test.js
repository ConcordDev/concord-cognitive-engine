/**
 * H2 — tunya leader dialogue trees + improvised-fallback labelling.
 *
 * Pins:
 *   - the 3 authored tunya leader idle trees load from content/dialogues/
 *   - getAuthoredDialogue resolves them by npcId (idle fallback)
 *   - the trees never leak the NPCs' narrative_context.secret (canary)
 *
 * Run: node --test tests/integration/tunya-dialogue.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upAsymmetry } from "../../migrations/128_npc_asymmetry.js";
import { seedContent, getAuthoredDialogue } from "../../lib/content-seeder.js";

const TUNYA_LEADERS = [
  "high_chancellor_xochi_aekon",
  "high_mason_torrek_masond",
  "high_healer_aerasi_medici",
];

// Secret fragments that must never appear in surfaced dialogue.
const FORBIDDEN = ["wormhole", "five thousand", "5000", "stranded transit"];

describe("H2 — tunya leader dialogue", () => {
  it("loads + resolves the three leader idle trees, secret-free", async () => {
    const db = new Database(":memory:");
    upAsymmetry(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS world_npcs (id TEXT, world_id TEXT, x REAL, y REAL, z REAL, npc_data_json TEXT, PRIMARY KEY(id, world_id));
      CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, human_summary TEXT, created_at INTEGER, creator_id TEXT, scope TEXT, visibility TEXT);
      CREATE TABLE IF NOT EXISTS factions (id TEXT PRIMARY KEY, name TEXT);
      INSERT OR IGNORE INTO users (id) VALUES ('system');
    `);
    await seedContent({ db });

    for (const npcId of TUNYA_LEADERS) {
      const tree = getAuthoredDialogue(npcId, "idle", null) || getAuthoredDialogue(npcId);
      assert.ok(tree, `${npcId}: no authored idle tree resolved`);
      assert.ok(tree.greeting && tree.greeting.length > 20, `${npcId}: greeting too thin`);
      assert.ok(Array.isArray(tree.nodes) && tree.nodes.length >= 3, `${npcId}: too few nodes`);
      // Every node has either playerOptions or is terminal.
      for (const n of tree.nodes) {
        assert.ok(n.npcText, `${npcId}/${n.id}: missing npcText`);
        assert.ok(Array.isArray(n.playerOptions) || n.isTerminal, `${npcId}/${n.id}: dead-end node`);
      }
      // Secret canary.
      const blob = JSON.stringify(tree).toLowerCase();
      for (const f of FORBIDDEN) {
        assert.ok(!blob.includes(f), `${npcId}: leaks secret fragment "${f}"`);
      }
    }
    db.close();
  });
});
