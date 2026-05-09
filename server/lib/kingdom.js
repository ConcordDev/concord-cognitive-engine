// server/lib/kingdom.js
//
// Kingdom system core engine. Found, decree, contest, resolve.
//
// Decree alignment is the master-stroke: rulers can ENACT any decree,
// but only decrees that ALIGN with the world's storyline + faction
// policy state activate as enforced refusal fields. Misaligned decrees
// activate as "tension" — visible to other players for exploitation —
// and a fully-misaligned decree just fails. This prevents tyrant rulers
// from breaking the world while still letting power-fantasy play emerge.
//
// Decree alignment is computed by lib/coherence-check.js#validateDecree.

import crypto from "crypto";
import { applyTemporaryRefusal } from "./refusal-field.js";

const DEFAULT_DECREE_DURATION_MS = 30 * 60 * 1000; // 30 min
const ALIGNMENT_ENFORCED         = 0.6;
const ALIGNMENT_TENSION          = 0.3;

// Decree kind catalog. Each kind maps to a refusal-field FIELD_KIND
// that gets applied to visitors inside the kingdom region when the
// decree is enforced. Genre-affinity hints help the alignment check.
export const DECREE_KINDS = Object.freeze({
  firearms_prohibited: {
    refusalKind: "firearms_blocked",
    description: "Firearm-class skills cannot be used inside the kingdom.",
    affinityGenres: ["fantasy", "concordia"],     // negatively affined to cyberpunk/scifi
  },
  martial_law: {
    refusalKind: "martial_law",
    description: "Only kingdom guards + ruler can attack visitors.",
    affinityGenres: ["fantasy", "crime", "superhero"],
  },
  travel_restricted: {
    refusalKind: "travel_blocked",
    description: "Visitors cannot leave the kingdom without ruler permission.",
    affinityGenres: ["crime", "superhero"],
  },
  anonymous_zone: {
    refusalKind: "perception_dampened",
    description: "All players in the kingdom have observation/perception cut by 50%.",
    affinityGenres: ["crime", "cyber"],
  },
  tax_levied: {
    refusalKind: "tax_active",
    description: "Marketplace transactions in the kingdom carry a small CC tax.",
    affinityGenres: ["concordia", "fantasy", "crime", "superhero", "cyber"], // tax fits anywhere
  },
  bounty_hunt: {
    refusalKind: "bounty_flagged",
    description: "Designated targets are flagged as bountied; bounty hunters profit.",
    affinityGenres: ["crime", "fantasy"],
  },
});

