// server/lib/theme-park.js
//
// Phase CC7 — theme park tycoon.

import crypto from "node:crypto";
import logger from "../logger.js";

const VALID_KINDS = new Set(["ride", "show", "food", "game"]);
const APPEAL_RIDE_BONUS_PER_VISIT = 0.001;
const SATISFACTION_GAIN_BASE = 0.15;
const VISITOR_STAY_S = 30 * 60;

export function openAttraction(db, ownerUserId, opts = {}) {
  if (!db || !ownerUserId) return { ok: false, error: "missing_inputs" };
  const { worldId, buildingId, attractionKind, name, ticketCc = 5 } = opts;
  if (!worldId || !attractionKind) return { ok: false, error: "missing_inputs" };
  if (!VALID_KINDS.has(attractionKind)) return { ok: false, error: "invalid_kind" };
  try {
    const id = `atr_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO attractions
        (id, owner_user_id, world_id, building_id, attraction_kind, name, ticket_cc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerUserId, worldId, buildingId || null, attractionKind, name || "Attraction", Math.max(0, ticketCc));
    return { ok: true, attractionId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function closeAttraction(db, attractionId, ownerUserId) {
  if (!db || !attractionId) return { ok: false, error: "missing_inputs" };
  try {
    const a = db.prepare(`SELECT owner_user_id, closed_at FROM attractions WHERE id = ?`).get(attractionId);
    if (!a) return { ok: false, error: "no_attraction" };
    if (a.owner_user_id !== ownerUserId) return { ok: false, error: "not_owner" };
    if (a.closed_at) return { ok: false, error: "already_closed" };
    db.prepare(`UPDATE attractions SET closed_at = unixepoch() WHERE id = ?`).run(attractionId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function tickVisitors(db, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, error: "missing_inputs" };
  const newArrivals = Math.max(0, Math.floor(Number(opts.newArrivals) || 0));
  try {
    // Arrivals.
    for (let i = 0; i < newArrivals; i++) {
      const vid = `vis_${crypto.randomBytes(4).toString("hex")}`;
      db.prepare(`
        INSERT INTO visitor_npcs (id, world_id, leaves_at)
        VALUES (?, ?, unixepoch() + ?)
      `).run(vid, worldId, VISITOR_STAY_S);
    }

    // Assign waiting visitors to attractions (by base_appeal).
    const waiting = db.prepare(`
      SELECT id FROM visitor_npcs
      WHERE world_id = ? AND current_attraction_id IS NULL AND leaves_at > unixepoch()
    `).all(worldId);
    const open = db.prepare(`
      SELECT id, ticket_cc FROM attractions
      WHERE world_id = ? AND closed_at IS NULL
      ORDER BY base_appeal DESC, total_visits DESC
    `).all(worldId);
    if (open.length === 0) return { ok: true, assigned: 0, departed: 0 };

    // Hoisted constant-SQL statements reused across the assign + depart loops.
    const assignVisitor = db.prepare(`
        UPDATE visitor_npcs SET current_attraction_id = ? WHERE id = ?
      `);
    const bumpAttraction = db.prepare(`
        UPDATE attractions
        SET current_visitors = current_visitors + 1,
            total_visits = total_visits + 1,
            total_revenue = total_revenue + ?,
            base_appeal = MIN(1.0, base_appeal + ?)
        WHERE id = ?
      `);
    const bumpSatisfaction = db.prepare(`
        UPDATE visitor_npcs
        SET satisfaction = MIN(1.0, satisfaction + ?), total_paid = total_paid + ?
        WHERE id = ?
      `);
    const decAttraction = db.prepare(`
          UPDATE attractions SET current_visitors = MAX(0, current_visitors - 1)
          WHERE id = ?
        `);
    const delVisitor = db.prepare(`DELETE FROM visitor_npcs WHERE id = ?`);

    let assigned = 0;
    for (const v of waiting) {
      const target = open[assigned % open.length];
      assignVisitor.run(target.id, v.id);
      bumpAttraction.run(target.ticket_cc, APPEAL_RIDE_BONUS_PER_VISIT, target.id);
      bumpSatisfaction.run(SATISFACTION_GAIN_BASE, target.ticket_cc, v.id);
      assigned++;
    }

    // Departures: visitors past leaves_at depart, current_visitors decrement.
    const departing = db.prepare(`
      SELECT id, current_attraction_id FROM visitor_npcs
      WHERE world_id = ? AND leaves_at <= unixepoch()
    `).all(worldId);
    for (const d of departing) {
      if (d.current_attraction_id) {
        decAttraction.run(d.current_attraction_id);
      }
      delVisitor.run(d.id);
    }

    return { ok: true, assigned, departed: departing.length };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getAttraction(db, attractionId) {
  if (!db || !attractionId) return null;
  try {
    return db.prepare(`SELECT * FROM attractions WHERE id = ?`).get(attractionId) || null;
  } catch { return null; }
}

export function listAttractionsInWorld(db, worldId) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT * FROM attractions WHERE world_id = ? AND closed_at IS NULL
      ORDER BY total_revenue DESC
    `).all(worldId);
  } catch { return []; }
}

export { VALID_KINDS, SATISFACTION_GAIN_BASE };
