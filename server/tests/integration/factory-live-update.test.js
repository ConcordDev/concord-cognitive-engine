// Phase Z10 — DB12 factory live update integration test.
// Place chest+belt+crafter → connect → tickClaimFactory → verify item moved.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upFactory } from "../../migrations/254_claim_entities.js";
import {
  placeEntity,
  depositToEntity,
  tickClaimFactory,
  connectEntities,
  getInventory,
  listEntities,
} from "../../lib/factory.js";

function bootDb() {
  const db = new Database(":memory:");
  // factory.js's isOwner predicate reads from land_claims — stub.
  db.exec(`
    CREATE TABLE IF NOT EXISTS land_claims (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      world_id TEXT
    );
  `);
  upFactory(db);
  // Seed a land claim owned by our test user.
  db.prepare(`INSERT INTO land_claims (id, owner_user_id, world_id) VALUES (?, ?, ?)`)
    .run("claim_a", "u_owner", "concordia-hub");
  return db;
}

const owner = (uid, claimId) => uid === "u_owner" && claimId === "claim_a";

describe("Phase Z10 / DB12 — factory live update", () => {
  it("places entities, connects them, ticks, items move along belts", () => {
    const db = bootDb();

    const chest = placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "chest", tileX: 0, tileY: 0, isOwner: owner });
    const belt  = placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "belt", tileX: 1, tileY: 0, isOwner: owner });
    const sink  = placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "chest", tileX: 2, tileY: 0, isOwner: owner });
    assert.equal(chest.ok, true);
    assert.equal(belt.ok, true);
    assert.equal(sink.ok, true);

    // Wire: belt → sink. (tickClaimFactory only moves items FROM belts to
    // their first connection — chests act as terminal sinks, not auto-feeders.)
    assert.equal(connectEntities(db, "u_owner", belt.entityId, sink.entityId, { isOwner: owner }).ok, true);

    // Seed the belt with items.
    assert.equal(depositToEntity(db, belt.entityId, { itemDescriptor: "ore", quantity: 3 }).ok, true);

    // Tick — one cycle moves one unit belt → sink.
    const tick = tickClaimFactory(db, "claim_a");
    assert.equal(tick.ok, true);
    assert.ok(tick.moved >= 1, `expected moved >= 1, got ${tick.moved}`);

    const sinkInv = getInventory(db, sink.entityId);
    assert.ok(sinkInv.length > 0, "sink should have received at least one item");
    assert.equal(sinkInv[0].item_descriptor, "ore");
  });

  it("placeEntity rejects on non-owner", () => {
    const db = bootDb();
    const r = placeEntity(db, "u_intruder", { claimId: "claim_a", entityType: "chest", tileX: 0, tileY: 0, isOwner: owner });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_claim_owner");
  });

  it("placeEntity enforces tile uniqueness", () => {
    const db = bootDb();
    placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "chest", tileX: 5, tileY: 5, isOwner: owner });
    const dup = placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "belt", tileX: 5, tileY: 5, isOwner: owner });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "tile_occupied");
  });

  it("listEntities returns all placed entities in claim", () => {
    const db = bootDb();
    placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "chest", tileX: 0, tileY: 0, isOwner: owner });
    placeEntity(db, "u_owner", { claimId: "claim_a", entityType: "crafter", tileX: 1, tileY: 1, isOwner: owner });
    const ents = listEntities(db, "claim_a");
    assert.equal(ents.length, 2);
  });
});
