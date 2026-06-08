'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  X, Flame, Wrench, FlaskConical, Cog, CircleDot,
  Check, XCircle, ChevronRight, Clock, Star, ArrowRight,
  ShoppingCart, BarChart3,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type StationType = 'forge' | 'workbench' | 'lab' | 'assembly' | 'kiln';

type MaterialQuality = 'poor' | 'standard' | 'fine' | 'superior' | 'masterwork';

interface Ingredient {
  name: string;
  required: number;
  available: number;
  quality?: MaterialQuality;
}

interface CraftingRecipe {
  id: string;
  name: string;
  station: StationType;
  ingredients: Ingredient[];
  outputName: string;
  outputDescription: string;
  outputQualityBase: number;
  craftTimeSeconds: number;
  skillRequirement?: { domain: string; tier: string; level: number };
}

interface RecentCraft {
  id: string;
  recipeName: string;
  quality: MaterialQuality;
  timestamp: string;
}

interface CraftingPanelProps {
  station?: StationType;
  recipes?: CraftingRecipe[];
  inventory?: Record<string, number>;
  onCraft?: (recipe: CraftingRecipe) => void;
  onClose?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STATION_META: Record<StationType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  forge:     { label: 'Forge',     icon: Flame,       color: 'text-orange-400' },
  workbench: { label: 'Workbench', icon: Wrench,      color: 'text-cyan-400' },
  lab:       { label: 'Lab',       icon: FlaskConical, color: 'text-purple-400' },
  assembly:  { label: 'Assembly',  icon: Cog,         color: 'text-blue-400' },
  kiln:      { label: 'Kiln',      icon: CircleDot,   color: 'text-red-400' },
};

const QUALITY_COLORS: Record<MaterialQuality, string> = {
  poor:       'text-gray-400',
  standard:   'text-gray-300',
  fine:       'text-green-400',
  superior:   'text-blue-400',
  masterwork: 'text-yellow-400',
};

/* ── Component ─────────────────────────────────────────────────── */

