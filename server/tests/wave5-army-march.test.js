// server/tests/wave5-army-march.test.js
//
// Wave 5 / T2.4 — visible faction armies. War campaigns already advance
// numerically through war-skirmish-cycle.js. This wave makes every
// advance also emit `world:army-march` with the centroids of both
// factions' NPCs so the player sees the war as movement, not numbers.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { factionAnchor } from "../emergent/war-skirmish-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, faction TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0
    );
  `);

  // Aggressor faction has 4 NPCs clustered around (50, 50)
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, x, z) VALUES
    ('a1', 'w1', 'sovereign', 48, 50),
    ('a2', 'w1', 'sovereign', 52, 50),
    ('a3', 'w1', 'sovereign', 50, 48),
    ('a4', 'w1', 'sovereign', 50, 52)
  `).run();
  // Defender has 3 NPCs around (200, 200)
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, x, z) VALUES
    ('d1', 'w1', 'lattice', 198, 200),
    ('d2', 'w1', 'lattice', 202, 200),
    ('d3', 'w1', 'lattice', 200, 202)
  `).run();
  // Dead aggressor — excluded from centroid
  db.prepare(`INSERT INTO world_npcs (id, world_id, faction, x, z, is_dead) VALUES
    ('a_dead', 'w1', 'sovereign', 0, 0, 1)
  `).run();
});

after(() => { db?.close(); });

describe("factionAnchor — centroid of living NPCs", () => {
  it("computes centroid for aggressor faction", () => {
    const a = factionAnchor(db, "w1", "sovereign");
    assert.ok(a);
    assert.equal(a.troopCount, 4);
    // The dead NPC at (0,0) shouldn't drag the centroid down.
    assert.ok(Math.abs(a.x - 50) < 1);
    assert.ok(Math.abs(a.z - 50) < 1);
  });

  it("computes centroid for defender faction", () => {
    const d = factionAnchor(db, "w1", "lattice");
    assert.ok(d);
    assert.equal(d.troopCount, 3);
    assert.ok(Math.abs(d.x - 200) < 1);
    assert.ok(Math.abs(d.z - 200.67) < 1);
  });

  it("returns null when faction has no living NPCs", () => {
    const ghost = factionAnchor(db, "w1", "nonexistent");
    assert.equal(ghost, null);
  });

  it("returns null for unknown world", () => {
    const ghost = factionAnchor(db, "nonsense", "sovereign");
    assert.equal(ghost, null);
  });
});
