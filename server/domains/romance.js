// server/domains/romance.js
//
// Phase II Wave 25 — romance / family / dynasty domain macros.

import {
  courtInteraction,
  getCourtship,
  listMyCourtships,
  propose,
  wed,
  dissolveMarriage,
  listMyMarriages,
  conceive,
  birthChild,
  listChildren,
  advanceChildMaturity,
  selectHeir,
  ROMANCE_CONSTANTS,
} from "../lib/romance-engine.js";
import { reactToPlayerEvent, getSpouses } from "../lib/spouse-reactivity.js";

export default function registerRomanceMacros(register) {
  register("romance", "court", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return courtInteraction(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""), input?.sentiment);
  });

  // F1.2 — gift system. Consume an inventory item and shift courtship affinity
  // by the NPC's reaction (loved/liked/neutral/disliked, derived from archetype
  // or an authored gift_preferences override).
  register("romance", "give_gift", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.npcId || !input?.itemId) return { ok: false, reason: "missing_inputs" };
    const { giveGift } = await import("../lib/gifting.js");
    return giveGift(db, {
      userId,
      npcId: String(input.npcId),
      itemId: String(input.itemId),
      worldId: input?.worldId ? String(input.worldId) : "concordia-hub",
    });
  });

  register("romance", "courtship", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const c = getCourtship(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""));
    if (!c) return { ok: false, reason: "no_courtship" };
    return { ok: true, courtship: c };
  });

  register("romance", "list_courtships", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, courtships: listMyCourtships(db, userId, input?.status || null) };
  });

  register("romance", "propose", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return propose(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""));
  });

  register("romance", "wed", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return wed(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""));
  });

  register("romance", "dissolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return dissolveMarriage(db, String(input?.marriageId || ""), String(input?.reason || "estranged"));
  });

  register("romance", "marriages", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, marriages: listMyMarriages(db, userId, input?.activeOnly !== false) };
  });

  register("romance", "conceive", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return conceive(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""));
  });

  register("romance", "birth", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return birthChild(db, String(input?.pregnancyId || ""), {
      name: input?.name,
      parentSkills: input?.parentSkills,
      personality: input?.personality,
    });
  });

  register("romance", "children", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, children: listChildren(db, userId) };
  });

  register("romance", "advance_maturity", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return advanceChildMaturity(db, String(input?.childId || ""));
  });

  register("romance", "select_heir", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input?.deceasedUserId
      ? String(input.deceasedUserId)
      : ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const heir = selectHeir(db, userId);
    if (!heir) return { ok: false, reason: "no_heir" };
    return { ok: true, heir };
  });

  // E4 — spouse reactivity. Trigger a spouse's reaction to a player event
  // (faction_join / faction_betray / npc_killed / scheme_exposed / player_death)
  // from quest scripting or a route. Returns the per-spouse affinity shifts.
  register("romance", "spouse_react", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const kind = String(input?.kind || "");
    if (!kind) return { ok: false, reason: "missing_kind" };
    return reactToPlayerEvent(db, userId, {
      kind,
      factionId: input?.factionId || null,
      targetNpcId: input?.targetNpcId || null,
      worldId: input?.worldId || null,
    });
  }, { note: "spouse reacts to a player faction/scheme/kill/death event" });

  register("romance", "spouses", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, spouses: getSpouses(db, userId) };
  });

  register("romance", "constants", async () => {
    return { ok: true, constants: ROMANCE_CONSTANTS };
  });
}
