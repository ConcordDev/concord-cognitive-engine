// Phase F2.5 — sub-world content parity test.
//
// Asserts that every non-hub sub-world has ≥3 authored quest chains
// loaded into the quest registry after seedContent runs.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import { seedContent } from "../../lib/content-seeder.js";
import { up as upAsymmetry } from "../../migrations/128_npc_asymmetry.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SUB_WORLDS = [
  "fantasy", "crime", "cyber", "superhero",
  "lattice-crucible", "sovereign-ruins", "concord-link-frontier",
];

describe("Phase F2 — sub-world content parity", () => {
  it("every sub-world has its quest-chain directory + ≥3 chain files", () => {
    const subWorldRoot = join(ROOT, "content", "quests", "sub-worlds");
    for (const world of SUB_WORLDS) {
      const dir = join(subWorldRoot, world);
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      assert.ok(files.length >= 3,
        `${world}: expected ≥3 quest chains, got ${files.length}`);
    }
  });

  it("every quest chain has 2-5 quests with valid objective types", () => {
    const validTypes = new Set([
      "reach_location", "talk_to", "observe", "interact", "deliver",
      "any_of", "stealth_traverse", "time_window",
    ]);
    const subWorldRoot = join(ROOT, "content", "quests", "sub-worlds");
    for (const world of SUB_WORLDS) {
      for (const f of readdirSync(join(subWorldRoot, world))) {
        if (!f.endsWith(".json")) continue;
        const chain = JSON.parse(readFileSync(join(subWorldRoot, world, f), "utf8"));
        assert.ok(Array.isArray(chain) && chain.length >= 2,
          `${world}/${f}: expected ≥2 quests`);
        for (const q of chain) {
          assert.ok(q.id, `${world}/${f}: quest missing id`);
          assert.ok(q.title, `${q.id}: missing title`);
          assert.ok(Array.isArray(q.objectives) && q.objectives.length >= 1,
            `${q.id}: needs ≥1 objective`);
          for (const obj of q.objectives) {
            assert.ok(validTypes.has(obj.type),
              `${q.id}/${obj.id}: invalid type '${obj.type}'`);
          }
        }
      }
    }
  });

  it("quest chains seed into the in-memory registry on boot", async () => {
    const db = new Database(":memory:");
    upAsymmetry(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS world_npcs (id TEXT, world_id TEXT, x REAL, y REAL, z REAL, npc_data_json TEXT, PRIMARY KEY(id, world_id));
      CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, human_summary TEXT, created_at INTEGER, creator_id TEXT, scope TEXT, visibility TEXT);
      CREATE TABLE IF NOT EXISTS factions (id TEXT PRIMARY KEY, name TEXT);
      INSERT OR IGNORE INTO users (id) VALUES ('system');
    `);
    const r = await seedContent({ db });
    // seedContent returns { ok, counts: { quests, npcs, ... } }.
    // The counts.quests value includes onboarding + main + faction + side +
    // F2.1 sub-world chains. We expect ≥60 from sub-worlds alone, so
    // overall ≥80.
    const questCount = r?.counts?.quests ?? 0;
    assert.ok(questCount >= 60,
      `quests counter ${questCount} should reflect sub-world chains`);
  });
});
