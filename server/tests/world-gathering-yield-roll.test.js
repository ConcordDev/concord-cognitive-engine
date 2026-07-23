// server/tests/world-gathering-yield-roll.test.js
//
// Gaps 1+2 — resource-node gather yield now rolls instead of returning a flat
// deterministic amount. `rollYield` layers a symmetric ±25% quantity variance
// (EV = the existing estimateYield baseline, so the long-run mean is preserved)
// plus a quality/skill-scaled "rich strike" rarity bonus. This pins:
//   - bounds (variance floor/ceiling, never < 1)
//   - EV preservation (statistical mean ≈ baseline, excluding rich strikes)
//   - rich-strike on/off via injected rng
//   - exact prediction through gatherFromNode with an injected rng
//   - conservation: the atomic decrement / depletion is untouched (total
//     extracted still equals stock exactly — the toctou property survives
//     variance)
//   - NPC parity: npcGatherFromNode applies the identical roll
//
// Run: node --test tests/world-gathering-yield-roll.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  rollYield,
  estimateYield,
  gatherFromNode,
  npcGatherFromNode,
} from "../lib/world-gathering.js";

// A deterministic rng that yields the given sequence, clamping to the last
// value once exhausted (rollYield draws exactly twice: variance, then strike).
function seqRng(seq) {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

function seedNode(db, overrides = {}) {
  const n = {
    id: "n1", world_id: "w1", node_type: "stone", resource_id: "stone",
    resource_name: "Stone Outcrop", biome: "plains",
    x: 0, y: 40, z: 0, depth: 0,
    quantity_remaining: 1000, max_quantity: 1000,
    quality: "common", difficulty: 1, respawn_hours: 72,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO world_resource_nodes
      (id, world_id, node_type, resource_id, resource_name, biome,
       x, y, z, depth, quantity_remaining, max_quantity, quality, difficulty, respawn_hours, is_depleted, seeded)
    VALUES (@id,@world_id,@node_type,@resource_id,@resource_name,@biome,
            @x,@y,@z,@depth,@quantity_remaining,@max_quantity,@quality,@difficulty,@respawn_hours,0,1)
  `).run(n);
  return n;
}

test("rollYield — bounds: within [round(0.75·base), round(1.25·base)+bonus], never < 1", () => {
  const base = 10;
  const bonus = Math.max(1, Math.round(base * 0.5)); // 5
  const lo = Math.round(0.75 * base);
  const hi = Math.round(1.25 * base) + bonus;

  const zero = rollYield(base, { nodeQuality: "common", skillLevel: 1, rng: seqRng([0]) });
  const high = rollYield(base, { nodeQuality: "common", skillLevel: 1, rng: seqRng([0.999999]) });

  for (const r of [zero, high]) {
    assert.ok(r.amount >= lo, `amount ${r.amount} >= ${lo}`);
    assert.ok(r.amount <= hi, `amount ${r.amount} <= ${hi}`);
    assert.ok(r.amount >= 1, "never below 1");
  }
  // rng→0 forces the strike (0 < chance); rng→~1 never strikes.
  assert.equal(zero.richStrike, true);
  assert.equal(high.richStrike, false);
});

test("rollYield — a tiny base still yields at least 1", () => {
  const r = rollYield(1, { rng: seqRng([0, 0.999]) }); // variance 0.75 → round(0.75)=1
  assert.ok(r.amount >= 1);
});

test("rollYield — baseline is preserved as the expected value (statistical)", () => {
  const base = 100;
  const bonus = Math.round(base * 0.5); // 50
  const N = 4000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    // Real RNG; subtract the rich-strike bonus so we measure the variance EV.
    const r = rollYield(base, { nodeQuality: "common", skillLevel: 1 });
    sum += r.amount - (r.richStrike ? bonus : 0);
  }
  const mean = sum / N;
  assert.ok(Math.abs(mean - base) <= 3, `variance EV ${mean} ≈ ${base} (±3)`);
});

test("rollYield — rich strike fires/omits deterministically via injected rng", () => {
  const base = 10;
  const bonus = Math.round(base * 0.5); // 5
  // variance draw 0.5 → amount = round(10)=10; strike draw 0.0 → hit.
  const hit = rollYield(base, { nodeQuality: "common", skillLevel: 30, rng: seqRng([0.5, 0.0]) });
  assert.equal(hit.richStrike, true);
  assert.equal(hit.amount, 10 + bonus);
  // strike draw 0.99 → miss (chance for common+skill30 = 0.08).
  const miss = rollYield(base, { nodeQuality: "common", skillLevel: 30, rng: seqRng([0.5, 0.99]) });
  assert.equal(miss.richStrike, false);
  assert.equal(miss.amount, 10);
});

test("rollYield — higher node quality raises the rich-strike chance", () => {
  // A strike draw of 0.20 misses on common (0.05) but hits on legendary (0.25).
  const common = rollYield(10, { nodeQuality: "common", skillLevel: 1, rng: seqRng([0.5, 0.20]) });
  const legendary = rollYield(10, { nodeQuality: "legendary", skillLevel: 1, rng: seqRng([0.5, 0.20]) });
  assert.equal(common.richStrike, false);
  assert.equal(legendary.richStrike, true);
});

test("gatherFromNode — injected rng makes the yield exactly predictable; node decrements by the reported amount", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const node = seedNode(db, { id: "np", quantity_remaining: 1000, max_quantity: 1000 });

  // Baseline for pickaxe/tier3/skill30 on a difficulty-1 stone node = 5.
  const base = estimateYield(node, "pickaxe", 3, 30).amount;
  const expected = rollYield(base, { nodeQuality: "common", skillLevel: 30, rng: seqRng([0.5, 0.0]) });

  const r = gatherFromNode(db, "np", "u1", {
    toolType: "pickaxe", toolTier: 3, skillLevel: 30, rng: seqRng([0.5, 0.0]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.gathered[0].quantity, expected.amount, "reported quantity == predicted roll");
  assert.equal(r.gathered[0].richStrike, true, "rich strike stamped on the primary item");

  const row = db.prepare("SELECT quantity_remaining FROM world_resource_nodes WHERE id='np'").get();
  assert.equal(row.quantity_remaining, 1000 - r.gathered[0].quantity, "node decremented by the reported amount");
  db.close();
});

test("gatherFromNode — no rich strike leaves the primary item without the flag", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedNode(db, { id: "nq", quantity_remaining: 1000, max_quantity: 1000 });
  const r = gatherFromNode(db, "nq", "u1", {
    toolType: "pickaxe", toolTier: 3, skillLevel: 30, rng: seqRng([0.5, 0.99]),
  });
  assert.equal(r.ok, true);
  assert.equal(r.gathered[0].richStrike, undefined);
  db.close();
});

test("gatherFromNode — conservation: draining a 20-stock node extracts exactly 20 with real RNG variance", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedNode(db, { id: "n20", quantity_remaining: 20, max_quantity: 20 });

  let total = 0;
  for (let i = 0; i < 200; i++) {
    const r = gatherFromNode(db, "n20", "u1", { toolType: "pickaxe", toolTier: 3, skillLevel: 30 });
    if (!r.ok) { assert.equal(r.error, "node_depleted"); break; }
    total += r.gathered[0].quantity;
  }
  const row = db.prepare("SELECT quantity_remaining, is_depleted FROM world_resource_nodes WHERE id='n20'").get();
  assert.equal(row.quantity_remaining, 0, "node fully drained");
  assert.equal(row.is_depleted, 1, "node flagged depleted");
  assert.equal(total, 20, "extracted exactly the stock — variance never over-extracts");
  db.close();
});

test("npcGatherFromNode — applies the identical roll as the player formula at equal inputs", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  const node = seedNode(db, {
    id: "nn", node_type: "herb", resource_id: "herb", resource_name: "Herb",
    biome: "forest", x: 100, y: 5, z: 200, quantity_remaining: 100, max_quantity: 100,
  });

  const npcLevel = 5;
  const npcSkill = npcLevel * 10;
  const tier = Math.min(3, Math.ceil(npcLevel / 3));
  const base = estimateYield(node, "hands", tier, npcSkill).amount;
  const expected = rollYield(base, {
    nodeQuality: node.quality, skillLevel: npcSkill, rng: seqRng([0.42, 0.0]),
  });

  const result = npcGatherFromNode(db, "w1", node.x, node.z, npcLevel, [], { rng: seqRng([0.42, 0.0]) });
  assert.ok(result);
  assert.equal(result.amount, expected.amount, "NPC amount matches the independently-computed roll");
  // Existing return shape preserved (additive change).
  assert.equal(result.resourceId, "herb");
  assert.equal(result.nodeType, "herb");
  db.close();
});
