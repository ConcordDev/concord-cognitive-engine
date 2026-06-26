// server/lib/quests/quest-engine.js
// Quest state machine: objective progress, completion detection, reward distribution.

import crypto from 'node:crypto';
import { gainSkillXP } from '../skills/skill-engine.js';
import { grantUnlock } from '../milestone-unlocks.js';

/**
 * Return all active quests for a player in a world, with objectives and rewards attached.
 */
export function getActiveQuests(db, userId, worldId) {
  // pq.user_id IS the "accepted by" field — `user_id` was the column name
  // chosen at migration 068; the original query asked for a non-existent
  // `accepted_by` column and 500'd every /api/worlds/:id/quests/active hit.
  const rows = db.prepare(`
    SELECT q.*, pq.user_id AS accepted_by, pq.status, pq.completed_at
    FROM world_quests q
    JOIN player_quests pq ON pq.quest_id = q.id
    WHERE pq.user_id = ? AND pq.world_id = ? AND (pq.status IS NULL OR pq.status = 'active')
    LIMIT 20
  `).all(userId, worldId);

  return rows.map(q => ({
    ...q,
    objectives: db.prepare(
      'SELECT * FROM quest_objectives WHERE quest_id = ? ORDER BY order_index'
    ).all(q.id),
    rewards: db.prepare(
      'SELECT * FROM quest_rewards WHERE quest_id = ?'
    ).all(q.id),
  }));
}

/**
 * Return objective rows for a quest with current player progress merged in.
 */
export function getQuestProgress(db, userId, worldId, questId) {
  return db.prepare(`
    SELECT o.*,
           COALESCE(p.current_count, 0) as current_count,
           p.completed_at as obj_completed_at
    FROM quest_objectives o
    LEFT JOIN player_quest_progress p
      ON p.objective_id = o.id AND p.user_id = ? AND p.world_id = ?
    WHERE o.quest_id = ?
    ORDER BY o.order_index
  `).all(userId, worldId, questId);
}

/**
 * Record progress toward matching objectives across all active quests (or a specific quest).
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} worldId
 * @param {string|null} questId  — null = scan all active quests
 * @param {string} type          — 'kill' | 'gather' | 'talk_to' | 'deliver' | 'reach_location'
 * @param {string} target        — archetype / item type / npc_id / location
 * @param {number} count         — how many units to add (default 1)
 */
export function recordObjectiveProgress(db, userId, worldId, questId, type, target, count = 1) {
  let objectives;
  if (questId) {
    objectives = db.prepare(`
      SELECT o.* FROM quest_objectives o
      JOIN player_quests pq ON pq.quest_id = o.quest_id
      WHERE pq.user_id = ? AND pq.world_id = ?
        AND (pq.status IS NULL OR pq.status = 'active')
        AND o.quest_id = ? AND o.type = ? AND o.target = ?
    `).all(userId, worldId, questId, type, target);
  } else {
    objectives = db.prepare(`
      SELECT o.* FROM quest_objectives o
      JOIN player_quests pq ON pq.quest_id = o.quest_id
      WHERE pq.user_id = ? AND pq.world_id = ?
        AND (pq.status IS NULL OR pq.status = 'active')
        AND o.type = ? AND o.target = ?
    `).all(userId, worldId, type, target);
  }

  for (const obj of objectives) {
    const existing = db.prepare(`
      SELECT * FROM player_quest_progress
      WHERE user_id = ? AND world_id = ? AND quest_id = ? AND objective_id = ?
    `).get(userId, worldId, obj.quest_id, obj.id);

    if (existing?.completed_at) continue; // already done

    const newCount = (existing?.current_count ?? 0) + count;
    const capped = Math.min(newCount, obj.required_count);
    const completed = capped >= obj.required_count;
    const completedAt = completed ? Math.floor(Date.now() / 1000) : null;

    db.prepare(`
      INSERT INTO player_quest_progress
        (id, user_id, world_id, quest_id, objective_id, current_count, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, world_id, quest_id, objective_id)
      DO UPDATE SET current_count = ?, completed_at = ?
    `).run(
      crypto.randomUUID(), userId, worldId, obj.quest_id, obj.id, capped, completedAt,
      capped, completedAt,
    );

    if (completed) {
      checkQuestCompletion(db, userId, worldId, obj.quest_id);
    }
  }
}

/**
 * Check whether all objectives for a quest are complete.
 * If so, mark the quest as completed in player_quests.
 * Returns true if the quest just became complete.
 */
