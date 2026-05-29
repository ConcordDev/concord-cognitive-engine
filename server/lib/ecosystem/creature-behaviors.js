// server/lib/ecosystem/creature-behaviors.js
//
// Theme 2 (game-feel pass): boid steering for spawned ambient fauna.
//
// Spawned creatures live in `world_npcs` with archetype `creature:<species>`.
// Without steering they sit where the spawner placed them — so the world
// feels like a static point cloud. This module advances each creature's
// position by a small velocity vector composed of three classic boid forces
// plus a flee-from-player term:
//
//   1. SEPARATION  — push away from neighbours within SEP_R
//   2. ALIGNMENT   — match average velocity of neighbours within NBR_R
//   3. COHESION    — drift toward the centre of the species cluster
//   4. FLEE        — sharp repulsion from the player within FLEE_R
//
// We keep velocities in-memory under STATE.creatureMotion[worldId] so we
// don't churn DB writes every tick. The spawner heartbeat (frequency ~30)
// already handles long-term population top-up; this cycle runs at
// frequency 4 (~60s) and bulk-flushes new positions at the end of each
// pass. New creatures pick up a small randomised initial velocity.
//
// Per the heartbeat invariant: this module never throws.

import { gradientConfigFor, hubAnchorFor, radialWorldsEnabled } from "../world-gradient.js";
import { outwardDriftForce } from "../world-migration.js";

const SEP_R         = 4;     // separation radius (m)
const NBR_R         = 12;    // neighbour radius for alignment + cohesion (m)
const FLEE_R        = 12;    // player flee radius (m)
const MAX_SPEED     = 2.0;   // m/s clamp
const STEP_S        = 60;    // approximate seconds per pass (frequency 4 × 15s)
const BOUNDS_M      = 400;   // soft world bounds; gentle pushback past this
const STILL_PROB    = 0.25;  // chance that a creature spends the pass idle (settles cluster centre)

// Tunables exposed for tests
export const TUNING = Object.freeze({
  SEP_R, NBR_R, FLEE_R, MAX_SPEED, STEP_S, BOUNDS_M,
});

/**
 * Get-or-create the in-memory motion store on STATE.
 *   STATE.creatureMotion = {
 *     [worldId]: {
 *       [creatureId]: { vx, vz, lastTickAt }
 *     }
 *   }
 */
function getMotionStore(state, worldId) {
  if (!state.creatureMotion) state.creatureMotion = Object.create(null);
  if (!state.creatureMotion[worldId]) state.creatureMotion[worldId] = Object.create(null);
  return state.creatureMotion[worldId];
}

function clampSpeed(vx, vz, maxSpeed = MAX_SPEED) {
  const m = Math.hypot(vx, vz);
  if (m <= maxSpeed) return { vx, vz };
  const k = maxSpeed / m;
  return { vx: vx * k, vz: vz * k };
}

function randSpeed() {
  const a = Math.random() * Math.PI * 2;
  const m = Math.random() * MAX_SPEED * 0.5;
  return { vx: Math.cos(a) * m, vz: Math.sin(a) * m };
}

/**
 * Run one boids pass for a single world. Reads creatures + nearby players,
 * steers each creature, persists final positions back to world_npcs.
 *
 * @param {object} db                  better-sqlite3 instance
 * @param {object} state               heartbeat STATE singleton
 * @param {string} worldId
 * @returns {{ ok: boolean, moved: number, species: number, reason?: string }}
 */
