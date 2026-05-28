/**
 * T3.2 — Eight Refusals codex seeding.
 *
 * The user-authored cross-world codex is minted as citable DTUs (idempotent,
 * per-world-tagged) so the worldbuilding surfaces in lore/atlas lenses and
 * grounds oracle dialogue. Mirrors the proven Phase Z2 trivia-answer-DTU mint.
 *
 * Run: node --test tests/integration/codex-seed.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { seedCodex } from "../../lib/content-seeder.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_PATH = path.resolve(HERE, "..", "..", "..", "content", "codex", "eight-refusals.json");

// Minimal dtus table mirroring the columns seedCodex writes (the exact set the
// proven trivia-answer mint uses) + world_id (migration 225).
function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, kind TEXT, title TEXT, human_summary TEXT,
      created_at INTEGER, creator_id TEXT, scope TEXT, visibility TEXT, world_id TEXT
    );
  `);
  return db;
}

const codex = JSON.parse(readFileSync(CODEX_PATH, "utf8"));

describe("T3.2 — codex content integrity", () => {
  it("ships 8 refusals + the ninth, each mapped to a real world", () => {
    assert.equal(codex.refusals.length, 8, "exactly eight refusals");
    assert.ok(codex.the_ninth, "the ninth refusal present");
    const worlds = new Set(codex.refusals.map((r) => r.world_id));
    for (const w of ["sovereign-ruins", "tunya", "fantasy", "crime", "cyber", "concord-link-frontier", "superhero", "lattice-crucible"]) {
      assert.ok(worlds.has(w), `refusal mapped to ${w}`);
    }
  });
});

describe("T3.2 — codex seeds as citable DTUs", () => {
  it("mints the index + one DTU per refusal + the ninth (10 total)", () => {
    const db = setupDb();
    const minted = seedCodex(db, codex, { slug: "codex_eight_refusals" });
    assert.equal(minted, 10, `expected 10 codex DTUs, got ${minted}`);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM dtus WHERE kind = 'codex'`).get().c;
    assert.equal(count, 10);
  });

  it("tags each refusal DTU with its world_id", () => {
    const db = setupDb();
    seedCodex(db, codex, { slug: "codex_eight_refusals" });
    const cyber = db.prepare(`SELECT world_id, title FROM dtus WHERE id = 'codex_eight_refusals_refuse_numbers'`).get();
    assert.equal(cyber.world_id, "cyber");
    const ninth = db.prepare(`SELECT world_id FROM dtus WHERE id = 'codex_eight_refusals_the_ninth'`).get();
    assert.equal(ninth.world_id, "concordia-hub");
  });

  it("is idempotent — re-seeding mints nothing new", () => {
    const db = setupDb();
    seedCodex(db, codex, { slug: "codex_eight_refusals" });
    const second = seedCodex(db, codex, { slug: "codex_eight_refusals" });
    assert.equal(second, 0, "re-seed must not duplicate codex DTUs");
  });

  it("the codex DTUs are public + global so they're citable and lens-visible", () => {
    const db = setupDb();
    seedCodex(db, codex, { slug: "codex_eight_refusals" });
    const row = db.prepare(`SELECT scope, visibility, creator_id FROM dtus WHERE id = 'codex_eight_refusals_index'`).get();
    assert.equal(row.scope, "global");
    assert.equal(row.visibility, "public");
    assert.equal(row.creator_id, "system");
  });
});