export function checkQuestCompletion(db, userId, worldId, questId) {
  const objectives = db.prepare(
    'SELECT id FROM quest_objectives WHERE quest_id = ?'
  ).all(questId);

  if (objectives.length === 0) return false;

  const doneCount = db.prepare(`
    SELECT COUNT(*) as c FROM player_quest_progress
    WHERE user_id = ? AND world_id = ? AND quest_id = ? AND completed_at IS NOT NULL
  `).get(userId, worldId, questId)?.c ?? 0;

  if (doneCount < objectives.length) return false;

  // All objectives done — mark quest complete
  db.prepare(`
    UPDATE player_quests
    SET status = 'completed', completed_at = unixepoch()
    WHERE user_id = ? AND world_id = ? AND quest_id = ?
      AND (status IS NULL OR status = 'active')
  `).run(userId, worldId, questId);

  return true;
}

/**
 * Claim rewards for a completed quest.
 * Returns { ok, rewards } on success or { ok: false, error } on failure.
 */
export function claimQuestRewards(db, userId, worldId, questId) {
  const pq = db.prepare(`
    SELECT * FROM player_quests
    WHERE user_id = ? AND world_id = ? AND quest_id = ? AND status = 'completed'
  `).get(userId, worldId, questId);

  if (!pq) return { ok: false, error: 'Quest not completed or already rewarded' };
  if (pq.rewarded_at) return { ok: false, error: 'Rewards already claimed' };

  const rewards = db.prepare(
    'SELECT * FROM quest_rewards WHERE quest_id = ?'
  ).all(questId);

  const world = db.prepare('SELECT universe_type AS world_type FROM worlds WHERE id = ?').get(worldId);
  const worldType = world?.world_type || 'standard';

  const granted = [];
  for (const r of rewards) {
    if (r.reward_type === 'skill_xp') {
      const result = gainSkillXP(db, userId, r.reward_key || 'combat', worldType, r.amount, { worldId });
      granted.push({ type: 'skill_xp', skill: r.reward_key, amount: r.amount, leveled: result.leveled });
    } else if (r.reward_type === 'xp') {
      granted.push({ type: 'xp', amount: r.amount });
    } else if (r.reward_type === 'gold') {
      granted.push({ type: 'gold', amount: r.amount });
    } else if (r.reward_type === 'skill_unlock' || r.reward_type === 'faction_modifier') {
      // Pillar 3 — completing a legendary task stamps an IMMUTABLE unlock onto
      // the player's state (a skill branch they may now wield, or a permanent
      // faction modifier), not just text. ref_id is deterministic per
      // (quest, user, key) so re-claiming is a no-op. Best-effort: a failed
      // stamp never blocks the rest of the reward grant.
      const u = grantUnlock(db, {
        userId,
        kind: r.reward_type,
        key: r.reward_key,
        amount: r.amount,
        source: `quest:${questId}`,
        refId: `quest:${questId}:${userId}:${r.reward_type}:${r.reward_key}`,
      });
      granted.push({ type: r.reward_type, key: r.reward_key, granted: !!u.granted, alreadyHad: !!u.alreadyHad });
    }
  }

  db.prepare(`
    UPDATE player_quests SET status = 'rewarded', rewarded_at = unixepoch()
    WHERE user_id = ? AND world_id = ? AND quest_id = ?
  `).run(userId, worldId, questId);

  return { ok: true, rewards: granted };
}

/**
 * Attach structured objectives to a quest (called at quest creation time).
 * objectives: Array<{ type, target, requiredCount?, description? }>
 */
export function addQuestObjectives(db, questId, objectives) {
  for (let i = 0; i < objectives.length; i++) {
    const obj = objectives[i];
    db.prepare(`
      INSERT OR IGNORE INTO quest_objectives
        (id, quest_id, type, target, required_count, description, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      questId,
      obj.type,
      obj.target,
      obj.requiredCount ?? 1,
      obj.description ?? '',
      i,
    );
  }
}

/**
 * Attach reward definitions to a quest.
 * rewards: Array<{ rewardType, rewardKey?, amount? }>
 */
export function addQuestRewards(db, questId, rewards) {
  for (const r of rewards) {
    db.prepare(`
      INSERT OR IGNORE INTO quest_rewards (id, quest_id, reward_type, reward_key, amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      questId,
      r.rewardType,
      r.rewardKey ?? null,
      r.amount ?? 100,
    );
  }
}
