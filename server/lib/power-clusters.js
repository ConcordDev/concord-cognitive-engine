// server/lib/power-clusters.js
//
// Power-upgrade collectibles (SR4 / Crackdown data-cluster loop). Scatter nodes
// across a world; a player who walks into one claims it (per-player) and gains
// progression toward the node's power. Exploring the 3D world IS the upgrade
// path — no menu grind.
//
// Design notes baked into the reference spec:
//  - Traversal-first: `sprint` nodes feed the shipped earned-foot-speed floor
//    (awardSprintXp) — the SR4 "super-sprint comes first" lesson.
//  - Costed, not god-mode: nodes raise the *floor/skill*, never grant uncosted
//    flight; the movement plan's gauge/level/cross-world gating still bounds the
//    ceiling, so powers don't trivialise the world (the SR4 "curse").
//  - Per-player claims: a cluster is a shared position but each player collects
//    their own (Crackdown orbs), so it stays MMO-correct.

import crypto from "node:crypto";
import { awardSprintXp } from "./movement/foot-speed.js";
import { gainSkillXP } from "./skills/skill-engine.js";

// How many nodes a world holds. 0 disables the whole loop (kill-switch).
export const CLUSTERS_PER_WORLD = (() => {
  const v = process.env.CONCORD_POWER_CLUSTERS;
  if (v === undefined) return 40;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
})();
const CLAIM_RADIUS_M = Number(process.env.CONCORD_POWER_CLUSTER_RADIUS) || 5;
const WORLD_SPREAD = 380; // scatter within ±this many units of origin
// Generous server-side sanity bound: if we have a presence row, the claim pos
// must be within this of it (catches blatant teleport-spoofs without being
// strict about interpolation lag).
const PRESENCE_SANITY_M = 40;

// The upgradeable powers + how each awards progression. `sprint` rides the
// shipped movement floor; the rest are skills via the canonical XP engine.
export const POWER_TAGS = ["sprint", "flight", "combat", "glyph", "focus", "vitality"];
const SKILL_FOR_TAG = {
  flight: "flight",
  combat: "combat",
  glyph: "glyph",
  focus: "focus",
  vitality: "vitality",
};

function sha(s) { return crypto.createHash("sha1").update(String(s)).digest(); }

// Deterministic position + tag + tier for the Nth cluster of a world, so a
// world's node layout is stable across restarts and identical on every shard.
function clusterSpecFor(worldId, idx) {
  const h = sha(`${worldId}:powercluster:${idx}`);
  const a = (h.readUInt32BE(0) / 0xffffffff) * Math.PI * 2;
  const r = 20 + (h.readUInt32BE(4) / 0xffffffff) * WORLD_SPREAD;
  const tag = POWER_TAGS[h[8] % POWER_TAGS.length];
  const tier = 1 + (h[9] % 3); // 1..3
  return {
    id: `pc_${worldId}_${idx}`,
    power_tag: tag,
    tier,
    x: Math.cos(a) * r,
    z: Math.sin(a) * r,
  };
}

/**
 * Idempotently ensure `worldId` holds up to CLUSTERS_PER_WORLD nodes. Cheap +
 * safe to call on every list (lazy-seed) — only inserts the missing ones.
 */
