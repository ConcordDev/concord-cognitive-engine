// server/domains/seasons.js
//
// Dead-macro-call fix (verification-audit campaign): the world lens's
// SeasonalEffects.tsx called domain:'seasons', name:'current' — never
// registered anywhere, guaranteed unknown_macro. The season substrate
// (server/lib/seasons.js, Phase 5c) already tracks per-world season state
// in world_seasons; this is a thin read that reuses the same idempotent
// advanceSeasonForWorld() the season-cycle heartbeat calls (safe to call
// from a read path — it only writes when a wall-clock boundary was
// actually crossed since the last check).

import { advanceSeasonForWorld, SEASONS, SEASON_NODE_YIELD_MULT } from "../lib/seasons.js";

export default function registerSeasonsActions(registerLensAction) {
  registerLensAction("seasons", "current", (ctx, _artifact, params = {}) => {
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    const r = advanceSeasonForWorld(ctx.db, worldId);
    if (!r.ok) return r;
    return { ok: true, result: { season: r.season, year: r.year, transitioned: r.transitioned, narrative: r.narrative } };
  });

  // The authored 42-day Concordia year: 6 seasons × 7 days, each with its
  // climate biases + per-resource gather-yield multipliers. Pure catalog
  // read from the same lib the season-cycle heartbeat runs on — no DB.
  registerLensAction("seasons", "calendar", () => {
    return {
      ok: true,
      result: {
        seasons: SEASONS.map((s) => ({ ...s, yieldMultipliers: SEASON_NODE_YIELD_MULT[s.name] || null })),
        seasonLengthDays: 7,
        yearLengthDays: SEASONS.length * 7,
      },
    };
  });
}
