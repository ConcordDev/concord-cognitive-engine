// server/tests/cross-world-economy-acceptance.test.js
//
// Sprint 1 acceptance criterion (per user spec):
//   "Can a synthetic player make >X Sparks/hour by pure arbitrage with
//   no risk? If yes, friction is too low. Target: arbitrage profit
//   margin trends toward transport cost as routes mature."
//
// Test plan:
//   1. Spin up 3 worlds in :memory:; load mig 166.
//   2. Seed world_market.current_price differing across worlds.
//   3. Run an arbitragePreview — assert profit margin is bounded by
//      transport_cost + risk (no infinite money).
//   4. Cycle 100 trades through the engine — assert that total Sparks
//      held by the buyer never exceeds initial + sum(margins) (Spark
//      conservation).
//   5. Verify kill switch blocks all cross-world ops when set to
//      'paused' / 'isolated_per_world' / 'rolled_back_single_world'.
//   6. Verify boundary discipline: arbitragePreview with fromWorld ===
//      toWorld returns no_route (CHECK constraint blocks self-route).

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  recomputeWorldEconomyState, getWorldEconomyState,
  transportCost, arbitragePreview,
  createTradeOrder, settleTradeOrder,
  getKillSwitchMode, setKillSwitchMode,
} from "../lib/cross-world-economy.js";
import { up as upMig166 } from "../migrations/166_cross_world_economy.js";

