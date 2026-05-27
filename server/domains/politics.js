// server/domains/politics.js
//
// Phase II Wave 22 — politics / elections domain macros.

import {
  openCycle,
  getCycle,
  listCyclesByWorld,
  advancePhase,
  declareCandidacy,
  withdrawCandidacy,
  listCandidatesInCycle,
  holdCampaignEvent,
  listCampaignEvents,
  castVote,
  tallyResults,
  certify,
  ELECTIONS_CONSTANTS,
} from "../lib/elections-engine.js";

export default function registerPoliticsMacros(register) {
  register("politics", "open_cycle", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      return openCycle(db, {
        worldId: input?.worldId,
        officeKind: input?.officeKind,
        seatLabel: input?.seatLabel,
      });
    } catch (err) {
      return { ok: false, reason: "invalid_input", message: err?.message || String(err) };
    }
  });

  register("politics", "get_cycle", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const c = getCycle(db, String(input?.cycleId || ""));
    if (!c) return { ok: false, reason: "cycle_not_found" };
    return { ok: true, cycle: c };
  });

  register("politics", "list_cycles", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, cycles: listCyclesByWorld(db, String(input?.worldId || ""), input?.phase || null) };
  });

  register("politics", "advance_phase", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return advancePhase(db, String(input?.cycleId || ""), String(input?.phase || ""));
  });

  register("politics", "declare_candidacy", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return declareCandidacy(db, {
      cycleId: String(input?.cycleId || ""),
      candidateKind: "player",
      candidateId: userId,
      platform: input?.platform,
    });
  });

  register("politics", "withdraw", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return withdrawCandidacy(db, String(input?.candidateId || ""));
  });

  register("politics", "candidates", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, candidates: listCandidatesInCycle(db, String(input?.cycleId || "")) };
  });

  register("politics", "campaign_event", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return holdCampaignEvent(db, String(input?.candidateId || ""), String(input?.eventKind || ""), input?.payload || {});
  });

  register("politics", "campaign_history", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, events: listCampaignEvents(db, String(input?.candidateId || ""), input?.limit) };
  });

  register("politics", "vote", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return castVote(db, {
      cycleId: String(input?.cycleId || ""),
      voterKind: "player",
      voterId: userId,
      candidateId: String(input?.candidateId || ""),
    });
  });

  register("politics", "tally", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return tallyResults(db, String(input?.cycleId || ""));
  });

  register("politics", "certify", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return certify(db, String(input?.cycleId || ""));
  });

  register("politics", "constants", async () => {
    return { ok: true, constants: ELECTIONS_CONSTANTS };
  });
}
