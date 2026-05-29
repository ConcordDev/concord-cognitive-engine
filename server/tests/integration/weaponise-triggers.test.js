/**
 * T2.1 — weaponise_at consumption.
 *
 * Pins:
 *   - the parser extracts structured triggers from authored prose
 *     (befriend / convene / expose / cross_reference / narrative)
 *   - seeding is idempotent on signature
 *   - befriending an NPC past the threshold fires its trigger exactly once,
 *     minting a citable revelation DTU and stamping fired_at
 *   - a below-threshold opinion does not fire
 *   - the secret excerpt surfaces in the revelation (player-facing), and the
 *     trigger never fires twice
 *
 * Run: node --test tests/integration/weaponise-triggers.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up261 } from "../../migrations/261_weaponise_triggers.js";
import {
  parseWeaponiseTrigger,
  seedWeaponiseTrigger,
  seedAllWeaponiseTriggers,
  checkBefriendTriggers,
  fireTrigger,
  BEFRIEND_OPINION_THRESHOLD,
} from "../../lib/embodied/weaponise-triggers.js";

function freshDb() {
  const db = new Database(":memory:");
  up261(db);
  // minimal world_npcs + dtus so resolve + revelation mint work
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, name TEXT);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, title TEXT, data TEXT, created_at INTEGER);
  `);
  return db;
}

describe("T2.1 — weaponise prose parser", () => {
  it("parses befriend triggers", () => {
    const t = parseWeaponiseTrigger("Befriend Kit; the pact's details surface.");
    assert.equal(t.kind, "befriend");
    assert.equal(t.requires.name, "Kit");
    assert.match(t.consequence, /pact/);
  });

  it("parses expose triggers", () => {
    const t = parseWeaponiseTrigger("Expose Jin and the patrol loses its only competent officer.");
    assert.equal(t.kind, "expose");
    assert.equal(t.requires.name, "Jin");
  });

  it("parses cross_reference triggers with two names", () => {
    const t = parseWeaponiseTrigger("Cross-reference Brann and Kiren; the impossible-print arc crosses worlds.");
    assert.equal(t.kind, "cross_reference");
    assert.deepEqual(t.requires.names, ["Brann", "Kiren"]);
  });

  it("parses convene triggers (Bring X to Y)", () => {
    const t = parseWeaponiseTrigger("Bring Kor to Taro; the Sifu's secret resurfaces, with consequences.");
    assert.equal(t.kind, "convene");
    assert.deepEqual(t.requires.names, ["Kor", "Taro"]);
  });

  it("falls back to narrative for unbindable prose", () => {
    const t = parseWeaponiseTrigger("Cross-world HLR alliance opens.");
    assert.equal(t.kind, "narrative");
  });
});

describe("T2.1 — seeding", () => {
  it("seeds from narrative_context.weaponise_at and is idempotent", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name) VALUES ('kit','w1','Kit Vance')`).run();
    const npc = {
      id: "npc-pactmaker", world_id: "w1",
      narrative_context: { weaponise_at: "Befriend Kit; the pact's details surface.", secret: "She signed the embassy pact in blood." },
    };
    const r1 = seedWeaponiseTrigger(db, npc);
    assert.equal(r1.ok, true);
    assert.equal(r1.kind, "befriend");
    const r2 = seedWeaponiseTrigger(db, npc); // re-seed
    assert.equal(r2.ok, true);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM weaponise_triggers`).get().n;
    assert.equal(count, 1, "idempotent on signature");
    // resolved Kit Vance -> 'kit'
    const row = db.prepare(`SELECT requires_json FROM weaponise_triggers`).get();
    assert.equal(JSON.parse(row.requires_json).resolvedId, "kit");
    db.close();
  });

  it("seedAll counts only NPCs with a weaponise_at", () => {
    const db = freshDb();
    const seeded = seedAllWeaponiseTriggers(db, [
      { id: "a", world_id: "w1", narrative_context: { weaponise_at: "Befriend Bo; x." } },
      { id: "b", world_id: "w1", narrative_context: {} },
      { id: "c", world_id: "w1" },
    ]);
    assert.equal(seeded, 1);
    db.close();
  });
});

describe("T2.1 — firing on befriend", () => {
  it("fires once when opinion crosses the threshold, minting a revelation", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO world_npcs (id, world_id, name) VALUES ('kit','w1','Kit')`).run();
    seedWeaponiseTrigger(db, {
      id: "kit", world_id: "w1",
      narrative_context: { weaponise_at: "Befriend Kit; the pact surfaces.", secret: "blood pact" },
    });

    // below threshold → no fire
    const below = checkBefriendTriggers(db, {
      userId: "u1", worldId: "w1", befriendedNpcId: "kit",
      opinionScore: BEFRIEND_OPINION_THRESHOLD - 1,
    });
    assert.equal(below.fired.length, 0);

    // at/above threshold → fires once
    const hit = checkBefriendTriggers(db, {
      userId: "u1", worldId: "w1", befriendedNpcId: "kit",
      opinionScore: BEFRIEND_OPINION_THRESHOLD + 5,
    });
    assert.equal(hit.fired.length, 1);
    const dtuId = hit.fired[0].revelationDtuId;
    const dtu = db.prepare(`SELECT type, data FROM dtus WHERE id = ?`).get(dtuId);
    assert.equal(dtu.type, "revelation");
    assert.match(JSON.parse(dtu.data).human, /blood pact/);

    // second crossing → no double fire
    const again = checkBefriendTriggers(db, {
      userId: "u1", worldId: "w1", befriendedNpcId: "kit",
      opinionScore: BEFRIEND_OPINION_THRESHOLD + 50,
    });
    assert.equal(again.fired.length, 0);
    db.close();
  });

  it("fireTrigger is idempotent on an already-fired row", () => {
    const db = freshDb();
    seedWeaponiseTrigger(db, {
      id: "n1", world_id: "w1",
      narrative_context: { weaponise_at: "Befriend Zed; x." },
    });
    const row = db.prepare(`SELECT * FROM weaponise_triggers`).get();
    const first = fireTrigger(db, row, { userId: "u1" });
    assert.equal(first.fired, true);
    const refetched = db.prepare(`SELECT * FROM weaponise_triggers`).get();
    const second = fireTrigger(db, refetched, { userId: "u1" });
    assert.equal(second.fired, false);
    db.close();
  });
});
