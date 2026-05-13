// server/domains/realm-council.js
//
// Concordia Phase 16 — realm council macros. (Distinct from the
// existing server/domains/council.js which scores Council Brain
// proposals; this surface is per-realm seasonal council sessions for
// the player-experience layer.)
//
// Macros (all under domain "realm_council"):
//   open_session / close_session / submit_petition / list_petitions /
//   cast_vote / tally / lobby / open_sessions

import {
  openSession,
  closeSession,
  submitPetition,
  listPetitions,
  castVote,
  tallyVotes,
  playerLobby,
  listOpenSessions,
} from "../lib/council-engine.js";

export default function registerRealmCouncilMacros(register) {
  register("realm_council", "open_session", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const realmId = String(input?.realmId || "").trim();
    const seasonId = Number(input?.seasonId);
    const year = Number(input?.year) || 1;
    if (!realmId || !Number.isFinite(seasonId)) return { ok: false, reason: "missing_inputs" };
    return openSession(db, realmId, seasonId, year);
  });

  register("realm_council", "close_session", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sessionId = String(input?.sessionId || "").trim();
    if (!sessionId) return { ok: false, reason: "missing_inputs" };
    return closeSession(db, sessionId);
  });

  register("realm_council", "submit_petition", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const sessionId = String(input?.sessionId || "").trim();
    const topic = String(input?.topic || "").trim();
    if (!sessionId || !topic) return { ok: false, reason: "missing_inputs" };
    return submitPetition(db, sessionId, { kind: "player", id: userId }, topic, input?.body || null);
  });

  register("realm_council", "list_petitions", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sessionId = String(input?.sessionId || "").trim();
    if (!sessionId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, petitions: listPetitions(db, sessionId) };
  });

  register("realm_council", "cast_vote", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const petitionId = String(input?.petitionId || "").trim();
    const memberId = String(input?.memberId || "").trim();
    const vote = String(input?.vote || "").trim();
    if (!petitionId || !memberId || !vote) return { ok: false, reason: "missing_inputs" };
    return castVote(db, petitionId, memberId, vote);
  });

  register("realm_council", "tally", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const petitionId = String(input?.petitionId || "").trim();
    if (!petitionId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, ...tallyVotes(db, petitionId) };
  });

  register("realm_council", "lobby", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const sessionId = String(input?.sessionId || "").trim();
    const memberNpcId = String(input?.memberNpcId || "").trim();
    const delta = Number(input?.delta) || 5;
    if (!sessionId || !memberNpcId) return { ok: false, reason: "missing_inputs" };
    return playerLobby(db, sessionId, userId, memberNpcId, delta);
  });

  register("realm_council", "open_sessions", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, sessions: listOpenSessions(db, input?.realmId ? String(input.realmId) : null) };
  });
}
