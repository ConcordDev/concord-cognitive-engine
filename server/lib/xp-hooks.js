/**
 * XP Hooks — Wire awardXP into real activity events.
 *
 * Hooks into DTU creation, marketplace sales, citations, and
 * other real knowledge actions so XP is earned automatically.
 *
 * Also adds domain-filtered leaderboard and daily/weekly quest generation.
 */

import logger from "../logger.js";

// ── XP Hook Installer ──────────────────────────────────────────────────────

/**
 * Install XP hooks into the system.
 * Call once at startup, passing dependencies.
 *
 * Only `awardXP` and `STATE` are needed here: `awardXP` (server.js) already
 * closes over its own module-scope `getXPProfile`/`saveStateDebounced` and
 * calls both internally on every award, so re-injecting them into this
 * installer would be pure duplication — verified by reading `awardXP`'s
 * body (server.js), not assumed. The DTU-creation hook below only needs
 * `STATE.dtus` to wrap and `awardXP` to call.
 *
 * @param {{ awardXP: Function, STATE: object }} deps
 */
export function installXPHooks({ awardXP, STATE }) {
  if (!awardXP || !STATE) {
    logger.warn("xp-hooks", "Cannot install XP hooks — missing dependencies");
    return;
  }

  // Hook into DTU creation via STATE event tracking
  const originalDtusSet = STATE.dtus?.set?.bind(STATE.dtus);
  if (originalDtusSet && STATE.dtus instanceof Map) {
    const tracked = new WeakSet();
    STATE.dtus.set = function(id, dtu) {
      const isNew = !STATE.dtus.has(id);
      const result = originalDtusSet(id, dtu);
      if (isNew && dtu && !tracked.has(dtu)) {
        try {
          tracked.add(dtu);
          const userId = dtu.ownerId || dtu.createdBy || "sovereign";
          const action = dtu.tier === "crystal" ? "dtu.create.crystal"
            : dtu.tier === "mega" ? "dtu.create"
            : dtu.tier === "hyper" ? "dtu.create"
            : "dtu.create";
          awardXP(userId, action, undefined, { dtuId: id, tier: dtu.tier });
        } catch (_e) { /* silent */ }
      }
      return result;
    };
  }

  logger.info("xp-hooks", "XP hooks installed — auto-awarding on DTU creation");
}

// ── Domain-Filtered Leaderboard ────────────────────────────────────────────

/**
 * Get leaderboard filtered by domain.
 * Scans XP history entries to compute per-domain XP totals.
 *
 * @param {{ xpStore: object }} STATE
 * @param {{ domain?: string, limit?: number }} opts
 * @returns {{ leaderboard: object[] }}
 */
export function getDomainLeaderboard(STATE, { domain = null, limit = 50 } = {}) {
  const entries = [];

  for (const [userId, profile] of Object.entries(STATE.xpStore || {})) {
    if (!domain) {
      // Global leaderboard
      entries.push({
        userId,
        totalXP: profile.totalXP || 0,
        level: profile.level || 1,
        title: profile.title || "Spark",
        streak: profile.streak?.current || 0,
      });
    } else {
      // Domain-specific: sum XP from history entries matching this domain
      const domainXP = (profile.history || [])
        .filter(h => {
          const tags = h.tags || h.meta?.tags || [];
          return tags.some(t => t.toLowerCase() === domain.toLowerCase());
        })
        .reduce((sum, h) => sum + (h.amount || 0), 0);

      if (domainXP > 0) {
        entries.push({
          userId,
          totalXP: profile.totalXP || 0,
          domainXP,
          level: profile.level || 1,
          title: profile.title || "Spark",
          streak: profile.streak?.current || 0,
        });
      }
    }
  }

  // Sort by domain XP if filtered, otherwise total XP
  entries.sort((a, b) => (domain ? (b.domainXP || 0) - (a.domainXP || 0) : b.totalXP - a.totalXP));
  return { leaderboard: entries.slice(0, limit) };
}

// ── Daily/Weekly Quest Generation ──────────────────────────────────────────

