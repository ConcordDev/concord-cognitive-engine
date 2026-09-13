// server/lib/world-kernel.js
//
// Named Concordia World Kernel — the CONCORDIA_UNITY_BUILD_PLAN clock.
// Heartbeats already exist (~168). This module is the UNIFIED named organ:
// one tick mutates society / life / consequence / physics / combat HP /
// breeding / craft / magic / terrain / material / session / creator.
// World mutates with no Unity player attached (Alive-path proof).
// Does not invent a second architecture — composes existing libs.

import { registerHeartbeat, listHeartbeatModules } from "../emergent/heartbeat-registry.js";
import { listConsequences } from "./world-consequence.js";
import { applyPendingConsequences } from "./consequence-apply.js";
import { decayNeeds, freshNeeds, satisfy, topNeed, getNeeds, setNeeds } from "./npc-needs.js";
import { applyAuthoritativeMove, applyRefusal, combatAllowed } from "./world-physics-authority.js";
import { applyAuthoritativeHit, ensureActor, getActor } from "./combat-hp-authority.js";
import { resolveCraft } from "./craft-resolve.js";
import { applyDeformation } from "./terrain-deformation.js";
import { stressResponse } from "./materials/stress.js";
import { seedDefaultGlyphLibrary, composeSpell } from "./glyph-spells.js";
import { ensureCrossbreedingTables, recordEncounter, generateHybrid } from "./creature-crossbreeding.js";
import { joinSession, snapshotSession } from "./concordia-session.js";
import { buildingPurpose, buildingPurposeForType } from "./building-purpose.js";

const KERNEL_ID = "world-kernel";
const DEFAULT_WORLD = "concordia-hub";

let _ticks = 0;
let _lastSnapshot = null;
let _registered = false;
const _life = new Map(); // npcId -> needs

export function ensureKernelTables(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS world_consequences (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL DEFAULT 'concordia-hub',
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_kind TEXT,
        target_id TEXT,
        location TEXT,
        evidence_json TEXT,
        witnesses_json TEXT,
        immediate_json TEXT,
        long_term_json TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_terrain_deformations (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        cell_x INTEGER NOT NULL,
        cell_z INTEGER NOT NULL,
        height_delta REAL NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'excavate',
        material_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (world_id, cell_x, cell_z)
      );
      CREATE TABLE IF NOT EXISTS glyph_components (
        id TEXT PRIMARY KEY,
        glyph TEXT NOT NULL,
        label TEXT NOT NULL,
        element TEXT NOT NULL,
        damage REAL NOT NULL DEFAULT 0,
        range_m REAL NOT NULL DEFAULT 0,
        stamina_cost REAL NOT NULL DEFAULT 0,
        mana_cost REAL NOT NULL DEFAULT 0,
        cooldown_s REAL NOT NULL DEFAULT 0,
        narrative TEXT
      );
      CREATE TABLE IF NOT EXISTS evo_assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT,
        local_path TEXT NOT NULL,
        category TEXT,
        tags_json TEXT,
        quality_level INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS evo_asset_interactions (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        actor_kind TEXT,
        actor_id TEXT,
        action TEXT,
        weight REAL
      );
    `);
  } catch { /* already exist or memory db */ }
  try { seedDefaultGlyphLibrary(db); } catch { /* */ }
  try { ensureCrossbreedingTables(db); } catch { /* */ }
  return { ok: true };
}

function tickSociety(db, worldId) {
  // Observe the bus. Do not invent a leader death — that used to stamp a fake
  // kill+succession on every kernel tick and poisoned the Alive test.
  const listed = listConsequences(db, { worldId, limit: 20 });
  const kills = listed.filter((r) => r.action === "kill").length;
  const wars = listed.filter((r) => r.action === "war").length;
  return {
    ok: true,
    recorded: listed.length,
    kills,
    wars,
    invented: false,
  };
}

function tickLife(db, elapsedHours = 0.25) {
  const npcId = "kernel-citizen";
  const prev = _life.get(npcId) || freshNeeds();
  const decayed = decayNeeds(prev, elapsedHours);
  const fed = satisfy(decayed, "hunger", 0.2);
  _life.set(npcId, fed);
  let dbTouched = 0;
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT id FROM world_npcs WHERE is_dead = 0 LIMIT 12
      `).all();
      for (const row of rows) {
        const before = getNeeds(db, row.id);
        if (setNeeds(db, row.id, decayNeeds(before, elapsedHours))) dbTouched++;
      }
    } catch { /* needs_json / table optional on minimal DBs */ }
  }
  return {
    ok: true,
    npcId,
    top: topNeed(fed),
    hunger_before: prev.hunger,
    hunger_after_decay: decayed.hunger,
    hunger_after_eat: fed.hunger,
    mutated: decayed.hunger !== prev.hunger,
    dbTouched,
  };
}

