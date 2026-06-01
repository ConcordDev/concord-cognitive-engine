import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { snapshotWorld, restoreWorld, verifySnapshotIntegrity, assertPreservedAcross } from "../lib/world-snapshot.js";

// Axis D — persistence. A world's per-world state must snapshot + restore exactly
// (data-loss is the one unforgivable bug). PER_WORLD_WRITE_TABLES includes
// world_buildings; we exercise the round-trip with it.

function dbWithBuildings() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT, owner_id TEXT, health_pct REAL)`);
  db.prepare("INSERT INTO world_buildings VALUES ('b1','tunya','u1',1.0),('b2','tunya','u2',0.5),('b3','crime','u3',1.0)").run();
  return db;
}

test("snapshot captures only the target world's per-world rows", () => {
  const db = dbWithBuildings();
  const { ok, envelope } = snapshotWorld(db, "tunya");
  assert.equal(ok, true);
  assert.equal(envelope.tables.world_buildings.length, 2); // b1,b2 — not crime's b3
  assert.ok(verifySnapshotIntegrity(envelope));
});

test("restore is exact + idempotent after destructive mutation", () => {
  const db = dbWithBuildings();
  const snap = snapshotWorld(db, "tunya").envelope;
  // Catastrophe: a bad op wipes + corrupts tunya's buildings.
  db.prepare("DELETE FROM world_buildings WHERE world_id='tunya'").run();
  db.prepare("INSERT INTO world_buildings VALUES ('garbage','tunya','x',0.1)").run();
  const r1 = restoreWorld(db, snap);
  assert.equal(r1.ok, true);
  const rows = db.prepare("SELECT id,health_pct FROM world_buildings WHERE world_id='tunya' ORDER BY id").all();
  assert.deepEqual(rows, [{ id: "b1", health_pct: 1.0 }, { id: "b2", health_pct: 0.5 }]);
  // Idempotent: restoring again yields the same state.
  restoreWorld(db, snap);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM world_buildings WHERE world_id='tunya'").get().c, 2);
  // crime untouched throughout.
  assert.equal(db.prepare("SELECT COUNT(*) c FROM world_buildings WHERE world_id='crime'").get().c, 1);
});

test("a tampered envelope is refused", () => {
  const db = dbWithBuildings();
  const snap = snapshotWorld(db, "tunya").envelope;
  snap.tables.world_buildings[0].health_pct = 999; // tamper without re-hashing
  assert.equal(verifySnapshotIntegrity(snap), false);
  assert.equal(restoreWorld(db, snap).ok, false);
});

test("migration-preservation: a row-dropping migration is caught", () => {
  const db = dbWithBuildings();
  const good = assertPreservedAcross(db, "tunya", (d) => d.exec("UPDATE world_buildings SET health_pct=0.9 WHERE world_id='tunya'"));
  assert.equal(good.preserved, true);
  const bad = assertPreservedAcross(db, "tunya", (d) => d.exec("DELETE FROM world_buildings WHERE id='b1'"));
  assert.equal(bad.preserved, false);
  assert.equal(bad.missing[0].table, "world_buildings");
});