export function scatterClusters(db, worldId) {
  if (!db || !worldId || CLUSTERS_PER_WORLD <= 0) return { ok: true, spawned: 0 };
  try {
    const have = db.prepare("SELECT COUNT(*) AS n FROM power_clusters WHERE world_id = ?").get(worldId)?.n || 0;
    if (have >= CLUSTERS_PER_WORLD) return { ok: true, spawned: 0 };
    const ins = db.prepare(`
      INSERT OR IGNORE INTO power_clusters (id, world_id, power_tag, tier, x, y, z)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);
    let spawned = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < CLUSTERS_PER_WORLD; i++) {
        const s = clusterSpecFor(worldId, i);
        const r = ins.run(s.id, worldId, s.power_tag, s.tier, s.x, s.z);
        if (r.changes) spawned++;
      }
    });
    tx();
    return { ok: true, spawned };
  } catch (err) {
    return { ok: false, spawned: 0, reason: "scatter_failed", error: err?.message };
  }
}

/**
 * List a world's clusters with a per-user `claimed` flag. Lazy-seeds first.
 * Optional { x, z, radius } filters to a proximity window (the "nearby nodes"
 * read for the 3D overlay).
 */
export function listClustersForWorld(db, worldId, userId, opts = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs", clusters: [] };
  scatterClusters(db, worldId);
  try {
    const rows = db.prepare(`
      SELECT c.id, c.power_tag, c.tier, c.x, c.y, c.z,
             CASE WHEN cl.cluster_id IS NULL THEN 0 ELSE 1 END AS claimed
      FROM power_clusters c
      LEFT JOIN power_cluster_claims cl
        ON cl.cluster_id = c.id AND cl.user_id = ?
      WHERE c.world_id = ?
    `).all(userId || "", worldId);
    let clusters = rows.map((r) => ({ ...r, claimed: !!r.claimed }));
    if (opts.x != null && opts.z != null) {
      const rad = Number(opts.radius) || 120;
      const r2 = rad * rad;
      clusters = clusters.filter((c) => {
        const dx = c.x - Number(opts.x), dz = c.z - Number(opts.z);
        return dx * dx + dz * dz <= r2;
      });
    }
    if (opts.unclaimedOnly) clusters = clusters.filter((c) => !c.claimed);
    return { ok: true, clusters, count: clusters.length };
  } catch {
    return { ok: true, clusters: [], count: 0, reason: "power_clusters_missing" };
  }
}

function awardForTag(db, userId, tag, tier) {
  if (tag === "sprint") {
    // Feed the earned-foot-speed floor. ~tier*220 m of sprint progress per node.
    const r = awardSprintXp(db, userId, tier * 220);
    return { kind: "sprint", leveled: !!r.leveledUp, level: r.level };
  }
  const skill = SKILL_FOR_TAG[tag];
  if (skill) {
    const r = gainSkillXP(db, userId, skill, "standard", tier * 60) || {};
    return { kind: skill, leveled: !!r.leveled, level: r.newLevel };
  }
  return { kind: tag, leveled: false };
}

/**
 * Claim a cluster for a player: validate proximity, award the power, record the
 * (idempotent) per-player claim. `pos` is the player's current {x,z}; the claim
 * is rejected if they're not within CLAIM_RADIUS_M of the node (the "walk into
 * the orb" check), with a generous server-side presence cross-check on top.
 */
export function claimCluster(db, worldId, userId, clusterId, pos = {}) {
  if (!db || !worldId || !userId || !clusterId) return { ok: false, reason: "missing_inputs" };
  if (CLUSTERS_PER_WORLD <= 0) return { ok: false, reason: "disabled" };
  let cluster;
  try {
    cluster = db.prepare("SELECT * FROM power_clusters WHERE id = ? AND world_id = ?").get(clusterId, worldId);
  } catch {
    return { ok: false, reason: "power_clusters_missing" };
  }
  if (!cluster) return { ok: false, reason: "not_found" };

  // Proximity: claimed position must be at the node.
  if (pos.x != null && pos.z != null) {
    const dx = cluster.x - Number(pos.x), dz = cluster.z - Number(pos.z);
    if (dx * dx + dz * dz > CLAIM_RADIUS_M * CLAIM_RADIUS_M) {
      return { ok: false, reason: "too_far", distance: Math.sqrt(dx * dx + dz * dz) };
    }
  } else {
    return { ok: false, reason: "missing_position" };
  }
  // Defense-in-depth: if a presence row exists, the claim pos must be near it.
  try {
    const pw = db.prepare("SELECT x, z FROM player_world_state WHERE user_id = ?").get(userId);
    if (pw && pw.x != null) {
      const dx = Number(pw.x) - Number(pos.x), dz = Number(pw.z) - Number(pos.z);
      if (dx * dx + dz * dz > PRESENCE_SANITY_M * PRESENCE_SANITY_M) {
        return { ok: false, reason: "position_mismatch" };
      }
    }
  } catch { /* presence table optional — skip cross-check */ }

  // Idempotent claim insert.
  try {
    const r = db.prepare(`
      INSERT OR IGNORE INTO power_cluster_claims (cluster_id, user_id, world_id, power_tag)
      VALUES (?, ?, ?, ?)
    `).run(clusterId, userId, worldId, cluster.power_tag);
    if (!r.changes) return { ok: false, reason: "already_claimed", powerTag: cluster.power_tag };
  } catch (err) {
    return { ok: false, reason: "claim_failed", error: err?.message };
  }

  // The claim is recorded; the power award is best-effort so a minimal build
  // without the skill schema still collects the node.
  let award;
  try { award = awardForTag(db, userId, cluster.power_tag, cluster.tier); }
  catch (err) { award = { kind: cluster.power_tag, leveled: false, error: err?.message }; }
  return { ok: true, clusterId, powerTag: cluster.power_tag, tier: cluster.tier, award };
}

/**
 * Per-power progress summary for a player: claimed vs total per tag (+ overall).
 */
export function getClusterProgress(db, userId, worldId = null) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    if (worldId) scatterClusters(db, worldId);
    const totalRows = worldId
      ? db.prepare("SELECT power_tag, COUNT(*) AS n FROM power_clusters WHERE world_id = ? GROUP BY power_tag").all(worldId)
      : db.prepare("SELECT power_tag, COUNT(*) AS n FROM power_clusters GROUP BY power_tag").all();
    const claimRows = worldId
      ? db.prepare("SELECT power_tag, COUNT(*) AS n FROM power_cluster_claims WHERE user_id = ? AND world_id = ? GROUP BY power_tag").all(userId, worldId)
      : db.prepare("SELECT power_tag, COUNT(*) AS n FROM power_cluster_claims WHERE user_id = ? GROUP BY power_tag").all(userId);
    const total = Object.fromEntries(totalRows.map((r) => [r.power_tag, r.n]));
    const claimed = Object.fromEntries(claimRows.map((r) => [r.power_tag, r.n]));
    const byTag = POWER_TAGS.map((tag) => ({ powerTag: tag, claimed: claimed[tag] || 0, total: total[tag] || 0 }));
    const claimedTotal = byTag.reduce((s, t) => s + t.claimed, 0);
    const grandTotal = byTag.reduce((s, t) => s + t.total, 0);
    return { ok: true, byTag, claimedTotal, total: grandTotal };
  } catch {
    return { ok: true, byTag: [], claimedTotal: 0, total: 0, reason: "power_clusters_missing" };
  }
}
