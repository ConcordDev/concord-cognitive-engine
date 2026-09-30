import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/416_world_consequences.js";
import {
  recordConsequence,
  recordLeaderDeath,
  listConsequences,
} from "../lib/world-consequence.js";

function setup() {
  const db = new Database(":memory:");
  up(db);
  return db;
}

describe("world-consequence", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("records and lists a kindness", () => {
    const r = recordConsequence(db, {
      worldId: "concordia-hub",
      actorKind: "player",
      actorId: "p1",
      action: "kindness",
      targetKind: "npc",
      targetId: "mara",
      importance: 0.94,
      immediate: { emotion: "gratitude", relationship_delta: 38 },
    });
    assert.equal(r.ok, true);
    const rows = listConsequences(db, { targetId: "mara" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "kindness");
    assert.equal(rows[0].immediate.relationship_delta, 38);
  });

  it("rejects unknown actions", () => {
    assert.throws(() => recordConsequence(db, {
      actorKind: "player", actorId: "p1", action: "teleport",
    }), /unknown action/);
  });

  it("leader death writes kill + succession (world remembers)", () => {
    recordLeaderDeath(db, {
      worldId: "fantasy",
      actorKind: "player",
      actorId: "p1",
      targetKind: "npc",
      targetId: "king-vael",
      factionId: "sundering-guard",
      location: "ward-court",
    });
    const kills = listConsequences(db, { action: "kill", worldId: "fantasy" });
    const succ = listConsequences(db, { action: "succession", worldId: "fantasy" });
    assert.equal(kills.length, 1);
    assert.equal(succ.length, 1);
    assert.equal(kills[0].immediate.succession, true);
    assert.equal(succ[0].immediate.triggered_by, kills[0].id);
  });

  it("tryRecordConsequence never throws on a missing table", async () => {
    const { tryRecordConsequence } = await import("../lib/world-consequence.js");
    const bare = new Database(":memory:");
    const r = tryRecordConsequence(bare, {
      actorKind: "player", actorId: "p1", action: "kindness",
    });
    assert.equal(r.ok, false);
  });
});
