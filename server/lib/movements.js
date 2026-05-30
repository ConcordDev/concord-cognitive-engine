// server/lib/movements.js
//
// Living Society — Phase 5: the Movement/Cell engine (THE KEYSTONE).
//
// A movement is a grievance-seeded coalition. It is founded by the angriest
// civilian holding a grudge against an authority, recruits cross-tier (civilian
// ↔ authored ↔ player) and cross-world under a secrecy-vs-discovery tension,
// and at a member threshold flips to `acting` (Phase 6 erupts it).
//
//   recruit fast  → visibility rises → counter-intel may suppress
//   recruit slow  → the ruler consolidates (grievance can cool)
//
// Deterministic seeding (clusters real grudges); never throws.

import crypto from "node:crypto";

const SEED_MIN_SEVERITY = Number(process.env.CONCORD_MOVEMENT_SEED_SEVERITY) || 6; // grudge total to seed
const RECRUIT_VISIBILITY_BUMP = Number(process.env.CONCORD_MOVEMENT_RECRUIT_VIS) || 8;
const SUPPRESS_VISIBILITY = Number(process.env.CONCORD_MOVEMENT_SUPPRESS_VIS) || 90;
const DEFAULT_THRESHOLD = Number(process.env.CONCORD_MOVEMENT_THRESHOLD) || 3;

function seeded(str) { return crypto.createHash("sha1").update(String(str)).digest(); }

