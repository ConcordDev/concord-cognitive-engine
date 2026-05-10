// server/migrations/166_cross_world_economy.js
//
// Cross-world economy parity sprint — extends the per-world world_market
// substrate (mig 064) + npc_inventory + economy_flows + regional_scarcity
// (mig 131) with three new shapes:
//
//   1. world_economy_state — per-world running CPI + average wage +
//      currency velocity. Refreshed by a heartbeat that aggregates
//      world_npcs.starting_sparks + economy_flows + recent
//      marketplace activity. Used by the arbitrage engine to know
//      whether a Tunyan dye sells at a markup in cyber.
//
//   2. transport_routes — per (from_world, to_world) pair: distance
//      units (informal — derived from federation peer hop count),
//      base cost in sparks per resource unit, risk_pct (sealie attack,
//      pirate intercept, etc.), perishability_factor (raw food rots
//      faster than dyes). Routes are seeded for every (from, to) pair
//      among the 9 authored worlds + concordia-hub.
//
//   3. cross_world_trade_orders — pending / in-transit / delivered
//      / failed orders. A trade order is a player or NPC commitment to
//      ship N units of resource R from world A to world B. The
//      transport_routes table prices it; the walker journey delivers it
//      (existing concord_link_walkers); the arbitrage profit is bounded
//      by transport cost + risk.

export function up(db) {
  // KILL SWITCH — must come first. Every cross-world op consults this
  // before executing. The default mode is 'live'. Operators can set:
  //   • 'paused' — freeze all cross-world reads + writes (data preserved)
  //   • 'isolated_per_world' — each world operates as if no others exist
  //   • 'rolled_back_single_world' — the one safe-mode for live debugging
  // Per-world state is preserved through every mode change. Sprints 2/3/4
  // all check this table before performing any cross-world operation.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_world_kill_switch (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'live',
      paused_at INTEGER,
      paused_by_user_id TEXT,
      paused_reason TEXT,
      last_changed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (mode IN ('live','paused','isolated_per_world','rolled_back_single_world'))
    )
  `);
  // Insert the singleton row.
  db.exec(`INSERT OR IGNORE INTO cross_world_kill_switch (id, mode) VALUES (1, 'live')`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS world_economy_state (
      world_id TEXT PRIMARY KEY,
      avg_wage_per_diurnal_sparks REAL NOT NULL DEFAULT 100,
      ration_cost_index REAL NOT NULL DEFAULT 1.0,
      currency_velocity REAL NOT NULL DEFAULT 1.0,
      internal_cpi REAL NOT NULL DEFAULT 1.0,
      total_circulating_sparks INTEGER NOT NULL DEFAULT 0,
      population_count INTEGER NOT NULL DEFAULT 0,
      last_recomputed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transport_routes (
      from_world TEXT NOT NULL,
      to_world TEXT NOT NULL,
      distance_units INTEGER NOT NULL DEFAULT 1,
      base_cost_per_unit_sparks REAL NOT NULL DEFAULT 5,
      risk_pct REAL NOT NULL DEFAULT 0.05,
      perishability_factor REAL NOT NULL DEFAULT 1.0,
      last_traversed_at INTEGER,
      PRIMARY KEY (from_world, to_world),
      CHECK (from_world <> to_world)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_world_trade_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id TEXT NOT NULL,
      from_world TEXT NOT NULL,
      to_world TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      source_price_sparks REAL NOT NULL,
      transport_cost_sparks REAL NOT NULL,
      destination_expected_price_sparks REAL NOT NULL,
      arbitrage_profit_estimate_sparks REAL NOT NULL,
      walker_journey_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at INTEGER,
      actual_destination_price_sparks REAL,
      actual_loss_qty INTEGER NOT NULL DEFAULT 0,
      CHECK (status IN ('open','in_transit','delivered','failed','expired'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_orders_buyer ON cross_world_trade_orders(buyer_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_orders_status ON cross_world_trade_orders(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_orders_route ON cross_world_trade_orders(from_world, to_world)`);

  // Seed transport routes for every authored-world pair. Distance is
  // 1 for sister-world pairs (Concordia ↔ sub-worlds), 2 for sub-world
  // ↔ sub-world, 3 for far worlds. Risk is set per-pair by lore: the
  // Tunya seas are sealie-dangerous; Fluxom routes are pirate-dangerous;
  // sovereign-ruins routes have spell-spirit interference.
  const ROUTES = [
    // hub ↔ sub-worlds (distance 1)
    ["concordia-hub", "tunya", 1, 5, 0.08, 1.0],
    ["concordia-hub", "fantasy", 1, 5, 0.06, 1.0],
    ["concordia-hub", "crime", 1, 4, 0.04, 1.0],
    ["concordia-hub", "cyber", 1, 4, 0.04, 1.0],
    ["concordia-hub", "superhero", 1, 4, 0.05, 1.0],
    ["concordia-hub", "concord-link-frontier", 1, 3, 0.07, 1.0],
    ["concordia-hub", "sovereign-ruins", 1, 6, 0.10, 1.0],
    ["concordia-hub", "lattice-crucible", 1, 5, 0.12, 1.0],
    // sub-world ↔ sub-world (distance 2). Selected high-traffic pairs.
    ["tunya", "fantasy", 2, 8, 0.12, 1.0],
    ["tunya", "cyber", 2, 9, 0.10, 1.0],
    ["tunya", "sovereign-ruins", 2, 11, 0.15, 1.0],
    ["fantasy", "sovereign-ruins", 2, 9, 0.18, 1.0],
    ["fantasy", "crime", 2, 7, 0.10, 1.0],
    ["crime", "cyber", 2, 6, 0.08, 1.0],
    ["cyber", "superhero", 2, 6, 0.07, 1.0],
    ["superhero", "fantasy", 2, 8, 0.09, 1.0],
    // frontier as the connective tissue (distance 1 to all)
    ["concord-link-frontier", "tunya", 1, 4, 0.06, 1.0],
    ["concord-link-frontier", "fantasy", 1, 4, 0.05, 1.0],
    ["concord-link-frontier", "crime", 1, 3, 0.04, 1.0],
    ["concord-link-frontier", "cyber", 1, 3, 0.04, 1.0],
    ["concord-link-frontier", "superhero", 1, 4, 0.05, 1.0],
    ["concord-link-frontier", "sovereign-ruins", 1, 5, 0.08, 1.0],
  ];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO transport_routes
      (from_world, to_world, distance_units, base_cost_per_unit_sparks, risk_pct, perishability_factor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [a, b, d, c, r, p] of ROUTES) {
    ins.run(a, b, d, c, r, p);
    ins.run(b, a, d, c, r, p); // routes are bidirectional
  }
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS cross_world_trade_orders`);
  db.exec(`DROP TABLE IF EXISTS transport_routes`);
  db.exec(`DROP TABLE IF EXISTS world_economy_state`);
}
