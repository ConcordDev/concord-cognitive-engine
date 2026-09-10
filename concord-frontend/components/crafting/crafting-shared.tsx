'use client';

import { Flame, Wand2, Sword, BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';

export const RECIPE_TYPES = [
  'fighting_style_recipe',
  'spell_recipe',
  'blueprint',
  'food_recipe',
] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

export interface RecipeRow {
  id: string;
  title: string;
  type?: string;
  meta?: { type?: string; description?: string; ingredients?: unknown };
  body?: { meta?: { description?: string } };
  created_at?: string;
}

export interface MarketplaceListing {
  id: string;
  title?: string;
  type?: string;
  price?: number;
  tier_prices?: Record<string, number>;
  creator_id?: string;
  creator_handle?: string;
}

export interface PlayerInventoryItem {
  id: string;
  item_type?: string;
  item_name: string;
  quantity?: number;
  effectiveness?: number;
  effectivenessLabel?: string;
}

export interface ResourceBar {
  bar_type: string;
  current: number;
  max: number;
  regen_per_sec?: number;
}

export interface CharacterProgress {
  level?: number;
  experience?: number;
  upgrade_points?: number;
  total_xp?: number;
  next_level_xp?: number;
}

// Mirrors the real `player_skill_levels` row shape returned by
// GET /api/crafting/skills's `skillLevels` array (server/routes/crafting.js) —
// `native_world_type`, not `worldType`; `xp`/`xp_to_next`, not `experience`.
export interface SkillRow {
  id?: string;
  skill_type?: string;
  level?: number;
  native_world_type?: string;
  xp?: number;
  xp_to_next?: number;
}

export interface CraftingRecipe {
  id: string;
  title: string;
  data: {
    spec?: {
      output?: { type?: string; name?: string; quality?: number };
      skill_requirements?: Array<{ skill_type: string; level: number }>;
      resource_requirements?: Array<{ resource_type: string; quantity: number }>;
    };
  } | string;
}

export type CraftingView =
  | 'mine'
  | 'forge'
  | 'browse'
  | 'skills'
  | 'workbench'
  | 'author'
  | 'ledger';

export const TYPE_META: Record<string, { label: string; icon: ReactNode; color: string }> = {
  food_recipe:           { label: 'Food',    icon: <Flame className="w-3.5 h-3.5" />,    color: 'text-orange-300' },
  spell_recipe:          { label: 'Spell',   icon: <Wand2 className="w-3.5 h-3.5" />,    color: 'text-violet-300' },
  fighting_style_recipe: { label: 'Style',   icon: <Sword className="w-3.5 h-3.5" />,    color: 'text-rose-300' },
  blueprint:             { label: 'Blueprint', icon: <BookOpen className="w-3.5 h-3.5" />, color: 'text-cyan-300' },
};

export function activeWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}
export function activeAvatarId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('concordia:activeAvatarId');
}
