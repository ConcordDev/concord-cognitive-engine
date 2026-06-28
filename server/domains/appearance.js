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

  // ── appearance.options ──────────────────────────────────────────────
  // The REAL per-slot catalog the renderer honors. Every assetId below is a
  // genuine enum value consumed by the procedural avatar mesh builder
  // (concord-frontend/lib/world-lens/character-schema.ts) and the appearance
  // save shape (bodyArchetype / hairStyle / clothing.{top,bottom,boots}.kind /
  // facial.jawShape, plus hat / accessory / cape / carry layers). NO synthetic
  // names, NO fabricated prices — these are the free, always-renderable base
  // set. Deterministic: the lists are fixed enums, returned in a stable order.
  //
  // Source of truth (mirrored, kept in sync):
  //   BodyArchetype          character-schema.ts:61
  //   HairStyle              character-schema.ts:196
  //   FacialFeatures.jawShape character-schema.ts:214
  //   ClothingTopKind        character-schema.ts:226
  //   ClothingBottomKind     character-schema.ts:231
  //   ClothingKit.boots.kind  character-schema.ts:250
  //   ClothingHatKind        character-schema.ts:236
  //   Accessories.augments    character-schema.ts:262 (eye / arm chrome → "glasses"/"hand")
  //   ClothingKit.cape        character-schema.ts:246 (→ "back")
  //   Accessories.carry       character-schema.ts:260 (→ "hand")
  //   FITZPATRICK_SKIN        character-schema.ts:139 (skin tones)
  //   HAIR_PALETTE keys       character-schema.ts:155 (color swatches)
  register("appearance", "options", async (ctx) => {
    // Humanize an enum value: 'synth-jacket' / 'left-arm' → 'Synth Jacket' / 'Left Arm'.
    const humanize = (v) =>
      String(v)
        .split(/[-_]/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");
    const opt = (assetId, extra) => ({ assetId, name: humanize(assetId), ...(extra || {}) });
    const slot = (vals) => vals.map((v) => opt(v));

    // Renderable enums (mirror of character-schema.ts — every value is real).
    const BODY = ["slim", "average", "stocky", "tall", "broad", "petite", "legend"];
    const HAIR = [
      "bald", "shaved", "short", "medium", "long", "ponytail", "bun",
      "braids", "locs", "dreads", "mohawk", "topknot", "undercut",
    ];
    const FACE = ["round", "square", "pointed", "soft"]; // jawShape
    const TOP = [
      "shirt", "vest", "coat", "robe", "apron", "tunic", "jacket", "trench",
      "breastplate", "synth-jacket", "cassock", "kanga", "duster", "cape",
    ];
    const BOTTOM = [
      "pants", "skirt", "shorts", "robe", "trousers", "kilt", "leggings",
      "sarong", "cargo", "leather-pants", "breeches",
    ];
    const SHOES = ["sandal", "boot", "greaves", "barefoot"]; // boots.kind
    const HAT = [
      "cap", "tophat", "beret", "hood", "helmet", "fedora", "turban",
      "circlet", "wreath", "visor", "goggle", "crown", "horned-helm",
    ];
    // "Glasses" maps to the renderer's eye-region cosmetics: visor/goggle hats
    // worn over the eyes + the eye-augment material set (chrome/matte/gold).
    const GLASSES = ["visor", "goggle", "eye-chrome", "eye-matte-black", "eye-gold"];
    // "Back" maps to the cape layer (ClothingKit.cape + pattern).
    const BACK = ["cape-plain", "cape-striped", "cape-glyph"];
    // "Hand" maps to the visible carried-prop layer (Accessories.carry) + the
    // arm-augment material set (chrome arm etc.).
    const HAND = [
      "sword", "staff", "pistol", "rifle", "bow", "satchel", "tome",
      "tool-belt", "pouch", "arm-chrome", "arm-matte-black", "arm-gold",
    ];
    // "Particle" maps to the marking/aura emissive set the renderer honors —
    // markings.kind + the emissive-glyph PBR material.
    const PARTICLE = ["tattoo", "scar-pattern", "paint", "glyph"];

    // Real skin tones — the Fitzpatrick I–VI variants the renderer resolves
    // (FITZPATRICK_SKIN in character-schema.ts). These ARE colors, so they
    // carry a `color` hex swatch.
    const SKIN_TONES = [
      ["pale-cool", "#f6dabb"], ["pale-warm", "#fadec7"],
      ["fair-cool", "#e8beac"], ["fair-warm", "#f0c8b6"],
      ["olive-cool", "#d3a18f"], ["olive-warm", "#cf8e74"],
      ["tan-cool", "#bd8d74"], ["tan-warm", "#c89878"],
      ["brown-cool", "#815c49"], ["brown-warm", "#8d6a52"],
      ["dark-brown-cool", "#4d332d"], ["dark-brown-warm", "#5a3d30"],
    ].map(([assetId, color]) => ({ assetId, name: humanize(assetId), color }));

    // Hair / clothing color swatches — the modal hex of each HAIR_PALETTE key.
    const COLORS = [
      ["black", "#1a1410"], ["dark-brown", "#3d2818"], ["brown", "#6a4828"],
      ["light-brown", "#9a7048"], ["blonde", "#c8a070"], ["light-blonde", "#e8d4a8"],
      ["red", "#a04018"], ["silver", "#c8c8c8"], ["cyber-magenta", "#ff2bd5"],
      ["cyber-cyan", "#30e8ff"], ["drift-violet", "#a060ff"], ["bloodline-red", "#c83020"],
    ].map(([assetId, color]) => ({ assetId, name: humanize(assetId), color }));

    // Optionally fold in the player's saved/owned cosmetics. These are REAL
    // user-authored outfits (saved_outfits, mig 221), surfaced as owned. No
    // fabricated prices — owned items are marked owned:true. Best-effort; a DB
    // without the table degrades to the base set above.
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    const savedOutfits = [];
    if (db && userId) {
      try {
        const rows = db.prepare(
          `SELECT id, name FROM saved_outfits WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`,
        ).all(userId);
        for (const r of rows) {
          savedOutfits.push({ assetId: r.id, name: r.name, owned: true });
        }
      } catch { /* table optional */ }
    }

    return {
      ok: true,
      slots: {
        body: slot(BODY),
        hair: slot(HAIR),
        face: slot(FACE),
        top: slot(TOP),
        bottom: slot(BOTTOM),
        shoes: slot(SHOES),
        hat: slot(HAT),
        glasses: slot(GLASSES),
        back: slot(BACK),
        hand: slot(HAND),
        particle: slot(PARTICLE),
      },
      skinTones: SKIN_TONES,
      colors: COLORS,
      savedOutfits,
    };
  }, {
    note: "Real per-slot avatar appearance catalog — every option is a renderable enum honored by character-schema.ts / the procedural mesh builder. No fabricated prices; base options are free/owned.",
  });

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
