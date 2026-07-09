/**
 * Shared types for the achievements lens — mirrors the REST/macro shapes
 * exactly (server/domains/achievements.js + server/lib/achievement-engine.js
 * + server/lib/player-titles.js). No field here is invented; every one maps
 * to a real column or a real computed value the server returns.
 */

export type AchievementRarity = 'bronze' | 'silver' | 'gold' | 'legendary';

/** GET /api/achievements/catalog (== achievements.list macro). */
export interface AchievementCatalogEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  icon?: string;
  rarity: AchievementRarity;
  hidden: boolean;
  rewardSparks?: number;
  rewardTitle?: string | null;
}

/** GET /api/achievements/mine (== achievements.mine macro), one row. */
export interface EarnedEntry {
  achievement_id: string;
  earned_at: number; // unix seconds
  title?: string;
  description?: string;
  category?: string;
  icon?: string;
  rarity?: AchievementRarity;
  rewardSparks?: number;
  rewardTitle?: string | null;
}

/** GET /api/achievements/recent (== achievements.recent macro), one row. */
export interface RecentUnlockRow {
  userId: string;
  achievement_id: string;
  earned_at: number; // unix seconds
  title: string;
  rarity: AchievementRarity;
  icon?: string;
}

/** Realtime `achievement:unlocked` payload (server/lib/achievement-engine.js#unlockAchievement). */
export interface AchievementUnlockedEvent {
  userId: string;
  achievementId: string;
  title: string;
  rarity: AchievementRarity;
  icon?: string;
  rewardSparks?: number;
  rewardTitle?: string | null;
}

/** GET /api/titles/mine — one owned title row. */
export interface OwnedTitle {
  id: string;
  title: string;
  worldId: string;
  earnedAt: number; // unix seconds
}
