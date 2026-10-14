/**
 * F4 — Join never demotes ruler; new resident is citizen; re-join is no-op.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up105 } from "../migrations/105_kingdoms.js";
import { foundKingdom, joinKingdom, listResidents } from "../lib/kingdom.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, owner_id TEXT, owner_type TEXT, type TEXT,
      tags_json TEXT, skill_level REAL DEFAULT 0
    )
  `);
  up105(db);
  return db;
}

describe("kingdoms F4 join role", () => {
  let db;
  let kingdomId;
  beforeEach(() => {
    db = setupDb();
    const r = foundKingdom(db, {
      rulerId: "ruler-1",
      regionPolygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      name: "Hold",
    });
    kingdomId = r.kingdomId;
  });

  it("ruler joins own kingdom -> role stays ruler", () => {
    const r = joinKingdom(db, kingdomId, "ruler-1");
    assert.equal(r.ok, true);
    assert.equal(r.alreadyResident, true);
    assert.equal(r.role, "ruler");
    const rows = listResidents(db, kingdomId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "ruler");
  });

  it("non-resident joins -> citizen", () => {
    const r = joinKingdom(db, kingdomId, "newbie");
    assert.equal(r.ok, true);
    assert.equal(r.role, "citizen");
    assert.equal(r.alreadyResident, undefined);
    const row = listResidents(db, kingdomId).find((x) => x.user_id === "newbie");
    assert.equal(row.role, "citizen");
  });

  it("repeat join -> still citizen, no dup row", () => {
    joinKingdom(db, kingdomId, "newbie");
    const again = joinKingdom(db, kingdomId, "newbie");
    assert.equal(again.ok, true);
    assert.equal(again.alreadyResident, true);
    assert.equal(again.role, "citizen");
    const rows = listResidents(db, kingdomId).filter((x) => x.user_id === "newbie");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, "citizen");
  });
});
