// server/domains/spawn.js
//
// Developer + test surface for forcing entities into a world without
// waiting for the heartbeat that normally drives spawning. Useful for:
//   - QA: "I need a boss at (x, z) right now to test combat"
//   - Live ops: "drop a wave of bandits at this rally point"
//   - Testing: force fauna pass to top off counts before a smoke run
//
// All macros are owner-only by default (caller must be the realm ruler
// of the target world OR the world's universe_type matches no realm).
// Authenticated users can force-spawn into worlds they're currently
// visiting (no privilege escalation outside their own session).
//
// Macros:
//   spawn.boss              — spawn a boss archetype at (x, z)
//   spawn.enemies           — spawn N enemies of a chosen archetype
//   spawn.creature_wave     — force a fauna-spawner pass (top off populations)
//   spawn.npc               — spawn a generic civilian / role NPC

import crypto from "node:crypto";

function _emit(event, payload) {
  try {
    if (globalThis?.__CONCORD_REALTIME__?.io && payload?.worldId) {
      globalThis.__CONCORD_REALTIME__.io.to(`world:${payload.worldId}`).emit(event, payload);
    }
  } catch { /* best-effort */ }
}

function _spawnOne(db, { id, worldId, archetype, npcType = "generic", x, z, faction = null, level = 1, currentHp = 100, maxHp = 100 }) {
  db.prepare(`
    INSERT INTO world_npcs (
      id, world_id, npc_type, archetype, faction, x, y, z,
      is_dead, is_conscious, level, current_hp, max_hp,
      spawn_location, current_location, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    id, worldId, npcType, archetype, faction, x, z,
    level, currentHp, maxHp,
    JSON.stringify({ x, y: 0, z }), JSON.stringify({ x, y: 0, z }),
  );
}

export default function registerSpawnMacros(register) {
  register("spawn", "boss", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, x = 0, z = 0, archetype, level = 10 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };

    const archetypeMod = await import("../lib/npc-archetypes.js");
    let resolvedArchetype = archetype;
    if (!resolvedArchetype) {
      const world = db.prepare(`SELECT universe_type FROM worlds WHERE id = ?`).get(worldId);
      const bosses = archetypeMod.getArchetypes(world?.universe_type || "generic", "bosses");
      if (!bosses || bosses.length === 0) return { ok: false, reason: "no_boss_for_universe" };
      resolvedArchetype = bosses[0].name || bosses[0].archetype || "boss";
    }
    const id = `boss_${crypto.randomUUID()}`;
    _spawnOne(db, {
      id, worldId,
      archetype: resolvedArchetype,
      npcType: "boss",
      x, z,
      level,
      currentHp: 500 + level * 50,
      maxHp: 500 + level * 50,
    });
    _emit("spawn:boss", { worldId, npcId: id, archetype: resolvedArchetype, x, z, level });
    return { ok: true, npcId: id, archetype: resolvedArchetype, x, z };
  }, { note: "Force-spawn a boss at (x, z). Archetype auto-picked from universe if omitted." });

  register("spawn", "enemies", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, x = 0, z = 0, count = 4, archetype, level = 1, spread = 12 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };

    const archetypeMod = await import("../lib/npc-archetypes.js");
    let resolvedArchetype = archetype;
    if (!resolvedArchetype) {
      const world = db.prepare(`SELECT universe_type FROM worlds WHERE id = ?`).get(worldId);
      const pick = archetypeMod.pickEnemyArchetype(world?.universe_type || "generic", level);
      resolvedArchetype = pick?.name || pick?.archetype || "bandit";
    }
    const ids = [];
    for (let i = 0; i < Math.min(20, Math.max(1, count)); i++) {
      const id = `enemy_${crypto.randomUUID()}`;
      const dx = (Math.random() * 2 - 1) * spread;
      const dz = (Math.random() * 2 - 1) * spread;
      _spawnOne(db, {
        id, worldId,
        archetype: resolvedArchetype,
        npcType: "enemy",
        x: x + dx, z: z + dz,
        level,
      });
      ids.push(id);
    }
    _emit("spawn:enemies", { worldId, ids, archetype: resolvedArchetype, x, z, count: ids.length, level });
    return { ok: true, spawned: ids.length, ids, archetype: resolvedArchetype };
  }, { note: "Spawn N enemies clustered around (x, z) with a spread." });

  register("spawn", "creature_wave", async (ctx, input = {}) => {
    const db = ctx?.db;
    const state = ctx?.state;
    if (!db) return { ok: false, reason: "no_db" };
    const { runFaunaSpawner } = await import("../lib/ecosystem/fauna-spawner.js");
    // Spawner needs a `state` arg — pass the makeCtx state if available,
    // otherwise a shim.
    const passState = state || { db };
    const result = runFaunaSpawner({ state: passState, db });
    _emit("spawn:creature-wave", { worldId: input?.worldId || null, ...result });
    return { ok: true, ...result };
  }, { note: "Force-trigger a fauna-spawner pass to top off populations." });

  register("spawn", "npc", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, x = 0, z = 0, archetype = "civilian", faction = null, level = 1 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const id = `npc_${crypto.randomUUID()}`;
    _spawnOne(db, {
      id, worldId, archetype, npcType: archetype, faction, x, z, level,
    });
    _emit("spawn:npc", { worldId, npcId: id, archetype, faction, x, z, level });
    return { ok: true, npcId: id, archetype };
  }, { note: "Spawn a single NPC at (x, z)." });
}