// Map a quality tier label from the backend onto the panel's quality enum.
function tierToQuality(tier: string): MaterialQuality {
  switch ((tier || '').toLowerCase()) {
    case 'crude': return 'poor';
    case 'fine': return 'fine';
    case 'exquisite': return 'superior';
    case 'masterwork': return 'masterwork';
    default: return 'standard';
  }
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function CraftingPanel({
  station: initialStation = 'forge',
  // No backend macro supplies station-based recipes with ingredient
  // availability, so recipes are empty unless passed in by a parent that
  // has the real data. Never fabricated.
  recipes = [],
  onCraft,
  onClose,
}: CraftingPanelProps) {
  const [activeStation, setActiveStation] = useState<StationType>(initialStation);
  const [selectedRecipe, setSelectedRecipe] = useState<CraftingRecipe | null>(null);
  const [crafting, setCrafting] = useState(false);
  const [craftProgress, setCraftProgress] = useState(0);
  const [recentCrafts, setRecentCrafts] = useState<RecentCraft[]>([]);

  // Real recent crafts from the crafting domain history log. Stays empty
  // (honest empty-state) on error or no data — never fabricated.
  useEffect(() => {
    let cancelled = false;
    lensRun('crafting', 'history_list', { limit: 10 })
      .then((r) => {
        const hist = (r.data?.result as { history?: Record<string, unknown>[] } | null)?.history;
        if (cancelled || !Array.isArray(hist)) return;
        const mapped: RecentCraft[] = hist.map((h) => {
          const best = (h.bestTier ?? {}) as { tier?: string };
          return {
            id: String(h.id ?? ''),
            recipeName: String(h.recipeName ?? 'Unknown'),
            quality: tierToQuality(String(best.tier ?? 'standard')),
            timestamp: timeAgo(String(h.craftedAt ?? '')),
          };
        });
        setRecentCrafts(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stationRecipes = recipes.filter((r) => r.station === activeStation);

  const canCraft = useCallback((recipe: CraftingRecipe) => {
    return recipe.ingredients.every((ing) => ing.available >= ing.required);
  }, []);

  const qualityBonus = useCallback((recipe: CraftingRecipe) => {
    const avgQuality = recipe.ingredients.reduce((sum, ing) => {
      const qMap: Record<string, number> = { poor: -10, standard: 0, fine: 10, superior: 20, masterwork: 35 };
      return sum + (qMap[ing.quality || 'standard'] || 0);
    }, 0) / recipe.ingredients.length;
    return Math.round(recipe.outputQualityBase + avgQuality);
  }, []);

  const handleCraft = useCallback((recipe: CraftingRecipe) => {
    if (!canCraft(recipe)) return;
    setCrafting(true);
    setCraftProgress(0);
    const steps = 20;
    const interval = (recipe.craftTimeSeconds * 1000) / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setCraftProgress(Math.round((step / steps) * 100));
      if (step >= steps) {
        clearInterval(timer);
        setCrafting(false);
        setCraftProgress(0);
        onCraft?.(recipe);
      }
    }, interval);
  }, [canCraft, onCraft]);

  const StationIcon = STATION_META[activeStation].icon;

  return (
    <div className={`w-[420px] flex flex-col max-h-[calc(100vh-4rem)] ${panel} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <StationIcon className={`w-4 h-4 ${STATION_META[activeStation].color}`} />
          <h2 className="text-sm font-semibold">Crafting</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Station selector */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5">
        {(Object.keys(STATION_META) as StationType[]).map((st) => {
          const meta = STATION_META[st];
          const Icon = meta.icon;
          return (
            <button
              key={st}
              onClick={() => { setActiveStation(st); setSelectedRecipe(null); }}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded whitespace-nowrap transition-colors ${
                activeStation === st
                  ? `bg-white/10 ${meta.color} border border-white/20`
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Recipe list */}
        <div className="w-44 border-r border-white/5 overflow-y-auto">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider px-3 pt-2 pb-1">
            Recipes ({stationRecipes.length})
          </p>
          {stationRecipes.length === 0 ? (
            <p className="text-[10px] text-gray-400 px-3 py-4">No recipes for this station.</p>
          ) : (
            stationRecipes.map((recipe) => {
              const craftable = canCraft(recipe);
              return (
                <button
                  key={recipe.id}
                  onClick={() => setSelectedRecipe(recipe)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors border-b border-white/5 ${
                    selectedRecipe?.id === recipe.id
                      ? 'bg-white/10 text-white'
                      : 'hover:bg-white/5 text-gray-400'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${craftable ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-xs truncate flex-1">{recipe.name}</span>
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                </button>
              );
            })
          )}
        </div>

        {/* Recipe detail */}
        <div className="flex-1 overflow-y-auto p-3">
          {!selectedRecipe ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Wrench className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-xs text-gray-400">Select a recipe to view details.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Output preview */}
              <div className="p-2.5 rounded bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-semibold text-white">{selectedRecipe.outputName}</span>
                </div>
                <p className="text-[10px] text-gray-400">{selectedRecipe.outputDescription}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400" />
                    Quality: <span className="text-yellow-400">{qualityBonus(selectedRecipe)}%</span>
                  </span>
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {selectedRecipe.craftTimeSeconds}s
                  </span>
                </div>
              </div>

              {/* Ingredients */}
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Ingredients</p>
                <div className="space-y-1">
                  {selectedRecipe.ingredients.map((ing, i) => {
                    const have = ing.available >= ing.required;
                    return (
                      <div key={i} className="flex items-center gap-2 p-1.5 rounded bg-white/5 border border-white/5">
                        {have ? (
                          <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="text-xs flex-1 truncate">{ing.name}</span>
                        {ing.quality && (
                          <span className={`text-[9px] ${QUALITY_COLORS[ing.quality]}`}>
                            [{ing.quality}]
                          </span>
                        )}
                        <span className={`text-[10px] ${have ? 'text-green-400' : 'text-red-400'}`}>
                          {ing.available}/{ing.required}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Skill requirement */}
              {selectedRecipe.skillRequirement && (
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <BarChart3 className="w-3 h-3" />
                  Requires: {selectedRecipe.skillRequirement.domain} {selectedRecipe.skillRequirement.tier} (Lv{selectedRecipe.skillRequirement.level})
                </div>
              )}

              {/* Craft button */}
              <div>
                {crafting ? (
                  <div className="w-full rounded bg-white/5 border border-white/10 overflow-hidden">
                    <div
                      className="h-8 bg-cyan-500/30 flex items-center justify-center text-xs text-cyan-300 transition-all duration-200"
                      style={{ width: `${craftProgress}%` }}
                    >
                      Crafting... {craftProgress}%
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleCraft(selectedRecipe)}
                    disabled={!canCraft(selectedRecipe)}
                    className={`w-full py-2 rounded text-xs font-semibold transition-colors ${
                      canCraft(selectedRecipe)
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 hover:bg-cyan-500/30'
                        : 'bg-white/5 text-gray-600 border border-white/5 cursor-not-allowed'
                    }`}
                  >
                    {canCraft(selectedRecipe) ? 'Craft' : 'Missing Materials'}
                  </button>
                )}
              </div>

              {/* Gather link */}
              {!canCraft(selectedRecipe) && (
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('crafting:open-exchange', { detail: { recipeId: selectedRecipe?.id } })); }}
                  className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <ShoppingCart className="w-3 h-3" />
                  Gather Materials from The Exchange
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent crafts */}
      <div className="border-t border-white/5 px-3 py-2">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Recent Crafts</p>
        <div className="space-y-0.5">
          {recentCrafts.length === 0 && (
            <p className="text-[10px] text-gray-400">No crafts yet.</p>
          )}
          {recentCrafts.map((rc) => (
            <div key={rc.id} className="flex items-center justify-between text-[10px]">
              <span className="text-gray-400">{rc.recipeName}</span>
              <div className="flex items-center gap-2">
                <span className={QUALITY_COLORS[rc.quality]}>{rc.quality}</span>
                <span className="text-gray-600">{rc.timestamp}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
