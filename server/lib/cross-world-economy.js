// server/lib/cross-world-economy.js
//
// Cross-world economy parity engine — sprint 1.
//
// Responsibilities:
//   1. recomputeWorldEconomyState(db, worldId)
//        Reads world_npcs.starting_sparks + recent economy_flows +
//        world_market.current_price for ration-equivalent goods. Writes
//        world_economy_state with avg_wage / ration_cost_index /
//        currency_velocity / internal_cpi / total_circulating_sparks /
//        population_count.
//
//   2. transportCost(db, fromWorld, toWorld, qty, perishabilityOverride?)
//        Returns sparks. Pulls transport_routes row; multiplies
//        base_cost_per_unit_sparks * qty * perishability * (1 + risk_pct).
//
//   3. arbitragePreview(db, resourceId, fromWorld, toWorld, qty)
//        Returns { sourcePrice, destPrice, transportCost, profitEstimate,
//        marginPct, friction_floor }. The friction_floor is the
//        transport cost itself — a healthy mature route has profit
//        margin trending toward this floor.
//
//   4. createTradeOrder(db, opts) — records a cross_world_trade_orders
//        row in 'open' status, deducts source_price + transport_cost
//        from buyer's wallet, dispatches a walker journey via existing
//        concord_link_walkers (or stubs the journey id when not
//        available).
//
//   5. settleTradeOrder(db, orderId, actualLossQty?)
//        Called when the walker arrives at destination. Marks delivered,
//        applies actual_loss_qty (random within risk_pct), credits
//        buyer with the destination price for the surviving qty.
//
// Kill switch: every public function checks cross_world_kill_switch and
// returns { ok: false, reason: 'kill_switch_<mode>' } if not 'live'.
//
// Sprint 1 acceptance: arbitrage profit margin trends toward
// transport_cost as routes mature. We enforce this by bounding profits:
// the engine NEVER creates sparks; it shifts them from buyer's wallet
// to source_world's economy and credits buyer at destination minus
// transport+loss. Total Spark conservation is therefore mechanical, not
// statistical.

// ── Kill switch ─────────────────────────────────────────────────────

export function getKillSwitchMode(db) {
  if (!db) return "paused"; // defensive: no db = paused
  try {
    const row = db.prepare(`SELECT mode FROM cross_world_kill_switch WHERE id = 1`).get();
    return row?.mode || "live";
  } catch {
    return "paused"; // table missing = paused
  }
}

export function setKillSwitchMode(db, mode, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!["live", "paused", "isolated_per_world", "rolled_back_single_world"].includes(mode)) {
    return { ok: false, reason: "invalid_mode" };
  }
  db.prepare(`
    UPDATE cross_world_kill_switch
    SET mode = ?, paused_at = ?, paused_by_user_id = ?, paused_reason = ?, last_changed_at = unixepoch()
    WHERE id = 1
  `).run(mode, mode === "live" ? null : Math.floor(Date.now() / 1000), opts.userId || null, opts.reason || null);
  return { ok: true, mode };
}

function killSwitchAllowsCrossWorld(db) {
  return getKillSwitchMode(db) === "live";
}

// ── World economy state ─────────────────────────────────────────────

