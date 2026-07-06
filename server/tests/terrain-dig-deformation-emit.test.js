// Verification-audit fix — pinning test for a real dead-event-listener +
// shape-mismatch bug: terrain.dig's realtime emit used the WRONG event
// name (frontend listened for 'world:deformation', nothing ever emitted
// it) AND, even after fixing the name, would have sent a payload shape
// ({cell, newDelta, newElevation, kind}) totally incompatible with the
// frontend's DeformationRecord ({id, type, entityId, x, y, z, timestamp}).
// Multiplayer terrain-dig sync was fully non-functional for other players.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";

let registerTerrainMacros;
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

describe("terrain.dig — realtime emit shape matches the frontend's DeformationRecord", () => {
  let db;

  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, ?)`).run("terrain-test-world", "Terrain Test", "fantasy");
    registerTerrainMacros = (await import("../domains/terrain.js")).default;
    registerTerrainMacros(register);
  });

  it("emits 'concordia:terrain-deformed' with a real DeformationRecord shape (id, type, entityId, x/y/z, timestamp)", async () => {
    const emitted = [];
    const ctx = {
      db,
      actor: { userId: "user_dig_test" },
      realtime: {
        io: {
          to: (_room) => ({
            emit: (event, payload) => emitted.push({ event, payload }),
          }),
        },
      },
    };

    const fn = ACTIONS.get("terrain.dig");
    const r = await fn(ctx, { worldId: "terrain-test-world", x: 10, z: 20, amount: 1 });
    assert.equal(r.ok, true, `dig should succeed: ${r.reason}`);

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "concordia:terrain-deformed");
    const payload = emitted[0].payload;

    // The exact fields app/lenses/world/page.tsx's DeformationRecord
    // requires (lib/world-lens/world-deformation.ts) — a payload missing
    // any of these makes the frontend's `if (!rec?.id) return;` guard
    // silently drop the record, which is exactly the bug this pins.
    assert.equal(typeof payload.id, "string");
    assert.ok(payload.id.length > 0);
    assert.equal(payload.type, "terrain_excavated");
    assert.equal(typeof payload.entityId, "string");
    assert.equal(typeof payload.x, "number");
    assert.equal(typeof payload.y, "number");
    assert.equal(typeof payload.z, "number");
    assert.equal(payload.x, 10);
    assert.equal(payload.z, 20);
    assert.equal(typeof payload.timestamp, "number");
  });
});