export function tickFlock(db, state, worldId) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  if (!state) state = {};

  let creatures;
  try {
    creatures = db.prepare(`
      SELECT id, archetype, x, z, level FROM world_npcs
      WHERE world_id = ? AND is_dead = 0
        AND archetype LIKE 'creature:%'
    `).all(worldId);
  } catch {
    return { ok: false, reason: "no_world_npcs" };
  }
  if (!creatures || creatures.length === 0) {
    return { ok: true, moved: 0, species: 0 };
  }

  // Pull recent player positions for flee. Treat any row without a sane
  // numeric x/z as absent. player_world_state may not exist on minimal
  // deployments; in that case flee is a no-op (creatures still flock).
  let players = [];
  try {
    players = db.prepare(`
      SELECT user_id, x, z FROM player_world_state
      WHERE world_id = ?
        AND x IS NOT NULL AND z IS NOT NULL
    `).all(worldId);
  } catch {
    players = [];
  }

  // Group by species so flock cohesion only pulls toward conspecifics.
  const groups = new Map();
  for (const c of creatures) {
    let arr = groups.get(c.archetype);
    if (!arr) { arr = []; groups.set(c.archetype, arr); }
    arr.push(c);
  }

  const motion = getMotionStore(state, worldId);
  const updates = [];

  // WS3: outward-migration drift. When radial worlds are on, creatures that
  // out-level their current ring feel a gentle pull toward the inner edge of
  // their home band — strong fauna drift to the frontier, the hub stays weak.
  // Off → no drift and the legacy ±400 soft bound applies (unchanged).
  let migrate = null;
  let boundsM = BOUNDS_M;
  if (radialWorldsEnabled()) {
    try {
      const world = db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId);
      const cfg = gradientConfigFor(world || null);
      const anchor = hubAnchorFor(db, worldId, cfg);
      migrate = { cfg, anchor };
      boundsM = cfg.worldRadiusM;
    } catch { /* no worlds table → no migration, legacy bounds */ }
  }

  for (const [, members] of groups) {
    if (members.length === 0) continue;

    // Group centre for cohesion seed.
    let cx = 0, cz = 0;
    for (const m of members) { cx += m.x; cz += m.z; }
    cx /= members.length;
    cz /= members.length;

    for (const m of members) {
      // A fraction of creatures spend the pass idle so the cluster has
      // some stationary anchor (reads as "grazing" on the client).
      if (Math.random() < STILL_PROB) {
        // Decay any existing velocity by half so resting creatures don't
        // re-accelerate next pass.
        const cur = motion[m.id];
        if (cur) {
          motion[m.id] = { vx: cur.vx * 0.5, vz: cur.vz * 0.5, lastTickAt: Date.now() };
        }
        continue;
      }

      // Existing velocity (or random init for fresh spawns)
      const cur = motion[m.id] ?? randSpeed();

      let sepX = 0, sepZ = 0;
      let alignX = 0, alignZ = 0, alignN = 0;
      let cohX = 0, cohZ = 0, cohN = 0;

      for (const n of members) {
        if (n.id === m.id) continue;
        const dx = m.x - n.x;
        const dz = m.z - n.z;
        const d2 = dx * dx + dz * dz;
        if (d2 === 0) continue;
        const d = Math.sqrt(d2);
        if (d < SEP_R) {
          // 1/d falloff so close neighbours dominate
          sepX += (dx / d) * (SEP_R - d) / SEP_R;
          sepZ += (dz / d) * (SEP_R - d) / SEP_R;
        }
        if (d < NBR_R) {
          const nm = motion[n.id];
          if (nm) {
            alignX += nm.vx;
            alignZ += nm.vz;
            alignN++;
          }
          cohX += n.x;
          cohZ += n.z;
          cohN++;
        }
      }

      // Player flee — strongest single force when triggered.
      let fleeX = 0, fleeZ = 0;
      let fleeing = false;
      for (const p of players) {
        const dx = m.x - Number(p.x);
        const dz = m.z - Number(p.z);
        const d2 = dx * dx + dz * dz;
        if (d2 === 0) continue;
        const d = Math.sqrt(d2);
        if (d < FLEE_R) {
          fleeing = true;
          // Stronger when player is close
          fleeX += (dx / d) * (FLEE_R - d) / FLEE_R;
          fleeZ += (dz / d) * (FLEE_R - d) / FLEE_R;
        }
      }

      // Combine forces. Weights tuned for "looks like a flock" not "perfectly
      // optimal flocking". Separation is the strongest base force; cohesion
      // is the gentlest pull.
      let vx = cur.vx;
      let vz = cur.vz;

      vx += sepX * 1.2;
      vz += sepZ * 1.2;

      if (alignN > 0) {
        const ax = alignX / alignN;
        const az = alignZ / alignN;
        vx += (ax - cur.vx) * 0.35;
        vz += (az - cur.vz) * 0.35;
      }

      if (cohN > 0) {
        const cmx = cohX / cohN;
        const cmz = cohZ / cohN;
        vx += (cmx - m.x) * 0.04;
        vz += (cmz - m.z) * 0.04;
      } else {
        // Fall back to species centre if no neighbours in NBR_R
        vx += (cx - m.x) * 0.02;
        vz += (cz - m.z) * 0.02;
      }

      if (fleeing) {
        // Flee dominates — overwrite velocity rather than add. Prevents
        // creatures from "running through" the player when cohesion pulls
        // them back toward the flock centre.
        vx = fleeX * MAX_SPEED * 1.4;
        vz = fleeZ * MAX_SPEED * 1.4;
      } else if (migrate) {
        // WS3 outward drift — only when not fleeing (survival first). Pulls an
        // over-leveled creature toward its home band's inner edge; a no-op once
        // it's far enough out.
        const { fx, fz } = outwardDriftForce(migrate.cfg, migrate.anchor, m.x, m.z, m.level);
        vx += fx;
        vz += fz;
      }

      // Soft world bounds: gentle pushback past ±boundsM (radial-aware)
      if (m.x >  boundsM) vx -= (m.x - boundsM) * 0.02;
      if (m.x < -boundsM) vx += (-boundsM - m.x) * 0.02;
      if (m.z >  boundsM) vz -= (m.z - boundsM) * 0.02;
      if (m.z < -boundsM) vz += (-boundsM - m.z) * 0.02;

      // Clamp magnitude so creatures don't streak.
      const cl = clampSpeed(vx, vz, fleeing ? MAX_SPEED * 1.6 : MAX_SPEED);
      const newX = m.x + cl.vx * STEP_S * 0.05; // 0.05 per-second factor: keeps moves under ~6m/pass
      const newZ = m.z + cl.vz * STEP_S * 0.05;

      motion[m.id] = { vx: cl.vx, vz: cl.vz, lastTickAt: Date.now() };
      updates.push({ id: m.id, x: newX, z: newZ });
    }
  }

  // Bulk flush positions. Single transaction; UPDATE per row but inside one
  // tx is ~1ms even for hundreds of creatures on better-sqlite3.
  if (updates.length > 0) {
    try {
      const upd = db.prepare(`UPDATE world_npcs SET x = ?, z = ? WHERE id = ?`);
      const tx = db.transaction((rows) => {
        for (const r of rows) upd.run(r.x, r.z, r.id);
      });
      tx(updates);
    } catch {
      // best-effort: if write fails (locked db, schema mismatch on minimal
      // deployments), in-memory motion still progresses next pass.
    }
  }

  return { ok: true, moved: updates.length, species: groups.size };
}

/**
 * Hard reset of in-memory state for a world. Used by tests and by world
 * teardown when a session ends — not strictly required, but keeps memory
 * tidy on long-lived servers.
 */
export function clearMotionForWorld(state, worldId) {
  if (!state?.creatureMotion?.[worldId]) return;
  delete state.creatureMotion[worldId];
}
