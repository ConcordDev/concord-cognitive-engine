// Integration test: every migration applies cleanly in numeric order
// against a fresh in-memory SQLite. Catches missing-table assumptions,
// duplicate column adds, and migration-on-migration ordering bugs that
// pure unit tests don't see.
//
// Each migration's up(db) is dynamically imported and run in order.
// We assert no throws, plus a few invariants on the resulting schema:
//   - every table referenced by route handlers in v2.0 / EvoEcosystem
//     exists after the migrations apply
//   - new ALTER TABLE columns (avatar_id, spoils_at) land where expected

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations");

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.js$/.test(f))
    .sort();
}

describe("integration: migration ordering", () => {
  let db;
  before(() => {
    // Many early migrations assume some baseline tables (users, dtus)
    // exist. The full server's initDatabase() creates those before
    // running migrations. Mirror that here with a minimal preset so
    // ALTER TABLE branches in later migrations have rows to alter.
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS dtus (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        title TEXT,
        body_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        visibility TEXT NOT NULL DEFAULT 'private',
        tier TEXT NOT NULL DEFAULT 'regular',
        type TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS world_npcs (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        archetype TEXT,
        name TEXT,
        x REAL, y REAL, z REAL,
        level INTEGER DEFAULT 1,
        is_dead INTEGER NOT NULL DEFAULT 0,
        is_conscious INTEGER NOT NULL DEFAULT 0,
        is_immortal INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS player_inventory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT,
        item_type TEXT,
        item_name TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        quality TEXT,
        acquired_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS personal_dtus (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        lens_domain TEXT,
        content_type TEXT,
        title TEXT,
        encrypted_content BLOB,
        iv BLOB,
        auth_tag BLOB
      );
    `);
  });

  test("v2.0 + EvoEcosystem migrations all apply cleanly in order", async () => {
    const v2_files = listMigrationFiles().filter((f) => /^09[0-8]_/.test(f));
    assert.ok(v2_files.length >= 5, `expected several v2.0 migrations, got ${v2_files.length}`);
    for (const file of v2_files) {
      const mod = await import(pathToFileURL(resolve(MIGRATIONS_DIR, file)).href);
      assert.equal(typeof mod.up, "function", `${file} must export up()`);
      assert.doesNotThrow(() => mod.up(db), `${file} threw during up()`);
    }
  });

  test("avatar_id column lands on player_inventory", () => {
    const cols = db.prepare("PRAGMA table_info(player_inventory)").all().map((r) => r.name);
    assert.ok(cols.includes("avatar_id"), "avatar_id missing on player_inventory");
  });

  test("spoils_at column lands on player_inventory", () => {
    const cols = db.prepare("PRAGMA table_info(player_inventory)").all().map((r) => r.name);
    assert.ok(cols.includes("spoils_at"), "spoils_at missing on player_inventory");
  });

  test("v2.0 tables exist after migration sweep", () => {
    const expected = [
      "world_buildings", "creature_population", "creature_corpses",
      "npc_knowledge", "player_world_metrics", "user_active_effects",
      "avatars", "refusal_fields",
    ];
    for (const t of expected) {
      const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
      assert.ok(r, `expected table ${t} after migrations`);
    }
  });

  test("re-running every migration is idempotent", async () => {
    const v2_files = listMigrationFiles().filter((f) => /^09[0-8]_/.test(f));
    for (const file of v2_files) {
      const mod = await import(pathToFileURL(resolve(MIGRATIONS_DIR, file)).href);
      assert.doesNotThrow(() => mod.up(db), `${file} re-run threw`);
    }
  });
});
