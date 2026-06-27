// server/domains/courtship.js
//
// Macro surface for the courtship / romance / dynasty loop, named to match
// the `/lenses/courtship` lens + its `lens.courtship.*` manifest entry.
//
// This is a THIN delegation layer over the real engine
// (server/lib/romance-engine.js) and the spouse-reactivity lib — it adds NO
// gameplay logic of its own. The affinity math, propose/wed thresholds,
// marriage transaction, pregnancy/birth/inheritance and spouse-reactivity all
// live in the lib; this file only adapts (ctx, input) → lib calls and pins the
// auth/db guards. The sibling `romance` domain (server/domains/romance.js)
// surfaces the same lib for back-compat; both delegate to one source of truth.

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
  ROMANCE_CONSTANTS,
} from "../lib/romance-engine.js";
import { reactToPlayerEvent, getSpouses } from "../lib/spouse-reactivity.js";

const PARTNER_KINDS = new Set(["player", "npc"]);

function partnerKindOf(input) {
  const k = String(input?.partnerKind || "npc");
  return PARTNER_KINDS.has(k) ? k : "npc";
}

// `sentiment` is a bounded affinity nudge in [-1, 1] — negatives are VALID
// (a cold/hostile interaction), so the generic "reject negative" guard does
// NOT apply. Reject only a poisoned value (NaN/±Infinity/1e308) or one outside
// the declared range. Absent is fine (the lib applies a neutral default).
// Returns true when the passed sentiment is unusable. Fail-CLOSED.
function badSentiment(input) {
  if (input?.sentiment === undefined || input?.sentiment === null) return false;
  const n = Number(input.sentiment);
  return !Number.isFinite(n) || n < -1 || n > 1;
}

export default function registerCourtshipMacros(register) {
  /**
   * courtship.list — the player's active courtships (read).
   * input: { status? }
   */
  register("courtship", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const status = input?.status ? String(input.status) : null;
    return { ok: true, courtships: listMyCourtships(db, userId, status) };
  }, { note: "list the player's courtships (acquainted → married)" });

  /**
   * courtship.get — a single courtship row for one partner (read).
   * input: { partnerKind?, partnerId }
   */
  register("courtship", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.partnerId) return { ok: false, reason: "missing_inputs" };
    const c = getCourtship(db, userId, partnerKindOf(input), String(input.partnerId));
    if (!c) return { ok: false, reason: "no_courtship" };
    return { ok: true, courtship: c };
  }, { note: "fetch one courtship by partner" });

  /**
   * courtship.interact — a courting interaction; shifts affinity by the
   * lib's COURT_AFFINITY_DELTA × sentiment and may fire a heart-event scene.
   * input: { partnerKind?, partnerId, sentiment? }
   */
  register("courtship", "interact", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.partnerId) return { ok: false, reason: "missing_inputs" };
    if (badSentiment(input)) return { ok: false, reason: "invalid_sentiment" };
    return courtInteraction(db, userId, partnerKindOf(input), String(input.partnerId), input?.sentiment);
  }, { note: "courting interaction — shifts affinity" });

  /**
   * courtship.propose — engagement. Gated at ROMANCE_CONSTANTS.ENGAGE_THRESHOLD
   * by the lib (the canonical propose floor; the lens sources it from here).
   * input: { partnerKind?, partnerId }
   */
  register("courtship", "propose", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.partnerId) return { ok: false, reason: "missing_inputs" };
    return propose(db, userId, partnerKindOf(input), String(input.partnerId));
  }, { note: "propose engagement (gated at ENGAGE_THRESHOLD)" });

  /**
   * courtship.wed — marriage. Requires status 'engaged' AND affinity ≥
   * ROMANCE_CONSTANTS.MARRY_THRESHOLD; opens a single-tx marriage row.
   * input: { partnerKind?, partnerId }
   */
  register("courtship", "wed", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.partnerId) return { ok: false, reason: "missing_inputs" };
    return wed(db, userId, partnerKindOf(input), String(input.partnerId));
  }, { note: "wed an engaged partner (gated at MARRY_THRESHOLD)" });

  /**
   * courtship.marriages — the player's active (or all) marriages + children.
   * input: { activeOnly? }
   */
  register("courtship", "marriages", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return {
      ok: true,
      marriages: listMyMarriages(db, userId, input?.activeOnly !== false),
      children: listChildren(db, userId),
    };
  }, { note: "list the player's marriages + children" });

  /**
   * courtship.dissolve — end a marriage (estranged / widowed).
   * input: { marriageId, reason? }
   */
  register("courtship", "dissolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input?.marriageId) return { ok: false, reason: "missing_inputs" };
    return dissolveMarriage(db, String(input.marriageId), String(input?.reason || "estranged"));
  }, { note: "dissolve a marriage" });

  /**
   * courtship.conceive — start a pregnancy (requires an active marriage).
   * input: { partnerKind?, partnerId }
   */
  register("courtship", "conceive", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.partnerId) return { ok: false, reason: "missing_inputs" };
    return conceive(db, userId, partnerKindOf(input), String(input.partnerId));
  }, { note: "conceive (must be married)" });

  /**
   * courtship.birth — birth a child from a due pregnancy.
   * input: { pregnancyId, name?, parentSkills?, personality? }
   */
  register("courtship", "birth", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input?.pregnancyId) return { ok: false, reason: "missing_inputs" };
    return birthChild(db, String(input.pregnancyId), {
      name: input?.name,
      parentSkills: input?.parentSkills,
      personality: input?.personality,
    });
  }, { note: "birth a child from a due pregnancy" });

  /**
   * courtship.children — the player's children (read).
   */
  register("courtship", "children", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, children: listChildren(db, userId) };
  }, { note: "list the player's children" });

  /**
   * courtship.spouses — NPC spouses currently wed to the player (read).
   */
  register("courtship", "spouses", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, spouses: getSpouses(db, userId) };
  }, { note: "list the player's NPC spouses" });

  /**
   * courtship.spouse_react — drive a spouse's reaction to a player world-event
   * (faction_join / faction_betray / npc_killed / scheme_exposed / player_death).
   * input: { kind, factionId?, targetNpcId?, worldId? }
   */
  register("courtship", "spouse_react", async (ctx, input = {}) => {
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

  /**
   * courtship.constants — the canonical engine thresholds, so the lens (and
   * any other caller) sources the propose/marry floors from the backend
   * instead of hardcoding them.
   */
  register("courtship", "constants", async () => {
    return { ok: true, constants: ROMANCE_CONSTANTS };
  }, { note: "canonical romance thresholds (propose/marry floors)" });
}