function tickConsequence(db) {
  return applyPendingConsequences(db, { limit: 40 });
}

function tickPhysics(worldId) {
  const walk = applyAuthoritativeMove({ playerId: "kernel-walker", worldId, x: 4, z: 1 });
  const hit = applyAuthoritativeMove({ playerId: "kernel-walker", worldId, x: 24, z: 0 });
  applyRefusal("kernel-field", { x: 0, z: 0 }, "hostility_paused");
  return {
    ok: true,
    walk_ok: !!walk.ok,
    collision: !!hit.collided,
    collided_at: { x: hit.x, z: hit.z },
    combat_on_hub: combatAllowed("concordia-hub", "a", "b"),
  };
}

function tickImpact(worldId) {
  ensureActor("TrainingDummy", { worldId, hp: 80 });
  const a = applyAuthoritativeHit({
    attackerId: "kernel-striker",
    targetId: "TrainingDummy",
    weapon: "hammer",
    baseDamage: 20,
    worldId,
  });
  const after = getActor("TrainingDummy");
  return {
    ok: !!a.ok && a.damage > 0 && after && after.hp < 80,
    damage: a.damage,
    hp: after?.hp,
    momentum: a.momentum,
    severity: a.severity,
    localHpApplied: false,
    authority: a.authority,
  };
}

function tickCraft() {
  const r = resolveCraft({
    inputs: ["iron_ore", "wood"],
    playerSkill: 40,
    stationQuality: 50,
    risk: 0.1,
    seed: "world-kernel-craft",
  });
  return { ok: !!r.ok, potency: r.outputPotency, affinity: r.outputAffinity, failed: !!r.failed, reason: r.reason || null };
}

function tickMagic(db) {
  try { seedDefaultGlyphLibrary(db); } catch { /* */ }
  const r = composeSpell(db, ["g_flame_seed", "g_ember_breath"]);
  return { ok: !!r.ok, element: r.element, max_damage: r.max_damage, glyph: r.composed_glyph, reason: r.reason || null };
}

function tickBreed(db) {
  try { ensureCrossbreedingTables(db); } catch { /* */ }
  const a = {
    id: "wk_wolf", topology: "quadruped", massKg: 80, heightM: 1.4,
    worldId: "fantasy", skillIds: [], abilitySeeds: [{ effects: [{ kind: "damage", params: { amount: 8 } }] }],
  };
  const b = {
    id: "wk_hound", topology: "quadruped", massKg: 70, heightM: 1.2,
    worldId: "fantasy", skillIds: [], abilitySeeds: [{ effects: [{ kind: "damage", params: { amount: 6 } }] }],
  };
  for (let i = 0; i < 25; i++) {
    recordEncounter(db, { aId: a.id, bId: b.id, worldA: "fantasy", worldB: "fantasy" });
  }
  const hybrid = generateHybrid(db, { a, b });
  return {
    ok: !!hybrid.ok,
    stability: hybrid.stability ?? null,
    topology: hybrid.hybrid?.topology ?? null,
    reason: hybrid.reason || null,
  };
}

function tickTerrain(db, worldId) {
  const r = applyDeformation(db, worldId, 40, 40, 4, "excavate");
  return { ok: !!r.ok, newDelta: r.newDelta, newElevation: r.newElevation, material: r.material, reason: r.reason || null };
}

function tickMaterial() {
  const wood = stressResponse("wood", 40);
  const steel = stressResponse("steel", 250);
  return {
    ok: wood.state === "yielding" && steel.failed === true,
    wood: wood.state,
    steel: steel.state,
    steel_failed: steel.failed,
  };
}

