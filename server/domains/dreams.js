// server/domains/dreams.js
//
// Phase 7 — surfaces the dream-engine + forward-sim substrates so the
// world HUD can show the player what their subconscious has been doing
// while they were offline.
//
// Two macros (read-only, scoped to actor.userId):
//
//   dreams.recent
//     Input:  { limit? }
//     Returns: { ok, dreams: [{ id, dream_dtu_id, fragment_count,
//                composer, composed_at, dtu? }] }
//     Each row pulls the dream DTU so the HUD can render the prose.
//
//   dreams.predictions
//     Input:  { worldId?, limit? }
//     Returns: { ok, predictions: [{ id, subject_kind, subject_id,
//                anticipated, confidence, composer, composed_at,
//                expires_at }] }

import { getRecentDreams } from "../lib/embodied/dream-engine.js";
import { getActivePredictions } from "../lib/embodied/forward-sim.js";

export default function registerDreamsMacros(register) {
  register("dreams", "recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 10));
    const rows = getRecentDreams(db, userId, limit);
    // Hydrate each dream DTU's data field so the HUD can render prose.
    const dreams = rows.map((d) => {
      let dtu = null;
      try {
        const r = db.prepare(`SELECT id, title, data FROM dtus WHERE id = ?`).get(d.dream_dtu_id);
        if (r) {
          let data = r.data;
          if (typeof data === "string") {
            try { data = JSON.parse(data); } catch { /* leave string */ }
          }
          dtu = { id: r.id, title: r.title, data };
        }
      } catch { /* dtu absent */ }
      return { ...d, dtu };
    });
    return { ok: true, count: dreams.length, dreams };
  }, { note: "Recent dream compositions (one per offline pass, ~6h cooldown). Each row carries the dream DTU for rendering." });

  register("dreams", "predictions", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 10));
    let predictions = getActivePredictions(db, userId, limit);
    if (input?.worldId) {
      predictions = predictions.filter((p) => !p.world_id || p.world_id === input.worldId);
    }
    return { ok: true, count: predictions.length, predictions };
  }, { note: "Active (non-realised, non-expired) forward-sim predictions for the auth'd player." });
}