function _newId(prefix) {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 14)}`;
}

/* ── Geometry ────────────────────────────────────────────────────── */

/**
 * Ray-casting point-in-polygon. Polygon is [[x, z], ...] in world coords.
 */
export function pointInPolygon(polygon, x, z) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], zi = polygon[i][1];
    const xj = polygon[j][0], zj = polygon[j][1];
    const intersect = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ── Found / list ─────────────────────────────────────────────────── */

export function foundKingdom(db, {
  rulerId, worldId = "concordia-hub", regionPolygon, name,
  storylineId = null, hqDistrictId = null,
}) {
  if (!db) return { ok: false, error: "db_required" };
  if (!rulerId || !name) return { ok: false, error: "ruler_and_name_required" };
  if (!Array.isArray(regionPolygon) || regionPolygon.length < 3) {
    return { ok: false, error: "polygon_min_3_points" };
  }

  // Reject if region overlaps an existing kingdom in the same world
  // (centroid containment is a fast-enough check for v1).
  const centroid = _polygonCentroid(regionPolygon);
  const existing = db.prepare(`SELECT id, region_polygon_json FROM kingdoms WHERE world_id = ?`).all(worldId);
  for (const row of existing) {
    try {
      const poly = JSON.parse(row.region_polygon_json);
      if (pointInPolygon(poly, centroid[0], centroid[1])) {
        return { ok: false, error: "overlaps_existing_kingdom", overlappingId: row.id };
      }
    } catch { /* malformed row — skip */ }
  }

  const id = _newId("kdm");
  try {
    db.prepare(`
      INSERT INTO kingdoms (id, world_id, name, region_polygon_json, ruler_user_id,
                            current_storyline_id, hq_district_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, worldId, String(name).slice(0, 80),
      JSON.stringify(regionPolygon),
      rulerId, storylineId, hqDistrictId,
    );
    db.prepare(`
      INSERT INTO kingdom_residents (kingdom_id, user_id, role) VALUES (?, ?, 'ruler')
    `).run(id, rulerId);
    return { ok: true, kingdomId: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function listKingdoms(db, { worldId = null } = {}) {
  if (!db) return [];
  // TODO: project explicit columns (auto-fix suggestion)
  let sql = `SELECT * FROM kingdoms`;
  const params = [];
  if (worldId) { sql += " WHERE world_id = ?"; params.push(worldId); }
  sql += " ORDER BY founded_at ASC";
  try {
    return db.prepare(sql).all(...params).map((r) => ({
      ...r,
      region_polygon: _safeJson(r.region_polygon_json, []),
    }));
  } catch { return []; }
}

export function getKingdom(db, kingdomId) {
  if (!db) return null;
  // TODO: project explicit columns (auto-fix suggestion)
  const row = db.prepare(`SELECT * FROM kingdoms WHERE id = ?`).get(kingdomId);
  if (!row) return null;
  return { ...row, region_polygon: _safeJson(row.region_polygon_json, []) };
}

/**
 * Find which kingdom (if any) a (worldId, x, z) point lies in.
 */
export function pointInKingdom(db, worldId, x, z) {
  const rows = db.prepare(`SELECT id, name, region_polygon_json FROM kingdoms WHERE world_id = ?`).all(worldId);
  for (const r of rows) {
    const poly = _safeJson(r.region_polygon_json, []);
    if (pointInPolygon(poly, x, z)) return { id: r.id, name: r.name };
  }
  return null;
}

/* ── Decrees ──────────────────────────────────────────────────────── */

/**
 * Enact a decree. Calls coherence-check#validateDecree to score
 * alignment; if score >= ALIGNMENT_ENFORCED the decree applies a
 * refusal field; if 0.3..0.6 it stacks as tension; below 0.3 it fails.
 *
 * @returns {{ ok, decreeId?, alignmentScore, activationState }}
 */
export async function enactDecree(db, kingdomId, decreeKind, parameters = {}, { state = null, durationMs = DEFAULT_DECREE_DURATION_MS } = {}) {
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, error: "kingdom_not_found" };
  const kindMeta = DECREE_KINDS[decreeKind];
  if (!kindMeta) return { ok: false, error: "unknown_decree_kind" };

  // Compute alignment via coherence-check.
  let alignmentScore = 0.5;
  try {
    const cc = await import("./coherence-check.js");
    if (typeof cc.validateDecree === "function") {
      const r = await cc.validateDecree(db, { kingdom: k, decreeKind, parameters });
      if (Number.isFinite(r?.alignmentScore)) alignmentScore = r.alignmentScore;
    } else {
      // Fallback: synthesize alignment from genre affinity if validateDecree
      // isn't yet wired.
      const worldGenre = _genreFromWorldId(k.world_id);
      alignmentScore = (kindMeta.affinityGenres || []).includes(worldGenre) ? 0.75 : 0.4;
    }
  } catch { /* coherence-check unavailable → keep default */ }

  let activationState = "failed";
  let refusalFieldId  = null;
  if (alignmentScore >= ALIGNMENT_ENFORCED) {
    activationState = "enforced";
    if (state) {
      try {
        const entry = applyTemporaryRefusal(state, k.world_id, kindMeta.refusalKind, {
          durationMs, reason: `kingdom_decree:${kingdomId}:${decreeKind}`,
        });
        if (entry?.id) refusalFieldId = entry.id;
      } catch { /* refusal-field unavailable */ }
    }
  } else if (alignmentScore >= ALIGNMENT_TENSION) {
    activationState = "tension";
  }

  const id = _newId("dec");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO kingdom_decrees
      (id, kingdom_id, decree_kind, parameters_json, alignment_score,
       activation_state, activated_at, expires_at, refusal_field_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, kingdomId, decreeKind, JSON.stringify(parameters || {}),
    alignmentScore, activationState,
    activationState === "failed" ? null : now,
    activationState === "failed" ? null : now + Math.floor(durationMs / 1000),
    refusalFieldId,
  );
  return { ok: true, decreeId: id, alignmentScore, activationState, refusalFieldId };
}

