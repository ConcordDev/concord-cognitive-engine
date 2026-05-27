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

export default function registerRomanceMacros(register) {
  register("romance", "court", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return courtInteraction(db, userId, String(input?.partnerKind || "npc"), String(input?.partnerId || ""), input?.sentiment);
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

  register("romance", "constants", async () => {
    return { ok: true, constants: ROMANCE_CONSTANTS };
  });
}