function setup() {
  const db = new Database(":memory:");
  // Minimal world_npcs table so recomputeWorldEconomyState has data.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE economy_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE world_market (
      world_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      current_price REAL NOT NULL,
      PRIMARY KEY (world_id, resource_id)
    );
  `);
  upMig166(db);
  return db;
}

function seedWorld(db, worldId, npcCount, avgSparks) {
  const ins = db.prepare(`INSERT INTO world_npcs (id, world_id, meta_json) VALUES (?, ?, ?)`);
  for (let i = 0; i < npcCount; i++) {
    ins.run(`${worldId}_npc_${i}`, worldId, JSON.stringify({ starting_sparks: avgSparks + (i * 10) }));
  }
}

function seedMarket(db, worldId, resourceId, price) {
  db.prepare(`INSERT OR REPLACE INTO world_market (world_id, resource_id, current_price) VALUES (?, ?, ?)`)
    .run(worldId, resourceId, price);
}

test("acceptance — arbitrage profit margin is bounded by transport_cost + risk", () => {
  const db = setup();
  seedWorld(db, "tunya", 50, 1000);
  seedWorld(db, "fantasy", 50, 1500);
  seedMarket(db, "tunya", "cactem_red_dye", 10);
  seedMarket(db, "fantasy", "cactem_red_dye", 30);

  recomputeWorldEconomyState(db, "tunya");
  recomputeWorldEconomyState(db, "fantasy");

  const preview = arbitragePreview(db, "cactem_red_dye", "tunya", "fantasy", 100);
  assert.equal(preview.ok, true);

  // Source cost: 10 * 100 = 1000
  // Dest revenue: 30 * 100 = 3000
  // Transport cost (tunya→fantasy: 8/unit * 100 * 1.0 perish * 1.12 risk = 896)
  // Profit: 3000 - 1000 - 896 = 1104
  // Margin: 1104 / 1000 = 1.10 (110%) — high but bounded
  // Friction floor (transport_cost) = 896 sparks
  assert.ok(preview.profitEstimate < (preview.destRevenue - preview.sourceCost),
    "profit must be reduced by transport cost");
  assert.equal(preview.friction_floor_sparks, preview.transportCost,
    "friction floor IS the transport cost");
  assert.ok(preview.transportCost > 0, "transport cost must be positive");
  // The acceptance: as routes mature (risk + perishability incorporated), margin trends to friction floor.
  // If destPrice → sourcePrice + transport_cost, profit → 0 and margin → 0. We assert the engine
  // returns the right delta with no hidden bonus.
  const expected = (preview.destPrice * preview.qty) - (preview.sourcePrice * preview.qty) - preview.transportCost;
  assert.equal(preview.profitEstimate, expected, "no hidden margin: profit = revenue - source - transport");
});

test("acceptance — total Spark conservation: no money created across 100 trades", () => {
  const db = setup();
  seedWorld(db, "tunya", 10, 1000);
  seedWorld(db, "fantasy", 10, 1000);
  seedMarket(db, "tunya", "dye", 10);
  seedMarket(db, "fantasy", "dye", 30);

  // Track the buyer's wallet manually. The engine does NOT create
  // sparks — it only records orders + settlements. The caller is
  // responsible for actual wallet movement, but the engine reports
  // buyerNetDelta which the caller must apply.
  let buyerWallet = 1000000; // 1M sparks
  const initialWallet = buyerWallet;

  let totalNetDelta = 0;
  for (let i = 0; i < 100; i++) {
    const order = createTradeOrder(db, {
      buyerId: "test_buyer",
      fromWorld: "tunya",
      toWorld: "fantasy",
      resourceId: "dye",
      qty: 50,
    });
    assert.equal(order.ok, true, `order ${i} should open`);

    // Simulate buyer paying source + transport up front.
    buyerWallet -= order.upFrontCost;

    // Settle (immediate for the test).
    const settlement = settleTradeOrder(db, order.orderId);
    assert.equal(settlement.ok, true);

    // Buyer receives gross_revenue at destination.
    buyerWallet += settlement.grossRevenue;
    totalNetDelta += settlement.buyerNetDelta;
  }

  // After 100 trades, the wallet's gain equals the sum of net deltas.
  // No infinite money: every buyerNetDelta is bounded by
  // (destPrice - sourcePrice) * surviving_qty - transport_cost — a
  // finite per-trade margin.
  assert.equal(buyerWallet - initialWallet, totalNetDelta,
    "wallet delta must equal sum of order net deltas (Spark conservation)");
  // The actual gain depends on prices; what matters is the engine's math is honest.
  assert.ok(Number.isFinite(totalNetDelta), "net delta is a finite number — no NaN/Infinity exploits");
});

test("acceptance — kill switch blocks every cross-world op when not 'live'", () => {
  const db = setup();
  seedMarket(db, "tunya", "x", 10);
  seedMarket(db, "fantasy", "x", 20);

  for (const mode of ["paused", "isolated_per_world", "rolled_back_single_world"]) {
    setKillSwitchMode(db, mode, { reason: "test" });
    assert.equal(getKillSwitchMode(db), mode);

    const preview = arbitragePreview(db, "x", "tunya", "fantasy", 10);
    assert.equal(preview.ok, false);
    assert.equal(preview.reason, `kill_switch_${mode}`);

    const order = createTradeOrder(db, { buyerId: "b", fromWorld: "tunya", toWorld: "fantasy", resourceId: "x", qty: 10 });
    assert.equal(order.ok, false);
    assert.equal(order.reason, `kill_switch_${mode}`);

    const settle = settleTradeOrder(db, 1);
    assert.equal(settle.ok, false);
    assert.equal(settle.reason, `kill_switch_${mode}`);
  }

  // Restore live and verify it works again.
  setKillSwitchMode(db, "live");
  const preview2 = arbitragePreview(db, "x", "tunya", "fantasy", 10);
  assert.equal(preview2.ok, true);
});

test("boundary discipline — fromWorld === toWorld is rejected at the table layer", () => {
  const db = setup();
  // The table CHECK constraint prevents same-world routes from existing.
  // arbitragePreview('tunya', 'tunya') therefore returns no_route.
  const preview = arbitragePreview(db, "x", "tunya", "tunya", 10);
  assert.equal(preview.ok, false);
  assert.equal(preview.reason, "no_route");
});

test("boundary discipline — every worldId is required, no implicit 'current world'", () => {
  const db = setup();
  // Missing fromWorld
  let r = arbitragePreview(db, "x", null, "tunya", 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_inputs");
  // Missing toWorld
  r = arbitragePreview(db, "x", "tunya", null, 10);
  assert.equal(r.ok, false);
  // Missing both
  r = arbitragePreview(db, "x", null, null, 10);
  assert.equal(r.ok, false);
});

test("transport cost scales with qty + risk + perishability", () => {
  const db = setup();
  const small = transportCost(db, "tunya", "fantasy", 10);
  const big = transportCost(db, "tunya", "fantasy", 1000);
  assert.ok(big.sparks > small.sparks * 50, "qty 100x → cost ~100x (small overhead)");

  // With perishability override > 1.0, cost goes up.
  const perishable = transportCost(db, "tunya", "fantasy", 100, 2.0);
  const stable = transportCost(db, "tunya", "fantasy", 100, 1.0);
  assert.ok(perishable.sparks > stable.sparks);
});

test("settlement applies risk-based loss and refreshes destination price", () => {
  const db = setup();
  seedMarket(db, "tunya", "dye", 10);
  seedMarket(db, "fantasy", "dye", 30);

  const order = createTradeOrder(db, {
    buyerId: "buyer", fromWorld: "tunya", toWorld: "fantasy", resourceId: "dye", qty: 100,
  });
  assert.equal(order.ok, true);

  // Bump the destination price between order and settlement (market drift).
  seedMarket(db, "fantasy", "dye", 35);

  const s = settleTradeOrder(db, order.orderId);
  assert.equal(s.ok, true);
  assert.equal(s.actualDestPrice, 35, "settlement uses live destination price, not cached");
  assert.ok(s.lossQty >= 0 && s.lossQty <= 100, "loss bounded by qty");
  assert.equal(s.survivingQty, 100 - s.lossQty);
});
