// Phase A Alive test — world mutates with no player, and the kernel does not
// invent deaths. 24 sim hours of tickWorldKernel.
//
//   cd server && node --test tests/world-kernel-alive.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up416 } from "../migrations/416_world_consequences.js";
import { up as up417 } from "../migrations/417_npc_living_world.js";
import { tickWorldKernel } from "../lib/world-kernel.js";
import { listConsequences, recordLeaderDeath } from "../lib/world-consequence.js";
import { applyPendingConsequences } from "../lib/consequence-apply.js";
import { freshNeeds } from "../lib/npc-needs.js";
import { memoriesFor } from "../lib/npc-memory.js";

function setup() {
  const db = new Database(":memory:");
  up416(db);
  up417(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      is_dead INTEGER NOT NULL DEFAULT 0,
      needs_json TEXT,
      faction TEXT
    );
  `);
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, is_dead, needs_json, faction)
    VALUES (?, 'concordia-hub', 0, ?, 'unburned-court')
  `).run("mara", JSON.stringify(freshNeeds()));
  return db;
}

describe("world-kernel Alive path", () => {
  it("24 sim hours with no player does not invent kills", () => {
    const db = setup();
    const before = listConsequences(db, { action: "kill", worldId: "concordia-hub" }).length;
    let last = null;
    for (let h = 0; h < 24; h++) {
      last = tickWorldKernel({ db, worldId: "concordia-hub", elapsedHours: 1 });
    }
    assert.equal(last.ok, true);
    assert.equal(last.organs.society.invented, false);
    assert.equal(last.organs.life.dbTouched, 1);
    const after = listConsequences(db, { action: "kill", worldId: "concordia-hub" }).length;
    assert.equal(after, before);
    const hunger = JSON.parse(
      db.prepare(`SELECT needs_json FROM world_npcs WHERE id = 'mara'`).get().needs_json,
    ).hunger;
    assert.ok(hunger > 0.5, `hunger should climb over 24h, got ${hunger}`);
  });

  it("a real leader death is remembered when applied", () => {
    const db = setup();
    recordLeaderDeath(db, {
      worldId: "concordia-hub",
      actorKind: "player",
      actorId: "p1",
      targetKind: "npc",
      targetId: "mara",
      factionId: "unburned-court",
    });
    const r = applyPendingConsequences(db);
    assert.equal(r.ok, true);
    assert.ok(r.applied >= 1);
    const mem = memoriesFor(db, "mara");
    assert.ok(mem.length >= 1);
    assert.equal(mem[0].category, "LOSS");
  });
});
