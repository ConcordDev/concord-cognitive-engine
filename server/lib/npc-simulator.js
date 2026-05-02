// server/lib/npc-simulator.js
// Per-world NPC simulation. One NPCSimulator instance per active world.
// Two NPC types:
//   - Autonomous NPCs (is_conscious=0): needs-based AI, can be killed, world-native archetypes
//   - Conscious Emergents (is_conscious=1, is_immortal=1): emergent-AI-backed, untouchable,
//     serve as world Jarls/Bosses/Governors, generate main quests

import crypto from "crypto";
import logger from "../logger.js";
import { adjustSimulationDensity } from "./population-scaling.js";
import {
  buildStructure,
  practiceSkill,
  npcEvaluateNearbyCreation,
  npcObserveSkillUse,
} from "./npc-behaviors.js";
import { NavGrid } from "./nav-grid.js";
import { getSpawnConfig, pickEnemyArchetype } from "./npc-archetypes.js";
import { accumulateWealth, evaluateGearUpgrade, seedStarterGear, leaderEnsuresFactionGear, updateUserGearCeiling, enforceGearCeiling } from "./npc-gear.js";
import { decayGrief, attemptCrossbreed } from "./npc-family.js";
import { tickRecruitment } from "./npc-spawning.js";
import { npcGatherFromNode, respawnExpiredNodes } from "./world-gathering.js";
import { detectiveTick, guardTick } from "./world-crime.js";
import { executeScheduledTask, assignJob, seedJobsForWorld, getCurrentPhase } from "./npc-jobs.js";
import { broadcastOpinionEvent } from "./npc-relations.js";
import { applyDamageToPlayer, computeDamage } from "./combat/damage-calculator.js";

// ──────────────────────────────────────────────────────────────────────────────
// NPC Combat AI — state machine for alert/pursue/attack/retreat behavior
// ──────────────────────────────────────────────────────────────────────────────

// Module-level map: npcId → combat state object
// { state, target, startPosition, helpCalled, alertedAt, _lastAttack }
const _npcCombatState = new Map();

// Aggression profiles per archetype
const AGGRO_PROFILE = {
  guard:     { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.8, canCallHelp: true },
  soldier:   { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.9, canCallHelp: true },
  bandit:    { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.7, canCallHelp: false },
  criminal:  { alertRadius: 8,  pursuitRadius: 15, melee: 2, aggro: 0.6, canCallHelp: false },
  farmer:    { alertRadius: 6,  pursuitRadius: 0,  melee: 0, aggro: 0.0, canCallHelp: false },
  merchant:  { alertRadius: 6,  pursuitRadius: 0,  melee: 0, aggro: 0.0, canCallHelp: false },
  // Frontier hostile creatures — aggressive on sight, longer pursuit.
  wraith:      { alertRadius: 12, pursuitRadius: 22, melee: 2, aggro: 0.85, canCallHelp: false },
  drift_eater: { alertRadius: 18, pursuitRadius: 30, melee: 3, aggro: 0.95, canCallHelp: true },
  shard_husk:  { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.8,  canCallHelp: false },
  default:   { alertRadius: 8,  pursuitRadius: 12, melee: 2, aggro: 0.3, canCallHelp: false },
};

// Base NPC attack damage by archetype (added on top of 8-15 base roll)
const ARCHETYPE_DAMAGE_BONUS = {
  guard: 5, soldier: 8, bandit: 4,
  wraith: 6, drift_eater: 12, shard_husk: 8,
};

// Rate-limit: minimum ms between NPC attacks on same target
const NPC_ATTACK_COOLDOWN_MS = 1500;

/**
 * Fetch active player positions from the database for a given world.
 * Returns array of { userId, x, z }.
 */
