// server/domains/appearance.js
//
// Surfaces per-NPC + per-faction appearance hints to the frontend so
// the renderer can build a deterministic character that respects the
// authored content. Three macros:
//
//   appearance.for_npc          — returns the data the frontend
//                                  character-schema generator needs:
//                                  authored visual block from the
//                                  NPC's faction + the NPC's appearance
//                                  prose + archetype + theme id.
//   appearance.for_world        — bulk read: all NPCs in a world with
//                                  their appearance hints. Used by the
//                                  scene's initial hydration pass.
//   appearance.faction_visual   — just the faction's visual + biome_mix
//                                  block (lighter than for_npc).
//
// Read-only — no DB writes. The frontend uses these to seed its
// character-schema.ts generator deterministically.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dir, "..", "..", "content");

/* In-process content cache. Authored content doesn't change at runtime
 * so we read once and reuse. */
const _factionsByWorld = new Map();   // worldId → factions[]
const _npcsByWorld = new Map();        // worldId → npcs[]
const CANON_WORLDS = ["tunya", "cyber", "crime", "fantasy", "superhero",
                       "sovereign-ruins", "lattice-crucible",
                       "concord-link-frontier"];

function _readJson(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return null; }
}

function _hydrateWorld(worldId) {
  if (_factionsByWorld.has(worldId) && _npcsByWorld.has(worldId)) return;
  const isHub = worldId === "concordia-hub" || worldId === "concordia";
  const baseDir = isHub
    ? join(CONTENT_ROOT, "world")
    : join(CONTENT_ROOT, "world", worldId);
  _factionsByWorld.set(worldId, _readJson(join(baseDir, "factions.json")) ?? []);
  const npcs = _readJson(join(baseDir, "npcs.json")) ?? [];
  _npcsByWorld.set(worldId, npcs);
}

function _resolveFaction(worldId, factionId) {
  if (!factionId) return null;
  _hydrateWorld(worldId);
  const factions = _factionsByWorld.get(worldId) ?? [];
  return factions.find((f) => f.id === factionId) ?? null;
}

function _resolveAuthoredNpc(worldId, npcId) {
  _hydrateWorld(worldId);
  const npcs = _npcsByWorld.get(worldId) ?? [];
  return npcs.find((n) => n.id === npcId) ?? null;
}

function _themeForWorldId(worldId) {
  if (!worldId) return "neon-punk";
  if (worldId === "concordia") return "concordia-hub";
  if ([...CANON_WORLDS, "concordia-hub"].includes(worldId)) return worldId;
  return "neon-punk";
}

