// server/tests/world-gathering-npc-node-fields.test.js
//
// 2026-07-21 — npcGatherFromNode's return only ever carried
// {resourceId, resourceName, amount, nodeId}; npc-simulator.js's
// gather_resource action wrote this into the DB and threw the rest away —
// no socket emit anywhere, so an NPC gathering was a completely silent
// state change ("It's hard to [depict NPCs gathering] with no rendered
// resource nodes or anything else"). This pins the extended return shape
// (nodeType/x/y/z) that server/lib/npc-simulator.js's new _emitGather now
// broadcasts as world:npc-gather.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { npcGatherFromNode, getNearbyNodes } from "../lib/world-gathering.js";

function seedNode(db, overrides = {}) {
  const node = {
    id: "node-test-1", world_id: "w1", node_type: "tree", resource_id: "wood",
    resource_name: "Wood", biome: "forest", x: 100, y: 5, z: 200,
    quantity_remaining: 100, max_quantity: 100,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO world_resource_nodes (id, world_id, node_type, resource_id, resource_name, biome, x, y, z, quantity_remaining, max_quantity)
    VALUES (@id, @world_id, @node_type, @resource_id, @resource_name, @biome, @x, @y, @z, @quantity_remaining, @max_quantity)
  `).run(node);
  return node;
}

describe("npcGatherFromNode — extended return shape for socket broadcast", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("returns nodeType and the node's real x/y/z alongside the existing resourceId/amount/nodeId fields", () => {
    const node = seedNode(db, { id: "node-a", x: 111, y: 7, z: 222, node_type: "tree" });
    const result = npcGatherFromNode(db, "w1", node.x, node.z, 5, []);
    assert.ok(result);
    assert.equal(result.nodeId, "node-a");
    assert.equal(result.nodeType, "tree");
    assert.equal(result.x, 111);
    assert.equal(result.y, 7);
    assert.equal(result.z, 222);
    // Pre-existing fields must still be present (additive change, not a rename).
    assert.equal(result.resourceId, "wood");
    assert.equal(result.resourceName, "Wood");
    assert.ok(typeof result.amount === "number" && result.amount > 0);
  });

  it("nodeType reflects whichever node the NPC actually gathered from, not a fixed value", () => {
    seedNode(db, { id: "node-b", x: 50, y: 0, z: 50, node_type: "ore_vein", resource_id: "iron-ore", resource_name: "Iron Ore" });
    const result = npcGatherFromNode(db, "w1", 50, 50, 5, []);
    assert.equal(result.nodeType, "ore_vein");
    assert.equal(result.resourceId, "iron-ore");
  });

  it("returns null (not a broadcast-shaped object with nulls) when no node is nearby — caller correctly skips the emit", () => {
    const result = npcGatherFromNode(db, "w1", 999, 999, 5, []);
    assert.equal(result, null);
  });

  it("getNearbyNodes (the underlying lookup) still returns node_type/x/y/z verbatim — the source npcGatherFromNode's new fields come from", () => {
    seedNode(db, { id: "node-c", x: 300, y: 12, z: 400, node_type: "crystal" });
    const nearby = getNearbyNodes(db, "w1", 300, 400, 30);
    const found = nearby.find((n) => n.id === "node-c");
    assert.ok(found);
    assert.equal(found.node_type, "crystal");
    assert.equal(found.x, 300);
    assert.equal(found.y, 12);
    assert.equal(found.z, 400);
  });
});
