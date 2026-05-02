/**
 * Concord Link Walkers
 *
 * Authored NPC couriers who carry physical messages between worlds. The
 * concord_link_walkers table existed since migration 076 but had no journey
 * simulation — this module is the runtime that fills the gap.
 *
 * Lifecycle:
 *   1. Walkers seeded from authored content/world/**\/npcs.json (link_walker:true)
 *      via seedWalkersFromAuthored. Idempotent.
 *   2. listAvailableWalkers — readers see walkers whose status='available' in
 *      a given home world.
 *   3. hireWalker — creates a contract, builds an anchor path between source
 *      and dest worlds, marks walker in_transit. Sparks debit handled at the
 *      send-message layer (concord-link.js); this module only manipulates the
 *      walker + contract rows.
 *   4. advanceJourneyTick — heartbeat-driven. Advances every in_transit walker
 *      one anchor per tick. On final hop rolls intercept; success = message
 *      delivered, failure = message intercepted (status set on the message
 *      row so the black-market layer in Phase C can surface it).
 *   5. trackWalker — read-only view by contract_id.
 *
 * Heartbeat invariant: every public function is wrapped in try/catch by its
 * callers, but advanceJourneyTick additionally guards each row in its own
 * try so a single bad walker never aborts the tick.
 */

import crypto from "crypto";

const REPUTATION_FLOOR = 10;
const REPUTATION_CEIL  = 100;

/**
 * Seed walker rows from authored NPC JSON. Called by content-seeder.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Iterable<object>} authoredNPCs  - flat list of { id, link_walker, world_id, ... }
 * @returns {{ inserted: number, skipped: number }}
 */
export function seedWalkersFromAuthored(db, authoredNPCs) {
  let inserted = 0;
  let skipped  = 0;

  const stmt = db.prepare(`
    INSERT INTO concord_link_walkers (
      id, npc_id, home_world, current_world, status, reputation,
      created_at, updated_at, current_anchor_idx
    )
    VALUES (?, ?, ?, ?, 'available', ?, unixepoch(), unixepoch(), 0)
    ON CONFLICT(id) DO NOTHING
  `);

  for (const npc of authoredNPCs) {
    if (!npc?.link_walker || !npc?.id) { skipped++; continue; }
    const homeWorld = npc.world_id || npc.home_world || "concordia";
    const reputation = clamp(typeof npc.reputation === "number" ? npc.reputation : 50, REPUTATION_FLOOR, REPUTATION_CEIL);
    const id = `walker_${npc.id}`;
    try {
      const r = stmt.run(id, npc.id, homeWorld, homeWorld, reputation);
      if (r.changes > 0) inserted++; else skipped++;
    } catch { skipped++; }
  }

  return { inserted, skipped };
}

/**
 * @returns {Array<{id:string, npc_id:string, home_world:string, current_world:string,
 *                  status:string, reputation:number}>}
 */
export function listAvailableWalkers(db, { homeWorld = null, limit = 50 } = {}) {
  if (homeWorld) {
    return db.prepare(`
      SELECT id, npc_id, home_world, current_world, status, reputation
        FROM concord_link_walkers
       WHERE status = 'available' AND home_world = ?
       ORDER BY reputation DESC
       LIMIT ?
    `).all(homeWorld, limit);
  }
  return db.prepare(`
    SELECT id, npc_id, home_world, current_world, status, reputation
      FROM concord_link_walkers
     WHERE status = 'available'
     ORDER BY reputation DESC
     LIMIT ?
  `).all(limit);
}

/**
 * Build an anchor path between two worlds. Walks through concord_link_anchors,
 * preferring same-world stops first if available, then cross-world. Falls back
 * to a synthetic 2-stop direct route if anchors are missing.
 */
