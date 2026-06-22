// server/lib/contribution-quests.js
//
// Contribution Quests (#36) — quests whose completion is VERIFIABLE real
// contribution: author N DTUs in a target lens after the quest opens. Progress
// is MEASURED from the dtus table (never self-reported), so it can't be gamed by
// claiming work you didn't do. On completion the sponsor's reward becomes
// claimable, minted through the existing earned-CC path (mintCoins), idempotent
// on a per-(quest,user) refId. Pure bounded reads (one COUNT per progress
// check); the reward mint is best-effort and guarded so the quest layer works
// even before the treasury is initialised.

import { mintCoins } from "../economy/coin-service.js";

let _idc = 0;
function cqId(p) { return `${p}_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/** Sponsor opens a contribution quest. Returns { ok, questId }. */
export function createContributionQuest(db, { sponsorId, title, targetLens, targetCount = 1, rewardCc = 0, startTs = null } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const sid = String(sponsorId || "");
  if (!sid || !title || !targetLens) return { ok: false, reason: "missing_fields" };
  const tc = Math.min(Math.max(Number(targetCount) || 1, 1), 10000);
  const reward = Math.max(Number(rewardCc) || 0, 0);
  const start = Number(startTs) || Math.floor(Date.now() / 1000);
  const id = cqId("cq");
  try {
    db.prepare(`INSERT INTO contribution_quests (id, sponsor_id, title, target_lens, target_count, reward_cc, start_ts) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sid, title, String(targetLens), tc, reward, start);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, questId: id };
}

/** Count a user's REAL DTUs in the quest's target lens authored at/after start. */
export function measureContribution(db, quest, userId) {
  try {
    // dtus.created_at is an ISO string; compare via unixepoch() for the start gate.
    return db.prepare(
      `SELECT COUNT(*) AS n FROM dtus WHERE creator_id = ? AND lens_id = ? AND unixepoch(created_at) >= ?`
    ).get(String(userId || ""), quest.target_lens, quest.start_ts).n || 0;
  } catch {
    return 0;
  }
}

/** Recompute a user's progress on a quest from real activity. Returns { ok, contributed, completed }. */
export function refreshProgress(db, questId, userId) {
  if (!db) return { ok: false, reason: "no_db" };
  const quest = db.prepare(`SELECT * FROM contribution_quests WHERE id = ?`).get(questId);
  if (!quest) return { ok: false, reason: "quest_not_found" };
  const uid = String(userId || "");
  if (!uid) return { ok: false, reason: "no_user" };
  const contributed = measureContribution(db, quest, uid);
  const completed = contributed >= quest.target_count;
  try {
    const existing = db.prepare(`SELECT completed_at FROM contribution_quest_claims WHERE quest_id = ? AND user_id = ?`).get(questId, uid);
    const completedAt = completed ? (existing?.completed_at || Math.floor(Date.now() / 1000)) : null;
    db.prepare(`
      INSERT INTO contribution_quest_claims (quest_id, user_id, contributed, completed_at, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(quest_id, user_id) DO UPDATE SET contributed = excluded.contributed, completed_at = excluded.completed_at, updated_at = unixepoch()
    `).run(questId, uid, contributed, completedAt);
  } catch (e) {
    return { ok: false, reason: "update_failed", error: String(e?.message || e) };
  }
  return { ok: true, contributed, target: quest.target_count, completed };
}

/**
 * Claim the reward once the quest is complete. Idempotent: a second call returns
 * already_claimed. The CC mint is best-effort — if the treasury isn't ready the
 * claim is still recorded (reward_minted=0) so it can be reconciled later.
 */
export function claimReward(db, questId, userId) {
  if (!db) return { ok: false, reason: "no_db" };
  const quest = db.prepare(`SELECT * FROM contribution_quests WHERE id = ?`).get(questId);
  if (!quest) return { ok: false, reason: "quest_not_found" };
  const uid = String(userId || "");
  // Always refresh from real activity first so claims reflect truth.
  refreshProgress(db, questId, uid);
  const claim = db.prepare(`SELECT * FROM contribution_quest_claims WHERE quest_id = ? AND user_id = ?`).get(questId, uid);
  if (!claim?.completed_at) return { ok: false, reason: "not_completed", contributed: claim?.contributed || 0, target: quest.target_count };
  if (claim.reward_claimed_at) return { ok: true, alreadyClaimed: true, rewardCc: quest.reward_cc, minted: !!claim.reward_minted };

  let minted = false;
  if (quest.reward_cc > 0) {
    try {
      const r = mintCoins(db, { amount: quest.reward_cc, userId: uid, refId: `contrib_quest:${questId}:${uid}` });
      minted = !!r?.ok;
    } catch { minted = false; }
  }
  try {
    db.prepare(`UPDATE contribution_quest_claims SET reward_claimed_at = unixepoch(), reward_minted = ?, updated_at = unixepoch() WHERE quest_id = ? AND user_id = ?`)
      .run(minted ? 1 : 0, questId, uid);
  } catch (e) {
    return { ok: false, reason: "claim_failed", error: String(e?.message || e) };
  }
  return { ok: true, rewardCc: quest.reward_cc, minted };
}

/** List open quests (optionally filtered by lens). */
export function listOpenQuests(db, { targetLens = null, limit = 50 } = {}) {
  if (!db) return [];
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  try {
    if (targetLens) {
      return db.prepare(`SELECT id, sponsor_id AS sponsorId, title, target_lens AS targetLens, target_count AS targetCount, reward_cc AS rewardCc FROM contribution_quests WHERE status = 'open' AND target_lens = ? ORDER BY created_at DESC LIMIT ?`).all(String(targetLens), lim);
    }
    return db.prepare(`SELECT id, sponsor_id AS sponsorId, title, target_lens AS targetLens, target_count AS targetCount, reward_cc AS rewardCc FROM contribution_quests WHERE status = 'open' ORDER BY created_at DESC LIMIT ?`).all(lim);
  } catch {
    return [];
  }
}

/** A user's progress across the quests they've touched. */
export function getQuestProgress(db, userId, { limit = 50 } = {}) {
  if (!db || !userId) return [];
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  try {
    return db.prepare(`
      SELECT c.quest_id AS questId, q.title, q.target_count AS target, c.contributed,
             c.completed_at AS completedAt, c.reward_claimed_at AS claimedAt, q.reward_cc AS rewardCc
      FROM contribution_quest_claims c JOIN contribution_quests q ON q.id = c.quest_id
      WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ?
    `).all(String(userId), lim);
  } catch {
    return [];
  }
}

export default { createContributionQuest, measureContribution, refreshProgress, claimReward, listOpenQuests, getQuestProgress };
