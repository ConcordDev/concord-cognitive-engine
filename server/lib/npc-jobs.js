// server/lib/npc-jobs.js
// NPC job definitions, schedules, and actual task execution.
// Every NPC has a real job with tasks they actually do — not just wandering.

import crypto from 'node:crypto';
import logger from '../logger.js';

// ── Time-of-day phases (based on server tick count) ───────────────────────────
// Assume a full day = 1440 ticks (each tick = ~1 min game time)
const DAY_CYCLE = 1440;
export function getCurrentPhase(tickCount) {
  const timeOfDay = (tickCount % DAY_CYCLE) / DAY_CYCLE; // 0–1
  if (timeOfDay < 0.15) return 'night';   // 0:00–3:36
  if (timeOfDay < 0.30) return 'morning'; // 3:36–7:12
  if (timeOfDay < 0.70) return 'day';     // 7:12–16:48
  if (timeOfDay < 0.85) return 'evening'; // 16:48–20:24
  return 'night';                          // 20:24–24:00
}

// ── Job type definitions ───────────────────────────────────────────────────────

export const JOB_TYPES = {
  blacksmith: {
    schedule: {
      morning: 'walk_to_work',
      day: 'craft_at_forge',
      evening: 'restock_materials',
      night: 'walk_home',
    },
    earns_from: ['crafting', 'trading'],
    archetype_match: ['blacksmith'],
    room_type_needed: 'forge',
  },
  merchant: {
    schedule: {
      morning: 'open_stall',
      day: 'tend_market',
      evening: 'count_coins',
      night: 'walk_home',
    },
    earns_from: ['trading'],
    archetype_match: ['merchant', 'trader'],
    room_type_needed: 'market_stall',
  },
  farmer: {
    schedule: {
      morning: 'walk_to_fields',
      day: 'gather_crops',
      evening: 'store_harvest',
      night: 'walk_home',
    },
    earns_from: ['gathering'],
    archetype_match: ['farmer'],
    room_type_needed: null,  // works outdoors
  },
  innkeeper: {
    schedule: {
      morning: 'prepare_inn',
      day: 'serve_guests',
      evening: 'serve_drinks',
      night: 'lock_up',
    },
    earns_from: ['trading'],
    archetype_match: ['innkeeper', 'bard'],
    room_type_needed: 'tavern',
  },
  guard: {
    schedule: {
      morning: 'patrol',
      day: 'patrol',
      evening: 'patrol',
      night: 'guard_post',
    },
    earns_from: ['patrol'],
    archetype_match: ['guard', 'soldier'],
    room_type_needed: null,
  },
  detective: {
    schedule: {
      morning: 'investigate_crimes',
      day: 'investigate_crimes',
      evening: 'write_report',
      night: 'walk_home',
    },
    earns_from: ['solving_crimes'],
    archetype_match: ['detective', 'guard'],
    room_type_needed: 'lab',  // detective's office = lab room type
  },
  mage: {
    schedule: {
      morning: 'study_tomes',
      day: 'practice_magic',
      evening: 'teach_apprentices',
      night: 'meditate',
    },
    earns_from: ['crafting', 'trading'],
    archetype_match: ['dark_wizard', 'mage'],
    room_type_needed: 'library',
  },
  scavenger: {
    schedule: {
      morning: 'search_ruins',
      day: 'gather_scrap',
      evening: 'sell_to_market',
      night: 'walk_home',
    },
    earns_from: ['gathering', 'trading'],
    archetype_match: ['bandit', 'pirate'],
    room_type_needed: null,
  },
  criminal: {
    schedule: {
      morning: 'stake_out',
      day: 'blend_in',
      evening: 'run_scheme',
      night: 'break_in',
    },
    earns_from: ['theft', 'crime'],
    archetype_match: ['bandit', 'pirate', 'henchman'],
    room_type_needed: null,
  },
  clerk: {
    schedule: {
      morning: 'walk_to_work',
      day: 'process_records',
      evening: 'file_decrees',
      night: 'walk_home',
    },
    earns_from: ['administration'],
    archetype_match: ['clerk', 'official', 'scribe', 'administrator', 'scholar'],
    room_type_needed: 'office',
  },
  builder: {
    schedule: {
      morning: 'walk_to_site',
      day: 'raise_structures',
      evening: 'haul_materials',
      night: 'walk_home',
    },
    earns_from: ['construction'],
    archetype_match: ['builder', 'laborer', 'mason', 'carpenter'],
    room_type_needed: 'construction_site',
  },
  healer: {
    schedule: {
      morning: 'open_clinic',
      day: 'tend_patients',
      evening: 'brew_remedies',
      night: 'walk_home',
    },
    earns_from: ['healing', 'trading'],
    archetype_match: ['healer', 'medic', 'doctor', 'priest'],
    room_type_needed: 'clinic',
  },
  generic: {
    schedule: {
      morning: 'gather_resource',
      day: 'socialize',
      evening: 'trade',
      night: 'rest',
    },
    earns_from: ['gathering'],
    archetype_match: [],
    room_type_needed: null,
  },
};