export function listDecrees(db, kingdomId, { activeOnly = false } = {}) {
  // TODO: project explicit columns (auto-fix suggestion)
  let sql = `SELECT * FROM kingdom_decrees WHERE kingdom_id = ?`;
  const params = [kingdomId];
  if (activeOnly) { sql += " AND activation_state IN ('enforced', 'tension') AND (expires_at IS NULL OR expires_at > unixepoch())"; }
  sql += " ORDER BY activated_at DESC";
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

/* ── Contest ──────────────────────────────────────────────────────── */

export function contestKingdom(db, kingdomId, contestantId, contestKind = "siege") {
  if (!["siege", "subversion", "annexation"].includes(contestKind)) {
    return { ok: false, error: "invalid_contest_kind" };
  }
  const k = getKingdom(db, kingdomId);
  if (!k) return { ok: false, error: "kingdom_not_found" };
  const id = _newId("ct");
  db.prepare(`
    INSERT INTO kingdom_claims
      (id, kingdom_id, claimant_user_id, contest_kind, contest_strength)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, kingdomId, contestantId, contestKind, 10);
  return { ok: true, contestId: id };
}

export function contributeContestStrength(db, contestId, amount) {
  const r = db.prepare(`
    UPDATE kingdom_claims SET contest_strength = contest_strength + ?
    WHERE id = ? AND resolution_state = 'active'
  `).run(amount, contestId);
  return { ok: r.changes > 0 };
}

export function resolveContest(db, contestId) {
  // TODO: project explicit columns (auto-fix suggestion)
  const c = db.prepare(`SELECT * FROM kingdom_claims WHERE id = ?`).get(contestId);
  if (!c) return { ok: false, error: "contest_not_found" };
  if (c.resolution_state !== "active") return { ok: true, alreadyResolved: true };

  const k = getKingdom(db, c.kingdom_id);
  if (!k) return { ok: false, error: "kingdom_gone" };

  const overthrow = c.contest_strength > k.claim_strength;
  const outcome = overthrow ? "overthrew" : "repelled";

  db.prepare(`
    UPDATE kingdom_claims SET resolution_state = 'resolved', resolved_at = unixepoch(), outcome = ?
    WHERE id = ?
  `).run(outcome, contestId);

  if (overthrow && c.claimant_user_id) {
    db.prepare(`
      UPDATE kingdoms SET ruler_user_id = ?, ruler_faction_id = NULL,
                          claim_strength = ? WHERE id = ?
    `).run(c.claimant_user_id, c.contest_strength, c.kingdom_id);
    // Promote the claimant to ruler in residents (replace existing ruler).
    db.prepare(`UPDATE kingdom_residents SET role = 'noble' WHERE kingdom_id = ? AND role = 'ruler'`).run(c.kingdom_id);
    db.prepare(`
      INSERT INTO kingdom_residents (kingdom_id, user_id, role)
      VALUES (?, ?, 'ruler')
      ON CONFLICT(kingdom_id, user_id) DO UPDATE SET role = 'ruler'
    `).run(c.kingdom_id, c.claimant_user_id);
  } else {
    // Repelled — claim_strength gets a bump for surviving the contest
    db.prepare(`UPDATE kingdoms SET claim_strength = claim_strength + ? WHERE id = ?`)
      .run(Math.min(20, c.contest_strength * 0.2), c.kingdom_id);
  }
  return { ok: true, outcome };
}

/* ── Residents ────────────────────────────────────────────────────── */

export function joinKingdom(db, kingdomId, userId, role = "citizen") {
  try {
    db.prepare(`
      INSERT INTO kingdom_residents (kingdom_id, user_id, role)
      VALUES (?, ?, ?)
      ON CONFLICT(kingdom_id, user_id) DO UPDATE SET role = excluded.role
    `).run(kingdomId, userId, role);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function listResidents(db, kingdomId) {
  try {
    // TODO: project explicit columns (auto-fix suggestion)
    return db.prepare(`SELECT * FROM kingdom_residents WHERE kingdom_id = ? ORDER BY joined_at ASC`).all(kingdomId);
  } catch { return []; }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function _safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function _polygonCentroid(polygon) {
  let cx = 0, cz = 0;
  for (const [x, z] of polygon) { cx += x; cz += z; }
  return [cx / polygon.length, cz / polygon.length];
}

function _genreFromWorldId(worldId) {
  if (!worldId) return "concordia";
  const id = worldId.toLowerCase();
  if (id.includes("fantasy")) return "fantasy";
  if (id.includes("cyber"))   return "cyber";
  if (id.includes("crime"))   return "crime";
  if (id.includes("hero") || id.includes("super")) return "superhero";
  if (id.includes("scifi") || id.includes("space")) return "scifi";
  return "concordia";
}

export {
  ALIGNMENT_ENFORCED,
  ALIGNMENT_TENSION,
  DEFAULT_DECREE_DURATION_MS,
};
