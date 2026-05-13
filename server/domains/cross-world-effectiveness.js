// server/domains/cross-world-effectiveness.js
//
// Surfaces the cross-world skill effectiveness layer to the frontend.
//
// Two macros (both safe for publicReadDomains — no DB writes):
//
//   cross_world_effectiveness.explain
//     Input: { domain, worldId, level?, maxLevel? }
//     Returns: { domain, worldId, level, affinity, floor, multiplier,
//                dominant, note }
//     Used by the per-world HUD chip: "Your magic is dampened here (15%)".
//
//   cross_world_effectiveness.for_player
//     Input: { worldId }   (resolves userId from ctx.actor)
//     Returns: per-domain row [{ domain, level, multiplier, note }]
//     Used by the "skills in this world" lens widget — gives the player
//     a snapshot of how every skill they have performs in the current
//     world. Lets them decide what to lead with.

import {
  effectivenessMultiplier,
  explainEffectiveness,
  getWorldMeta,
} from "../lib/cross-world-effectiveness.js";
import { SKILL_DOMAINS } from "../lib/skill-domains.js";
import {
  availabilityForMaterial,
  classifyAvailability,
  materialForSkill,
  MATERIAL_KINDS,
} from "../lib/embodied/material-availability.js";

export default function registerCrossWorldEffectivenessMacros(register) {
  register("cross_world_effectiveness", "explain", async (ctx, input = {}) => {
    const { domain, worldId, level = 1, maxLevel = 100 } = input || {};
    if (!domain || !worldId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, ...explainEffectiveness({ domain, worldId, level, maxLevel }) };
  }, { note: "Diagnostic for a single (domain, world, level) triple. Returns dialogue-ready 'note' string." });

  register("cross_world_effectiveness", "for_player", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const { worldId, maxLevel = 100 } = input || {};
    if (!worldId) return { ok: false, reason: "missing_worldId" };

    const meta = getWorldMeta(worldId);
    if (!meta) return { ok: true, worldId, worldKnown: false, rows: [] };

    // Pull every skill the player has, even at low level. The HUD wants
    // to show "your hacking is dampened here" even if you only have 5
    // points in hacking — that's the user-visible feedback loop.
    let skillRows = [];
    try {
      skillRows = db.prepare(`
        SELECT skill_type AS domain, MAX(level) AS level
        FROM player_skill_levels WHERE user_id = ?
        GROUP BY skill_type
      `).all(userId);
    } catch {
      skillRows = [];
    }

    const rows = skillRows
      .filter(r => r.domain && r.level > 0)
      .map(r => {
        const ex = explainEffectiveness({
          domain: r.domain, worldId, level: r.level, maxLevel,
        });
        const materialKind = materialForSkill(r.domain);
        const materialAvailability = materialKind ? availabilityForMaterial(worldId, materialKind) : 1.0;
        return {
          domain: r.domain,
          level: r.level,
          multiplier: ex.multiplier,
          affinity: ex.affinity,
          floor: ex.floor,
          dominant: ex.dominant,
          note: ex.note,
          materialKind,
          materialAvailability,
          materialTier: materialKind ? classifyAvailability(materialAvailability) : "abundant",
        };
      })
      .sort((a, b) => b.multiplier - a.multiplier);

    // Material map snapshot — every declared kind for the HUD's
    // material readout. Worlds that haven't declared availability use
    // defaults (ballistic_ammo=1.0 / others 0.5).
    const materials = {};
    for (const kind of MATERIAL_KINDS) {
      const v = availabilityForMaterial(worldId, kind);
      materials[kind] = { value: v, tier: classifyAvailability(v) };
    }

    return {
      ok: true,
      worldId,
      worldKnown: true,
      worldDescription: meta.description || null,
      rows,
      materials,
      // Convenience: the strongest + weakest domains in this world so
      // the HUD can highlight them.
      strongest: rows[0] || null,
      weakest: rows[rows.length - 1] || null,
    };
  }, { note: "Per-domain potency snapshot for the player in the given world, plus per-world material availability." });

  register("cross_world_effectiveness", "list_domains", async () => {
    return { ok: true, domains: SKILL_DOMAINS };
  }, { note: "Canonical skill domain registry." });

  // Silence unused-import lint by referencing effectivenessMultiplier
  // (re-exported for any future caller that wants the raw number).
  void effectivenessMultiplier;
}
