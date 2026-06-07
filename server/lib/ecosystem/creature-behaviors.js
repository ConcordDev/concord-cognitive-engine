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
import { lifestyleForSpecies } from "./loot-tables.js";
import { eats, isScavenger } from "./food-web.js";
import crypto from "node:crypto";
import {
  freshCreatureNeeds, decayCreatureNeeds, satisfyCreatureNeed, creatureIntent,
} from "./creature-needs.js";
// Wave 7 affect/instinct substrate (Layers 1-4). Pure libs; the wire below is
// additive + behind CONCORD_AFFECT_INSTINCT (default on when ecology is on).
import { umweltForSpecies, perceiveSignals } from "./umwelt.js";
import { computeCoreAffect } from "./core-affect.js";
import { restingDrivesForSpecies, updateDrives, dominantDrive } from "./drives.js";
import { releasersForSpecies, matchReleaser } from "./releasers.js";
import { signalsForWorld } from "../embodied/signals.js";

const SEP_R         = 4;     // separation radius (m)
const NBR_R         = 12;    // neighbour radius for alignment + cohesion (m)
const FLEE_R        = 12;    // player flee radius (m)
const MAX_SPEED     = 2.0;   // m/s clamp
const STEP_S        = 60;    // approximate seconds per pass (frequency 4 × 15s)
const BOUNDS_M      = 400;   // soft world bounds; gentle pushback past this
const STILL_PROB    = 0.25;  // chance that a creature spends the pass idle (settles cluster centre)

