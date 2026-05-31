// Track 3 — mood tells. Pins moodFromStress banding + that the /npcs JOIN actually
// surfaces stress/coping/mood from npc_stress (the nameplate reads `mood`).
//
// Run: node --test tests/npc-mood-payload.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { moodFromStress, moodHasTell } from "../lib/npc-mood.js";

describe("moodFromStress banding", () => {
  it("coping trait wins; else stress bands", () => {
    assert.equal(moodFromStress(10, "drink"), "coping");   // locked coping wins
    assert.equal(moodFromStress(90, null), "breaking");
    assert.equal(moodFromStress(60, null), "tense");
    assert.equal(moodFromStress(20, null), "content");
    assert.equal(moodFromStress(40, null), "neutral");
    assert.equal(moodFromStress(null, null), null);        // no data → no tell
  });
  it("moodHasTell gates the surfaced ones", () => {
    assert.equal(moodHasTell("breaking"), true);
    assert.equal(moodHasTell("coping"), true);
    assert.equal(moodHasTell("neutral"), false);
    assert.equal(moodHasTell(null), false);
  });
});

describe("the /npcs JOIN surfaces mood", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a stressed NPC's stress + mood surface via the LEFT JOIN npc_stress", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, is_dead)
                VALUES ('npc_x','concordia-hub','scholar','{"x":1,"z":2}',0)`).run();
    db.prepare(`INSERT INTO npc_stress (npc_id, stress, coping_trait) VALUES ('npc_x', 82, NULL)`).run();
    const r = db.prepare(`
      SELECT n.id, n.current_location, st.stress AS npc_stress, st.coping_trait AS npc_coping
      FROM world_npcs n LEFT JOIN npc_stress st ON st.npc_id = n.id
      WHERE n.world_id = ? AND n.is_dead = 0
    `).get("concordia-hub");
    assert.equal(r.npc_stress, 82);
    assert.equal(moodFromStress(r.npc_stress, r.npc_coping), "breaking");
  });

  it("an un-stressed NPC joins to null (no tell)", () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, current_location, is_dead)
                VALUES ('npc_y','concordia-hub','guard','{"x":0,"z":0}',0)`).run();
    const r = db.prepare(`
      SELECT st.stress AS npc_stress, st.coping_trait AS npc_coping
      FROM world_npcs n LEFT JOIN npc_stress st ON st.npc_id = n.id WHERE n.id='npc_y'
    `).get();
    assert.equal(r.npc_stress, null);
    assert.equal(moodFromStress(r.npc_stress, r.npc_coping), null);
  });
});
