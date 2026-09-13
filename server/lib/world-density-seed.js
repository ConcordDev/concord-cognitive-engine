/**
 * Kernel DB density for a living world. Authored rows only — never mints
 * citizens, vehicles, or buildings that are not already owned by a seeder.
 *
 * Buildings stay owned by world-seeder.js. NPC rows stay owned by
 * content-seeder.js. This pass fills the gaps those two leave: hub
 * world_buildings via the existing writer, npc_routine_state / npc_schedules
 * from authored daily_schedule, and an honest vehicle skip when no catalog.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedWorldContent } from "./world-seeder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, "../../content");
const DEFAULT_WORLD = "concordia-hub";

const _done = new Set();

function readJson(rel) {
  const p = join(CONTENT, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return null; }
}

function authoredNpcFiles(worldId) {
  const out = [];
  const push = (arr, fallbackWorld) => {
    if (!Array.isArray(arr)) return;
    for (const npc of arr) {
      if (!npc?.id) continue;
      out.push({ ...npc, world_id: npc.world_id || fallbackWorld });
    }
  };
  if (worldId === DEFAULT_WORLD) push(readJson("world/npcs.json"), DEFAULT_WORLD);
  const folder = worldId === DEFAULT_WORLD ? "concordia-hub" : worldId;
  push(readJson(`world/${folder}/npcs.json`), worldId);
  push(readJson(`world/${folder}/npcs-extra.json`), worldId);
  return out.filter((n) => (n.world_id || worldId) === worldId);
}

function authoredNpcIds(worldId) {
  return authoredNpcFiles(worldId).map((n) => n.id);
}

function activityKind(activity) {
  const s = String(activity || "").toLowerCase();
  if (/sleep|bed|dream/.test(s)) return "sleep";
  if (/rest|meal|eat|food/.test(s)) return "rest";
  if (/train|drill|practice|spar/.test(s)) return "train";
  if (/craft|write|audit|notes|forge|scribe/.test(s)) return "craft";
  if (/gather|harvest|forage/.test(s)) return "gather";
  if (/trade|market|sell|merchant/.test(s)) return "trade";
  if (/commune|prayer|temple|rite/.test(s)) return "commune";
  if (/social|audience|petitioner|visitor|letter/.test(s)) return "socialize";
  if (/patrol|watch|guard/.test(s)) return "patrol";
  return "wander";
}

function locationKind(location) {
  const s = String(location || "").toLowerCase();
  if (/chamber|home|quarters|house|lodging/.test(s)) return "home";
  if (/archive|floor|vault|workshop|forge|workplace/.test(s)) return "workplace";
  if (/market/.test(s)) return "market";
  if (/grove/.test(s)) return "grove";
  if (/temple/.test(s)) return "temple";
  if (/tavern/.test(s)) return "tavern";
  if (/wild/.test(s)) return "wilds";
  return "plaza";
}

function blockFromHours(hours) {
  const start = Number(Array.isArray(hours) ? hours[0] : hours);
  if (!Number.isFinite(start)) return 0;
  const h = ((Math.floor(start) - 1) % 24 + 24) % 24;
  return Math.min(7, Math.floor(h / 3));
}

function currentBlock(now = new Date()) {
  return Math.min(7, Math.floor(now.getUTCHours() / 3));
}

function count(db, sql, ...args) {
  try { return Number(db.prepare(sql).get(...args)?.n || 0); }
  catch { return 0; }
}

function seedRoutines(db, worldId, npcs) {
  let routines = 0;
  let schedules = 0;
  const daySeed = 0;
  const now = Math.floor(Date.now() / 1000);
  const liveBlock = currentBlock();
  let insSched;
  let insState;
  try {
    insSched = db.prepare(`
      INSERT OR IGNORE INTO npc_schedules (
        id, npc_id, block_idx, activity_kind, location_kind,
        target_x, target_z, day_seed, preoccupation_signature, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insState = db.prepare(`
      INSERT OR IGNORE INTO npc_routine_state (
        npc_id, current_block, activity_kind, location_kind,
        target_x, target_z, started_at, expected_end_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  } catch {
    return { routines: 0, schedules: 0, reason: "no_routine_tables" };
  }

  let npcExists;
  try {
    npcExists = db.prepare(`SELECT id FROM world_npcs WHERE id = ?`);
  } catch {
    return { routines: 0, schedules: 0, reason: "no_world_npcs" };
  }
  for (const npc of npcs) {
    if (!npc?.id || !Array.isArray(npc.daily_schedule) || npc.daily_schedule.length === 0) continue;
    const exists = npcExists.get(npc.id);
    if (!exists) continue;
    const pos = (npc.spawn_location && typeof npc.spawn_location === "object")
      ? { x: Number(npc.spawn_location.x) || 0, z: Number(npc.spawn_location.z) || 0 }
      : { x: 0, z: 0 };
    const blocks = new Map();
    for (const slot of npc.daily_schedule) {
      const idx = blockFromHours(slot.phase_hours);
      blocks.set(idx, slot);
      const kind = activityKind(slot.activity);
      const loc = locationKind(slot.location);
      const id = `sched_${npc.id}_${idx}_${daySeed}`;
      try {
        const r = insSched.run(
          id, npc.id, idx, kind, loc, pos.x, pos.z, daySeed,
          slot.need_addressed || null, now,
        );
        if (r.changes > 0) schedules++;
      } catch { /* CHECK / unique — skip that slot */ }
    }
    const live = blocks.get(liveBlock) || npc.daily_schedule[0];
    try {
      const r = insState.run(
        npc.id,
        liveBlock,
        activityKind(live?.activity),
        locationKind(live?.location),
        pos.x,
        pos.z,
        now,
        now + 3 * 3600,
      );
      if (r.changes > 0) routines++;
    } catch { /* */ }
  }
  return { routines, schedules };
}