// ── Assign job to NPC ──────────────────────────────────────────────────────────

/**
 * Assign the best matching job to an NPC based on archetype.
 * Creates or updates the npc_jobs record.
 */
export function assignJob(db, npcId, worldId) {
  const npc = db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(npcId);
  if (!npc) return null;

  const archetype = npc.archetype || 'generic';

  // Find matching job type
  let jobType = 'generic';
  for (const [type, def] of Object.entries(JOB_TYPES)) {
    if (def.archetype_match.includes(archetype)) {
      jobType = type;
      break;
    }
  }

  // Criminals: NPCs with criminal_rep > 0.5 drift toward criminal job
  if ((npc.criminal_rep || 0) > 0.5) jobType = 'criminal';

  // Find work location: a building with matching room type
  const jobDef = JOB_TYPES[jobType];
  let workBuildingId = null;
  let workRoomId = null;

  if (jobDef.room_type_needed) {
    const room = db.prepare(`
      SELECT r.id, r.building_id FROM building_rooms r
      JOIN world_buildings b ON b.id = r.building_id
      WHERE b.world_id = ? AND r.room_type = ? AND (r.owner_id IS NULL OR r.owner_id = ?)
      LIMIT 1
    `).get(worldId, jobDef.room_type_needed, npcId);
    if (room) {
      workBuildingId = room.building_id;
      workRoomId = room.id;
    } else {
      // Fallback: use any building
      const building = db.prepare('SELECT id FROM world_buildings WHERE world_id = ? LIMIT 1').get(worldId);
      workBuildingId = building?.id;
    }
  }

  const schedule = JOB_TYPES[jobType].schedule;

  // Upsert job record
  const existing = db.prepare('SELECT id FROM npc_jobs WHERE npc_id = ?').get(npcId);
  if (existing) {
    db.prepare(`UPDATE npc_jobs SET job_type = ?, work_building_id = ?, work_room_id = ?, schedule = ? WHERE npc_id = ?`)
      .run(jobType, workBuildingId, workRoomId, JSON.stringify(schedule), npcId);
  } else {
    db.prepare(`INSERT INTO npc_jobs (id, npc_id, world_id, job_type, work_building_id, work_room_id, schedule)
      VALUES (?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), npcId, worldId, jobType, workBuildingId, workRoomId, JSON.stringify(schedule));
  }

  // Also update the NPC's job columns
  db.prepare('UPDATE world_npcs SET job_type = ?, job_location_id = ?, job_room_id = ? WHERE id = ?')
    .run(jobType, workBuildingId, workRoomId, npcId);

  return { npcId, jobType, workBuildingId, workRoomId };
}

// ── Execute scheduled task ─────────────────────────────────────────────────────

/**
 * Execute the current scheduled task for an NPC based on time-of-day.
 * Called from npc-simulator tick. Returns the task name executed.
 */
export async function executeScheduledTask(npc, jobType, phase, db, worldId, opts = {}) {
  const { gatherFromWorld, buildStructure } = opts;
  const jobDef = JOB_TYPES[jobType] || JOB_TYPES.generic;
  const taskName = jobDef.schedule[phase] || 'rest';

  // Update current task
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare('UPDATE world_npcs SET current_task = ?, schedule_phase = ? WHERE id = ?')
      .run(JSON.stringify({ type: taskName, started_at: now }), phase, npc.id);
    db.prepare('UPDATE npc_jobs SET current_task = ? WHERE npc_id = ?')
      .run(JSON.stringify({ type: taskName, started_at: now }), npc.id);
  } catch { /* columns may not exist yet */ }

  switch (taskName) {
    case 'craft_at_forge': {
      // Blacksmith crafts items if they have materials
      const resources = _getNPCResources(npc, db);
      if (resources['iron-ore'] >= 3) {
        // Craft a basic item — reduces iron, increases wealth
        resources['iron-ore'] = Math.max(0, (resources['iron-ore'] || 0) - 3);
        resources['iron-goods'] = (resources['iron-goods'] || 0) + 1;
        _setNPCResources(db, npc.id, resources);
        _earnWage(db, npc.id, 15);
        logger.debug('npc-jobs', 'crafted', { npcId: npc.id, item: 'iron-goods' });
      }
      break;
    }

    case 'tend_market':
    case 'serve_guests':
    case 'serve_drinks': {
      // Merchant/innkeeper earns passively during business hours
      _earnWage(db, npc.id, 8);
      break;
    }

    case 'gather_crops':
    case 'search_ruins':
    case 'gather_scrap': {
      // These trigger the real world-gathering system (handled by npc-simulator gather_resource action)
      break;
    }

    case 'patrol': {
      // Guards patrol and look for crime (handled by world-crime.js guardTick)
      _earnWage(db, npc.id, 5);
      break;
    }

    case 'investigate_crimes': {
      // Detectives investigate (handled by world-crime.js detectiveTick)
      _earnWage(db, npc.id, 12);
      break;
    }

    case 'write_report': {
      // Detective consolidates findings — small wage
      _earnWage(db, npc.id, 5);
      break;
    }

    case 'practice_magic':
    case 'study_tomes': {
      // Mage improves skill level
      try {
        db.prepare('UPDATE dtus SET skill_level = MIN(100, skill_level + 0.1) WHERE creator_id = ? AND type = ?')
          .run(npc.id, 'skill');
      } catch { /* non-fatal */ }
      break;
    }

    case 'run_scheme':
    case 'break_in': {
      // Criminal NPCs attempt break-ins at night
      if ((npc.criminal_rep || 0) > 0.2) {
        const targetBuilding = db.prepare(`
          SELECT id FROM world_buildings
          WHERE world_id = ? AND owner_type = 'player' AND id != ?
          ORDER BY RANDOM() LIMIT 1
        `).get(worldId, npc.home_building_id || '');

        if (targetBuilding) {
          const { npcBreakIn } = await import('./world-crime.js');
          npcBreakIn(db, npc.id, targetBuilding.id, worldId);
        }
      }
      break;
    }

    case 'count_coins':
    case 'restock_materials':
    case 'store_harvest':
    case 'open_stall':
    case 'prepare_inn':
    case 'stake_out':
    case 'blend_in':
      // Logistical tasks — minor wage
      _earnWage(db, npc.id, 3);
      break;

    case 'walk_to_work':
    case 'walk_home':
    case 'guard_post':
    case 'lock_up':
    case 'meditate':
    case 'socialize':
    case 'rest':
    default:
      // Movement/rest tasks
      break;
  }

  // Increment tasks_completed
  try {
    db.prepare('UPDATE npc_jobs SET tasks_completed = tasks_completed + 1, last_clocked_in = ? WHERE npc_id = ?')
      .run(now, npc.id);
  } catch { /* non-fatal */ }

  return taskName;
}

// ── Seed jobs for all NPCs in a world ─────────────────────────────────────────

/**
 * Called once when a world is seeded. Assigns jobs to all existing NPCs.
 * Idempotent — skips NPCs that already have a job.
 */
export function seedJobsForWorld(db, worldId) {
  const npcs = db.prepare(`
    SELECT n.id FROM world_npcs n
    LEFT JOIN npc_jobs j ON j.npc_id = n.id
    WHERE n.world_id = ? AND j.id IS NULL AND n.is_dead = 0
  `).all(worldId);

  let assigned = 0;
  for (const { id } of npcs) {
    try {
      assignJob(db, id, worldId);
      assigned++;
    } catch { /* non-fatal */ }
  }
  return assigned;
}

/**
 * Get the current task description for display.
 */
export function getNPCCurrentActivity(db, npcId) {
  const job = db.prepare('SELECT * FROM npc_jobs WHERE npc_id = ?').get(npcId);
  if (!job) return 'wandering';
  const task = JSON.parse(job.current_task || '{}');
  return task.type || job.job_type;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _getNPCResources(npc, db) {
  const row = db.prepare('SELECT activity_resources FROM world_npcs WHERE id = ?').get(npc.id);
  try { return JSON.parse(row?.activity_resources || '{}'); } catch { return {}; }
}

function _setNPCResources(db, npcId, resources) {
  db.prepare('UPDATE world_npcs SET activity_resources = ? WHERE id = ?')
    .run(JSON.stringify(resources), npcId);
}

function _earnWage(db, npcId, amount) {
  // NPCs accumulate wealth — same as npc-gear.js accumulateWealth pattern
  try {
    db.prepare('UPDATE world_npcs SET activity_resources = json_patch(activity_resources, json_object(\'_wealth\', MAX(0, CAST(json_extract(activity_resources, \'$._wealth\') AS INTEGER) + ?))) WHERE id = ?')
      .run(amount, npcId);
  } catch { /* non-fatal if json functions unavailable */ }
}
