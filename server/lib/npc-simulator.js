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
    // Only choose a new action if not currently walking
    if (!this.state.currentPath || this.state.pathIndex >= (this.state.currentPath?.length ?? 0)) {
      const action = await this._chooseAction();
      await this._executeAction(action);
    }
    await this._maybeEvaluateCreations();
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

    switch (action) {
      case "rest":
        this.needs.rest = Math.min(1, this.needs.rest + 0.3);
        break;
      case "gather_resource":
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.15);
        break;
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
    if (row) this._agents.push(new NPCAgent(row, this.worldId, this._db, this._selectBrain));
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

    // Faction coordination: enemy NPCs strategize together
    await this._tickFactionCoordination(autonomousAgents);

    // Conscious emergents: emergent-AI tick (lighter — just goal updates)
    await Promise.allSettled(consciousAgents.map(a => a.tickConscious()));

    // NPC ↔ NPC / NPC ↔ Emergent conversations (5% chance per tick group)
    if (Math.random() < 0.05) {
      await this._tickNPCConversations(autonomousAgents, consciousAgents);
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
