// Test for Wave 7 / E4 — death is a felt event (Context 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migDeath } from "../migrations/329_legacy_death_appraisal.js";
import { recordDeathAppraisal } from "../lib/npc-legacy.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_legacies (id TEXT PRIMARY KEY, npc_id TEXT, world_id TEXT, died_at INTEGER, cause_of_death TEXT, last_words TEXT, tomb_x REAL, tomb_z REAL, faction TEXT, archetype TEXT);
    CREATE TABLE affect_state (entity_id TEXT, world_id TEXT, v REAL, a REAL, PRIMARY KEY (entity_id, world_id));
  `);
  migDeath(db); // adds npc_legacies.final_feltper_json
  return db;
}

test("E4 — death appraises as maximal-negative valence (grief)", async (t) => {
  await t.test("a killed NPC's legacy carries a maximal-negative feltPer labelled grief/despair", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO npc_legacies (id, npc_id, world_id, cause_of_death) VALUES ('lg1','elder','w','combat')`).run();
    const r = recordDeathAppraisal(db, { id: "elder", world_id: "w" }, "killer-player", "lg1");
    assert.equal(r.ok, true);
    assert.ok(r.feltPer.valence < -0.3, "death is strongly aversive");
    assert.ok(["grief", "despair", "dread", "fury"].includes(r.quale), `labelled a dark quale (${r.quale})`);
    // stamped onto the legacy row
    const row = db.prepare(`SELECT final_feltper_json FROM npc_legacies WHERE id='lg1'`).get();
    const stamped = JSON.parse(row.final_feltper_json);
    assert.equal(stamped.killerId, "killer-player");
    assert.ok(stamped.feltPer.valence < -0.3);
  });

  await t.test("there is no coded survive() — death is just the worst APPRAISAL", () => {
    // the mechanism is a felt-per, not a goal; the function returns an appraisal, not a drive
    const db = setupDb();
    db.prepare(`INSERT INTO npc_legacies (id, npc_id, cause_of_death) VALUES ('lg2','npc2','age')`).run();
    const r = recordDeathAppraisal(db, { id: "npc2" });
    assert.equal(typeof r.feltPer.valence, "number");
    assert.equal(r.feltPer.dominantDrive === "survive", false, "no survive drive — self-preservation emerges from the felt-per");
  });

  await t.test("never throws on a minimal DB (no column / no legacy row)", () => {
    const bare = new Database(":memory:");
    bare.exec(`CREATE TABLE npc_legacies (id TEXT PRIMARY KEY, npc_id TEXT)`);
    assert.doesNotThrow(() => recordDeathAppraisal(bare, { id: "x" }));
    assert.equal(recordDeathAppraisal(bare, { id: "x" }).ok, true);
  });
});