/** Active (non-left) member count for a movement. */
export function memberCount(db, movementId) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM movement_members WHERE movement_id = ? AND left_at IS NULL`).get(movementId)?.n ?? 0;
  } catch { return 0; }
}

export function getMovement(db, movementId) {
  try {
    const m = db.prepare(`SELECT * FROM movements WHERE id = ?`).get(movementId);
    if (!m) return null;
    return { ...m, members: memberCount(db, movementId) };
  } catch { return null; }
}

export function listMovements(db, worldId, status = null) {
  try {
    const rows = status
      ? db.prepare(`SELECT * FROM movements WHERE world_id = ? AND status = ?`).all(worldId, status)
      : db.prepare(`SELECT * FROM movements WHERE world_id = ?`).all(worldId);
    return rows.map((m) => ({ ...m, members: memberCount(db, m.id) }));
  } catch { return []; }
}

/**
 * Cluster shared grudges against ONE authority in a world and, if the summed
 * severity clears the seed threshold, found a movement led by the angriest
 * member. Idempotent (the unique seed index dedupes (founder, target)).
 *
 * @returns { ok, seeded: [...movementIds] }
 */
export function seedMovementFromGrievance(db, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let clusters = [];
  try {
    // Group open grudges by (target_kind, target_id) where the holder is an NPC
    // that lives in this world; sum severity; pick the angriest holder.
    clusters = db.prepare(`
      SELECT g.target_kind, g.target_id,
             SUM(g.severity) AS total_severity,
             COUNT(DISTINCT g.npc_id) AS holders
      FROM npc_grudges g
      JOIN world_npcs n ON n.id = g.npc_id
      WHERE g.resolved_at IS NULL AND n.world_id = ? AND COALESCE(n.is_dead,0) = 0
        AND g.target_kind IN ('faction','npc')
      GROUP BY g.target_kind, g.target_id
      HAVING total_severity >= ?
    `).all(worldId, SEED_MIN_SEVERITY);
  } catch { return { ok: true, seeded: [] }; }

  const seededIds = [];
  for (const c of clusters) {
    // The angriest holder founds it.
    let founder = null;
    try {
      founder = db.prepare(`
        SELECT g.npc_id, SUM(g.severity) AS sev
        FROM npc_grudges g JOIN world_npcs n ON n.id = g.npc_id
        WHERE g.resolved_at IS NULL AND n.world_id = ? AND g.target_kind = ? AND g.target_id = ?
        GROUP BY g.npc_id ORDER BY sev DESC LIMIT 1
      `).get(worldId, c.target_kind, c.target_id);
    } catch { founder = null; }
    if (!founder) continue;

    const id = `mov_${crypto.randomUUID()}`;
    // Threshold scales (mildly) with how many already share the grievance.
    const threshold = Math.max(1, Math.min(DEFAULT_THRESHOLD + Math.floor(c.holders / 3), 8));
    try {
      const r = db.prepare(`
        INSERT INTO movements (id, world_id, founded_by_kind, founded_by_id, target_kind, target_id,
                               status, grievance_severity, action_threshold, narrative_json)
        VALUES (?, ?, 'npc', ?, ?, ?, 'recruiting', ?, ?, ?)
        ON CONFLICT(world_id, founded_by_id, target_kind, target_id) DO NOTHING
      `).run(id, worldId, founder.npc_id, c.target_kind, c.target_id, c.total_severity, threshold,
        JSON.stringify({ founded_over: `${c.holders} share a grievance against ${c.target_id}` }));
      if (r.changes > 0) {
        // The founder is the first member.
        _addMember(db, id, "npc", founder.npc_id, { role: "founder", loyalty: 0.95 });
        seedPlan(db, id, threshold);
        seededIds.push(id);
      }
    } catch { /* per-cluster best-effort */ }
  }
  return { ok: true, seeded: seededIds };
}

function seedPlan(db, movementId, threshold) {
  try {
    db.prepare(`
      INSERT INTO movement_plans (id, movement_id, phase, description, required_members, completion_predicate_json)
      VALUES (?, ?, 0, 'Gather enough hands to act', ?, ?)
    `).run(`mvp_${crypto.randomUUID()}`, movementId, threshold, JSON.stringify({ members_gte: threshold }));
  } catch { /* optional */ }
}

function _addMember(db, movementId, kind, id, { role = "soldier", loyalty = 0.6, worldId = null, secrecy = 50 } = {}) {
  try {
    db.prepare(`
      INSERT INTO movement_members (movement_id, member_kind, member_id, member_world_id, role, secrecy_level, loyalty)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(movement_id, member_kind, member_id) DO UPDATE SET left_at = NULL, role = excluded.role
    `).run(movementId, kind, id, worldId, role, secrecy, loyalty);
    return true;
  } catch { return false; }
}

/**
 * Recruit a candidate into a movement (the courier reaches them). Growth raises
 * visibility — the secrecy-vs-discovery tension. Cross-tier + cross-world:
 * candidateKind can be 'player', candidateWorldId can differ from the movement's.
 *
 * @returns { ok, members, visibility, reason? }
 */
export function recruit(db, movementId, candidateKind, candidateId, { role = "soldier", candidateWorldId = null } = {}) {
  if (!db || !movementId || !candidateId) return { ok: false, reason: "missing_inputs" };
  const m = getMovement(db, movementId);
  if (!m) return { ok: false, reason: "no_movement" };
  if (m.status === "suppressed" || m.status === "completed") return { ok: false, reason: "movement_closed" };
  // Invariant: a movement can't recruit its own target (you don't enlist the
  // tyrant into the rebellion against the tyrant).
  if (candidateKind !== "player" && String(candidateId) === String(m.target_id)) {
    return { ok: false, reason: "cannot_recruit_target" };
  }
  if (!_addMember(db, movementId, candidateKind, candidateId, { role, worldId: candidateWorldId })) {
    return { ok: false, reason: "add_failed" };
  }
  const visBump = RECRUIT_VISIBILITY_BUMP + (candidateKind === "player" ? 4 : 0);
  const newVis = Math.min(100, (m.visibility_level || 0) + visBump);
  try {
    db.prepare(`UPDATE movements SET visibility_level = ?, updated_at = unixepoch() WHERE id = ?`).run(newVis, movementId);
  } catch { /* noop */ }
  return { ok: true, members: memberCount(db, movementId), visibility: newVis };
}

/**
 * Counter-intel hit: an enforcer/loyalist overhears the movement. Raises
 * visibility; if it crosses the suppression line, the movement is suppressed.
 */
export function exposeMovement(db, movementId, { byKind = "npc", byId = "unknown", method = "overheard", amount = 25 } = {}) {
  if (!db || !movementId) return { ok: false, reason: "missing_inputs" };
  const m = getMovement(db, movementId);
  if (!m) return { ok: false, reason: "no_movement" };
  try {
    db.prepare(`
      INSERT INTO movement_visibility (movement_id, discovered_by_kind, discovered_by_id, method)
      VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
    `).run(movementId, byKind, byId, method);
  } catch { /* optional */ }
  const newVis = Math.min(100, (m.visibility_level || 0) + amount);
  let status = m.status;
  if (newVis >= SUPPRESS_VISIBILITY && m.status !== "acting") status = "suppressed";
  try {
    db.prepare(`UPDATE movements SET visibility_level = ?, status = ?, updated_at = unixepoch() WHERE id = ?`).run(newVis, status, movementId);
  } catch { /* noop */ }
  return { ok: true, visibility: newVis, status, suppressed: status === "suppressed" };
}

/**
 * Advance a movement: when members ≥ action_threshold, flip recruiting →
 * organized → acting. A suppressed/completed movement is inert.
 */
export function tickMovement(db, movementId) {
  const m = getMovement(db, movementId);
  if (!m) return { ok: false, reason: "no_movement" };
  if (m.status === "suppressed" || m.status === "completed") return { ok: true, status: m.status, noop: true };
  const members = m.members;
  let status = m.status;
  if (members >= m.action_threshold) {
    status = m.status === "recruiting" ? "organized" : "acting";
  }
  if (status !== m.status) {
    try { db.prepare(`UPDATE movements SET status = ?, updated_at = unixepoch() WHERE id = ?`).run(status, movementId); }
    catch { /* noop */ }
    // mark the gather plan complete when we organize
    if (status === "organized" || status === "acting") {
      try { db.prepare(`UPDATE movement_plans SET completed_at = unixepoch() WHERE movement_id = ? AND completed_at IS NULL AND required_members <= ?`).run(movementId, members); }
      catch { /* noop */ }
    }
  }
  return { ok: true, status, members, threshold: m.action_threshold, acted: status === "acting" };
}

export const MOVEMENT_CONSTANTS = Object.freeze({
  SEED_MIN_SEVERITY, RECRUIT_VISIBILITY_BUMP, SUPPRESS_VISIBILITY, DEFAULT_THRESHOLD,
});