const DAILY_QUEST_TEMPLATES = [
  { type: "daily", title: "Knowledge Spark", description: "Create 3 DTUs today", goal: { action: "dtu.create", count: 3 }, xpReward: 50 },
  { type: "daily", title: "Deep Dive", description: "Explore a new domain lens", goal: { action: "lens.action", count: 2 }, xpReward: 30 },
  { type: "daily", title: "Quick Capture", description: "Quick-capture 5 ideas", goal: { action: "capture.quick", count: 5 }, xpReward: 40 },
  { type: "daily", title: "Tag Organizer", description: "Tag 10 DTUs", goal: { action: "dtu.tag", count: 10 }, xpReward: 25 },
  { type: "daily", title: "Cross-Pollinator", description: "Make a cross-domain connection", goal: { action: "dtu.cross_domain_connection", count: 1 }, xpReward: 60 },
];

const WEEKLY_QUEST_TEMPLATES = [
  { type: "weekly", title: "Knowledge Architect", description: "Create 20 DTUs this week", goal: { action: "dtu.create", count: 20 }, xpReward: 300 },
  { type: "weekly", title: "Streak Master", description: "Maintain a 7-day streak", goal: { action: "streak.daily", count: 7 }, xpReward: 200 },
  { type: "weekly", title: "Marketplace Debut", description: "List or sell an item on the marketplace", goal: { action: "marketplace.sale", count: 1 }, xpReward: 250 },
  { type: "weekly", title: "Crystal Forge", description: "Create a crystal DTU", goal: { action: "dtu.create.crystal", count: 1 }, xpReward: 200 },
  { type: "weekly", title: "Hypothesis Hunter", description: "Confirm a hypothesis", goal: { action: "hypothesis.confirmed", count: 1 }, xpReward: 350 },
];

/**
 * Generate daily/weekly quests for a user.
 * Uses deterministic seeding so each user gets consistent quests per day.
 *
 * @param {string} userId
 * @returns {{ daily: object[], weekly: object[] }}
 */
export function generateQuests(userId = "sovereign") {
  const today = new Date().toISOString().slice(0, 10);
  const weekNum = Math.floor(Date.now() / (7 * 86_400_000));

  // Seed-based selection (deterministic per user+day)
  const dailySeed = hashCode(`${userId}-${today}-daily`);
  const weeklySeed = hashCode(`${userId}-${weekNum}-weekly`);

  // Pick 3 daily quests
  const daily = [];
  const usedDaily = new Set();
  for (let i = 0; i < 3 && i < DAILY_QUEST_TEMPLATES.length; i++) {
    const idx = Math.abs(dailySeed + i * 7) % DAILY_QUEST_TEMPLATES.length;
    if (!usedDaily.has(idx)) {
      usedDaily.add(idx);
      daily.push({
        ...DAILY_QUEST_TEMPLATES[idx],
        id: `daily-${today}-${idx}`,
        expiresAt: `${today}T23:59:59Z`,
        progress: 0,
      });
    }
  }

  // Pick 2 weekly quests
  const weekly = [];
  const usedWeekly = new Set();
  for (let i = 0; i < 2 && i < WEEKLY_QUEST_TEMPLATES.length; i++) {
    const idx = Math.abs(weeklySeed + i * 11) % WEEKLY_QUEST_TEMPLATES.length;
    if (!usedWeekly.has(idx)) {
      usedWeekly.add(idx);
      const weekEnd = new Date(Date.now() + (7 - new Date().getDay()) * 86_400_000);
      weekly.push({
        ...WEEKLY_QUEST_TEMPLATES[idx],
        id: `weekly-${weekNum}-${idx}`,
        expiresAt: weekEnd.toISOString().slice(0, 10) + "T23:59:59Z",
        progress: 0,
      });
    }
  }

  return { daily, weekly };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash;
}

// ── Marketplace Sale XP Hook ───────────────────────────────────────────────

/**
 * Award XP for a marketplace sale. Call from the purchase handler.
 */
export function awardMarketplaceSaleXP(awardXP, { sellerId, buyerId, itemId, price } = {}) {
  if (sellerId) {
    awardXP(sellerId, "marketplace.sale", 200, { itemId, price, role: "seller" });
  }
  if (buyerId) {
    awardXP(buyerId, "marketplace.purchase", 50, { itemId, price, role: "buyer" });
  }
}

/**
 * Award XP for citation. Call when a DTU is cited by another.
 */
export function awardCitationXP(awardXP, { ownerId, dtuId, citedById } = {}) {
  if (ownerId) {
    awardXP(ownerId, "dtu.cited", 15, { dtuId, citedById });
  }
}

export default {
  installXPHooks,
  getDomainLeaderboard,
  generateQuests,
  awardMarketplaceSaleXP,
  awardCitationXP,
};