export function buildRoute(db, sourceWorld, destWorld) {
  if (!sourceWorld || !destWorld) return [];

  // Source-world anchor (any stable one)
  const src = db.prepare(`
    SELECT id FROM concord_link_anchors
     WHERE world_id = ? ORDER BY stability DESC LIMIT 1
  `).get(sourceWorld);

  // Dest-world anchor (any stable one)
  const dst = db.prepare(`
    SELECT id FROM concord_link_anchors
     WHERE world_id = ? ORDER BY stability DESC LIMIT 1
  `).get(destWorld);

  // For cross-world routes insert a hub stop ('concordia') if neither side is
  // already concordia. Concordia is the canonical relay world per CLAUDE.md.
  const route = [];
  if (src?.id) route.push(src.id);
  if (sourceWorld !== "concordia" && destWorld !== "concordia") {
    const hub = db.prepare(`
      SELECT id FROM concord_link_anchors
       WHERE world_id = 'concordia' ORDER BY stability DESC LIMIT 1
    `).get();
    if (hub?.id) route.push(hub.id);
  }
  if (dst?.id && (!route.length || route[route.length - 1] !== dst.id)) {
    route.push(dst.id);
  }

  // Fallback if no anchors at all — synthesize symbolic stops so the journey
  // simulation still has something to advance through.
  if (route.length < 2) {
    return [`anchor:${sourceWorld}`, `anchor:${destWorld}`];
  }
  return route;
}

/**
 * Hire a walker. Returns the contract row. The caller is responsible for
 * debiting the payer's sparks; this function just records the contract +
 * walker journey state.
 *
 * @returns {{ ok:true, contract:object, walker:object } | { ok:false, reason:string }}
 */
