// Phase CC4 — factory automation tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  placeEntity, removeEntity, connectEntities, depositToEntity,
  tickClaimFactory, listEntities, getInventory,
} from "../lib/factory.js";
import { up as upFactory } from "../migrations/254_claim_entities.js";

function freshDb() { const db = new Database(":memory:"); upFactory(db); return db; }

const ownerYes = () => true;
const ownerNo = () => false;

describe("Phase CC4 — factory automation", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("placeEntity tile-uniqueness", () => {
    const a = placeEntity(db, "u1", { claimId: "lc-1", entityType: "chest", tileX: 0, tileY: 0, isOwner: ownerYes });
    assert.equal(a.ok, true);
    const b = placeEntity(db, "u1", { claimId: "lc-1", entityType: "belt", tileX: 0, tileY: 0, isOwner: ownerYes });
    assert.equal(b.ok, false);
    assert.equal(b.error, "tile_occupied");
  });

  it("non-owner cannot place", () => {
    const r = placeEntity(db, "intruder", { claimId: "lc-1", entityType: "chest", tileX: 0, tileY: 0, isOwner: ownerNo });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_claim_owner");
  });

  it("invalid entity_type rejected", () => {
    const r = placeEntity(db, "u1", { claimId: "lc-1", entityType: "blackhole", tileX: 0, tileY: 0, isOwner: ownerYes });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_type");
  });

  it("connectEntities adds target to source.connections_json", () => {
    const a = placeEntity(db, "u1", { claimId: "lc-1", entityType: "belt", tileX: 0, tileY: 0, isOwner: ownerYes });
    const b = placeEntity(db, "u1", { claimId: "lc-1", entityType: "chest", tileX: 1, tileY: 0, isOwner: ownerYes });
    const c = connectEntities(db, "u1", a.entityId, b.entityId, { isOwner: ownerYes });
    assert.equal(c.ok, true);
    const list = listEntities(db, "lc-1");
    const belt = list.find(e => e.id === a.entityId);
    assert.deepEqual(JSON.parse(belt.connections_json), [b.entityId]);
  });

  it("tick moves item from belt to its connection", () => {
    const belt = placeEntity(db, "u1", { claimId: "lc-1", entityType: "belt", tileX: 0, tileY: 0, isOwner: ownerYes });
    const chest = placeEntity(db, "u1", { claimId: "lc-1", entityType: "chest", tileX: 1, tileY: 0, isOwner: ownerYes });
    connectEntities(db, "u1", belt.entityId, chest.entityId, { isOwner: ownerYes });
    depositToEntity(db, belt.entityId, { itemDescriptor: "iron_ore", quantity: 3 });
    tickClaimFactory(db, "lc-1");
    const beltInv = getInventory(db, belt.entityId);
    const chestInv = getInventory(db, chest.entityId);
    assert.equal(beltInv[0].quantity, 2);
    assert.equal(chestInv[0].quantity, 1);
  });

  it("crafter consumes inputs + produces output per recipe", () => {
    const crafter = placeEntity(db, "u1", {
      claimId: "lc-1", entityType: "crafter", tileX: 0, tileY: 0, isOwner: ownerYes,
      config: { recipe: {
        inputs: [{ itemDescriptor: "iron_ore", quantity: 2 }],
        output: { itemDescriptor: "iron_ingot", quantity: 1 },
      }},
    });
    depositToEntity(db, crafter.entityId, { itemDescriptor: "iron_ore", quantity: 5 });
    tickClaimFactory(db, "lc-1");
    const inv = getInventory(db, crafter.entityId);
    const ore = inv.find(i => i.item_descriptor === "iron_ore");
    const ingot = inv.find(i => i.item_descriptor === "iron_ingot");
    assert.equal(ore.quantity, 3);
    assert.equal(ingot.quantity, 1);
  });

  it("crafter without inputs sufficient → no-op", () => {
    const crafter = placeEntity(db, "u1", {
      claimId: "lc-1", entityType: "crafter", tileX: 0, tileY: 0, isOwner: ownerYes,
      config: { recipe: {
        inputs: [{ itemDescriptor: "iron_ore", quantity: 10 }],
        output: { itemDescriptor: "iron_ingot", quantity: 1 },
      }},
    });
    depositToEntity(db, crafter.entityId, { itemDescriptor: "iron_ore", quantity: 5 });
    const r = tickClaimFactory(db, "lc-1");
    assert.equal(r.crafted, 0);
  });

  it("removeEntity wipes inventory + row", () => {
    const e = placeEntity(db, "u1", { claimId: "lc-1", entityType: "chest", tileX: 0, tileY: 0, isOwner: ownerYes });
    depositToEntity(db, e.entityId, { itemDescriptor: "x", quantity: 5 });
    removeEntity(db, "u1", e.entityId, { isOwner: ownerYes });
    assert.equal(listEntities(db, "lc-1").length, 0);
    assert.equal(getInventory(db, e.entityId).length, 0);
  });
});
