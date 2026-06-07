// server/domains/crime.js
//
// Phase II Wave 23 — crime depth domain macros.

import {
  recordCrime, resolveCrime, listWanted,
  issueBounty, claimBounty, cancelBounty, listBountiesOnTarget,
  stakeGangTerritory, advanceTerritoryControl, listTerritoriesInWorld,
  planHeist, executeHeist, listMyHeists,
  CRIME_CONSTANTS,
} from "../lib/crime-engine.js";

export default function registerCrimeMacros(register) {
  register("crime", "record", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return recordCrime(db, { ...input, perpetratorUserId: userId });
  });

  register("crime", "resolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return resolveCrime(db, String(input?.crimeId || ""), String(input?.resolution || ""));
  });

  register("crime", "wanted", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, wanted: listWanted(db, { worldId: input?.worldId }) };
  });

  register("crime", "issue_bounty", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return issueBounty(db, {
      targetKind: input?.targetKind, targetId: input?.targetId,
      issuedByKind: "player", issuedById: userId,
      amountCents: input?.amountCents, reason: input?.reason,
    });
  });

  register("crime", "claim_bounty", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return claimBounty(db, String(input?.bountyId || ""), userId);
  });

  register("crime", "cancel_bounty", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return cancelBounty(db, String(input?.bountyId || ""), userId);
  });

  register("crime", "bounties_on", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, bounties: listBountiesOnTarget(db, String(input?.targetKind || "player"), String(input?.targetId || "")) };
  });

  register("crime", "stake_territory", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return stakeGangTerritory(db, input);
  });

  register("crime", "advance_control", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return advanceTerritoryControl(db, String(input?.territoryId || ""), Number(input?.delta) || 0);
  });

  register("crime", "territories", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, territories: listTerritoriesInWorld(db, String(input?.worldId || "")) };
  });

  register("crime", "plan_heist", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return planHeist(db, { ...input, plannerUserId: userId });
  });

  register("crime", "execute_heist", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return executeHeist(db, {
      heistId: input?.heistId,
      crewSkill: input?.crewSkill,
      rollOverride: input?.rollOverride,
      witnessRollOverride: input?.witnessRollOverride,
    });
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  register("crime", "my_heists", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, heists: listMyHeists(db, userId) };
  });

  register("crime", "constants", async () => {
    return { ok: true, constants: CRIME_CONSTANTS };
  });
}
