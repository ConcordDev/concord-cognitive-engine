// V1.2 Wave D follow-on — cross-world "edges" view.
//
// worldstate.overview / worldstate.world_detail answer "how healthy is
// world X" but had no surface for "how connected is the N-world system as
// a whole." This proves worldstate.connections aggregates real edges
// BETWEEN world pairs from four existing cross-world substrates:
//   - cross_world_trade_orders  (trade)
//   - cross_world_schemes       (scheme)
//   - royalty_lineage / economy_ledger via getCrossWorldRoyaltyFlow (royalty)
//   - population_flow_events    (migration)
//
// Honesty invariant under test: an isolated world with zero rows in every
// source table across BOTH directions must contribute ZERO edges — never a
// fabricated placeholder row. The aggregation math (weight = SUM/COUNT per
// group) must exactly match hand-computed expectations against the seeded
// fixture rows.
//
// Uses a real, fully-migrated in-memory better-sqlite3 db, same pattern as
// tests/world-overview-domain.test.js.
//
// Run: node --test server/tests/world-overview-connections.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerWorldOverviewMacros from "../domains/world-overview.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, input);
}

before(() => {
  registerWorldOverviewMacros(register);
});

const W_A = "test_conn_world_a";
const W_B = "test_conn_world_b";
const W_C = "test_conn_world_c";
const ISOLATED = "test_conn_isolated";

function findEdge(edges, fromWorld, toWorld, kind) {
  return edges.find((e) => e.fromWorld === fromWorld && e.toWorld === toWorld && e.kind === kind);
}

