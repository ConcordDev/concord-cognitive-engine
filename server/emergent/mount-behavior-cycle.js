// server/emergent/mount-behavior-cycle.js
//
// Phase U — substrate-driven loose mount behaviour.
//
// For each loose mount (player_companions where mount_eligible=1 AND
// deployed=0): pick a target state (wandering / fleeing / feeding)
// based on hunger + predator proximity + nearest food node, then step
// the position one tick toward the target.
//
// Frequency: 20 ticks (~5 min). Tunable via CONCORD_MOUNT_BEHAVIOR_BATCH.
//
// Emits `mount:behavior` socket events on state change so the
// frontend MountAvatar3D can swap animation clips.

const PREDATOR_RANGE_M = 30;
const FOOD_RANGE_M     = 12;
const WANDER_STEP_M    = 8;
const FLEE_STEP_M      = 18;
const HUNGER_FEED_THRESHOLD = 70;

function _maxPerPass(envFlag = 200) {
  const v = process.env.CONCORD_MOUNT_BEHAVIOR_BATCH;
  return v && Number.isFinite(Number(v)) ? Math.max(1, Number(v)) : envFlag;
}

function _hungerFor(db, companionId) {
  // mount_state JSON column from migration 142 carries hunger/stamina/loyalty.
  try {
    const row = db.prepare(`SELECT mount_state FROM player_companions WHERE id = ?`).get(companionId);
    const st = row?.mount_state ? JSON.parse(row.mount_state) : null;
    return Number(st?.hunger ?? 0);
  } catch { return 0; }
}

function _nearestPredator(db, worldId, x, z) {
  // A predator is any creature in world_npcs flagged hostile_to_mounts.
  // For now: any NPC of archetype:'creature_hunter' or 'predator' within range.
  try {
    const rows = db.prepare(`
      SELECT id, current_location FROM world_npcs
      WHERE world_id = ? AND COALESCE(is_dead,0) = 0
        AND (archetype LIKE 'creature_hunter%' OR archetype LIKE '%predator%')
      LIMIT 100
    `).all(worldId);
    let best = null;
    for (const r of rows) {
      try {
        const p = JSON.parse(r.current_location || '{}');
        const dx = (p.x || 0) - x, dz = (p.z || 0) - z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d < PREDATOR_RANGE_M && (!best || d < best.d)) best = { id: r.id, x: p.x || 0, z: p.z || 0, d };
      } catch { /* skip malformed */ }
    }
    return best;
  } catch { return null; }
}

function _nearestFoodNode(db, worldId, x, z) {
  // resource_nodes from the gather substrate; food kinds = herb / fruit / tuber.
  try {
    const rows = db.prepare(`
      SELECT id, x, z FROM world_resource_nodes
       WHERE world_id = ? AND node_type IN ('herb', 'fruit', 'tuber', 'plant')
       LIMIT 200
    `).all(worldId);
    let best = null;
    for (const r of rows) {
      const dx = (r.x || 0) - x, dz = (r.z || 0) - z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if (d < FOOD_RANGE_M && (!best || d < best.d)) best = { id: r.id, x: r.x, z: r.z, d };
    }
    return best;
  } catch { return null; }
}

function _stepTowards(curX, curZ, tgtX, tgtZ, stride) {
  const dx = tgtX - curX, dz = tgtZ - curZ;
  const d  = Math.sqrt(dx*dx + dz*dz);
  if (d < 0.01) return { x: curX, z: curZ };
  return { x: curX + (dx / d) * Math.min(d, stride), z: curZ + (dz / d) * Math.min(d, stride) };
}

function _wanderStep(curX, curZ, seed) {
  // Deterministic-ish wander — random angle from seed, fixed stride.
  const ang = (seed * 13.7 + Date.now() * 0.0001) % (Math.PI * 2);
  return { x: curX + Math.cos(ang) * WANDER_STEP_M, z: curZ + Math.sin(ang) * WANDER_STEP_M };
}

export async function runMountBehaviorCycle({ db } = {}) {
  if (!db) return { ok: true, reason: 'no_db', processed: 0 };
  const cap = _maxPerPass();

  let processed = 0;
  let stateChanges = 0;
  const emits = [];

  try {
    const candidates = db.prepare(`
      SELECT id, owner_id, world_id, behavior_state, pos_x, pos_z
        FROM player_companions
       WHERE mount_eligible = 1 AND deployed = 0
       ORDER BY COALESCE(behavior_updated_at, 0) ASC
       LIMIT ?
    `).all(cap);

    // Hoisted constant-SQL statements reused across the bounded candidate loop.
    const selMountState = db.prepare(`SELECT mount_state FROM player_companions WHERE id = ?`);
    const setMountState = db.prepare(`UPDATE player_companions SET mount_state = ? WHERE id = ?`);
    const setBehavior = db.prepare(`
          UPDATE player_companions
             SET behavior_state = ?, pos_x = ?, pos_z = ?, behavior_updated_at = unixepoch()
           WHERE id = ?
        `);

    for (const c of candidates) {
      try {
        const x  = Number(c.pos_x ?? 0);
        const z  = Number(c.pos_z ?? 0);
        const hunger = _hungerFor(db, c.id);

        const predator = _nearestPredator(db, c.world_id, x, z);
        let nextState  = c.behavior_state || 'wandering';
        let nextPos    = { x, z };

        if (predator) {
          nextState = 'fleeing';
          // Move directly AWAY from the predator.
          const away = _stepTowards(x, z, x - (predator.x - x), z - (predator.z - z), FLEE_STEP_M);
          nextPos = away;
        } else if (hunger >= HUNGER_FEED_THRESHOLD) {
          const food = _nearestFoodNode(db, c.world_id, x, z);
          if (food) {
            nextState = 'feeding';
            nextPos   = _stepTowards(x, z, food.x, food.z, WANDER_STEP_M);
            // Decrement hunger via mount_state JSON merge.
            try {
              const row = selMountState.get(c.id);
              const st  = row?.mount_state ? JSON.parse(row.mount_state) : {};
              st.hunger = Math.max(0, (st.hunger ?? 0) - 4);
              setMountState.run(JSON.stringify(st), c.id);
            } catch { /* mount_state may not exist on legacy rows */ }
          } else {
            nextState = 'wandering';
            nextPos   = _wanderStep(x, z, c.id.charCodeAt(0));
          }
        } else {
          nextState = 'wandering';
          nextPos   = _wanderStep(x, z, c.id.charCodeAt(0));
        }

        setBehavior.run(nextState, nextPos.x, nextPos.z, c.id);

        if (nextState !== c.behavior_state) {
          stateChanges++;
          emits.push({ companionId: c.id, ownerId: c.owner_id, worldId: c.world_id, state: nextState, x: nextPos.x, z: nextPos.z });
        }
        processed++;
      } catch { /* per-mount failure isolated */ }
    }
  } catch (err) {
    return { ok: false, reason: 'query_failed', err: String(err?.message || err) };
  }

  // Realtime fan-out (best-effort).
  try {
    const REALTIME = globalThis._concordREALTIME || globalThis.__CONCORD_REALTIME__;
    if (REALTIME?.io) {
      for (const e of emits) {
        REALTIME.io.to(`world:${e.worldId}`).emit('mount:behavior', e);
      }
    }
  } catch { /* sockets optional */ }

  return { ok: true, processed, stateChanges, emits: emits.length };
}
