// Contract test for Wave 7 / A3b — temperament inheritance on death.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migTrace } from "../migrations/326_affect_trace_temperament.js";
import { inheritTemperament } from "../lib/npc-legacy.js";
import { birthTemperament } from "../lib/ecosystem/temperament.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, is_dead INTEGER DEFAULT 0)`);
  // inheritance link table (best-effort target of recordInheritanceLink)
  db.exec(`CREATE TABLE npc_inheritance_links (id TEXT PRIMARY KEY, deceased_npc_id TEXT, heir_npc_id TEXT, inherited_kind TEXT, source_id TEXT, detail_json TEXT, inherited_at INTEGER)`);
  migTrace(db); // adds world_npcs.temperament_json
  return db;
}

test("A3b — temperament inheritance on death", async (t) => {
  await t.test("heir inherits a blend biased toward a fearful parent", () => {
    const db = setupDb();
    const fearfulParent = { ...birthTemperament({ speciesId: "deer", seed: "p" }), FEAR: 0.95, PANIC: 0.9 };
    const braveHeir = { ...birthTemperament({ speciesId: "deer", seed: "h" }), FEAR: 0.1 };
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('dead', 'w', 'deer', ?)`).run(JSON.stringify(fearfulParent));
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('heir', 'w', 'deer', ?)`).run(JSON.stringify(braveHeir));

    const n = inheritTemperament(db, { id: "dead", archetype: "deer" }, { id: "heir", archetype: "deer" });
    assert.equal(n, 1);
    const after = JSON.parse(db.prepare(`SELECT temperament_json FROM world_npcs WHERE id='heir'`).get().temperament_json);
    assert.ok(DRIVE_KINDS.every((k) => Number.isFinite(after[k])), "valid 7-drive vector");
    assert.ok(after.FEAR > braveHeir.FEAR, "the fearful parent pulls the heir's FEAR up (the fossil of resistance)");
    // a link was recorded
    assert.ok(db.prepare(`SELECT 1 FROM npc_inheritance_links WHERE inherited_kind='temperament'`).get());
  });

  await t.test("deterministic: same deceased+heir inputs → same inherited vector", () => {
    // (onNpcDeath's legacy-exists guard ensures it runs once per death; here we pin
    //  that the blend itself is deterministic given identical inputs.)
    const db = setupDb();
    const parent = birthTemperament({ speciesId: "wolf", seed: "p2" });
    const heirStart = birthTemperament({ speciesId: "wolf", seed: "h2" });
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('d', 'w', 'wolf', ?)`).run(JSON.stringify(parent));
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('h1', 'w', 'wolf', ?)`).run(JSON.stringify(heirStart));
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('h2', 'w', 'wolf', ?)`).run(JSON.stringify(heirStart));
    // two distinct heirs with identical starting state + same deceased → identical result
    // requires the same seed key, so use the same heir id for both via separate DBs.
    inheritTemperament(db, { id: "d", archetype: "wolf" }, { id: "h1", archetype: "wolf" });
    const first = db.prepare(`SELECT temperament_json FROM world_npcs WHERE id='h1'`).get().temperament_json;
    // a fresh DB, same ids + same inputs → same output (determinism)
    const db2 = setupDb();
    db2.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('d', 'w', 'wolf', ?)`).run(JSON.stringify(parent));
    db2.prepare(`INSERT INTO world_npcs (id, world_id, archetype, temperament_json) VALUES ('h1', 'w', 'wolf', ?)`).run(JSON.stringify(heirStart));
    inheritTemperament(db2, { id: "d", archetype: "wolf" }, { id: "h1", archetype: "wolf" });
    const second = db2.prepare(`SELECT temperament_json FROM world_npcs WHERE id='h1'`).get().temperament_json;
    assert.equal(first, second, "same inputs → same inherited vector (deterministic seed)");
  });

  await t.test("no-op when the deceased has no temperament (graceful)", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES ('d', 'w', 'deer')`).run();
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype) VALUES ('h', 'w', 'deer')`).run();
    assert.equal(inheritTemperament(db, { id: "d" }, { id: "h" }), 0);
  });

  await t.test("no-op when the column is absent (mig pending) — never throws", () => {
    const bare = new Database(":memory:");
    bare.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT)`);
    assert.doesNotThrow(() => inheritTemperament(bare, { id: "a" }, { id: "b" }));
    assert.equal(inheritTemperament(bare, { id: "a" }, { id: "b" }), 0);
  });
});
