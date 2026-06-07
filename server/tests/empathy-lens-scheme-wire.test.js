// Integration test for Wave 7 / E1 — empathy-lens wired into NPC scheme resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migLens } from "../migrations/328_npc_deception_lens.js";
import { advanceScheme } from "../lib/npc-schemes.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, temperament_json TEXT, x REAL, z REAL);
    CREATE TABLE affect_state (entity_id TEXT, world_id TEXT, v REAL, a REAL, PRIMARY KEY (entity_id, world_id));
    CREATE TABLE npc_schemes (
      id TEXT PRIMARY KEY, plotter_kind TEXT, plotter_id TEXT, target_kind TEXT, target_id TEXT,
      kind TEXT, motive TEXT, phase TEXT, success_pct REAL DEFAULT 50, accomplice_count INTEGER DEFAULT 0,
      evidence_count INTEGER DEFAULT 0, discovery_pct REAL DEFAULT 0, next_tick_at INTEGER, resolved_at INTEGER
    );
    CREATE TABLE npc_scheme_accomplices (scheme_id TEXT, npc_id TEXT);
    CREATE TABLE npc_scheme_evidence (id TEXT, scheme_id TEXT, evidence_kind TEXT, detail TEXT);
    CREATE TABLE character_opinions (npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL);
    CREATE TABLE npc_stress (npc_id TEXT, stress REAL DEFAULT 0);
  `);
  migLens(db);
  return db;
}
function seedScheme(db, { id = "s1", target = "victim", kind = "seduce", success = 50 }) {
  db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('plotter', 'w')`).run();
  db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES (?, 'w')`).run(target);
  db.prepare(`INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct)
    VALUES (?, 'npc', 'plotter', 'npc', ?, ?, 'moving', ?)`).run(id, target, kind, success);
}

test("E1 — empathy-lens in scheme resolution", async (t) => {
  await t.test("a naïve target is fooled — the deception scheme COMPLETES", () => {
    const db = setupDb();
    seedScheme(db, { id: "s1", target: "naive", kind: "seduce" });
    // naive target: no deception sensitivities → the con lands
    const r = advanceScheme(db, "s1");
    const phase = db.prepare(`SELECT phase FROM npc_schemes WHERE id='s1'`).get().phase;
    assert.equal(phase, "complete", "the seduction landed against a naïve lens");
    assert.notEqual(r.sawThrough, true);
  });

  await t.test("a con-spotting target catches it — EXPOSED + the lens drifts up", () => {
    const db = setupDb();
    seedScheme(db, { id: "s2", target: "wary", kind: "seduce" });
    // pre-seed a high seduction sensitivity → the target sees through
    db.prepare(`INSERT INTO npc_deception_lens (npc_id, tell_kind, sensitivity) VALUES ('wary','seduction',0.95)`).run();
    const before = db.prepare(`SELECT sensitivity FROM npc_deception_lens WHERE npc_id='wary'`).get().sensitivity;
    const r = advanceScheme(db, "s2");
    const phase = db.prepare(`SELECT phase FROM npc_schemes WHERE id='s2'`).get().phase;
    assert.equal(phase, "exposed", "the con-spotter caught the seduction");
    assert.equal(r.sawThrough, true);
    const after = db.prepare(`SELECT sensitivity FROM npc_deception_lens WHERE npc_id='wary'`).get().sensitivity;
    assert.ok(after >= before, "a caught con trains the mark further (asymmetric arms race)");
  });

  await t.test("getting conned TEACHES — a once-naïve mark reads the same con after being caught-out", () => {
    const db = setupDb();
    // simulate the mark having caught several cons (population learning) by drifting it
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('learner', 'w')`).run();
    db.prepare(`INSERT INTO npc_deception_lens (npc_id, tell_kind, sensitivity) VALUES ('learner','blackmail',0.9)`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id) VALUES ('plotter', 'w')`).run();
    db.prepare(`INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct)
      VALUES ('s3','npc','plotter','npc','learner','blackmail','moving',90)`).run();
    advanceScheme(db, "s3");
    // even at success_pct 90, the trained lens reads the blackmail → exposed
    assert.equal(db.prepare(`SELECT phase FROM npc_schemes WHERE id='s3'`).get().phase, "exposed");
  });

  await t.test("non-deception schemes + kill-switch keep the blind roll", () => {
    const db = setupDb();
    seedScheme(db, { id: "s4", target: "v", kind: "assassinate", success: 100 });
    advanceScheme(db, "s4", { rng: () => 0 }); // assassinate isn't a deception → roll path
    assert.equal(db.prepare(`SELECT phase FROM npc_schemes WHERE id='s4'`).get().phase, "complete");
  });
});
