// server/domains/daily-life.js
//
// Slice-of-Life SL1 macro surface — the player's everyday "living" verbs.
// (Domain is `daily_life`; `social` is already the social-media/feed lens.)
// Run via POST /api/lens/run. Gated behind CONCORD_SOCIAL_LIFE (off → disabled).
//
//   daily_life.hang_out / share_meal / go_drinking / spend_evening — affinity beats
//   daily_life.gift  — delegates to the existing gifting path (no duplicate logic)
//   daily_life.log   — recent beats + cooldowns (read)

import { performDailyVerb, getCooldown, SOCIAL_VERB_TUNING } from "../lib/social/daily-life.js";
import { giveGift } from "../lib/gifting.js";

function enabled() { return process.env.CONCORD_SOCIAL_LIFE === "1"; }
function gate(ctx) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!ctx?.db) return { ok: false, reason: "no_db" };
  return null;
}
function authed(ctx) { const u = ctx?.actor?.userId; return u ? String(u) : null; }

export default function registerDailyLifeMacros(register) {
  for (const verb of Object.keys(SOCIAL_VERB_TUNING)) {
    register("daily_life", verb, async (ctx, input = {}) => {
      const g = gate(ctx); if (g) return g;
      const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
      return performDailyVerb(ctx.db, {
        userId: uid, verb,
        partnerKind: input.partnerKind || "npc",
        partnerId: input.partnerId,
        worldId: input.worldId || "concordia-hub",
      });
    }, { note: `slice-of-life: ${verb}` });
  }

  register("daily_life", "gift", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return giveGift(ctx.db, { userId: uid, npcId: input.partnerId || input.npcId, itemId: input.itemId, worldId: input.worldId || "concordia-hub" });
  }, { note: "slice-of-life: gift (delegates to gifting)" });

  register("daily_life", "log", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const rows = ctx.db.prepare(`
      SELECT verb, partner_kind, partner_id, world_id, streak, at
      FROM player_social_log WHERE user_id=? ORDER BY at DESC LIMIT 50
    `).all(uid);
    const cooldowns = {};
    if (input.partnerId) {
      for (const v of Object.keys(SOCIAL_VERB_TUNING)) {
        cooldowns[v] = getCooldown(ctx.db, uid, v, input.partnerKind || "npc", input.partnerId);
      }
    }
    return { ok: true, log: rows, cooldowns };
  }, { note: "slice-of-life: recent beats + cooldowns (read)" });
}
