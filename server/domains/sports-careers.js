// server/domains/sports-careers.js
//
// Phase II Wave 17 — sports careers + leagues domain macros.

import {
  openLeague, addTeam, addRosterMember, listTeamsInLeague,
  ensureCareer, requestTryout,
  scheduleMatch, playMatch, tickLeagues,
  advanceCareerStage, recordMatchOutcome, retireCareer,
  SPORTS_CONSTANTS,
} from "../lib/sports-league-engine.js";

export default function registerSportsMacros(register) {
  register("sports_careers", "open_league", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return openLeague(db, input);
  });

  register("sports_careers", "add_team", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return addTeam(db, String(input?.leagueId || ""), String(input?.name || ""), input?.powerScore);
  });

  register("sports_careers", "add_roster_member", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return addRosterMember(db, String(input?.teamId || ""), String(input?.memberKind || "npc"), String(input?.memberId || ""), input?.role);
  });

  register("sports_careers", "teams", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, teams: listTeamsInLeague(db, String(input?.leagueId || "")) };
  });

  register("sports_careers", "request_tryout", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return requestTryout(db, userId, String(input?.leagueId || ""), {
      athleticSkill: input?.athleticSkill,
      reflexSkill: input?.reflexSkill,
    });
  });

  register("sports_careers", "my_career", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const c = ensureCareer(db, userId, String(input?.sportKind || "basketball"));
    return { ok: true, career: c };
  });

  register("sports_careers", "schedule_match", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return scheduleMatch(db, String(input?.leagueId || ""), String(input?.homeTeamId || ""), String(input?.awayTeamId || ""), input?.scheduledAt);
  });

  register("sports_careers", "play_match", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return playMatch(db, String(input?.matchId || ""), { rollOverride: input?.rollOverride });
  });

  register("sports_careers", "tick", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return tickLeagues(db);
  });

  register("sports_careers", "advance_stage", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return advanceCareerStage(db, String(input?.careerId || ""));
  });

  register("sports_careers", "record_outcome", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return recordMatchOutcome(db, String(input?.careerId || ""), input?.points, !!input?.wonMvp);
  });

  register("sports_careers", "retire", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return retireCareer(db, String(input?.careerId || ""));
  });

  register("sports_careers", "constants", async () => {
    return { ok: true, constants: SPORTS_CONSTANTS };
  });
}