function seedVehicles(db, worldId) {
  const folder = worldId === DEFAULT_WORLD ? "concordia-hub" : worldId;
  const catalog = readJson(`world/${folder}/vehicles.json`);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { vehicles: 0, skipped: true, reason: "no_authored_vehicles" };
  }
  let vehicles = 0;
  for (const v of catalog) {
    if (!v?.id || !v?.kind) continue;
    try {
      db.prepare(`
        INSERT OR IGNORE INTO world_vehicles
          (id, world_id, kind, owner_kind, owner_id, pos_x, pos_y, pos_z, heading)
        VALUES (?, ?, ?, 'realm', ?, ?, ?, ?, ?)
      `).run(
        v.id, worldId, v.kind, v.owner_id || worldId,
        Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0, Number(v.heading) || 0,
      );
      vehicles++;
    } catch { /* kind CHECK / missing table */ }
  }
  return { vehicles, skipped: false };
}

/**
 * Idempotent density pass for one world. Safe on kernel-only DBs (missing
 * tables → zeros + reasons, never fabricated rows).
 */
export function seedWorldDensity(db, worldId = DEFAULT_WORLD) {
  if (!db) return { ok: false, reason: "no_db" };
  const key = String(worldId || DEFAULT_WORLD);
  const authored = authoredNpcFiles(key);
  const authoredIds = authored.map((n) => n.id);

  let vehicleInfo = { skipped: true, reason: "no_authored_vehicles" };
  if (!_done.has(key)) {
    try {
      seedWorldContent(db, key, "standard");
    } catch { /* world_buildings optional on kernel-only DBs */ }
    vehicleInfo = seedVehicles(db, key);
    _done.add(key);
  }
  seedRoutines(db, key, authored);

  const npcs = count(db, `SELECT COUNT(*) AS n FROM world_npcs WHERE world_id = ? AND is_dead = 0`, key);
  const quests = count(db, `SELECT COUNT(*) AS n FROM world_quests WHERE world_id = ?`, key);
  const buildingRows = count(db, `SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ?`, key);

  const out = {
    ok: true,
    worldId: key,
    npcs,
    authoredNpcs: authoredIds.length,
    buildings: buildingRows,
    quests,
    routines: count(db, `SELECT COUNT(*) AS n FROM npc_routine_state`),
    vehicles: count(db, `SELECT COUNT(*) AS n FROM world_vehicles WHERE world_id = ?`, key),
    vehiclesSkipped: !!vehicleInfo.skipped,
    vehicleReason: vehicleInfo.reason || null,
    invented: false,
    cached: _done.has(key),
  };
  return out;
}

export function densitySeeded(worldId = DEFAULT_WORLD) {
  return _done.has(worldId);
}

export function authoredHubNpcIds() {
  return authoredNpcIds(DEFAULT_WORLD);
}

export default { seedWorldDensity, densitySeeded, authoredHubNpcIds };
