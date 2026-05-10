/**
 * Sprint B Phase 11.4 — procgen settlements contract.
 *
 * Pins the load-bearing behavior:
 *   1. spawnSettlementForRegion creates 3-5 NPCs deterministically
 *      from the region id (same region → same names).
 *   2. Idempotent — re-running on the same region returns the existing
 *      settlement without spawning duplicates.
 *   3. NPCs are placed inside the region's anchor + radius.
 *   4. decaySettlementForRegion marks NPCs decayed but doesn't delete
 *      (so quest-log queries can still reference them).
 *   5. Decayed NPCs don't appear in listSettlementNpcs/forWorld.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  spawnSettlementForRegion,
  decaySettlementForRegion,
  listSettlementNpcs,
  listSettlementNpcsForWorld,
} from '../lib/procgen-settlements.js';

let db;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  try { db?.close(); } catch { /* noop */ }
});

const sampleRegion = (overrides = {}) => ({
  id: 'pgr_test_region_1',
  world_id: 'concordia-hub',
  anchor_x: 100,
  anchor_z: -50,
  radius_m: 80,
  region_kind: 'haunted_glade',
  ...overrides,
});

describe('spawnSettlementForRegion', () => {
  it('creates 3-5 NPCs on first call', () => {
    const r = spawnSettlementForRegion(db, sampleRegion());
    assert.equal(r.ok, true);
    assert.equal(r.action, 'created');
    assert.ok(r.npcs.length >= 3 && r.npcs.length <= 5,
      `expected 3-5 NPCs, got ${r.npcs.length}`);
  });

  it('NPCs have id / name / archetype / level / position', () => {
    const r = spawnSettlementForRegion(db, sampleRegion());
    for (const npc of r.npcs) {
      assert.ok(npc.id?.startsWith('pgs_npc_'));
      assert.ok(typeof npc.name === 'string' && npc.name.length > 0);
      assert.ok(typeof npc.archetype === 'string' && npc.archetype.length > 0);
      assert.ok(typeof npc.level === 'number' && npc.level > 0);
      assert.ok(typeof npc.x === 'number');
      assert.ok(typeof npc.z === 'number');
    }
  });

  it('NPCs are placed inside region radius', () => {
    const region = sampleRegion({ anchor_x: 0, anchor_z: 0, radius_m: 100 });
    const r = spawnSettlementForRegion(db, region);
    for (const npc of r.npcs) {
      const distSq = npc.x * npc.x + npc.z * npc.z;
      // 80% of radius (per the spawn function)
      assert.ok(distSq <= 80 * 80, `NPC at distance ${Math.sqrt(distSq)} should be < 80m from anchor`);
    }
  });

  it('is deterministic — same region id → same NPC names + count', () => {
    const dbA = new Database(':memory:');
    const dbB = new Database(':memory:');
    const a = spawnSettlementForRegion(dbA, sampleRegion());
    const b = spawnSettlementForRegion(dbB, sampleRegion());
    assert.equal(a.npcs.length, b.npcs.length);
    // Names depend on the seeded RNG → same seed (region id) → same names.
    const aNames = a.npcs.map(n => n.name);
    const bNames = b.npcs.map(n => n.name);
    assert.deepEqual(aNames, bNames);
    dbA.close();
    dbB.close();
  });

  it('idempotent — second call returns existing settlement, no new NPCs', () => {
    const first = spawnSettlementForRegion(db, sampleRegion());
    const second = spawnSettlementForRegion(db, sampleRegion());
    assert.equal(second.ok, true);
    assert.equal(second.action, 'already_exists');
    assert.equal(second.npcs.length, first.npcs.length);
  });

  it('rejects invalid input', () => {
    assert.equal(spawnSettlementForRegion(null, sampleRegion()).ok, false);
    assert.equal(spawnSettlementForRegion(db, null).ok, false);
    assert.equal(spawnSettlementForRegion(db, { id: 'x' }).ok, false); // missing world_id
  });
});

describe('decaySettlementForRegion', () => {
  it('marks NPCs decayed but does not delete rows', () => {
    spawnSettlementForRegion(db, sampleRegion());
    const before = db.prepare(`SELECT COUNT(*) c FROM procgen_settlement_npcs`).get();
    const r = decaySettlementForRegion(db, 'pgr_test_region_1');
    assert.equal(r.ok, true);
    assert.ok(r.decayed >= 3);
    const after = db.prepare(`SELECT COUNT(*) c FROM procgen_settlement_npcs`).get();
    assert.equal(after.c, before.c, 'rows should still exist after decay');
    const live = db.prepare(`SELECT COUNT(*) c FROM procgen_settlement_npcs WHERE decayed_at IS NULL`).get();
    assert.equal(live.c, 0);
  });

  it('idempotent — second decay is a no-op', () => {
    spawnSettlementForRegion(db, sampleRegion());
    const first = decaySettlementForRegion(db, 'pgr_test_region_1');
    const second = decaySettlementForRegion(db, 'pgr_test_region_1');
    assert.equal(second.ok, true);
    assert.equal(second.decayed, 0);
  });
});

describe('listSettlementNpcs / listSettlementNpcsForWorld', () => {
  it('returns active NPCs only', () => {
    spawnSettlementForRegion(db, sampleRegion());
    const before = listSettlementNpcs(db, 'pgr_test_region_1');
    assert.ok(before.length >= 3);
    decaySettlementForRegion(db, 'pgr_test_region_1');
    const after = listSettlementNpcs(db, 'pgr_test_region_1');
    assert.equal(after.length, 0, 'decayed NPCs should not be listed');
  });

  it('listSettlementNpcsForWorld aggregates across regions', () => {
    spawnSettlementForRegion(db, sampleRegion({ id: 'pgr_a', world_id: 'concordia-hub' }));
    spawnSettlementForRegion(db, sampleRegion({ id: 'pgr_b', world_id: 'concordia-hub' }));
    spawnSettlementForRegion(db, sampleRegion({ id: 'pgr_c', world_id: 'sovereign-ruins' }));
    const concordia = listSettlementNpcsForWorld(db, 'concordia-hub');
    const ruins = listSettlementNpcsForWorld(db, 'sovereign-ruins');
    assert.ok(concordia.length >= 6, 'concordia-hub should aggregate both regions');
    assert.ok(ruins.length >= 3, 'sovereign-ruins should include only its own region');
    assert.ok(concordia.length > ruins.length);
  });
});