describe("worldstate.connections — real cross-world edge aggregation, no mutation", () => {
  let db;

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    for (const id of [W_A, W_B, W_C, ISOLATED]) {
      db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`).run(id, id);
    }
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it("returns no_db honestly when no db is supplied", async () => {
    const r = await call("worldstate.connections", {}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("returns ZERO edges for a fully isolated world — never a fabricated placeholder row", async () => {
    // Seed cross-world activity between A and B only; ISOLATED has no rows
    // anywhere, in either direction.
    db.prepare(`
      INSERT INTO cross_world_trade_orders
        (buyer_id, from_world, to_world, resource_id, qty,
         source_price_sparks, transport_cost_sparks,
         destination_expected_price_sparks, arbitrage_profit_estimate_sparks, status)
      VALUES ('u1', ?, ?, 'iron_ore', 10, 5, 2, 8, 30, 'open')
    `).run(W_A, W_B);

    const r = await call("worldstate.connections", { db }, {});
    assert.equal(r.ok, true);
    const touchesIsolated = r.edges.filter((e) => e.fromWorld === ISOLATED || e.toWorld === ISOLATED);
    assert.deepEqual(touchesIsolated, [], "an isolated world must contribute zero edges");

    // And with zero rows anywhere at all, connections is an empty list —
    // not a fabricated 0-weight row per pair.
    const dbEmpty = new Database(":memory:");
    await runMigrations(dbEmpty);
    dbEmpty.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`).run(ISOLATED, ISOLATED);
    const r2 = await call("worldstate.connections", { db: dbEmpty }, {});
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.edges, []);
    dbEmpty.close();
  });

  it("aggregates trade edges by (from_world, to_world) with weight = summed qty", async () => {
    const insert = (from, to, qty) => db.prepare(`
      INSERT INTO cross_world_trade_orders
        (buyer_id, from_world, to_world, resource_id, qty,
         source_price_sparks, transport_cost_sparks,
         destination_expected_price_sparks, arbitrage_profit_estimate_sparks, status)
      VALUES ('u1', ?, ?, 'iron_ore', ?, 5, 2, 8, 30, 'open')
    `).run(from, to, qty);

    insert(W_A, W_B, 10);
    insert(W_A, W_B, 25);
    insert(W_B, W_A, 4); // opposite direction — must be a SEPARATE edge

    const r = await call("worldstate.connections", { db }, {});
    assert.equal(r.ok, true);

    const ab = findEdge(r.edges, W_A, W_B, "trade");
    assert.ok(ab, "expected an A->B trade edge");
    assert.equal(ab.weight, 35); // 10 + 25
    assert.equal(ab.orderCount, 2);

    const ba = findEdge(r.edges, W_B, W_A, "trade");
    assert.ok(ba, "expected a SEPARATE B->A trade edge (directed, not folded)");
    assert.equal(ba.weight, 4);
    assert.equal(ba.orderCount, 1);
  });

  it("aggregates scheme edges by (plotter_world_id, target_world_id) with weight = scheme count", async () => {
    const insert = (plotterWorld, targetWorld, kind, phase) => {
      const id = `xsch_${Math.random().toString(36).slice(2, 10)}`;
      db.prepare(`
        INSERT INTO cross_world_schemes
          (id, plotter_world_id, plotter_kind, plotter_id,
           target_world_id, target_kind, target_id,
           kind, phase, success_pct, discovery_pct, next_tick_at)
        VALUES (?, ?, 'npc', 'plotter_1', ?, 'npc', 'target_1', ?, ?, 20, 15, 0)
      `).run(id, plotterWorld, targetWorld, kind, phase);
    };

    insert(W_A, W_C, "assassinate", "planning");
    insert(W_A, W_C, "blackmail", "abandoned"); // terminal phase still counts — real signal
    insert(W_C, W_A, "seduce", "complete");

    const r = await call("worldstate.connections", { db }, {});

    const ac = findEdge(r.edges, W_A, W_C, "scheme");
    assert.ok(ac);
    assert.equal(ac.weight, 2);

    const ca = findEdge(r.edges, W_C, W_A, "scheme");
    assert.ok(ca);
    assert.equal(ca.weight, 1);
  });

  it("aggregates migration edges by (from_world_id, to_world_id) with weight = event count, any status", async () => {
    const insert = (from, to, status, expectedArrival = 0) => db.prepare(`
      INSERT INTO population_flow_events
        (npc_id, from_world_id, to_world_id, expected_arrival_at, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(`npc_${Math.random().toString(36).slice(2, 10)}`, from, to, expectedArrival, status);

    insert(W_B, W_C, "arrived");
    insert(W_B, W_C, "in_transit");
    insert(W_B, W_C, "lost"); // still a real attempted move — counts

    const r = await call("worldstate.connections", { db }, {});
    const bc = findEdge(r.edges, W_B, W_C, "migration");
    assert.ok(bc);
    assert.equal(bc.weight, 3);

    // No edge in the reverse direction — honest, not fabricated.
    assert.equal(findEdge(r.edges, W_C, W_B, "migration"), undefined);
  });

  it("aggregates royalty edges via getCrossWorldRoyaltyFlow (reused, not reimplemented), direction = child world -> parent world", async () => {
    // Seed two DTUs in different worlds + a cross-world citation + its
    // real ROYALTY_PAYOUT ledger row, exactly the shape
    // getCrossWorldRoyaltyFlow's own JOIN expects.
    db.prepare(`
      INSERT INTO dtus (id, title, world_id, creator_id, visibility)
      VALUES ('parent_dtu_1', 'Ancestor Idea', ?, 'creator_p', 'public')
    `).run(W_A);
    db.prepare(`
      INSERT INTO dtus (id, title, world_id, creator_id, visibility)
      VALUES ('child_dtu_1', 'Derivative Idea', ?, 'creator_c', 'public')
    `).run(W_B);

    db.prepare(`
      INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator)
      VALUES ('xcit_1', 'child_dtu_1', 'parent_dtu_1', 1, 'creator_c', 'creator_p')
    `).run();

    db.prepare(`
      INSERT INTO economy_ledger
        (id, type, from_user_id, to_user_id, amount, fee, net, status, ref_id)
      VALUES ('ledg_1', 'ROYALTY_PAYOUT', NULL, 'creator_p', 21, 0, 21, 'complete', 'xcit_1')
    `).run();

    const r = await call("worldstate.connections", { db }, {});
    // Direction: money flows from the citing (child) world to the cited
    // (parent) world's creator.
    const edge = findEdge(r.edges, W_B, W_A, "royalty");
    assert.ok(edge, "expected a B(child) -> A(parent) royalty edge");
    assert.equal(edge.weight, 21);
    assert.equal(edge.citationCount, 1);

    // No fabricated reverse edge.
    assert.equal(findEdge(r.edges, W_A, W_B, "royalty"), undefined);
  });

  it("aggregates multiple citations between the same world pair into ONE edge, summing amountCC", async () => {
    db.prepare(`INSERT INTO dtus (id, title, world_id, creator_id, visibility) VALUES ('p1', 'P1', ?, 'creator_p', 'public')`).run(W_A);
    db.prepare(`INSERT INTO dtus (id, title, world_id, creator_id, visibility) VALUES ('p2', 'P2', ?, 'creator_p', 'public')`).run(W_A);
    db.prepare(`INSERT INTO dtus (id, title, world_id, creator_id, visibility) VALUES ('c1', 'C1', ?, 'creator_c', 'public')`).run(W_B);
    db.prepare(`INSERT INTO dtus (id, title, world_id, creator_id, visibility) VALUES ('c2', 'C2', ?, 'creator_c', 'public')`).run(W_B);

    db.prepare(`INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator) VALUES ('xcit_2', 'c1', 'p1', 1, 'creator_c', 'creator_p')`).run();
    db.prepare(`INSERT INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator) VALUES ('xcit_3', 'c2', 'p2', 1, 'creator_c', 'creator_p')`).run();

    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, ref_id) VALUES ('ledg_2', 'ROYALTY_PAYOUT', NULL, 'creator_p', 10, 0, 10, 'complete', 'xcit_2')`).run();
    db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, ref_id) VALUES ('ledg_3', 'ROYALTY_PAYOUT', NULL, 'creator_p', 15.5, 0, 15.5, 'complete', 'xcit_3')`).run();

    const r = await call("worldstate.connections", { db }, {});
    const edges = r.edges.filter((e) => e.fromWorld === W_B && e.toWorld === W_A && e.kind === "royalty");
    assert.equal(edges.length, 1, "same world-pair citations must fold into ONE edge");
    assert.equal(edges[0].weight, 25.5);
    assert.equal(edges[0].citationCount, 2);
  });

  it("honors an explicit worldIds filter — edges touching an excluded world are dropped", async () => {
    db.prepare(`
      INSERT INTO cross_world_trade_orders
        (buyer_id, from_world, to_world, resource_id, qty,
         source_price_sparks, transport_cost_sparks,
         destination_expected_price_sparks, arbitrage_profit_estimate_sparks, status)
      VALUES ('u1', ?, ?, 'iron_ore', 10, 5, 2, 8, 30, 'open')
    `).run(W_A, W_B);
    db.prepare(`
      INSERT INTO cross_world_trade_orders
        (buyer_id, from_world, to_world, resource_id, qty,
         source_price_sparks, transport_cost_sparks,
         destination_expected_price_sparks, arbitrage_profit_estimate_sparks, status)
      VALUES ('u1', ?, ?, 'iron_ore', 7, 5, 2, 8, 30, 'open')
    `).run(W_A, W_C);

    const r = await call("worldstate.connections", { db }, { worldIds: [W_A, W_B] });
    assert.equal(r.ok, true);
    assert.equal(findEdge(r.edges, W_A, W_B, "trade")?.weight, 10);
    assert.equal(findEdge(r.edges, W_A, W_C, "trade"), undefined, "excluded world's edge must be dropped");
  });

  it("does not mutate any source table (read-only aggregation)", async () => {
    db.prepare(`
      INSERT INTO cross_world_trade_orders
        (buyer_id, from_world, to_world, resource_id, qty,
         source_price_sparks, transport_cost_sparks,
         destination_expected_price_sparks, arbitrage_profit_estimate_sparks, status)
      VALUES ('u1', ?, ?, 'iron_ore', 10, 5, 2, 8, 30, 'open')
    `).run(W_A, W_B);

    const before = db.prepare(`SELECT status FROM cross_world_trade_orders`).get();
    await call("worldstate.connections", { db }, {});
    const after = db.prepare(`SELECT status FROM cross_world_trade_orders`).get();
    assert.deepEqual(before, after);
  });
});
