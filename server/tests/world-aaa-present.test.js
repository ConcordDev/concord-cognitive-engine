import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { packAaaSnapshot } from "../lib/world-aaa-present.js";

describe("packAaaSnapshot", () => {
  it("returns empty live rows and authored lore when tables are missing", () => {
    const extra = packAaaSnapshot({}, "concordia-hub", { userId: "u1" });
    assert.ok(Array.isArray(extra.npcs));
    assert.equal(extra.npcs.length, 0);
    assert.ok(Array.isArray(extra.quests));
    assert.ok(extra.quests.some((q) => q.id === "founding_day_01_gather"));
    assert.ok(Array.isArray(extra.lore));
    assert.ok(extra.lore.some((b) => b.id === "hub_the_heart_claimed"));
    assert.equal(extra.refusal.id, "the_ninth");
    assert.equal(extra.voice.cellM, 50);
  });

  it("lists kernel quests alongside authored ones", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE lattice_born_quests (
        id TEXT PRIMARY KEY, title TEXT, status TEXT, kind TEXT, world_id TEXT
      );
    `);
    db.prepare(`INSERT INTO lattice_born_quests VALUES ('q-lat','Lattice thread','open','rumor','concordia-hub')`).run();
    const extra = packAaaSnapshot(db, "concordia-hub", { userId: "u1" });
    assert.ok(extra.quests.some((q) => q.id === "q-lat"));
    assert.ok(extra.quests.some((q) => q.id === "founding_day_01_gather"));
  });
});
