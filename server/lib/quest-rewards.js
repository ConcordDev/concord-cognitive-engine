// server/lib/quest-rewards.js
//
// Reward grant for quest completion. Reads the quest's `rewards` field
// (declared in content/quests/*.json) and translates it into concrete
// state changes: currency credit on users.{concordia_credits,sparks},
// inventory rows in player_inventory, and skill XP via skill-progression.
//
// Wired by server/emergent/quest-engine.js when a quest's final step is
// completed. Idempotent per (userId, questId) — re-completing a quest
// won't double-grant. Logs each grant for the transparency feed.

import crypto from "node:crypto";
import logger from "../logger.js";

/**
 * Schema for quest.rewards (mirrors what the JSON authoring uses):
 *   {
 *     xp:           number,                       // skill xp on `crafting`/`exploration`/etc.
 *     gold:         number,                       // adds to users.concordia_credits
 *     sparks:       number,                       // adds to users.sparks
 *     skill_xp:     { [skillType: string]: number },
 *     named_items:  Array<{
 *       id:        string,           // logical item id (also used as item_id in inventory)
 *       name:      string,           // human-readable name
 *       type:      string,           // weapon | armor | tool | consumable | trinket | material
 *       quality:   string,           // tier_1 .. tier_5 → quality column
 *       quantity?: number,           // default 1
 *       tags?:     string[],
 *       description?: string,
 *     }>,
 *   }
 */

const REWARD_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS quest_reward_grants (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    quest_id      TEXT NOT NULL,
    granted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    gold          REAL NOT NULL DEFAULT 0,
    sparks        INTEGER NOT NULL DEFAULT 0,
    skill_xp_json TEXT NOT NULL DEFAULT '{}',
    items_json    TEXT NOT NULL DEFAULT '[]',
    UNIQUE(user_id, quest_id)
  );
  CREATE INDEX IF NOT EXISTS idx_quest_reward_grants_user ON quest_reward_grants(user_id);
`;

let _initialized = false;

function ensureSchema(db) {
  if (_initialized) return;
  try { db.exec(REWARD_LOG_TABLE); } catch { /* already exists */ }
  _initialized = true;
}

/**
 * Grant a quest's rewards to a player. Returns { ok, granted, alreadyGranted }.
 * Wraps every state change in a single SQLite transaction so partial failure
 * doesn't leave the player with half the rewards.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} userId
 * @param {string} questId        — the engine's internal quest id (for de-dupe)
 * @param {object} rewards        — the rewards object from the quest JSON
 */
export function grantQuestRewards(db, userId, questId, rewards = {}) {
  if (!db || !userId || !questId) {
    return { ok: false, error: "missing_args" };
  }
  if (!rewards || typeof rewards !== "object") {
    return { ok: true, granted: { gold: 0, sparks: 0, items: 0 } };
  }

  ensureSchema(db);

  // Idempotency: short-circuit if we've already granted for this (user, quest).
  const existing = db.prepare(
    `SELECT id FROM quest_reward_grants WHERE user_id = ? AND quest_id = ?`
  ).get(userId, questId);
  if (existing) {
    return { ok: true, alreadyGranted: true, granted: { gold: 0, sparks: 0, items: 0 } };
  }

  const gold   = Number(rewards.gold ?? rewards.cc ?? 0) || 0;
  const sparks = Math.floor(Number(rewards.sparks ?? 0) || 0);
  const skillXP = (rewards.skill_xp && typeof rewards.skill_xp === "object") ? rewards.skill_xp : {};
  const named  = Array.isArray(rewards.named_items) ? rewards.named_items : [];
  // Single-skill xp shorthand → bucket into the catch-all "exploration" skill
  // when the JSON used the legacy { xp: N } form rather than skill_xp.
  const fallbackXP = Number(rewards.xp ?? 0) || 0;
  if (fallbackXP > 0 && Object.keys(skillXP).length === 0) {
    skillXP.exploration = fallbackXP;
  }

  const grantedItems = [];

  const tx = db.transaction(() => {
    if (gold > 0) {
      db.prepare(
        `UPDATE users SET concordia_credits = COALESCE(concordia_credits, 0) + ? WHERE id = ?`
      ).run(gold, userId);
    }
    if (sparks > 0) {
      db.prepare(
        `UPDATE users SET sparks = COALESCE(sparks, 0) + ? WHERE id = ?`
      ).run(sparks, userId);
    }
    for (const raw of named) {
      if (!raw || typeof raw !== "object") continue;
      const item = {
        id:       String(raw.id || `quest_item_${crypto.randomUUID().slice(0, 8)}`),
        name:     String(raw.name || "Quest Reward"),
        type:     String(raw.type || "trinket"),
        quality:  String(raw.quality || "tier_1"),
        quantity: Math.max(1, Math.floor(Number(raw.quantity || 1))),
      };
      const invId = crypto.randomUUID();
      try {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, acquired_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        `).run(invId, userId, item.type, item.id, item.name, item.quantity, item.quality);
        grantedItems.push(item);
      } catch (err) {
        logger.warn({ err: err.message, item }, "quest_reward_inventory_insert_failed");
      }
    }
    db.prepare(`
      INSERT INTO quest_reward_grants (id, user_id, quest_id, gold, sparks, skill_xp_json, items_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      questId,
      gold,
      sparks,
      JSON.stringify(skillXP),
      JSON.stringify(grantedItems),
    );
  });

  try {
    tx();
  } catch (err) {
    logger.warn({ err: err.message, userId, questId }, "quest_reward_grant_tx_failed");
    return { ok: false, error: err.message };
  }

  // Skill XP grants live outside the transaction because skill-progression
  // does its own DB work + LLM-eligible XP curve calculation. Best-effort.
  if (Object.keys(skillXP).length > 0) {
    import("./skill-progression.js").then((sp) => {
      for (const [skillType, amount] of Object.entries(skillXP)) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (n <= 0) continue;
        try {
          sp.gainSkillXP?.(db, userId, skillType, "standard", n);
        } catch (err) {
          logger.warn({ err: err.message, skillType, amount: n, userId }, "quest_reward_skill_xp_failed");
        }
      }
    }).catch(() => { /* skill-progression import optional */ });
  }

  // Realtime fanfare so the GameJuice bridge can fire client-side feedback.
  try {
    const realtimeEmit = globalThis.realtimeEmit;
    if (typeof realtimeEmit === "function") {
      realtimeEmit("quest:rewards_granted", {
        userId,
        questId,
        gold,
        sparks,
        items: grantedItems,
        skillXP,
      });
    }
  } catch { /* realtime best-effort */ }

  logger.info(
    { userId, questId, gold, sparks, items: grantedItems.length, skillXP: Object.keys(skillXP).length },
    "quest_rewards_granted",
  );

  return {
    ok: true,
    granted: {
      gold,
      sparks,
      items: grantedItems.length,
      itemList: grantedItems,
      skillXP,
    },
  };
}
