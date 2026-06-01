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
import { spendSlots, canAfford, slotsUsed, currentDayIdx, dayState } from "../lib/day-clock.js";
import { gatherAttendees, GATHERING_KINDS } from "../lib/social-gatherings.js";

function enabled() { return process.env.CONCORD_SOCIAL_LIFE !== "0"; }
function socialEventsEnabled() { return process.env.CONCORD_SOCIAL_EVENTS !== "0"; }
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
      // Day-clock: every life verb costs a finite daily slot (the viability cone
      // over time). Check affordability FIRST (block a full day); only spend a
      // slot on a SUCCESSFUL beat — a cooldown'd/failed verb wastes nothing.
      const day = currentDayIdx();
      if (!canAfford(verb, slotsUsed(ctx.db, uid, day))) return { ok: false, reason: "day_full", daySlotsRemaining: 0 };
      const res = await performDailyVerb(ctx.db, {
        userId: uid, verb,
        partnerKind: input.partnerKind || "npc",
        partnerId: input.partnerId,
        worldId: input.worldId || "concordia-hub",
      });
      if (res && res.ok) {
        const slot = spendSlots(ctx.db, uid, day, verb);
        return { ...res, daySlotsRemaining: slot.remaining };
      }
      return res; // verb failed (cooldown, etc.) — no slot consumed
    }, { note: `slice-of-life: ${verb} (costs a day-clock slot)` });
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

  register("daily_life", "day", async (ctx, _input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return { ok: true, ...dayState(ctx.db, uid, currentDayIdx()) };
  }, { note: "slice-of-life: today's slot budget + allocation (read)" });

  // SL5 — social gathering composer. Pulls the live relationship web (courtship,
  // family, grudges) into an attendee list + beats for a wedding / funeral /
  // festival. Read-only (composes the beats; the caller fires grief separately
  // when triggersGrief). Behind CONCORD_SOCIAL_EVENTS.
  register("daily_life", "gather", async (ctx, input = {}) => {
    if (!socialEventsEnabled()) return { ok: false, reason: "disabled" };
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    const uid = authed(ctx);
    const kind = GATHERING_KINDS.includes(input.kind) ? input.kind : "festival";
    // Default the focal to the calling player; allow an explicit NPC/player focal.
    const focalKind = input.focalKind === "npc" ? "npc" : (input.focalKind === "player" ? "player" : (uid ? "player" : "npc"));
    const focalId = input.focalId || (focalKind === "player" ? uid : null);
    if (!focalId) return { ok: false, reason: "focal_required" };
    const composed = gatherAttendees(ctx.db, { kind, focalKind, focalId });
    return { ok: true, ...composed };
  }, { note: "slice-of-life: compose a wedding/funeral/festival from live relations (read)" });
}
