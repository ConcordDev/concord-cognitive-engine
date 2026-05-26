// server/tests/wave4b-cavalry-scalar.test.js
//
// Wave 4b — cavalry damage scalar. When a player has a mounted companion
// (player_companions.mounted=1), combat damage is multiplied by 1.2×.
// If the mount has winged_* topology, the multiplier climbs to 1.3×
// (flight = stoop attacks). This file pins the multiplier math as a
// unit-style check against the same SQL the route runs.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

let db;

// Minimal reproduction of the cavalry check from routes/worlds.js so
// the test doesn't have to spin up the full route.
function applyCavalryScalar(db, userId, finalDamage) {
  try {
    const mountedRow = db.prepare(`
      SELECT id, blueprint_json FROM player_companions
      WHERE owner_id = ? AND mounted = 1
      LIMIT 1
    `).get(userId);
    if (mountedRow && Number.isFinite(finalDamage)) {
      let cavalryMul = 1.2;
      try {
        const bp = mountedRow.blueprint_json ? JSON.parse(mountedRow.blueprint_json) : null;
        if (typeof bp?.topology === "string" && bp.topology.startsWith("winged_")) cavalryMul = 1.3;
      } catch { /* ok */ }
      return { finalDamage: Math.round(finalDamage * cavalryMul * 10) / 10, cavalryMul, mountedId: mountedRow.id };
    }
  } catch { /* table optional */ }
  return { finalDamage, cavalryMul: 1.0, mountedId: null };
}

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_companions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, creature_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mounted INTEGER NOT NULL DEFAULT 0,
      blueprint_json TEXT,
      UNIQUE(owner_id, creature_id)
    );
  `);
  db.prepare(`INSERT INTO player_companions (id, owner_id, creature_id, name, mounted, blueprint_json) VALUES
    ('c_wolf',   'U1', 'h_wolf',   'Fang',    0, '{"topology":"quadruped"}'),
    ('c_dragon', 'U2', 'h_dragon', 'Drogon',  1, '{"topology":"winged_quadruped"}'),
    ('c_horse',  'U3', 'h_horse',  'Storm',   1, '{"topology":"quadruped"}')
  `).run();
});

after(() => { db?.close(); });

describe("Wave 4b — cavalry damage scalar", () => {
  it("unmounted attacker gets no scalar", () => {
    const r = applyCavalryScalar(db, "U1", 100);
    assert.equal(r.finalDamage, 100);
    assert.equal(r.cavalryMul, 1.0);
    assert.equal(r.mountedId, null);
  });

  it("ground mount gives 1.2×", () => {
    const r = applyCavalryScalar(db, "U3", 100);
    assert.equal(r.cavalryMul, 1.2);
    assert.equal(r.finalDamage, 120);
    assert.equal(r.mountedId, "c_horse");
  });

  it("winged mount gives 1.3× (stoop attack bonus)", () => {
    const r = applyCavalryScalar(db, "U2", 100);
    assert.equal(r.cavalryMul, 1.3);
    assert.equal(r.finalDamage, 130);
    assert.equal(r.mountedId, "c_dragon");
  });

  it("user with no companions row passes through cleanly", () => {
    const r = applyCavalryScalar(db, "U_ghost", 50);
    assert.equal(r.finalDamage, 50);
    assert.equal(r.cavalryMul, 1.0);
  });

  it("zero damage is preserved (no multiplication weirdness)", () => {
    const r = applyCavalryScalar(db, "U2", 0);
    assert.equal(r.finalDamage, 0);
  });

  it("multiplier rounds to one decimal place", () => {
    const r = applyCavalryScalar(db, "U2", 17);   // 17 × 1.3 = 22.1
    assert.equal(r.finalDamage, 22.1);
  });
});
