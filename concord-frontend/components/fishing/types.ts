// components/fishing/types.ts
//
// Shared shapes for the fishing hub lens. Mirrors the REAL objects returned
// by `server/lib/fishing.js#listFishForWorld` (content/world/<id>/fauna/
// fish.json) and the `player_inventory` rows the `fishing.catches` /
// `fishing.get` / `fishing.species` / `fishing.catalog` macros return.
// No field here is invented — every property is one the backend genuinely
// sends; optional fields are optional because not every world's fauna file
// authors them yet.

export interface FishSpecies {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | string;
  biome?: string;
  subBiome?: string;
  mass?: number;
  description?: string;
  abilities?: string[];
  /** itemId -> drop probability (0..1). */
  dropTable?: Record<string, number>;
  buffOnCook?: Record<string, number | string> | null;
}

export interface CatchRow {
  id: string;
  world_id: string;
  item_id: string;
  item_name?: string;
  /** Unix epoch seconds (player_inventory.acquired_at). */
  acquired_at: number;
  /** JSON string: { qualityScore, sessionId, buffOnCook }. */
  meta_json?: string;
}

export interface ParsedCatchMeta {
  qualityScore?: number;
  sessionId?: string;
  buffOnCook?: Record<string, number | string> | null;
}

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export const RARITY_COLORS: Record<string, string> = {
  common: 'text-zinc-300 bg-zinc-800 border-zinc-700',
  uncommon: 'text-emerald-300 bg-emerald-900/40 border-emerald-700/50',
  rare: 'text-cyan-300 bg-cyan-900/40 border-cyan-700/50',
  epic: 'text-violet-300 bg-violet-900/40 border-violet-700/50',
  legendary: 'text-amber-300 bg-amber-900/40 border-amber-700/50',
};

/**
 * Quality tiers mirror `server/lib/fishing.js`'s TENSION_PERFECT/GOOD/POOR
 * thresholds (0.85 / 0.55 / 0.20) verbatim — display-only re-derivation of a
 * REAL server-computed `qualityScore`, never a fabricated number.
 */
export function qualityTier(score: number): 'perfect' | 'good' | 'fair' | 'poor' {
  if (score >= 0.85) return 'perfect';
  if (score >= 0.55) return 'good';
  if (score >= 0.2) return 'fair';
  return 'poor';
}

export const QUALITY_TIER_COLORS: Record<string, string> = {
  perfect: 'text-amber-300 bg-amber-900/40 border-amber-700/50',
  good: 'text-emerald-300 bg-emerald-900/40 border-emerald-700/50',
  fair: 'text-cyan-300 bg-cyan-900/40 border-cyan-700/50',
  poor: 'text-zinc-400 bg-zinc-800 border-zinc-700',
};

export function parseCatchMeta(row: CatchRow): ParsedCatchMeta {
  if (!row.meta_json) return {};
  try {
    const parsed = JSON.parse(row.meta_json);
    return parsed && typeof parsed === 'object' ? (parsed as ParsedCatchMeta) : {};
  } catch {
    return {};
  }
}