function _getPlayerPositions(db, worldId) {
  try {
    // world_visits stores last_position as JSON; fall back to player_world_state
    const visits = db.prepare(`
      SELECT wv.user_id, wv.last_position, pws.x as sx, pws.z as sz
      FROM world_visits wv
      LEFT JOIN player_world_state pws ON pws.user_id = wv.user_id
      WHERE wv.world_id = ? AND wv.departed_at IS NULL
    `).all(worldId);

    return visits.map(v => {
      const pos = _parseJSON(v.last_position, null);
      const x = pos?.x ?? v.sx ?? null;
      const z = pos?.z ?? v.sz ?? null;
      if (x === null || z === null) return null;
      return { userId: v.user_id, x, z };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Euclidean distance between two {x,z} points.
 */
function _dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Core combat AI function — runs once per NPC per tick.
 * Accesses io lazily via globalThis._concordREALTIME.
 */
function updateNPCCombatAI(npc, worldId, db) {
  // Graceful skip if NPC has no position
  if (!npc || !npc.location) return;

  const archetype = npc.archetype || 'default';
  const profile   = AGGRO_PROFILE[archetype] || AGGRO_PROFILE.default;

  // Fetch NPC DB row for HP / is_wanted / criminal_rep
  let npcRow;
  try {
    npcRow = db.prepare(
      'SELECT current_hp, max_hp, is_wanted, criminal_rep FROM world_npcs WHERE id = ?'
    ).get(npc.id);
  } catch { return; }

  if (!npcRow) return;

  const hpRatio    = (npcRow.current_hp ?? 100) / Math.max(1, npcRow.max_hp ?? 100);
  const isWanted   = !!npcRow.is_wanted;

  // Wanted NPCs are always maximally aggressive
  const effectiveAggro = isWanted ? 0.9 : profile.aggro;

  // Non-aggro NPCs (farmer, merchant) — never attack, may flee (handled separately)
  if (effectiveAggro === 0.0 && !isWanted) {
    // Non-aggro flee logic: if a player is very close, path away
    const players = _getPlayerPositions(db, worldId);
    for (const player of players) {
      const d = _dist2d(npc.location, player);
      if (d < profile.alertRadius) {
        // Flee: move opposite direction from the player
        _fleeFromPoint(npc, player);
        break;
      }
    }
    return;
  }

  // Ensure combat state entry
  if (!_npcCombatState.has(npc.id)) {
    _npcCombatState.set(npc.id, {
      state: 'idle',
      target: null,
      startPosition: { x: npc.location.x, z: npc.location.z },
      helpCalled: false,
      alertedAt: 0,
      _lastAttack: 0,
    });
  }

  const cs = _npcCombatState.get(npc.id);

  // Get player positions for this world
  const players = _getPlayerPositions(db, worldId);

  // Find nearest player
  let nearestPlayer = null;
  let nearestDist   = Infinity;
  for (const p of players) {
    const d = _dist2d(npc.location, p);
    if (d < nearestDist) {
      nearestDist   = d;
      nearestPlayer = p;
    }
  }

  const now = Date.now();

  // ── State machine transitions ──────────────────────────────────────────────

  if (cs.state === 'idle') {
    // idle → alerted: player within alert radius AND conditions met
    if (nearestPlayer && nearestDist <= profile.alertRadius && effectiveAggro > 0) {
      cs.state     = 'alerted';
      cs.target    = nearestPlayer;
      cs.alertedAt = now;
      cs.startPosition = { x: npc.location.x, z: npc.location.z };
    }

  } else if (cs.state === 'alerted') {
    // alerted → pursuing: target confirmed within pursuit radius
    if (nearestPlayer && nearestDist <= profile.pursuitRadius) {
      cs.target = nearestPlayer;
      if (profile.pursuitRadius > 0) {
        cs.state = 'pursuing';
        // Emit calling_help once when first entering combat
        if (!cs.helpCalled && profile.canCallHelp) {
          cs.helpCalled = true;
          _callForHelp(npc, worldId, db);
        }
      }
    } else if (now - cs.alertedAt > 10000) {
      // Timed out — go back to idle
      cs.state  = 'idle';
      cs.target = null;
    }

  } else if (cs.state === 'pursuing') {
    if (!nearestPlayer || nearestDist > profile.pursuitRadius + 5) {
      // Lost target — return to idle
      cs.state  = 'idle';
      cs.target = null;
    } else {
      cs.target = nearestPlayer;

      // HP retreat check
      if (hpRatio < 0.25) {
        cs.state = 'retreating';
      } else if (nearestDist <= profile.melee) {
        // In melee range — attack
        cs.state = 'attacking';
        if (!cs.helpCalled && profile.canCallHelp) {
          cs.helpCalled = true;
          _callForHelp(npc, worldId, db);
        }
      } else {
        // Move toward target
        _moveToward(npc, nearestPlayer, db, worldId);
      }
    }

  } else if (cs.state === 'attacking') {
    if (!nearestPlayer) {
      cs.state = 'idle';
    } else if (hpRatio < 0.25) {
      cs.state = 'retreating';
    } else if (nearestDist > profile.melee + 1) {
      // Target moved out of range — pursue again
      cs.state = 'pursuing';
    } else {
      // Attack! Rate-limited to once per NPC_ATTACK_COOLDOWN_MS
      if (now - cs._lastAttack >= NPC_ATTACK_COOLDOWN_MS) {
        cs._lastAttack = now;
        _performNPCAttack(npc, nearestPlayer, worldId, db, archetype);
      }
    }

  } else if (cs.state === 'retreating') {
    const distFromStart = _dist2d(npc.location, cs.startPosition);
    if (distFromStart > 30) {
      // Gave up — too far from start
      cs.state  = 'idle';
      cs.target = null;
      cs.helpCalled = false;
    } else if (hpRatio >= 0.5) {
      // Recovered enough — go back to idle
      cs.state  = 'idle';
      cs.target = null;
    } else {
      // Pathfind back toward start position
      _moveToward(npc, cs.startPosition, db, worldId);
    }
  }
}

/**
 * Emit world:npc-alert socket event and mark nearby NPCs as alerted.
 */
function _callForHelp(npc, worldId, db) {
  const HELP_RADIUS = 15;
  try {
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-alert', {
      worldId,
      npcId:    npc.id,
      position: npc.location,
      radius:   HELP_RADIUS,
    });

    // Alert nearby NPCs by setting their combat state to alerted
    const nearbyNpcs = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND is_dead = 0 AND id != ?
      LIMIT 20
    `).all(worldId, npc.id);

    for (const nearby of nearbyNpcs) {
      const nearbyLoc = _parseNPCLocation(db, nearby.id);
      if (!nearbyLoc) continue;
      const d = _dist2d(npc.location, nearbyLoc);
      if (d <= HELP_RADIUS) {
        // If this nearby NPC doesn't have combat state yet, set it to alerted
        if (!_npcCombatState.has(nearby.id)) {
          _npcCombatState.set(nearby.id, {
            state: 'alerted',
            target: null,
            startPosition: { x: nearbyLoc.x, z: nearbyLoc.z },
            helpCalled: false,
            alertedAt: Date.now(),
            _lastAttack: 0,
          });
        } else {
          const nearbyCs = _npcCombatState.get(nearby.id);
          if (nearbyCs.state === 'idle') {
            nearbyCs.state     = 'alerted';
            nearbyCs.alertedAt = Date.now();
          }
        }
      }
    }
  } catch { /* non-fatal */ }
}

/**
 * Get location of an NPC from DB (lightweight read).
 */
function _parseNPCLocation(db, npcId) {
  try {
    const row = db.prepare('SELECT current_location FROM world_npcs WHERE id = ?').get(npcId);
    return row ? _parseJSON(row.current_location, null) : null;
  } catch { return null; }
}

/**
 * Set NPC path toward a target point using NavGrid A*.
 */
function _moveToward(npc, target, db, worldId) {
  try {
    const navGrid = getNavGrid();
    const path    = navGrid.findPath(npc.location.x, npc.location.z, target.x, target.z);
    if (path && path.length > 0) {
      npc.state.currentPath = path;
      npc.state.pathIndex   = 0;
    }
  } catch { /* non-fatal */ }
}

/**
 * Move NPC away from a point (flee behavior).
 */
function _fleeFromPoint(npc, from) {
  try {
    const dx    = npc.location.x - from.x;
    const dz    = npc.location.z - from.z;
    const len   = Math.sqrt(dx * dx + dz * dz) || 1;
    const fleeX = npc.location.x + (dx / len) * 20;
    const fleeZ = npc.location.z + (dz / len) * 20;

    const navGrid = getNavGrid();
    const path    = navGrid.findPath(npc.location.x, npc.location.z, fleeX, fleeZ);
    if (path && path.length > 0) {
      npc.state.currentPath = path;
      npc.state.pathIndex   = 0;
    }
  } catch { /* non-fatal */ }
}

/**
 * Perform one NPC melee attack on a player.
 */
function _performNPCAttack(npc, target, worldId, db, archetype) {
  try {
    const baseDamage  = 8 + Math.floor(Math.random() * 8); // 8-15
    const bonus       = ARCHETYPE_DAMAGE_BONUS[archetype] || 0;
    const totalDamage = baseDamage + bonus;

    const attackerStats = {
      skillLevel: 1,
      element: 'none',
      basePower: totalDamage,
      enchantmentBonus: 0,
      worldMultiplier: 1.0,
    };

    // Minimal defender stats (no armor lookup to keep tick fast)
    const defenderStats = {
      physical_resistance: 0,
      current_hp: 100,
      max_hp: 100,
      status_effects: '[]',
    };

    const damageResult = computeDamage(attackerStats, defenderStats, {});
    applyDamageToPlayer(db, worldId, npc.id, 'npc', target.userId, damageResult, {
      element: 'none', bar_used: 'hp', bar_cost: damageResult.finalDamage,
    });

    // Emit real-time attack notification to the target player's session
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-attack', {
      worldId,
      npcId:      npc.id,
      targetId:   target.userId,
      damage:     damageResult.finalDamage,
      archetype,
      kill:       damageResult.kill,
    });
  } catch { /* non-fatal */ }
}

// ── Heightmap generation (mirrors TerrainRenderer.tsx deterministic algo) ──
// Resolution kept low (128) for server — A* is the bottleneck, not sample count.
const HM_RES = 128;

function _generateHeightmap(res) {
  const data = new Float32Array(res * res);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / res; const nz = z / res;
      let elev = 0;
      if (nx < 0.1)      elev = 2 + nx * 30;
      else if (nx < 0.2) elev = 5 + Math.pow((nx - 0.1) / 0.1, 2) * 35;
      else if (nx < 0.6) elev = 40 + Math.sin(nx * Math.PI * 3) * 5;
      else               {
        elev = 45 + (nx - 0.6) * 80;
        elev += Math.sin(nx * 12 + nz * 8) * 6 + Math.sin(nx * 7 - nz * 5) * 4;
      }
      const creekCenterX = 0.35 + nz * 0.15;
      const distFromCreek = Math.abs(nx - creekCenterX);
      if (distFromCreek < 0.04) elev -= 12 * (1 - distFromCreek / 0.04);
      elev += Math.sin(nx * 47.3 + nz * 31.7) * 0.5 + Math.sin(nx * 97.1 + nz * 73.3) * 0.3;
      data[z * res + x] = Math.max(0, Math.min(80, elev)) / 80;
    }
  }
  return data;
}

// Shared NavGrid — built once, reused across all NPC agents
let _navGrid = null;
function getNavGrid() {
  if (!_navGrid) {
    const hm = _generateHeightmap(HM_RES);
    _navGrid  = new NavGrid(hm, HM_RES, HM_RES, 2000 / HM_RES); // cellSize ≈ 15.6m
    _navGrid.buildGrid();
  }
  return _navGrid;
}

const NPC_WALK_SPEED   = 1.4;  // m/s
const WAYPOINT_REACH_M = 2.0;  // metres — consider waypoint reached

// Map of worldId → NPCSimulator instance
export const simulators = new Map();

// ──────────────────────────────────────────────────────────────────────────────
// NPCAgent
// ──────────────────────────────────────────────────────────────────────────────

export class NPCAgent {
  constructor(row, worldId, db, selectBrain) {
    this.id          = row.id;
    this.worldId     = worldId;
    this.npcType     = row.npc_type;
    this.archetype   = row.archetype || 'generic';
    this.faction     = row.faction || 'neutral';
    this.level       = row.level || 1;
    this.isConscious = !!row.is_conscious;
    this.isImmortal  = !!row.is_immortal;
    this.location    = _parseJSON(row.current_location, { x: 0, y: 0, z: 0 });
    this.spawnLoc    = _parseJSON(row.spawn_location,   { x: 0, y: 0, z: 0 });
    this.state       = _parseJSON(row.state, {});
    this.needs       = this.state.needs || _defaultNeeds();
    this.goals       = this.state.goals || [];
    this.currentActivity = this.state.currentActivity || null;
    this._db         = db;
    this._selectBrain = selectBrain;
  }

  /** Tick for conscious emergents — lighter, just updates goals from emergent AI */
  async tickConscious() {
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:emergent-npc:tick",
      });
      const raw = await handle.generate(
        `You are ${this.state.name || this.archetype} in world ${this.worldId}. ` +
        `Your current goals: ${JSON.stringify(this.goals)}. ` +
        `What is your primary directive right now? Reply in one sentence.`
      );
      if (raw) {
        this.goals = [{ directive: raw.slice(0, 200), updatedAt: Date.now() }];
        this._persistState();
      }
    } catch { /* non-fatal */ }
  }

  /** Faction leader coordinates tactics with other members */
  async _coordinateFaction(members) {
    if (members.length < 2) return;
    const memberSummary = members.map(m => `${m.archetype}(lvl${m.level})`).join(', ');
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:faction:coordinate",
      });
      const raw = await handle.generate(
        `You are ${this.archetype}, faction leader of "${this.faction}" in world ${this.worldId}. ` +
        `Your group: ${memberSummary}. ` +
        `Devise a brief tactical instruction for your group in one sentence. ` +
        `Consider flanking, ambush, or coordinated assault. Return JSON: ` +
        `{"tactic":"<name>","instruction":"<one sentence for the group>"}`
      );
      const match = raw?.match(/\{[\s\S]*?\}/);
      if (match) {
        const tactic = JSON.parse(match[0]);
        // Distribute tactic to all faction members
        for (const member of members) {
          member.state.factionTactic = tactic;
        }
      }
    } catch { /* non-fatal */ }
  }

  /** NPC speaks to another NPC or conscious emergent */
  async _speakTo(partner) {
    const myName      = this.state.name || this.archetype;
    const partnerName = partner.state?.name || partner.archetype || 'stranger';
    const topic       = this.state.factionTactic?.tactic || this.goals[0]?.directive || 'the world around us';

    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:npc:conversation",
      });
      const raw = await handle.generate(
        `You are ${myName} (${this.archetype}, ${this.faction} faction). ` +
        `You are speaking to ${partnerName} (${partner.archetype || 'entity'}) ` +
        `about: ${topic}. World: ${this.worldId}. ` +
        `Write one line of natural dialogue from ${myName} to ${partnerName}. No quotes around it.`
      );

      if (!raw) return;

      // Partner hears and may update their goals based on what was said
      if (partner.goals !== undefined) {
        partner.goals = partner.goals || [];
        partner.goals.push({ heardFrom: myName, said: raw.slice(0, 200), at: Date.now() });
        if (partner.goals.length > 10) partner.goals = partner.goals.slice(-10);
        partner._persistState?.();
      }

      // Log the conversation as a world event (lightweight, no DB write — SSE only)
      this._db.prepare(
        "INSERT OR IGNORE INTO world_events (id, world_id, type, actor_id, data, created_at) VALUES (?,?,?,?,?,unixepoch())"
      ).run(
        crypto.randomUUID(), this.worldId, 'npc_conversation', this.id,
        JSON.stringify({ speaker: myName, listener: partnerName, line: raw.slice(0, 200) })
      ).valueOf?.(); // safe no-op if table missing
    } catch { /* non-fatal */ }
  }

  async tick(dtMs = 3000) {
    this._updateNeeds();
    // Advance along active path first (position update each tick)
    this._tickPath(dtMs / 1000);

    // ── Combat AI (runs before action selection so combat can override movement) ──
    if (!this.isConscious && !this.isImmortal) {
      try { updateNPCCombatAI(this, this.worldId, this._db); } catch { /* non-fatal */ }
    }

    // Only choose a new action if not currently walking AND not in active combat
    const combatState = _npcCombatState.get(this.id);
    const inCombat    = combatState && combatState.state !== 'idle';
    if (!inCombat && (!this.state.currentPath || this.state.pathIndex >= (this.state.currentPath?.length ?? 0))) {
      const action = await this._chooseAction();
      await this._executeAction(action);
    }
    await this._maybeEvaluateCreations();

    // Wealth accumulation — earn income based on occupation each tick
    try { accumulateWealth(this._db, this.id, this.archetype); } catch { /* non-fatal */ }

    // Gear upgrade evaluation — every ~20 ticks (random to stagger NPC upgrades)
    if (Math.random() < 0.05) {
      try { evaluateGearUpgrade(this._db, this.id); } catch { /* non-fatal */ }
    }

    this._persistState();
  }

  _tickPath(dtSec) {
    const path  = this.state.currentPath;
    if (!path || !path.length) return;
    let   idx   = this.state.pathIndex ?? 0;
    if (idx >= path.length) { this.state.currentPath = null; return; }

    // Walk toward current waypoint at NPC_WALK_SPEED
    let remaining = NPC_WALK_SPEED * dtSec; // metres this tick
    while (remaining > 0 && idx < path.length) {
      const wp  = path[idx];
      const dx  = wp.x - this.location.x;
      const dz  = wp.z - this.location.z;
      const d   = Math.sqrt(dx * dx + dz * dz);
      if (d <= WAYPOINT_REACH_M || d < remaining) {
        this.location.x = wp.x;
        this.location.z = wp.z;
        remaining      -= d;
        idx++;
      } else {
        this.location.x += (dx / d) * remaining;
        this.location.z += (dz / d) * remaining;
        remaining = 0;
      }
    }
    this.state.pathIndex = idx;
    if (idx >= path.length) this.state.currentPath = null;
  }

  _updateNeeds() {
    const decay = { hunger: 0.05, rest: 0.03, social: 0.02, purpose: 0.01, safety: 0.01 };
    for (const [k, d] of Object.entries(decay)) {
      this.needs[k] = Math.max(0, (this.needs[k] ?? 1) - d);
    }
  }

  async _chooseAction() {
    // Most urgent need drives action
    const urgentNeed = Object.entries(this.needs)
      .filter(([, v]) => v < 0.3)
      .sort(([, a], [, b]) => a - b)[0];

    if (urgentNeed) {
      return _needToAction(urgentNeed[0]);
    }

    // Otherwise use subconscious brain for richer decision
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious",
        callerId: "world:npc:decision",
      });

      const prompt = `NPC type: ${this.npcType}
World: ${this.worldId}
Needs: ${JSON.stringify(this.needs)}
Goals: ${JSON.stringify(this.goals)}
Location: ${JSON.stringify(this.location)}

Choose one action for this NPC. Return JSON only:
{ "action": "<gather_resource|build_structure|practice_skill|socialize|travel|trade|rest|create>", "target": "<optional string>" }`;

      const raw   = await handle.generate(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_e) {
      // fallback
    }

    return { action: "rest" };
  }

  async _executeAction({ action, target }) {
    this.currentActivity = action;

    // Map action → DB activity string for loot generator
    const activityMap = {
      gather_resource: 'gathering', build_structure: 'crafting', practice_skill: 'crafting',
      trade: 'trading', rest: 'resting', socialize: 'resting', travel: 'patrolling',
      create: 'crafting', default: 'idle',
    };
    const dbActivity = activityMap[action] || 'idle';
    try {
      this._db.prepare('UPDATE world_npcs SET current_activity = ? WHERE id = ?').run(dbActivity, this.id);
    } catch { /* column may not exist yet pre-migration */ }

    switch (action) {
      case "rest":
        this.needs.rest = Math.min(1, this.needs.rest + 0.3);
        break;
      case "gather_resource": {
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.15);
        // Attempt to gather from a real nearby resource node first
        try {
          const npcRow  = this._db.prepare('SELECT activity_resources, level FROM world_npcs WHERE id = ?').get(this.id);
          const posRow  = _parseJSON(this.location, {});
          const npcX    = posRow.x ?? 1000, npcZ = posRow.z ?? 1000;
          const npcLvl  = npcRow?.level || 1;
          const preferred = [_archetypeResource(this.archetype)];

          const gathered = npcGatherFromNode(this._db, this.worldId, npcX, npcZ, npcLvl, preferred);
          const resourceId = gathered?.resourceId ?? _archetypeResource(this.archetype);
          const amount     = gathered?.amount ?? (1 + Math.floor(Math.random() * 2));

          const resources = _parseJSON(npcRow?.activity_resources, {});
          resources[resourceId] = Math.min(50, (resources[resourceId] || 0) + amount);
          this._db.prepare('UPDATE world_npcs SET activity_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), this.id);
        } catch { /* non-fatal */ }
        break;
      }
      case "socialize":
        this.needs.social = Math.min(1, this.needs.social + 0.25);
        break;
      case "build_structure":
        await buildStructure(this, target || "shelter", this.location, this._db);
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.2);
        break;
      case "practice_skill": {
        const skills = this._db.prepare(
          "SELECT id FROM dtus WHERE creator_id = ? AND type = 'skill' LIMIT 1"
        ).get(this.id);
        if (skills) await practiceSkill(this, skills.id, this._db);
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.1);
        break;
      }
      case "travel": {
        // NavGrid A* pathfinding — pick a destination 30-80m away, walk there
        const angle   = Math.random() * Math.PI * 2;
        const dist    = 30 + Math.random() * 50;
        const goalX   = this.location.x + Math.cos(angle) * dist;
        const goalZ   = this.location.z + Math.sin(angle) * dist;
        const navGrid = getNavGrid();
        const path    = navGrid.findPath(this.location.x, this.location.z, goalX, goalZ);
        if (path.length > 0) {
          this.state.currentPath  = path;
          this.state.pathIndex    = 0;
          this.state.pathGoal     = { x: goalX, z: goalZ };
        }
        break;
      }
      case "trade":
        this.needs.social   = Math.min(1, this.needs.social   + 0.1);
        this.needs.purpose  = Math.min(1, this.needs.purpose  + 0.1);
        break;
      case "create":
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.2);
        break;
      default:
        break;
    }
  }

  async _maybeEvaluateCreations() {
    if (Math.random() > 0.1) return; // 10% chance per tick
    const nearby = this._db.prepare(`
      SELECT * FROM dtus
      WHERE type = 'concordia_creation' AND world_id = ?
      LIMIT 5
    `).all(this.worldId);

    for (const creation of nearby) {
      await npcEvaluateNearbyCreation(this, creation, this._db, this._selectBrain);
    }
  }

  async _maybeGenerateQuests() {
    if (Math.random() > 0.05) return; // 5% chance per tick
    try {
      const { detectQuestOpportunities } = await import("./quest-emergence.js");
      await detectQuestOpportunities(this, this._db, this._selectBrain);
    } catch (_e) { /* non-fatal */ }
  }

  _persistState() {
    this.state.needs           = this.needs;
    this.state.goals           = this.goals;
    this.state.currentActivity = this.currentActivity;

    this._db.prepare(
      "UPDATE world_npcs SET state = ?, current_location = ?, last_tick_at = unixepoch() WHERE id = ?"
    ).run(JSON.stringify(this.state), JSON.stringify(this.location), this.id);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// NPCSimulator
// ──────────────────────────────────────────────────────────────────────────────

export class NPCSimulator {
  constructor(worldId, db, selectBrain) {
    this.worldId      = worldId;
    this._db          = db;
    this._selectBrain = selectBrain;
    this._agents      = [];
    this._timer       = null;
    this._tickRate    = 60000; // will be updated on first player count
  }

  async initialize() {
    const rows = this._db.prepare(
      "SELECT * FROM world_npcs WHERE world_id = ? AND is_dead = 0"
    ).all(this.worldId);

    this._agents = rows.map(r => new NPCAgent(r, this.worldId, this._db, this._selectBrain));

    // Seed NPCs from world archetypes if empty
    if (this._agents.length === 0) {
      await this._seedWorldNPCs();
    }
  }

  async _seedWorldNPCs() {
    const world = this._db.prepare("SELECT * FROM worlds WHERE id = ?").get(this.worldId);
    const universeType = world?.universe_type || 'generic';
    const config = getSpawnConfig(universeType);

    // Spawn bosses (conscious, immortal — backed by emergent AI)
    for (const boss of config.bosses) {
      this._spawnNpc({ ...boss, npc_type: boss.archetype, universe_type: universeType });
    }
    // Spawn civilians
    for (const civ of config.civilians) {
      for (let i = 0; i < (civ.count || 2); i++) {
        this._spawnNpc({ ...civ, npc_type: civ.archetype, universe_type: universeType });
      }
    }
    // Spawn enemies
    for (const enemy of config.enemies) {
      const count = enemy.count || 3;
      for (let i = 0; i < count; i++) {
        this._spawnNpc({ ...enemy, npc_type: enemy.archetype, universe_type: universeType });
      }
    }
  }

  _spawnNpc(opts = {}) {
    const id = crypto.randomUUID();
    const spawnX = (Math.random() - 0.5) * 400;
    const spawnZ = (Math.random() - 0.5) * 400;
    const spawnLoc = JSON.stringify({ x: spawnX, y: 0, z: spawnZ });

    this._db.prepare(`
      INSERT INTO world_npcs
        (id, world_id, npc_type, archetype, body_type, universe_type, faction,
         is_conscious, is_immortal, quest_giver, level, spawn_location, current_location, state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, this.worldId,
      opts.npc_type || 'generic',
      opts.archetype || 'generic',
      opts.body_type || 'humanoid',
      opts.universe_type || '',
      opts.faction || 'neutral',
      opts.is_conscious ? 1 : 0,
      opts.is_immortal ? 1 : 0,
      opts.quest_giver ? 1 : 0,
      opts.level || (opts.level_range ? opts.level_range[0] : 1),
      spawnLoc,
      spawnLoc,
      JSON.stringify({ name: opts.archetype }),
    );

    const row = this._db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
    if (row) {
      // Seed starter gear for this NPC
      try { seedStarterGear(this._db, id, opts.archetype || 'generic', opts.level || 1); } catch { /* non-fatal */ }
      this._agents.push(new NPCAgent(row, this.worldId, this._db, this._selectBrain));
    }
  }

  /** Spawn a new enemy at a target level — called when player enters an area */
  spawnEnemy(targetLevel = 1) {
    const world = this._db.prepare("SELECT universe_type FROM worlds WHERE id = ?").get(this.worldId);
    const archetype = pickEnemyArchetype(world?.universe_type || 'generic', targetLevel);
    this._spawnNpc({ ...archetype, npc_type: archetype.archetype, level: targetLevel });
  }

  async tick() {
    // Separate conscious (emergent-backed) from autonomous agents
    const autonomousAgents = this._agents.filter(a => !a.isConscious);
    const consciousAgents  = this._agents.filter(a =>  a.isConscious);

    // Autonomous NPCs: needs-based tick + faction coordination
    await Promise.allSettled(autonomousAgents.map(a => a.tick()));
    await Promise.allSettled(autonomousAgents.map(a => a._maybeGenerateQuests()));

    // Faction coordination: enemy NPCs strategize together + leader gear enforcement
    await this._tickFactionCoordination(autonomousAgents);

    // Conscious emergents: emergent-AI tick (lighter — just goal updates)
    await Promise.allSettled(consciousAgents.map(a => a.tickConscious()));

    // NPC ↔ NPC / NPC ↔ Emergent conversations (5% chance per tick group)
    if (Math.random() < 0.05) {
      await this._tickNPCConversations(autonomousAgents, consciousAgents);
    }

    // Grief decay — slow healing over time
    try { decayGrief(this._db, this.id); } catch { /* non-fatal */ }

    // Every ~50 ticks: update user gear ceiling + enforce caps
    if (Math.random() < 0.02) {
      try {
        updateUserGearCeiling(this._db);
        enforceGearCeiling(this._db);
      } catch { /* non-fatal */ }
    }

    // Rare: civilian recruitment tick across world
    if (Math.random() < 0.005) {
      try { tickRecruitment(this._db, this.worldId); } catch { /* non-fatal */ }
    }

    // Rare: crossbreeding check for spouse pairs
    if (Math.random() < 0.01) {
      try { this._tickCrossbreeding(); } catch { /* non-fatal */ }
    }

    // Periodic: respawn depleted resource nodes (runs every ~1% of ticks ≈ once per minute at 1Hz)
    if (Math.random() < 0.01) {
      try { respawnExpiredNodes(this._db); } catch { /* non-fatal */ }
    }

    // Periodic: NPC job schedule execution (time-of-day tasks)
    if (Math.random() < 0.1) {
      try {
        const phase = getCurrentPhase(this._tickCount || 0);
        for (const agent of autonomousAgents.slice(0, 10)) {
          const jobType = agent.state?.job_type || 'generic';
          await executeScheduledTask(agent, jobType, phase, this._db, this.worldId)
            .catch(() => {});
        }
        this._tickCount = (this._tickCount || 0) + 1;
      } catch { /* non-fatal */ }
    }

    // Periodic: detective/guard crime tick (2% of ticks)
    if (Math.random() < 0.02) {
      try {
        for (const agent of autonomousAgents) {
          const archetype = agent.archetype || '';
          const jobType = agent.state?.job_type || '';
          if (archetype === 'guard' || archetype === 'detective' || jobType === 'detective') {
            detectiveTick(this._db, agent.id, this.worldId);
          } else if (archetype === 'guard' || jobType === 'guard') {
            guardTick(this._db, agent.id, this.worldId, agent.location);
          }
        }
      } catch { /* non-fatal */ }
    }

    // Very rare: directive voting tick (0.5% of ticks)
    if (Math.random() < 0.005) {
      try {
        const { tickDirectiveVoting } = await import('./world-governance.js');
        tickDirectiveVoting(this._db, this.worldId);
      } catch { /* non-fatal */ }
    }

    // Very rare: seed jobs for NPCs without assignments (0.2% of ticks)
    if (Math.random() < 0.002) {
      try { seedJobsForWorld(this._db, this.worldId); } catch { /* non-fatal */ }
    }

    // Very rare: seed NPC-to-NPC archetype opinions (0.1% of ticks)
    if (Math.random() < 0.001) {
      try {
        const { seedNPCOpinions } = await import('./npc-relations.js');
        seedNPCOpinions(this._db, this.worldId);
      } catch { /* non-fatal */ }
    }
  }

  _tickCrossbreeding() {
    const spousePairs = this._db.prepare(`
      SELECT r.npc_id, r.related_id FROM npc_relationships r
      WHERE r.rel_type = 'spouse'
        AND r.npc_id IN (SELECT id FROM world_npcs WHERE world_id = ? AND is_dead = 0)
      LIMIT 10
    `).all(this.worldId);
    for (const pair of spousePairs) {
      const offspring = attemptCrossbreed(this._db, pair.npc_id, pair.related_id, this.worldId);
      if (offspring) {
        const row = this._db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(offspring.id);
        if (row) this._agents.push(new NPCAgent(row, this.worldId, this._db, this._selectBrain));
        logger.info('npc-simulator', 'crossbreed_born', { id: offspring.id, species: offspring.species });
      }
    }
  }

  /** Faction coordination: pick a leader, generate shared tactics */
  async _tickFactionCoordination(agents) {
    const byFaction = new Map();
    for (const agent of agents) {
      const faction = agent.faction || 'neutral';
      if (faction === 'neutral') continue;
      if (!byFaction.has(faction)) byFaction.set(faction, []);
      byFaction.get(faction).push(agent);
    }

    for (const [faction, members] of byFaction) {
      if (members.length < 2) continue;
      // Leader = highest level in faction
      const leader = members.sort((a, b) => (b.level || 1) - (a.level || 1))[0];
      try {
        await leader._coordinateFaction(members);
        // Leader ensures undergeared members receive wealth transfers
        const memberIds = members.filter(m => m.id !== leader.id).map(m => m.id);
        leaderEnsuresFactionGear(this._db, leader.id, memberIds);
      } catch { /* non-fatal */ }
    }
  }

  /** NPC ↔ NPC and NPC ↔ Emergent conversations */
  async _tickNPCConversations(autonomousAgents, consciousAgents) {
    if (!autonomousAgents.length) return;

    const speaker = autonomousAgents[Math.floor(Math.random() * autonomousAgents.length)];
    // Pick a conversation partner: another NPC or a conscious emergent
    const partners = [...autonomousAgents.filter(a => a.id !== speaker.id), ...consciousAgents];
    if (!partners.length) return;

    const partner = partners[Math.floor(Math.random() * partners.length)];
    await speaker._speakTo(partner).catch(() => {});

    // Update mutual opinion from conversation (slight warmth from interaction)
    try {
      const { recordNPCToNPCInteraction } = await import('./npc-relations.js');
      recordNPCToNPCInteraction(this._db, speaker.id, partner.id, 0.01, 'conversation');
    } catch { /* non-fatal */ }
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch(err => logger?.debug?.('[npc-simulator] background op failed', { err: err?.message }));
    }, this._tickRate);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  updatePopulation(playerCount) {
    const { tickRate } = adjustSimulationDensity({ id: this.worldId }, playerCount);
    if (tickRate !== this._tickRate) {
      this._tickRate = tickRate;
      if (this._timer) {
        this.stop();
        this.start();
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function _defaultNeeds() {
  return { hunger: 1, rest: 1, social: 1, purpose: 1, safety: 1 };
}

function _needToAction(need) {
  const map = { hunger: "gather_resource", rest: "rest", social: "socialize", purpose: "create", safety: "travel" };
  return { action: map[need] || "rest" };
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function _archetypeResource(archetype) {
  const map = {
    blacksmith: 'iron-ore', engineer: 'circuit-board', farmer: 'herb-bundle',
    hunter: 'leather-strip', scientist: 'data-chip', medic: 'herb-bundle',
    trader: 'gold-coin', guard: 'stone-block', default: 'wood-planks',
  };
  return map[archetype] || map.default;
}
