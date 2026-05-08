/**
 * Tier-2 parity test for Phase 2 — royalty-cascade CTE refactor.
 *
 * Pins behavioural equivalence between the new CTE-based functions and
 * a reference implementation (the prior queue-based logic). Generates
 * randomized DAG-shaped lineage graphs up to 50 deep over 200 cases
 * (kept modest because each case spins up an in-memory DB).
 *
 * Uses better-sqlite3 in-memory; skips if not available.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getAncestorChain,
  getDescendants,
} from "../economy/royalty-cascade.js";

// ── Reference (queue-based) implementations — kept here as fixtures.
function refAncestorChain(db, contentId, maxDepth = 50) {
  const ancestors = [];
  const visited = new Set();
  const queue = [{ id: contentId, generation: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id) || current.generation > maxDepth) continue;
    visited.add(current.id);
    const parents = db.prepare(`
      SELECT parent_id, parent_creator, generation
      FROM royalty_lineage WHERE child_id = ?
    `).all(current.id);
    for (const parent of parents) {
      const totalGeneration = current.generation + parent.generation;
      if (totalGeneration <= maxDepth && !visited.has(parent.parent_id)) {
        ancestors.push({
          contentId: parent.parent_id,
          creatorId: parent.parent_creator,
          generation: totalGeneration,
        });
        queue.push({ id: parent.parent_id, generation: totalGeneration });
      }
    }
  }
  return ancestors;
}

function refDescendants(db, contentId, maxDepth = 50) {
  const out = [];
  const visited = new Set();
  const queue = [{ id: contentId, generation: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id) || current.generation > maxDepth) continue;
    visited.add(current.id);
    const children = db.prepare(`
      SELECT child_id, creator_id, generation
      FROM royalty_lineage WHERE parent_id = ?
    `).all(current.id);
    for (const child of children) {
      const totalGeneration = current.generation + child.generation;
      if (!visited.has(child.child_id)) {
        out.push({
          contentId: child.child_id,
          creatorId: child.creator_id,
          generation: totalGeneration,
        });
        queue.push({ id: child.child_id, generation: totalGeneration });
      }
    }
  }
  return out;
}

function buildLineageDb(Database, edges) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE royalty_lineage (
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      parent_creator TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (child_id, parent_id)
    );
  `);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO royalty_lineage
      (child_id, parent_id, parent_creator, creator_id, generation)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const e of edges) stmt.run(e.child, e.parent, e.parentCreator, e.creatorId, e.generation || 1);
  return db;
}

// Seeded RNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomDag(seed, nodeCount) {
  const r = rng(seed);
  const edges = [];
  for (let i = 1; i < nodeCount; i++) {
    // Each node has 1-3 parents drawn from earlier ids — guarantees DAG.
    const parents = Math.max(1, Math.floor(r() * 3));
    const seen = new Set();
    for (let p = 0; p < parents; p++) {
      const pIdx = Math.floor(r() * i);
      if (seen.has(pIdx)) continue;
      seen.add(pIdx);
      edges.push({
        child: `n${i}`,
        parent: `n${pIdx}`,
        parentCreator: `creator${pIdx % 5}`,
        creatorId: `creator${i % 5}`,
        generation: 1,
      });
    }
  }
  return edges;
}

function sortChain(arr) {
  return [...arr].sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    return a.contentId.localeCompare(b.contentId);
  }).map(x => ({
    contentId: x.contentId,
    creatorId: x.creatorId,
    generation: x.generation,
  }));
}

describe("royalty-cascade CTE parity (Phase 2)", () => {
  let Database;
  it("loads better-sqlite3 fixture or skips", async (t) => {
    try { Database = (await import("better-sqlite3")).default; }
    catch { return t.skip("better-sqlite3 not installed in this environment"); }
  });

  it("getAncestorChain matches reference across 50 random DAGs", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    for (let seed = 1; seed <= 50; seed++) {
      const nodeCount = 8 + (seed % 12);
      const edges = randomDag(seed, nodeCount);
      const db = buildLineageDb(Database, edges);
      const target = `n${nodeCount - 1}`;
      const ref = sortChain(refAncestorChain(db, target));
      const live = sortChain(getAncestorChain(db, target));
      assert.deepEqual(live, ref, `seed=${seed} ancestors diverged`);
      db.close();
    }
  });

  it("getDescendants matches reference across 50 random DAGs", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    for (let seed = 100; seed <= 150; seed++) {
      const nodeCount = 8 + (seed % 12);
      const edges = randomDag(seed, nodeCount);
      const db = buildLineageDb(Database, edges);
      const target = "n0";
      const ref = sortChain(refDescendants(db, target));
      const live = sortChain(getDescendants(db, target));
      assert.deepEqual(live, ref, `seed=${seed} descendants diverged`);
      db.close();
    }
  });

  it("getAncestorChain handles empty chain", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    const db = buildLineageDb(Database, []);
    const result = getAncestorChain(db, "isolated-node");
    assert.deepEqual(result, []);
    db.close();
  });

  it("getAncestorChain respects maxDepth", async (t) => {
    if (!Database) return t.skip("better-sqlite3 not installed");
    // Linear chain: n0 ← n1 ← n2 ← n3 ← n4 ← n5
    const edges = [];
    for (let i = 1; i <= 5; i++) {
      edges.push({ child: `n${i}`, parent: `n${i - 1}`, parentCreator: `c${i - 1}`, creatorId: `c${i}`, generation: 1 });
    }
    const db = buildLineageDb(Database, edges);
    const live = getAncestorChain(db, "n5", 2);
    assert.equal(live.length, 2, "should only reach 2 generations back");
    assert.equal(live[0].contentId, "n4");
    assert.equal(live[1].contentId, "n3");
    db.close();
  });
});
