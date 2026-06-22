// server/domains/contrib.js
//
// Contribution Quests (#36) — macros over the verifiable-contribution quest
// substrate (lib/contribution-quests.js, mig 342). Progress is measured from
// real authored DTUs, so a quest can't be completed by claiming work you didn't
// do. Reward mints through the existing earned-CC path, idempotent.
//
// Registered from server.js: registerContribMacros(register).

import {
  createContributionQuest, refreshProgress, claimReward, listOpenQuests, getQuestProgress,
} from "../lib/contribution-quests.js";

export default function registerContribMacros(register) {
  register("contrib", "create", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const sponsorId = input.sponsorId || ctx?.actor?.userId;
    if (!sponsorId) return { ok: false, reason: "no_user" };
    return createContributionQuest(db, { sponsorId, title: input.title, targetLens: input.targetLens, targetCount: input.targetCount, rewardCc: input.rewardCc, startTs: input.startTs });
  }, { note: "open a contribution quest (author N DTUs in a target lens) (#36)" });

  register("contrib", "progress", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return refreshProgress(db, input.questId, userId);
  }, { note: "recompute a user's quest progress from real DTU activity (#36)" });

  register("contrib", "claim", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return claimReward(db, input.questId, userId);
  }, { note: "claim a completed contribution quest's reward (idempotent) (#36)" });

  register("contrib", "list", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, quests: listOpenQuests(db, { targetLens: input.targetLens, limit: input.limit }) };
  }, { note: "list open contribution quests (#36)" });

  register("contrib", "mine", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, progress: getQuestProgress(db, userId, { limit: input.limit }) };
  }, { note: "a user's contribution-quest progress (#36)" });
}