export default function registerAppearanceMacros(register) {
  register("appearance", "for_npc", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { npcId } = input || {};
    if (!npcId) return { ok: false, reason: "missing_npc_id" };

    // Look up the live NPC.
    let row;
    try {
      row = db.prepare(`
        SELECT id, world_id, faction, archetype FROM world_npcs WHERE id = ?
      `).get(npcId);
    } catch {
      return { ok: false, reason: "world_npcs_missing" };
    }
    if (!row) return { ok: false, reason: "not_found" };

    const factionId = row.faction || null;
    const faction = factionId ? _resolveFaction(row.world_id, factionId) : null;
    const authored = _resolveAuthoredNpc(row.world_id, npcId);

    const knownHeroes = new Set([
      "sovereign_first_refusal", "concord_first_thought",
      "concordia_first_breath", "weaver_of_echoes",
    ]);

    return {
      ok: true,
      npcId,
      worldId: row.world_id,
      themeId: _themeForWorldId(row.world_id),
      factionId,
      archetype: row.archetype,
      // Authored faction visual heraldry — the schema generator overrides
      // its style palette with this when present.
      factionVisual: faction?.visual || null,
      factionBiomes: faction?.biome_mix || null,
      // Authored NPC prose, for narrative tooltips + future LLM hooks.
      appearanceText: authored?.appearance || null,
      backstory:       authored?.background || null,
      heroMesh:        knownHeroes.has(npcId) || authored?.hero_mesh === true,
    };
  }, {
    note: "Per-NPC appearance hints — authored faction visual + NPC prose + archetype + theme. Frontend feeds these into character-schema.generateAppearance().",
  });

  register("appearance", "for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, limit = 200 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };

    let rows;
    try {
      // Phase T — LEFT JOIN npc_residency so the appearance hint
      // includes home_world_id. A travelling NPC's mesh is keyed off
      // their HOME world, not their current world, so a courier
      // visiting concordia-hub still loads the concord-link mesh.
      rows = db.prepare(`
        SELECT n.id, n.faction, n.archetype,
               COALESCE(r.home_world_id, n.home_world_id, n.world_id) AS home_world_id
          FROM world_npcs n
          LEFT JOIN npc_residency r ON r.npc_id = n.id
         WHERE n.world_id = ? AND COALESCE(n.is_dead, 0) = 0
           AND COALESCE(n.archetype, '') NOT LIKE 'creature:%'
         LIMIT ?
      `).all(worldId, Math.min(500, Math.max(1, Number(limit))));
    } catch {
      // Phase T's residency join is best-effort. On a DB that predates
      // migration 159 (no npc_residency table) or lacks the
      // world_npcs.home_world_id column, fall back to the base read
      // and key home_world_id off the NPC's current world.
      try {
        rows = db.prepare(`
          SELECT n.id, n.faction, n.archetype, n.world_id AS home_world_id
            FROM world_npcs n
           WHERE n.world_id = ? AND COALESCE(n.is_dead, 0) = 0
             AND COALESCE(n.archetype, '') NOT LIKE 'creature:%'
           LIMIT ?
        `).all(worldId, Math.min(500, Math.max(1, Number(limit))));
      } catch {
        return { ok: false, reason: "world_npcs_missing" };
      }
    }

    const themeId = _themeForWorldId(worldId);
    const out = rows.map((row) => {
      const faction = row.faction ? _resolveFaction(worldId, row.faction) : null;
      const authored = _resolveAuthoredNpc(worldId, row.id);
      return {
        npcId: row.id,
        factionId: row.faction || null,
        archetype: row.archetype,
        factionVisual: faction?.visual || null,
        appearanceText: authored?.appearance || null,
        heroMesh: authored?.hero_mesh === true,
        homeWorldId: row.home_world_id || worldId,
      };
    });
    return { ok: true, worldId, themeId, count: out.length, npcs: out };
  }, {
    note: "Bulk-read appearance hints for every NPC in a world. Used by the scene's hydration pass.",
  });

  // Phase E2 — save / load player character appearance.
  register("appearance", "save", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const { appearance, avatarId } = input || {};
    if (!appearance || typeof appearance !== "object") {
      return { ok: false, reason: "missing_appearance" };
    }
    const json = JSON.stringify(appearance);
    // Prefer avatar-scoped storage (mig 187 adds avatars.appearance_json).
    if (avatarId) {
      try {
        const r = db.prepare(`
          UPDATE avatars SET appearance_json = ? WHERE id = ? AND user_id = ?
        `).run(json, avatarId, userId);
        if (r.changes > 0) return { ok: true, scope: "avatar", avatarId };
      } catch { /* table may lack column */ }
    }
    // Fall back to users.appearance_json.
    try {
      const r = db.prepare(`UPDATE users SET appearance_json = ? WHERE id = ?`).run(json, userId);
      if (r.changes > 0) return { ok: true, scope: "user" };
    } catch { /* column optional */ }
    return { ok: false, reason: "no_storage_column" };
  }, { note: "Persist a player's RichAppearanceConfig. Avatar-scoped if avatarId given, else user-scoped." });

  register("appearance", "load_for_user", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    try {
      const row = db.prepare(`SELECT appearance_json FROM users WHERE id = ?`).get(userId);
      if (row?.appearance_json) {
        try { return { ok: true, appearance: JSON.parse(row.appearance_json) }; }
        catch { return { ok: false, reason: "appearance_parse_failed" }; }
      }
      // Try the primary avatar.
      try {
        const a = db.prepare(`SELECT appearance_json FROM avatars WHERE user_id = ? AND is_primary = 1`).get(userId);
        if (a?.appearance_json) return { ok: true, appearance: JSON.parse(a.appearance_json), scope: "avatar" };
      } catch { /* optional */ }
      return { ok: true, appearance: null };
    } catch {
      return { ok: false, reason: "load_failed" };
    }
  }, { note: "Load player's persisted appearance — user-scoped or primary-avatar-scoped." });

  register("appearance", "load_for_avatar", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "missing_inputs" };
    const { avatarId } = input || {};
    if (!avatarId) return { ok: false, reason: "missing_avatar_id" };
    try {
      const a = db.prepare(`SELECT appearance_json FROM avatars WHERE id = ? AND user_id = ?`).get(avatarId, userId);
      if (a?.appearance_json) return { ok: true, appearance: JSON.parse(a.appearance_json) };
      return { ok: true, appearance: null };
    } catch {
      return { ok: false, reason: "load_failed" };
    }
  }, { note: "Load appearance for a specific avatar." });

  register("appearance", "faction_visual", async (ctx, input = {}) => {
    const { worldId, factionId } = input || {};
    if (!worldId || !factionId) return { ok: false, reason: "missing_inputs" };
    const faction = _resolveFaction(worldId, factionId);
    if (!faction) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      factionId,
      worldId,
      visual: faction.visual || null,
      biomeMix: faction.biome_mix || null,
      dialogueStyle: faction.dialogue_style || null,
      foundingPopulation: faction.founding_population || null,
      controlledDistricts: faction.controlled_districts || null,
    };
  }, {
    note: "Authored faction visual heraldry — primary/secondary/accent colors + biome bias. Lighter than for_npc.",
  });
}
