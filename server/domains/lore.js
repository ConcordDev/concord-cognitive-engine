// server/domains/lore.js
//
// Wave 8b — the authored-cosmology read surface (the codex backend).
//
// list   — browse/filter the authored canon (hidden_truth stripped).
// get    — a single authored event by id.
// facets — distinct world/type/era values for the codex filter UI.
// spine  — the Pillars/Pantheon cosmology events (codex header + goddess ground).
//
// All public-read: the authored lore is the player-facing canon. The author-only
// `hidden_truth` is stripped in lib/authored-lore.js, never served here.

import {
  listAuthoredLore, getAuthoredLore, authoredLoreFacets, cosmologySpine,
} from "../lib/authored-lore.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) BEFORE it can
// silently clamp through the lib's Math.max/min bounds. An absent field is fine
// (the macro uses its default). Returns null when clean, or the offending key.
// Copied from the literary domain — the fail-CLOSED contract the macro-assassin
// V2 vectors probe.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerLoreMacros(register) {
  register("lore", "list", async (_ctx, input = {}) => {
    const bad = badNumericField(input, ["limit"]);
    if (bad) return { ok: false, reason: `invalid_${bad}` };
    return {
      ok: true,
      events: listAuthoredLore({
        worldId: input.worldId || undefined,
        type: input.type || undefined,
        era: input.era || undefined,
        q: input.q || undefined,
        limit: input.limit,
      }),
    };
  }, { note: "browse the authored cosmology canon (hidden_truth stripped)" });

  register("lore", "get", async (_ctx, input = {}) => {
    if (!input.id) return { ok: false, reason: "missing_id" };
    const event = getAuthoredLore(input.id);
    if (!event) return { ok: false, reason: "unknown_event" };
    return { ok: true, event };
  }, { note: "single authored lore event by id" });

  register("lore", "facets", async () => {
    return { ok: true, facets: authoredLoreFacets() };
  }, { note: "distinct world/type/era values for the codex filters" });

  register("lore", "spine", async () => {
    return { ok: true, events: cosmologySpine() };
  }, { note: "the Pillars/Pantheon cosmology events" });
}
