// server/lib/sub-world-starter-content.js
//
// Wave 4 gap-closure — a user-spawned sub-world's mirrored `worlds` row
// was a bare-minimum shell: default-empty `physics_modulators`/
// `rule_modulators` ('{}') and zero NPCs. A player who "Enter"s a freshly
// spawned sub-world landed in a blank Concordia instance that didn't read
// as a physics-sim/research-zone/substrate space matching the sub-world's
// declared `kind` at all — see docs/lens-specs/sub-worlds-capability-map.md
// ("Investigated and honestly deferred" → "the next real increment").
//
// This is a DELIBERATELY BOUNDED fix, not a new authoring pipeline: real
// per-kind physics/rule-modulator presets, plus a small (2 NPC) deterministic
// starter roster persisted through the SAME `world_npcs` write path real
// authored worlds use (`content-seeder.js#_persistAuthoredNpcToWorld`) — no
// factions, no quests, no lore. Closing the full "any sub-world could carry
// a full authored-content library" gap (per-`kind` `world_substrate_dtus`,
// routing the in-place block editor's terrain/prop/light blocks into the
// substrate, etc.) is real but larger ENGINEERING work, out of scope here.
//
// Both spawn paths that mirror a sub-world into the real `worlds` table
// call this so neither one is a bare shell:
//   - `server/domains/sub-worlds.js` `sub_worlds.spawn` (the live creator-
//     platform lens)
//   - `server.js` `sub_world.spawn_from_forge` (the legacy singular macro —
//     had the identical "never mirrors to `worlds`" defect PLUS never
//     mirrored at all; closed in the same pass since it's the same bug
//     pattern living on in dead-adjacent code)
//
// Every write here is best-effort (try/catch, never throws) — matching the
// existing mirror helpers' own honesty contract: a missing/minimal `worlds`
// or `world_npcs` table (unit tests, early boot) degrades to "the lens
// still works, the extra flavor just doesn't land."

import { _persistAuthoredNpcToWorld } from "./content-seeder.js";

// Presets keyed by the sub-worlds domain's own KINDS set
// (server/domains/sub-worlds.js) — physics_simulator / research_zone /
// concord_substrate. Values are intentionally modest: real numbers a
// world-builder would actually pick, not padding.
const KIND_PRESETS = {
  physics_simulator: {
    theme: "physics_sandbox",
    physics_modulators: { gravity: 9.8, friction: 0.6, restitution: 0.35 },
    rule_modulators: { theme: "physics_sandbox", combat_enabled: false, pvp_enabled: false },
    starterNpcs: [
      { suffix: "curator", name: "Sandbox Curator", archetype: "scholar", title: "Curator" },
      { suffix: "technician", name: "Rig Technician", archetype: "trader", title: "Technician" },
    ],
  },
  research_zone: {
    theme: "research_outpost",
    physics_modulators: { gravity: 9.8, friction: 0.8, restitution: 0.1 },
    rule_modulators: { theme: "research_outpost", combat_enabled: false, pvp_enabled: false },
    starterNpcs: [
      { suffix: "archivist", name: "Field Archivist", archetype: "scholar", title: "Archivist" },
      { suffix: "analyst", name: "Data Analyst", archetype: "scholar", title: "Analyst" },
    ],
  },
  concord_substrate: {
    theme: "concord_substrate",
    physics_modulators: { gravity: 9.8, friction: 0.7, restitution: 0.2 },
    rule_modulators: { theme: "concord_substrate", combat_enabled: true, pvp_enabled: false },
    starterNpcs: [
      { suffix: "warden", name: "Substrate Warden", archetype: "guard", title: "Warden" },
      { suffix: "seer", name: "Lattice Seer", archetype: "mystic", title: "Seer" },
    ],
  },
};

const DEFAULT_PRESET = KIND_PRESETS.physics_simulator;

/** The preset for a declared sub-world kind, falling back to the physics_simulator preset for an unknown/absent kind. */
export function presetForKind(kind) {
  return KIND_PRESETS[kind] || DEFAULT_PRESET;
}

/**
 * Apply kind-appropriate physics/rule modulators + a small deterministic
 * starter NPC roster to a just-mirrored `worlds` row. Call this ONCE, at
 * spawn time, after the bare `worlds` row insert — it is intentionally not
 * wired into `update_settings` (a later kind change re-theming/re-rostering
 * an already-visited world is a different, un-scoped decision; see the
 * capability map's "Deliberately not synced" precedent for `paused`).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ worldId: string, kind: string }} opts
 * @returns {{ ok: boolean, reason?: string, theme?: string, npcCount?: number }}
 */
export function seedSubWorldStarterContent(db, { worldId, kind } = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_db_or_world" };
  const preset = presetForKind(kind);

  try {
    db.prepare(`
      UPDATE worlds SET physics_modulators = ?, rule_modulators = ?
      WHERE id = ?
    `).run(
      JSON.stringify(preset.physics_modulators),
      JSON.stringify(preset.rule_modulators),
      worldId,
    );
  } catch (_e) { /* best-effort — matches the mirror helpers' own contract */ }

  let npcCount = 0;
  try {
    for (const starter of preset.starterNpcs) {
      // Deterministic per-world id so a re-run (e.g. a retried spawn) is
      // idempotent via _persistAuthoredNpcToWorld's own ON CONFLICT.
      const npc = {
        id: `${worldId}_npc_${starter.suffix}`,
        name: starter.name,
        title: starter.title,
        archetype: starter.archetype,
        world_id: worldId,
      };
      if (_persistAuthoredNpcToWorld(db, npc, worldId)) npcCount++;
    }
  } catch (_e) { /* best-effort */ }

  return { ok: true, theme: preset.theme, npcCount };
}