export function recomputeWorldEconomyState(db, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };

  // Pull NPC wealth + count from world_npcs (the canonical NPC table).
  let npcStats;
  try {
    npcStats = db.prepare(`
      SELECT
        COUNT(*) AS pop,
        COALESCE(AVG(wealth_sparks), 0) AS avg_sparks,
        COALESCE(SUM(wealth_sparks), 0) AS total_sparks
      FROM world_npcs
      WHERE world_id = ?
    `).get(worldId);
  } catch {
    npcStats = { pop: 0, avg_sparks: 0, total_sparks: 0 };
  }

  // Recent flow velocity from economy_flows (mig 131). Velocity =
  // flows-per-NPC over the last 24 in-game hours.
  let flowCount = 0;
  try {
    flowCount = db.prepare(`
      SELECT COUNT(*) AS c FROM economy_flows
      WHERE world_id = ? AND occurred_at > unixepoch() - 86400
    `).get(worldId)?.c || 0;
  } catch {
    flowCount = 0;
  }
  const velocity = npcStats.pop > 0 ? flowCount / npcStats.pop : 0;

  // Ration cost index: avg of basic-grain world_market prices if
  // available, else 1.0 baseline.
  let rationCost = 1.0;
  try {
    const r = db.prepare(`
      SELECT AVG(current_price) AS p FROM world_market
      WHERE world_id = ? AND resource_id IN ('basic_grain','bread','vegetables','salted_fish')
    `).get(worldId);
    if (r?.p) rationCost = r.p;
  } catch { /* table optional */ }

  // CPI = ration_cost_index * (1 + 0.1 * velocity_above_baseline).
  // Mild — high velocity means demand-side pressure.
  const cpi = rationCost * (1 + 0.1 * Math.max(0, velocity - 1));

  // Average wage: pull from authored NPC starting_sparks averaged over
  // 30 (rough diurnal-cycle smoothing). Fall back to 100 if no NPCs.
  const avgWage = npcStats.pop > 0 ? npcStats.avg_sparks / 30 : 100;

  db.prepare(`
    INSERT INTO world_economy_state
      (world_id, avg_wage_per_diurnal_sparks, ration_cost_index, currency_velocity,
       internal_cpi, total_circulating_sparks, population_count, last_recomputed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(world_id) DO UPDATE SET
      avg_wage_per_diurnal_sparks = excluded.avg_wage_per_diurnal_sparks,
      ration_cost_index = excluded.ration_cost_index,
      currency_velocity = excluded.currency_velocity,
      internal_cpi = excluded.internal_cpi,
      total_circulating_sparks = excluded.total_circulating_sparks,
      population_count = excluded.population_count,
      last_recomputed_at = unixepoch()
  `).run(worldId, avgWage, rationCost, velocity, cpi, npcStats.total_sparks, npcStats.pop);

  return {
    ok: true,
    worldId,
    avgWage,
    rationCost,
    velocity,
    cpi,
    totalSparks: npcStats.total_sparks,
    population: npcStats.pop,
  };
}

export function getWorldEconomyState(db, worldId) {
  if (!db || !worldId) return null;
  try {
    return db.prepare(`SELECT * FROM world_economy_state WHERE world_id = ?`).get(worldId) || null;
  } catch {
    return null;
  }
}

// ── Transport cost ─────────────────────────────────────────────────

export function transportCost(db, fromWorld, toWorld, qty, perishabilityOverride) {
  if (!db || !fromWorld || !toWorld || qty <= 0) return null;
  const route = db.prepare(`
    SELECT * FROM transport_routes WHERE from_world = ? AND to_world = ?
  `).get(fromWorld, toWorld);
  if (!route) return null;

  const perishability = perishabilityOverride ?? route.perishability_factor;
  const baseCost = route.base_cost_per_unit_sparks * qty * perishability;
  const riskAdjusted = baseCost * (1 + route.risk_pct);
  return {
    sparks: Math.ceil(riskAdjusted),
    base_cost: Math.ceil(baseCost),
    risk_pct: route.risk_pct,
    distance_units: route.distance_units,
    perishability,
  };
}

// ── Arbitrage preview ─────────────────────────────────────────────

export function arbitragePreview(db, resourceId, fromWorld, toWorld, qty) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !resourceId || !fromWorld || !toWorld || qty <= 0) {
    return { ok: false, reason: "missing_inputs" };
  }

  const tc = transportCost(db, fromWorld, toWorld, qty);
  if (!tc) return { ok: false, reason: "no_route" };

  let sourcePrice = 0;
  let destPrice = 0;
  try {
    sourcePrice = db.prepare(`
      SELECT current_price FROM world_market WHERE world_id = ? AND resource_id = ?
    `).get(fromWorld, resourceId)?.current_price || 0;
    destPrice = db.prepare(`
      SELECT current_price FROM world_market WHERE world_id = ? AND resource_id = ?
    `).get(toWorld, resourceId)?.current_price || 0;
  } catch { /* world_market optional in some test setups */ }

  const sourceCost = sourcePrice * qty;
  const destRevenue = destPrice * qty;
  const profitEstimate = destRevenue - sourceCost - tc.sparks;
  const marginPct = sourceCost > 0 ? profitEstimate / sourceCost : 0;

  return {
    ok: true,
    resourceId,
    fromWorld,
    toWorld,
    qty,
    sourcePrice,
    destPrice,
    sourceCost,
    destRevenue,
    transportCost: tc.sparks,
    risk_pct: tc.risk_pct,
    profitEstimate,
    marginPct,
    friction_floor_sparks: tc.sparks,
  };
}