// ── Animal Kingdom ecology tunables ─────────────────────────────────────────
const PREDATOR_SENSE_R = 16;   // prey sense a predator within this radius and bolt
const HUNT_R           = 22;   // a hungry predator stalks prey within this radius
const KILL_R           = 3.5;  // a predator at/inside this range of prey makes a kill
const MAX_KILLS_PASS   = 3;    // cap predation kills per world per pass (bounds DB writes)
const ECO_STEP_HOURS   = 0.5;  // game-time hours of need decay per ~60s pass (accelerated)
const HUNGER_HUNT_THRESHOLD = 0.5; // a predator only hunts once this hungry
const SCAVENGE_R       = 26;   // a hungry scavenger senses + steers to a carcass
const FEED_R           = 3.5;  // a scavenger at/inside this range feeds on it
const MAX_FEED_PASS    = 4;    // cap carcass feeds per world per pass

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
export function tickFlock(db, state, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  if (!state) state = {};

  // Animal Kingdom: the systemic layer (cross-species predator awareness, hunt
  // steering, needs-driven intent, predation kills) rides on top of the pure
  // boids. Off (CONCORD_CREATURE_ECOLOGY=0) → byte-identical to the original
  // flock pass. Caller may force via opts.ecology for tests.
  const ecology = opts.ecology ?? (process.env.CONCORD_CREATURE_ECOLOGY !== "0");
  // Wave 7 Layer 1-4 affect/instinct overlay. Rides inside the ecology block; its
  // only effects are additive fields on motion[m.id] (_affect/_perceived/_drives)
  // + a force-gain multiplier from a released FAP. Off → byte-identical ecology pass.
  const affect = ecology && (opts.affect ?? (process.env.CONCORD_AFFECT_INSTINCT !== "0"));

  // One world-signal bundle per tickFlock (not per creature) — the umwelt filter
  // weights this same bundle differently per species. signalsForWorld degrades to
  // { hasData:false } when the embodied substrate is empty, so perception is a
  // graceful no-op on minimal builds.
  let worldSignals = null;
  if (affect) {
    try { worldSignals = signalsForWorld(db, worldId); }
    catch { worldSignals = { hasData: false }; }
  }
  // Per-species memoisation so the catalog lookups (umwelt/resting-drives/releasers)
  // run once per species per tick, not once per creature.
  const _umweltCache = new Map();
  const _restingCache = new Map();
  const _releaserCache = new Map();
  const umweltFor = (sp) => { let v = _umweltCache.get(sp); if (!v) { v = umweltForSpecies(sp); _umweltCache.set(sp, v); } return v; };
  const restingFor = (sp) => { let v = _restingCache.get(sp); if (!v) { v = restingDrivesForSpecies(sp); _restingCache.set(sp, v); } return v; };
  const releasersFor = (sp) => { let v = _releaserCache.get(sp); if (!v) { v = releasersForSpecies(sp); _releaserCache.set(sp, v); } return v; };

  let creatures;
  try {
    creatures = db.prepare(`
      SELECT id, archetype, species_id, x, z, level FROM world_npcs
      WHERE world_id = ? AND is_dead = 0
        AND archetype LIKE 'creature:%'
    `).all(worldId);
  } catch {
    // Older schema without species_id — retry the legacy column set so the
    // pure-boids path still runs (species is then derived from the archetype).
    try {
      creatures = db.prepare(`
        SELECT id, archetype, x, z, level FROM world_npcs
        WHERE world_id = ? AND is_dead = 0
          AND archetype LIKE 'creature:%'
      `).all(worldId);
    } catch {
      return { ok: false, reason: "no_world_npcs" };
    }
  }
  if (!creatures || creatures.length === 0) {
    return { ok: true, moved: 0, species: 0 };
  }

  // Ecology pre-pass: tag each creature with its species + lifestyle, and split
  // the flat predator / prey lists used for cross-species awareness + hunting.
  let predatorList = [];
  let preyList = [];
  let corpses = []; // fresh carcasses scavengers path toward (RDR2 vultures-on-the-kill)
  if (ecology) {
    for (const c of creatures) {
      const sp = c.species_id
        || (String(c.archetype || "").startsWith("creature:") ? c.archetype.slice(9) : null);
      c._species = sp;
      c._lifestyle = sp ? lifestyleForSpecies(sp) : null;
      c._scavenger = sp ? isScavenger(sp) : false;
      if (c._lifestyle === "carnivore") predatorList.push(c);
      else if (c._lifestyle === "herbivore" || c._lifestyle === "omnivore") preyList.push(c);
    }
    try {
      corpses = db.prepare(`
        SELECT id, x, z FROM creature_corpses
        WHERE world_id = ? AND claimed = 0 AND x IS NOT NULL AND z IS NOT NULL
          AND expires_at > unixepoch()
        LIMIT 40
      `).all(worldId);
    } catch { corpses = []; } // creature_corpses optional on minimal builds
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
      // ── Ecology context: decay needs → intent, sense nearby predators ──
      // Drives the idle decision (urgent creatures don't graze), the prey-flee
      // force, and the predator hunt steering. creature-needs.js is the motive
      // layer; this is where it finally steers behaviour.
      let ecoCtx = null;
      if (ecology) {
        const diet = m._lifestyle || "omnivore";
        const needs = decayCreatureNeeds(motion[m.id]?.needs || freshCreatureNeeds(), diet, ECO_STEP_HOURS);
        let predatorNear = false, pdx = 0, pdz = 0, pd = 0;
        if (m._lifestyle === "herbivore" || m._lifestyle === "omnivore") {
          let bestD2 = PREDATOR_SENSE_R * PREDATOR_SENSE_R;
          for (const pr of predatorList) {
            if (!eats(pr._species, m._species)) continue;
            const dx = m.x - pr.x, dz = m.z - pr.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > 0 && d2 < bestD2) { bestD2 = d2; predatorNear = true; pdx = dx; pdz = dz; pd = Math.sqrt(d2); }
          }
        }
        // ── Wave 7 Layers 1-4: perceive → feel → drive → release ──
        // Cheap, always-on. Produces a per-individual affect/drive state + maybe a
        // released fixed-action-pattern whose gain amplifies the flee/hunt force.
        let released = null;
        let releasedGain = 1;
        if (affect && m._species) {
          const sp = m._species;
          const perceived = perceiveSignals(worldSignals, umweltFor(sp));
          const priorMotion = motion[m.id] || {};
          const coreAffect = computeCoreAffect(
            perceived, needs,
            { predatorNear, predatorDist: pd, isHunting: m._lifestyle === "carnivore" },
            priorMotion._affect || null,
          );
          const priorDrives = priorMotion._drives || restingFor(sp);
          const drives = updateDrives(priorDrives, restingFor(sp), coreAffect, {
            predatorNear, needs, isHunting: m._lifestyle === "carnivore",
          });
          // Releaser appraisal bundle: the perceived signal aliases (noise/light/…)
          // plus the boolean threat flag we already sensed.
          released = matchReleaser(releasersFor(sp), { ...perceived, predatorNear }, drives);
          releasedGain = released?.gain || 1;
          m._affect = coreAffect;
          m._perceived = perceived;
          m._drives = drives;
          m._dominantDrive = dominantDrive(drives).name;
          m._released = released ? released.fap : null;
          // Mergeable bag persisted onto motion[m.id] at every write site below so
          // the affect/drive state survives across ticks (drive decay continuity).
          m._affectFields = {
            _affect: coreAffect, _drives: drives,
            _released: m._released, _dominantDrive: m._dominantDrive,
          };
        }

        const intent = creatureIntent(needs, { diet }, { predatorNear }, released);
        const hungryHunter = m._lifestyle === "carnivore" && intent === "hunt" && needs.hunger >= HUNGER_HUNT_THRESHOLD;
        // A hungry scavenger with a carcass available will go pick at it (easy
        // food) — that's what draws the crowd to a kill.
        const wantsScavenge = m._scavenger && corpses.length > 0 && needs.hunger >= HUNGER_HUNT_THRESHOLD;
        ecoCtx = { needs, predatorNear, pdx, pdz, pd, hungryHunter, wantsScavenge, releasedGain };
        m._needs = needs;
        m._hunting = hungryHunter;
        m._scavenging = wantsScavenge;
      }

      // A fraction of creatures spend the pass idle so the cluster has
      // some stationary anchor (reads as "grazing" on the client). A fleeing
      // prey or a hunting predator never idles — survival/hunger overrides.
      const urgent = !!(ecoCtx && (ecoCtx.predatorNear || ecoCtx.hungryHunter || ecoCtx.wantsScavenge));
      if (!urgent && Math.random() < STILL_PROB) {
        // Decay any existing velocity by half so resting creatures don't
        // re-accelerate next pass. Preserve the decayed needs.
        const cur = motion[m.id];
        if (cur) {
          motion[m.id] = { vx: cur.vx * 0.5, vz: cur.vz * 0.5, lastTickAt: Date.now(), needs: ecoCtx?.needs ?? cur.needs, ...(m._affectFields || {}) };
        } else if (ecoCtx) {
          motion[m.id] = { vx: 0, vz: 0, lastTickAt: Date.now(), needs: ecoCtx.needs, ...(m._affectFields || {}) };
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

      // Cross-species awareness. Prey bolt from a sensed predator (folded into
      // the flee force — this is the "a deer bolting tells you a cougar's near"
      // tell). A hungry predator gets a hunt vector toward the nearest prey it
      // eats. Both ride the existing flee/seek machinery below.
      let huntX = 0, huntZ = 0, hunting = false;
      if (ecology && ecoCtx) {
        if (ecoCtx.predatorNear && ecoCtx.pd > 0) {
          fleeing = true;
          const inv = (PREDATOR_SENSE_R - ecoCtx.pd) / PREDATOR_SENSE_R;
          fleeX += (ecoCtx.pdx / ecoCtx.pd) * (1 + inv);
          fleeZ += (ecoCtx.pdz / ecoCtx.pd) * (1 + inv);
        }
        // Scavenge takes priority over hunting — a carcass is free food. The
        // hungry scavenger steers to the nearest one (and feeds in the pass below).
        if (ecoCtx.wantsScavenge) {
          let bestD2 = SCAVENGE_R * SCAVENGE_R, bx = 0, bz = 0, bd = 0, target = null;
          for (const cp of corpses) {
            const dx = cp.x - m.x, dz = cp.z - m.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; bx = dx; bz = dz; bd = Math.sqrt(d2) || 1; target = cp; }
          }
          if (target) {
            hunting = true;
            huntX = (bx / bd) * MAX_SPEED * 0.9;
            huntZ = (bz / bd) * MAX_SPEED * 0.9;
            m._scavengeTarget = target.id;
          }
        }
        if (!hunting && ecoCtx.hungryHunter) {
          let bestD2 = HUNT_R * HUNT_R, bx = 0, bz = 0, bd = 0;
          for (const q of preyList) {
            if (!eats(m._species, q._species)) continue;
            const dx = q.x - m.x, dz = q.z - m.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > 0 && d2 < bestD2) { bestD2 = d2; bx = dx; bz = dz; bd = Math.sqrt(d2); }
          }
          if (bd > 0) { hunting = true; huntX = (bx / bd) * MAX_SPEED * 0.95; huntZ = (bz / bd) * MAX_SPEED * 0.95; }
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

      // Hunt seek (predator → prey) adds before the flee overwrite, so a
      // predator that's itself fleeing the player abandons the hunt (survival
      // first) but otherwise commits toward its quarry. A released hunt FAP
      // (stoop/pursue) multiplies the seek; default gain 1 → unchanged.
      const releasedGain = ecoCtx?.releasedGain || 1;
      if (hunting) { vx += huntX * releasedGain; vz += huntZ * releasedGain; }

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

      // Clamp magnitude so creatures don't streak. A released flee FAP
      // (freeze_then_bolt/bolt) raises the flee speed cap by its gain — the bolt
      // is genuinely faster, not just a re-aimed walk. Default gain 1 → unchanged.
      const fleeCap = MAX_SPEED * 1.6 * (fleeing ? releasedGain : 1);
      const cl = clampSpeed(vx, vz, fleeing ? fleeCap : MAX_SPEED);
      const newX = m.x + cl.vx * STEP_S * 0.05; // 0.05 per-second factor: keeps moves under ~6m/pass
      const newZ = m.z + cl.vz * STEP_S * 0.05;

      motion[m.id] = { vx: cl.vx, vz: cl.vz, lastTickAt: Date.now(), needs: ecoCtx?.needs ?? motion[m.id]?.needs, ...(m._affectFields || {}) };
      updates.push({ id: m.id, x: newX, z: newZ });
    }
  }

  // Post-move position map (updates ∪ idle originals), shared by the predation
  // + scavenge passes below.
  let posById = null;
  if (ecology) {
    posById = new Map();
    for (const c of creatures) posById.set(c.id, { x: c.x, z: c.z });
    for (const u of updates) posById.set(u.id, { x: u.x, z: u.z });
  }

  // ── Predation pass ──────────────────────────────────────────────────────
  // A hungry predator that ended the pass within KILL_R of prey it eats makes a
  // kill: the prey dies (the spawner refills the population next cycle) and the
  // predator's hunger is sated. Capped per pass so a flock can't be wiped and DB
  // writes stay bounded.
  let kills = [];
  if (ecology && posById && predatorList.length && preyList.length) {
    const deadPrey = new Set();
    for (const pr of predatorList) {
      if (kills.length >= MAX_KILLS_PASS) break;
      if (!pr._hunting) continue;
      const pp = posById.get(pr.id);
      if (!pp) continue;
      let victim = null, bestD2 = KILL_R * KILL_R;
      for (const q of preyList) {
        if (deadPrey.has(q.id) || !eats(pr._species, q._species)) continue;
        const qp = posById.get(q.id);
        if (!qp) continue;
        const dx = pp.x - qp.x, dz = pp.z - qp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; victim = q; }
      }
      if (victim) {
        deadPrey.add(victim.id);
        const vp = posById.get(victim.id);
        kills.push({
          predatorId: pr.id, predatorSpecies: pr._species,
          preyId: victim.id, preySpecies: victim._species,
          x: vp.x, z: vp.z,
        });
        // The kill sates the predator's hunger.
        if (pr._needs) {
          motion[pr.id] = { ...(motion[pr.id] || {}), needs: satisfyCreatureNeed(pr._needs, "hunger", 0.7) };
        }
      }
    }
  }

  // ── Scavenge-feed pass ────────────────────────────────────────────────────
  // A scavenger that reached the carcass it was steering toward feeds: its
  // hunger is sated and the carcass is claimed (consumed). Capped per pass.
  let scavenged = 0;
  if (ecology && posById && corpses.length) {
    const corpseById = new Map(corpses.map((c) => [c.id, c]));
    const claimed = new Set();
    for (const [, members] of groups) {
      for (const m of members) {
        if (scavenged >= MAX_FEED_PASS) break;
        if (!m._scavenger || !m._scavengeTarget) continue;
        const cp = corpseById.get(m._scavengeTarget);
        if (!cp || claimed.has(cp.id)) continue;
        const sp = posById.get(m.id);
        if (!sp) continue;
        const dx = sp.x - cp.x, dz = sp.z - cp.z;
        if (dx * dx + dz * dz > FEED_R * FEED_R) continue;
        claimed.add(cp.id);
        scavenged++;
        if (m._needs) {
          motion[m.id] = { ...(motion[m.id] || {}), needs: satisfyCreatureNeed(m._needs, "hunger", 0.6) };
        }
      }
    }
    if (claimed.size > 0) {
      try {
        const claim = db.prepare(`UPDATE creature_corpses SET claimed = 1 WHERE id = ?`);
        const tx = db.transaction((ids) => { for (const id of ids) claim.run(id); });
        tx([...claimed]);
      } catch { /* best-effort */ }
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

  // Flush predation deaths separately (best-effort; a position-flush failure
  // shouldn't block kills and vice-versa). Each kill leaves a carcass scavengers
  // can pick at (the vultures-on-the-kill loop) — an NPC kill, so killer_user_id
  // is null. Short TTL since scavengers consume it.
  if (kills.length > 0) {
    try {
      const kill = db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`);
      const tx = db.transaction((rows) => { for (const r of rows) kill.run(r.preyId); });
      tx(kills);
    } catch { /* best-effort */ }
    try {
      const corpse = db.prepare(`
        INSERT INTO creature_corpses (id, world_id, species_id, killer_user_id, x, y, z, claimed, expires_at)
        VALUES (?, ?, ?, NULL, ?, 0, ?, 0, unixepoch() + 900)
      `);
      const tx = db.transaction((rows) => {
        for (const r of rows) corpse.run(`cc_${crypto.randomUUID()}`, worldId, r.preySpecies, r.x, r.z);
      });
      tx(kills);
    } catch { /* creature_corpses optional on minimal builds */ }
  }

  return { ok: true, moved: updates.length, species: groups.size, kills: kills.length, killed: kills, scavenged };
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