export function hireWalker(db, { walkerId, payerId, sourceWorld, destWorld, messageId = null, feeSparks = 0 }) {
  if (!walkerId || !payerId || !sourceWorld || !destWorld) {
    return { ok: false, reason: "missing_required_fields" };
  }

  const walker = db.prepare(`SELECT * FROM concord_link_walkers WHERE id = ?`).get(walkerId);
  if (!walker)                  return { ok: false, reason: "walker_not_found" };
  if (walker.status !== "available") return { ok: false, reason: "walker_unavailable" };

  const route = buildRoute(db, sourceWorld, destWorld);
  if (route.length < 2) return { ok: false, reason: "no_route_available" };

  const contractId = `lwc_${crypto.randomBytes(8).toString("hex")}`;
  const interceptRoll = computeInterceptRoll(walker, sourceWorld, destWorld);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO concord_link_contracts (
        id, walker_id, message_id, payer_id, fee_sparks, status,
        source_world, dest_world, created_at
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, unixepoch())
    `).run(contractId, walkerId, messageId, payerId, Math.max(0, Math.floor(feeSparks)), sourceWorld, destWorld);

    db.prepare(`
      UPDATE concord_link_walkers
         SET status            = 'in_transit',
             contract_id       = ?,
             route_anchors     = ?,
             current_anchor_idx = 0,
             eta_tick          = NULL,
             intercept_roll    = ?,
             dispatched_at     = unixepoch(),
             message_id        = ?,
             updated_at        = unixepoch()
       WHERE id = ?
    `).run(contractId, JSON.stringify(route), interceptRoll, messageId, walkerId);
  });
  tx();

  const contract = db.prepare(`SELECT * FROM concord_link_contracts WHERE id = ?`).get(contractId);
  const updatedWalker = db.prepare(`SELECT * FROM concord_link_walkers WHERE id = ?`).get(walkerId);
  return { ok: true, contract, walker: updatedWalker };
}

/**
 * Compute the per-journey intercept roll. Higher reputation walkers + same-world
 * routes are safer; cross-world is riskier. Returns a value in [0,1] — the
 * journey is intercepted on its final hop if Math.random() < intercept_roll.
 */
function computeInterceptRoll(walker, sourceWorld, destWorld) {
  const sameWorld = sourceWorld === destWorld;
  const repFactor = 1 - clamp(walker.reputation, 0, 100) / 200; // 0.5 → 1.0
  const distanceFactor = sameWorld ? 0.4 : 1.0;
  const base = 0.04; // 4% baseline intercept rate at rep=100, same world
  return clamp(base * repFactor * distanceFactor * 4, 0.005, 0.6);
}

/**
 * Heartbeat advance. Moves every in_transit walker one anchor closer to
 * destination. On the final hop, rolls intercept_roll; on success message
 * is delivered, on failure message is intercepted. In either case the
 * contract closes and the walker returns to available.
 *
 * @returns {{ advanced:number, delivered:number, intercepted:number, errors:number }}
 */
export function advanceJourneyTick(db, { onDelivered = null, onIntercepted = null } = {}) {
  let advanced = 0, delivered = 0, intercepted = 0, errors = 0;

  const inTransit = db.prepare(`
    SELECT * FROM concord_link_walkers WHERE status = 'in_transit'
  `).all();

  for (const w of inTransit) {
    try {
      let route = [];
      try { route = JSON.parse(w.route_anchors || "[]"); } catch { route = []; }
      if (!Array.isArray(route) || route.length < 2) {
        // Malformed — return walker to available state so the world recovers
        db.prepare(`
          UPDATE concord_link_walkers
             SET status='available', contract_id=NULL, message_id=NULL,
                 route_anchors=NULL, current_anchor_idx=0, intercept_roll=NULL,
                 updated_at=unixepoch()
           WHERE id=?
        `).run(w.id);
        errors++;
        continue;
      }

      const nextIdx = (w.current_anchor_idx || 0) + 1;
      const isFinalHop = nextIdx >= route.length - 1;

      if (!isFinalHop) {
        db.prepare(`
          UPDATE concord_link_walkers
             SET current_anchor_idx = ?,
                 current_world      = COALESCE(?, current_world),
                 updated_at         = unixepoch()
           WHERE id = ?
        `).run(nextIdx, anchorToWorld(route[nextIdx]), w.id);
        advanced++;
        continue;
      }

      // Final hop — roll intercept then resolve
      const roll = typeof w.intercept_roll === "number" ? w.intercept_roll : 0.05;
      const isIntercepted = Math.random() < roll;
      const finalAnchor   = route[route.length - 1];
      const finalWorld    = anchorToWorld(finalAnchor);

      if (isIntercepted) {
        completeJourney(db, w, "intercepted", finalWorld);
        intercepted++;
        if (onIntercepted) { try { onIntercepted({ walker: w, messageId: w.message_id, contractId: w.contract_id }); } catch { /* listener best-effort */ } }
      } else {
        completeJourney(db, w, "delivered", finalWorld);
        delivered++;
        if (onDelivered) { try { onDelivered({ walker: w, messageId: w.message_id, contractId: w.contract_id }); } catch { /* listener best-effort */ } }
      }
    } catch { errors++; }
  }

  return { advanced, delivered, intercepted, errors };
}

function completeJourney(db, walker, outcome, finalWorld) {
  // Close the contract
  if (walker.contract_id) {
    const contractStatus = outcome === "delivered" ? "delivered"
      : outcome === "intercepted" ? "intercepted"
      : outcome === "lost" ? "lost"
      : "delivered";
    db.prepare(`
      UPDATE concord_link_contracts
         SET status=?, completed_at=unixepoch()
       WHERE id=?
    `).run(contractStatus, walker.contract_id);
  }

  // Update the message row if there is one
  if (walker.message_id) {
    const msgStatus = outcome === "intercepted" ? "intercepted"
      : outcome === "lost" ? "lost"
      : "delivered";
    db.prepare(`
      UPDATE concord_link_messages
         SET status=?, delivered_at=CASE WHEN ?='delivered' THEN unixepoch() ELSE delivered_at END,
             link_walker_id=?
       WHERE id=?
    `).run(msgStatus, msgStatus, walker.id, walker.message_id);
  }

  // Reputation: success +2, intercepted -3, lost -5 (clamped)
  const repDelta = outcome === "delivered" ? 2 : outcome === "intercepted" ? -3 : -5;
  const newRep   = clamp((walker.reputation || 50) + repDelta, REPUTATION_FLOOR, REPUTATION_CEIL);

  // Walker returns to available in the destination world
  db.prepare(`
    UPDATE concord_link_walkers
       SET status='available', contract_id=NULL, message_id=NULL,
           route_anchors=NULL, current_anchor_idx=0, intercept_roll=NULL,
           current_world=COALESCE(?, current_world),
           reputation=?, updated_at=unixepoch()
     WHERE id=?
  `).run(finalWorld, newRep, walker.id);
}

/**
 * Read-only journey/contract view by contract id.
 */
export function trackWalker(db, contractId) {
  const contract = db.prepare(`SELECT * FROM concord_link_contracts WHERE id=?`).get(contractId);
  if (!contract) return null;
  const walker = db.prepare(`SELECT * FROM concord_link_walkers WHERE id=?`).get(contract.walker_id);
  let route = [];
  if (walker?.route_anchors) {
    try { route = JSON.parse(walker.route_anchors); } catch { /* ignore */ }
  }
  return { contract, walker, route, currentAnchorIdx: walker?.current_anchor_idx ?? null };
}

function anchorToWorld(anchorId) {
  if (!anchorId) return null;
  if (anchorId.startsWith("anchor:")) return anchorId.slice(7);
  return null; // real anchors don't encode their world in the id; current_world unchanged
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