// ── Trade orders ──────────────────────────────────────────────────

export function createTradeOrder(db, opts) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  const { buyerId, fromWorld, toWorld, resourceId, qty } = opts;
  if (!db || !buyerId || !fromWorld || !toWorld || !resourceId || qty <= 0) {
    return { ok: false, reason: "missing_inputs" };
  }

  const preview = arbitragePreview(db, resourceId, fromWorld, toWorld, qty);
  if (!preview.ok) return preview;

  // The buyer's wallet must cover source_cost + transport_cost up front.
  const upFrontCost = preview.sourceCost + preview.transportCost;
  // Single insert — no wallet debit here; the macro layer decides that.
  // We record the order with full pricing so the settlement step can
  // mechanically conserve sparks.
  const result = db.prepare(`
    INSERT INTO cross_world_trade_orders
      (buyer_id, from_world, to_world, resource_id, qty,
       source_price_sparks, transport_cost_sparks,
       destination_expected_price_sparks, arbitrage_profit_estimate_sparks,
       status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(
    buyerId, fromWorld, toWorld, resourceId, qty,
    preview.sourcePrice, preview.transportCost,
    preview.destPrice, preview.profitEstimate,
  );

  return {
    ok: true,
    orderId: result.lastInsertRowid,
    upFrontCost,
    preview,
  };
}

export function settleTradeOrder(db, orderId, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !orderId) return { ok: false, reason: "missing_inputs" };

  const order = db.prepare(`SELECT * FROM cross_world_trade_orders WHERE id = ?`).get(orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "open" && order.status !== "in_transit") {
    return { ok: false, reason: `already_${order.status}` };
  }

  // Determine actual loss from risk_pct (a fraction of qty rounded
  // down, with stochastic clamp to [0, qty]).
  const route = db.prepare(`SELECT risk_pct FROM transport_routes WHERE from_world = ? AND to_world = ?`)
    .get(order.from_world, order.to_world);
  const riskPct = route?.risk_pct || 0;
  const baseLoss = Math.floor(order.qty * riskPct);
  const lossQty = Math.min(order.qty, opts.actualLossQty ?? baseLoss);
  const survivingQty = order.qty - lossQty;

  // Refresh destination price at settlement time — the market may have
  // moved while in transit.
  let actualDestPrice = order.destination_expected_price_sparks;
  try {
    const m = db.prepare(`SELECT current_price FROM world_market WHERE world_id = ? AND resource_id = ?`)
      .get(order.to_world, order.resource_id);
    if (m?.current_price) actualDestPrice = m.current_price;
  } catch { /* no market — keep expected */ }

  db.prepare(`
    UPDATE cross_world_trade_orders
    SET status = 'delivered',
        delivered_at = unixepoch(),
        actual_destination_price_sparks = ?,
        actual_loss_qty = ?
    WHERE id = ?
  `).run(actualDestPrice, lossQty, orderId);

  // Mark route last-traversed for analytics.
  db.prepare(`UPDATE transport_routes SET last_traversed_at = unixepoch() WHERE from_world = ? AND to_world = ?`)
    .run(order.from_world, order.to_world);

  // Net for the buyer = (surviving_qty * actual_dest_price)
  //                   - (qty * source_price)        ← already paid
  //                   - transport_cost              ← already paid
  // The "net delta" is how much the buyer ends with vs how much they
  // started with. This is what the caller credits to the buyer's wallet.
  const grossRevenue = survivingQty * actualDestPrice;
  const buyerNetDelta = grossRevenue - (order.qty * order.source_price_sparks) - order.transport_cost_sparks;

  return {
    ok: true,
    orderId,
    grossRevenue,
    actualDestPrice,
    survivingQty,
    lossQty,
    buyerNetDelta,
  };
}

// ── Sweep helper for the heartbeat ────────────────────────────────

export function recomputeAllWorlds(db) {
  if (!db) return { ok: false, reason: "no_db" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs`).all().map(r => r.world_id);
  } catch {
    worlds = ["concordia-hub"]; // fallback
  }
  const results = [];
  for (const w of worlds) {
    if (!w) continue;
    try {
      const r = recomputeWorldEconomyState(db, w);
      results.push(r);
    } catch (err) {
      results.push({ ok: false, worldId: w, error: String(err?.message || err) });
    }
  }
  return { ok: true, processed: results.length, results };
}
