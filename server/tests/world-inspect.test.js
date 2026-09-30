import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { explainNpc } from "../lib/world-inspect.js";

describe("explainNpc", () => {
  it("fails honestly without a row", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, archetype TEXT, faction TEXT, state TEXT, world_id TEXT);`);
    const r = explainNpc(db, "missing");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });

  it("overlays authored public line and never copies secrets", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_npcs (
        id TEXT PRIMARY KEY, archetype TEXT, faction TEXT, state TEXT, world_id TEXT,
        is_wanted INTEGER, bounty INTEGER
      );
    `);
    db.prepare(`
      INSERT INTO world_npcs (id, archetype, faction, state, world_id, is_wanted, bounty)
      VALUES ('lord_curator_asbir_thelane', 'scholar', 'concordant_curators', ?, 'concordia-hub', 0, 0)
    `).run(JSON.stringify({ name: "Asbir Thelane" }));
    const r = explainNpc(db, "lord_curator_asbir_thelane", { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.equal(r.name, "Asbir Thelane");
    assert.match(r.authoredLine || "", /notebook/i);
    assert.doesNotMatch(JSON.stringify(r), /sealed wall-cavity/i);
    assert.doesNotMatch(r.why, /secret/i);
  });
});
