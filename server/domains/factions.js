// server/domains/factions.js
//
// Sprint D / V1 — macro surface for faction visual data.
// useFactionTheme hook on the frontend calls factions.visual.

import { getAuthoredFaction, _authoredFactions } from "../lib/content-seeder.js";

export default function registerFactionsMacros(register) {
  /**
   * factions.visual — return the visual block for a faction.
   * input: { factionId }
   */
  register("factions", "visual", async (_ctx, input = {}) => {
    if (!input.factionId) return { ok: false, reason: "missing_factionId" };
    const f = getAuthoredFaction(input.factionId);
    if (!f) return { ok: false, reason: "faction_not_found" };
    return { ok: true, factionId: f.id, visual: f.visual ?? null };
  }, { note: "faction visual block (V1)" });

  /**
   * factions.list_with_visual — return id + name + visual for every faction.
   */
  register("factions", "list_with_visual", async () => {
    const out = [];
    for (const f of _authoredFactions.values()) {
      out.push({ id: f.id, name: f.name, visual: f.visual ?? null });
    }
    return { ok: true, factions: out };
  });
}