function tickBuilding() {
  let purpose = null;
  try { purpose = buildingPurposeForType("forge", "concordia-hub") || buildingPurpose("portal-studio"); } catch { /* */ }
  return { ok: purpose != null, purpose: purpose || null };
}

function tickSession(worldId) {
  joinSession(worldId, "kernel-a", { x: 0, z: 0 });
  joinSession(worldId, "kernel-b", { x: 2, z: 1 });
  const snap = snapshotSession(worldId);
  return { ok: snap.count >= 2, count: snap.count, members: snap.members.map((m) => m.id) };
}

function tickCreator(db) {
  let created = false;
  let id = null;
  try {
    const existing = db.prepare(`SELECT id FROM evo_assets WHERE local_path = ?`).get("Assets/Models/kenney/forge.glb");
    if (existing) {
      id = existing.id;
    } else {
      id = `evo_wk_${Date.now().toString(36)}`;
      db.prepare(`
        INSERT INTO evo_assets (id, kind, source, local_path, category, owner_id)
        VALUES (?, 'mesh', 'kenney', ?, 'building', ?)
      `).run(id, "Assets/Models/kenney/forge.glb", "unity-local-guest");
      created = true;
    }
    db.prepare(`
      INSERT INTO evo_asset_interactions (id, asset_id, actor_kind, actor_id, action, weight)
      VALUES (?, ?, 'system', 'world-kernel', 'use', 1.0)
    `).run(`int_${Date.now().toString(36)}`, id);
  } catch (e) {
    return { ok: false, reason: e?.message || "creator_failed" };
  }
  return { ok: true, assetId: id, created };
}

function tickCreature() {
  const dummy = ensureActor("Hostile.Pack", { hp: 60, worldId: "fantasy" });
  const hit = applyAuthoritativeHit({
    attackerId: "kernel-hunter",
    targetId: dummy.id,
    weapon: "spear",
    worldId: "fantasy",
  });
  return { ok: !!hit.ok && hit.damage > 0, hp: hit.targetHealth, killed: hit.targetKilled };
}

/**
 * One World Kernel tick. World mutates with no player attached.
 */
export function tickWorldKernel({ db, worldId = DEFAULT_WORLD, elapsedHours = 0.25 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  ensureKernelTables(db);
  _ticks += 1;
  const organs = {
    society: tickSociety(db, worldId),
    life: tickLife(db, elapsedHours),
    consequence: tickConsequence(db),
    physics: tickPhysics(worldId),
    impact: tickImpact(worldId),
    craft: tickCraft(),
    magic: tickMagic(db),
    breed: tickBreed(db),
    terrain: tickTerrain(db, worldId),
    material: tickMaterial(),
    building: tickBuilding(),
    session: tickSession(worldId),
    creator: tickCreator(db),
    creature: tickCreature(),
  };
  const heartbeats = (() => {
    try { return listHeartbeatModules().map((m) => m.id); } catch { return []; }
  })();
  const ok = Object.values(organs).every((o) => o && o.ok);
  _lastSnapshot = {
    ok,
    kernel: KERNEL_ID,
    worldId,
    ticks: _ticks,
    ts: Date.now(),
    organs,
    heartbeat_ids: heartbeats,
    heartbeat_named: heartbeats.includes(KERNEL_ID) || _registered,
    offline_mutation: true,
  };
  return _lastSnapshot;
}

export function snapshotWorldKernel() {
  return _lastSnapshot || { ok: false, reason: "never_ticked" };
}

export async function runWorldKernelCycle({ db, worldId } = {}) {
  return tickWorldKernel({ db, worldId: worldId || DEFAULT_WORLD });
}

export function registerWorldKernelHeartbeat() {
  if (_registered) return { ok: true, already: true };
  registerHeartbeat(KERNEL_ID, {
    frequency: 4,
    handler: runWorldKernelCycle,
    neverDisable: true,
    scope: "world",
  });
  _registered = true;
  return { ok: true, id: KERNEL_ID };
}

export function kernelTickCount() {
  return _ticks;
}

export default {
  tickWorldKernel,
  snapshotWorldKernel,
  runWorldKernelCycle,
  registerWorldKernelHeartbeat,
  ensureKernelTables,
  kernelTickCount,
};
