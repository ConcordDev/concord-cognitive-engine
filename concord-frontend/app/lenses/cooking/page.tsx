'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RecipeBoxSection } from '@/components/cooking/RecipeBoxSection';
import { RecipeKitchen } from '@/components/cooking/RecipeKitchen';
import { NutritionExplorer } from '@/components/cooking/NutritionExplorer';
import { UsdaFoodSearch } from '@/components/cooking/UsdaFoodSearch';
import { CookingActionPanel } from '@/components/cooking/CookingActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  ChefHat, Plus, Search, Trash2, Clock, Users, Flame,
  Star, UtensilsCrossed, Layers, ChevronDown, Timer,
  CheckSquare, Square, Loader2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface RecipeData {
  name: string;
  cuisine: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
  rating: number;
  notes: string;
}

// ── Action result types ─────────────────────────────────────────
interface ScaleRecipeResult {
  message?: string;
  scaleFactor: number;
  baseServings: number;
  targetServings: number;
  recipe?: string;
  ingredients: { name: string; original: string; scaled: string }[];
}

interface NutritionEstimateResult {
  message?: string;
  totalCalories: number;
  perServing: number;
  servings: number;
  macros: Record<string, string>;
  note?: string;
}

interface MealPlanResult {
  message?: string;
  weeklyBudget: number;
  dailyBudget: number;
  days: number;
  mealsToFill: number;
  dietaryNotes: string;
  plan: { day: number; dayName: string; meals: string[] }[];
}

interface SubstitutionResult {
  message?: string;
  ingredient: string;
  found: boolean;
  substitutions: { sub: string; ratio: string; note?: string }[];
}

function isObjectResult(result: unknown): result is Record<string, unknown> {
  return typeof result === 'object' && result !== null;
}

function isScaleRecipeResult(result: unknown): result is ScaleRecipeResult {
  return isObjectResult(result) && 'scaleFactor' in result;
}

function isNutritionEstimateResult(result: unknown): result is NutritionEstimateResult {
  return isObjectResult(result) && 'totalCalories' in result;
}

function isMealPlanResult(result: unknown): result is MealPlanResult {
  return isObjectResult(result) && 'weeklyBudget' in result;
}

function isSubstitutionResult(result: unknown): result is SubstitutionResult {
  return isObjectResult(result) && 'substitutions' in result;
}

function hasMessage(result: unknown): result is { message: string } {
  return isObjectResult(result) && 'message' in result && typeof (result as Record<string, unknown>).message === 'string';
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'text-neon-green bg-neon-green/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  hard: 'text-red-400 bg-red-400/10',
};

// ── Cooking Timer ──────────────────────────────────────────────
function CookingTimer() {
  const [minutes, setMinutes] = useState(5);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const total = minutes * 60 + seconds;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [remaining, setRemaining] = useState(total);

  useEffect(() => { setRemaining(minutes * 60 + seconds); }, [minutes, seconds]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) {
            setRunning(false);
            setFinished(true);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const reset = () => { setRunning(false); setFinished(false); setRemaining(minutes * 60 + seconds); };
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
  const ss = (remaining % 60).toString().padStart(2, '0');
  const circumference = 2 * Math.PI * 36;
  const dash = (pct / 100) * circumference;

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Timer className="w-4 h-4 text-orange-400" />Cooking Timer</h3>
      <div className="flex items-center gap-4">
        {/* SVG ring */}
        <div className="relative w-24 h-24 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
            <circle cx="40" cy="40" r="36" fill="none"
              stroke={finished ? '#ef4444' : running ? '#fb923c' : '#6b7280'}
              strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 0.5s linear' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-lg font-mono font-bold', finished ? 'text-red-400 animate-pulse' : 'text-white')}>{finished ? '✓' : `${mm}:${ss}`}</span>
          </div>
        </div>
        <div className="space-y-2 flex-1">
          {!running && !finished && (
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={99} value={minutes} onChange={e => setMinutes(Math.max(0, Number(e.target.value)))}
                className="w-16 input-lattice text-center text-sm" placeholder="min" />
              <span className="text-gray-400">:</span>
              <input type="number" min={0} max={59} value={seconds} onChange={e => setSeconds(Math.max(0, Math.min(59, Number(e.target.value))))}
                className="w-16 input-lattice text-center text-sm" placeholder="sec" />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { if (finished) { reset(); } else setRunning(r => !r); }}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', running ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-neon-green/20 text-neon-green border border-neon-green/30')}>
              {finished ? 'Reset' : running ? 'Pause' : 'Start'}
            </button>
            {(running || finished) && <button onClick={reset} className="px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-500">Reset</button>}
          </div>
          {finished && <p className="text-xs text-red-400 animate-bounce">Timer done!</p>}
        </div>
      </div>
    </div>
  );
}

// ── Ingredient Checklist ────────────────────────────────────────
function IngredientChecklist({ ingredients }: { ingredients: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setChecked(prev => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s; });
  if (!ingredients || ingredients.length === 0) return <p className="text-xs text-gray-400 italic">No ingredients listed.</p>;
  return (
    <ul className="space-y-1.5">
      {ingredients.map((ing, i) => (
        <li key={i} onClick={() => toggle(i)} className="flex items-center gap-2 cursor-pointer group">
          {checked.has(i)
            ? <CheckSquare className="w-4 h-4 text-neon-green shrink-0" />
            : <Square className="w-4 h-4 text-gray-400 shrink-0 group-hover:text-gray-300" />}
          <span className={cn('text-sm transition-colors', checked.has(i) ? 'line-through text-gray-400' : 'text-gray-200')}>{ing}</span>
        </li>
      ))}
      {checked.size > 0 && (
        <li className="text-xs text-gray-400 pt-1">{checked.size}/{ingredients.length} checked</li>
      )}
    </ul>
  );
}

const DIFFICULTY_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  easy: { label: 'Easy', color: 'text-neon-green bg-neon-green/10 border border-neon-green/20', icon: '●' },
  medium: { label: 'Medium', color: 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/20', icon: '●●' },
  hard: { label: 'Hard', color: 'text-red-400 bg-red-400/10 border border-red-400/20', icon: '●●●' },
};

export default function CookingLensPage() {
  useLensNav('cooking');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('cooking');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showTimer, setShowTimer] = useState(false);
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Search recipes', category: 'navigation', action: () => searchInputRef.current?.focus() },
      { id: 'new-recipe',   keys: 'n', description: 'New recipe',     category: 'actions',    action: () => setShowCreate(true) },
      { id: 'toggle-timer', keys: 't', description: 'Toggle kitchen timer', category: 'view',  action: () => setShowTimer((v) => !v) },
      { id: 'diff-all',    keys: '0', description: 'All difficulties', category: 'view', action: () => setDifficultyFilter('all') },
      { id: 'diff-easy',   keys: '1', description: 'Easy',             category: 'view', action: () => setDifficultyFilter('easy') },
      { id: 'diff-medium', keys: '2', description: 'Medium',           category: 'view', action: () => setDifficultyFilter('medium') },
      { id: 'diff-hard',   keys: '3', description: 'Hard',             category: 'view', action: () => setDifficultyFilter('hard') },
      { id: 'collapse',    keys: 'esc', description: 'Collapse expanded recipe', category: 'navigation', action: () => setExpandedRecipe(null) },
    ],
    { lensId: 'cooking' }
  );
  const [servingMultipliers, setServingMultipliers] = useState<Record<string, number>>({});
  const [newRecipe, setNewRecipe] = useState({ name: '', cuisine: '', difficulty: 'easy' as 'easy' | 'medium' | 'hard', prepTime: 0, cookTime: 0, servings: 4 });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<RecipeData>('cooking', 'recipe', { seed: [] });

  const runAction = useRunArtifact('cooking');
  const [actionResult, setActionResult] = useState<{ action: string; result: unknown } | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleAction = useCallback(async (action: string) => {
    const targetId = items[0]?.id;
    if (!targetId) return;
    setIsRunning(true);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({ action, result: { message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } });
      } else {
        setActionResult({ action, result: res.result });
      }
    } catch (err) {
      setActionResult({ action, result: `Error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsRunning(false);
    }
  }, [items, runAction]);

  const recipes = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Untitled Recipe' }))
      .filter(r => {
        if (search && !(r.name?.toLowerCase().includes(search.toLowerCase()) || r.cuisine?.toLowerCase().includes(search.toLowerCase()))) return false;
        if (difficultyFilter !== 'all' && r.difficulty !== difficultyFilter) return false;
        return true;
      }),
    [items, search, difficultyFilter]
  );

  const stats = useMemo(() => ({
    total: recipes.length,
    cuisines: [...new Set(recipes.map(r => r.cuisine).filter(Boolean))].length,
    avgTime: recipes.length ? Math.round(recipes.reduce((s, r) => s + (r.prepTime || 0) + (r.cookTime || 0), 0) / recipes.length) : 0,
    topRated: recipes.filter(r => (r.rating || 0) >= 4).length,
  }), [recipes]);

  const handleCreate = useCallback(async () => {
    if (!newRecipe.name.trim()) return;
    await create({
      title: newRecipe.name,
      data: {
        name: newRecipe.name, cuisine: newRecipe.cuisine, difficulty: newRecipe.difficulty,
        prepTime: newRecipe.prepTime, cookTime: newRecipe.cookTime, servings: newRecipe.servings,
        ingredients: [], instructions: [], tags: [], rating: 0, notes: '',
      },
    });
    setNewRecipe({ name: '', cuisine: '', difficulty: 'easy', prepTime: 0, cookTime: 0, servings: 4 });
    setShowCreate(false);
  }, [newRecipe, create]);

  if (isError) return (
    <div role="alert" className="flex items-center justify-center h-full p-8">
      <ErrorState error={error?.message} onRetry={() => refetch()} />
    </div>
  );

  return (
    <LensShell lensId="cooking" asMain={false}>
      <FirstRunTour lensId="cooking" />
      <ManifestActionBar />
      <DepthBadge lensId="cooking" size="sm" className="ml-2" />
      <div className="px-4 mt-3 space-y-4">
        <RecipeBoxSection />
        {/* Paprika 3 + Samsung Food backlog: URL/photo import, cook mode,
            ratings + made-it log, USDA-linked nutrition, multi-store
            shopping, printable export. */}
        <RecipeKitchen />
      </div>
    <div data-lens-theme="cooking" className="p-6 space-y-6">
      {/* Phase 4 — REAL USDA FoodData Central search. Tier-1 honest macros. */}
      <UsdaFoodSearch domain="cooking" />
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChefHat className="w-6 h-6 text-orange-400" />
          <div>
            <h1 className="text-xl font-bold">Cooking Lens</h1>
            <p className="text-sm text-gray-400">Recipes, meal prep & kitchen management</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="cooking" data={realtimeData || {}} compact />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTimer(t => !t)} className={cn('btn-neon', showTimer && 'bg-orange-500/20 border-orange-500/40')}>
            <Timer className="w-4 h-4 mr-1 inline" /> Timer
          </button>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
            <Plus className="w-4 h-4 mr-2 inline" /> New Recipe
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showTimer && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <CookingTimer />
          </motion.div>
        )}
      </AnimatePresence>

      <UniversalActions domain="cooking" artifactId={items[0]?.id} compact />

      {/* ── Cooking Backend Actions ── */}
      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ChefHat className="w-4 h-4 text-orange-400" /> Recipe Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'scaleRecipe', label: 'Scale Recipe' },
            { action: 'nutritionEstimate', label: 'Nutrition Estimate' },
            { action: 'mealPlan', label: 'Meal Plan' },
            { action: 'substitution', label: 'Substitutions' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={isRunning || !items[0]?.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 hover:bg-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning && actionResult === null ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              {label}
            </button>
          ))}
        </div>
        {isRunning && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin text-orange-400" />
            Running action…
          </div>
        )}
        {actionResult && !isRunning && (
          <div className="relative rounded-lg bg-lattice-deep border border-orange-500/20 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-orange-300 font-medium capitalize">{actionResult.action}</span>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-gray-300" aria-label="Xcircle">
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="text-[11px] space-y-2 max-h-64 overflow-y-auto">
              {/* Error / plain message */}
              {typeof actionResult.result === 'string' && (
                <p className="text-gray-300">{actionResult.result}</p>
              )}
              {hasMessage(actionResult.result) && (
                <p className="text-gray-300">{actionResult.result.message}</p>
              )}

              {/* scaleRecipe */}
              {isScaleRecipeResult(actionResult.result) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-orange-400">{actionResult.result.baseServings}</p>
                      <p className="text-[10px] text-gray-400">Original</p>
                    </div>
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-neon-green">{actionResult.result.targetServings}</p>
                      <p className="text-[10px] text-gray-400">Target</p>
                    </div>
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-neon-cyan">{actionResult.result.scaleFactor}×</p>
                      <p className="text-[10px] text-gray-400">Factor</p>
                    </div>
                  </div>
                  {actionResult.result.recipe && (
                    <p className="text-gray-400">Recipe: <span className="text-gray-200">{actionResult.result.recipe}</span></p>
                  )}
                  <div className="space-y-1">
                    {actionResult.result.ingredients.map((ing) => (
                      <div key={ing.name} className="flex items-center justify-between text-gray-300 bg-lattice-bg px-2 py-1 rounded">
                        <span className="font-medium">{ing.name}</span>
                        <span className="text-gray-400">{ing.original} → <span className="text-orange-400">{ing.scaled}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* nutritionEstimate */}
              {isNutritionEstimateResult(actionResult.result) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="text-lg font-bold text-orange-400">{actionResult.result.totalCalories}</p>
                      <p className="text-[10px] text-gray-400">Total kcal</p>
                    </div>
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="text-lg font-bold text-neon-cyan">{actionResult.result.perServing}</p>
                      <p className="text-[10px] text-gray-400">Per serving ({actionResult.result.servings})</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(actionResult.result.macros || {}).map(([macro, val]) => (
                      <div key={macro} className="p-1.5 bg-lattice-bg rounded text-center">
                        <p className="font-bold text-neon-green">{val}</p>
                        <p className="text-[10px] text-gray-400">{macro}</p>
                      </div>
                    ))}
                  </div>
                  {actionResult.result.note && (
                    <p className="text-[10px] text-gray-400 italic">{actionResult.result.note}</p>
                  )}
                </div>
              )}

              {/* mealPlan */}
              {isMealPlanResult(actionResult.result) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-orange-400">{actionResult.result.days}</p>
                      <p className="text-[10px] text-gray-400">Days</p>
                    </div>
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-neon-green">${actionResult.result.dailyBudget}</p>
                      <p className="text-[10px] text-gray-400">Daily Budget</p>
                    </div>
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="font-bold text-neon-cyan">${actionResult.result.weeklyBudget}</p>
                      <p className="text-[10px] text-gray-400">Weekly Total</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <span>Meals to fill:</span>
                    <span className="text-orange-300">{actionResult.result.mealsToFill}</span>
                    <span className="ml-auto text-[10px]">Diet: {actionResult.result.dietaryNotes}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {actionResult.result.plan.map((day) => (
                      <div key={day.day} className="p-1 bg-lattice-bg rounded text-center">
                        <p className="text-[10px] font-medium text-orange-400">{day.dayName}</p>
                        <p className="text-[10px] text-gray-400">{day.meals.length}m</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* substitution */}
              {isSubstitutionResult(actionResult.result) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Replacing:</span>
                    <span className="text-orange-300 font-medium capitalize">{actionResult.result.ingredient || '—'}</span>
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] ${actionResult.result.found ? 'bg-neon-green/20 text-neon-green' : 'bg-gray-500/20 text-gray-400'}`}>
                      {actionResult.result.found ? 'Found' : 'Not found'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {actionResult.result.substitutions.map((s, i) => (
                      <div key={i} className="p-2 bg-lattice-bg rounded space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-200">{s.sub}</span>
                          <span className="text-neon-cyan text-[10px] font-mono">{s.ratio}</span>
                        </div>
                        {s.note && <p className="text-[10px] text-gray-400">{s.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Create Recipe</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input value={newRecipe.name} onChange={e => setNewRecipe(p => ({ ...p, name: e.target.value }))} placeholder="Recipe name..." className="input-lattice" />
            <input value={newRecipe.cuisine} onChange={e => setNewRecipe(p => ({ ...p, cuisine: e.target.value }))} placeholder="Cuisine (e.g. Italian)..." className="input-lattice" />
            <select value={newRecipe.difficulty} onChange={e => setNewRecipe(p => ({ ...p, difficulty: e.target.value as RecipeData['difficulty'] }))} className="input-lattice">
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
            <input type="number" value={newRecipe.prepTime || ''} onChange={e => setNewRecipe(p => ({ ...p, prepTime: Number(e.target.value) }))} placeholder="Prep (min)..." className="input-lattice" />
            <input type="number" value={newRecipe.cookTime || ''} onChange={e => setNewRecipe(p => ({ ...p, cookTime: Number(e.target.value) }))} placeholder="Cook (min)..." className="input-lattice" />
            <input type="number" value={newRecipe.servings || ''} onChange={e => setNewRecipe(p => ({ ...p, servings: Number(e.target.value) }))} placeholder="Servings..." className="input-lattice" />
          </div>
          <button onClick={handleCreate} disabled={createMut.isPending || !newRecipe.name.trim()} className="btn-neon green w-full">
            {createMut.isPending ? 'Creating...' : 'Save Recipe'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><UtensilsCrossed className="w-5 h-5 text-orange-400 mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Recipes</p></div>
        <div className="lens-card"><Flame className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.cuisines}</p><p className="text-sm text-gray-400">Cuisines</p></div>
        <div className="lens-card"><Clock className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{stats.avgTime}m</p><p className="text-sm text-gray-400">Avg Time</p></div>
        <div className="lens-card"><Star className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{stats.topRated}</p><p className="text-sm text-gray-400">Top Rated</p></div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); searchInputRef.current?.blur(); } }}
            placeholder="Search recipes…  / focuses · Esc clears"
            className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap text-xs">
          {(['all', 'easy', 'medium', 'hard'] as const).map((d, i) => (
            <button
              key={d}
              onClick={() => setDifficultyFilter(d)}
              className={`px-2 py-0.5 rounded border transition-colors ${
                difficultyFilter === d
                  ? d === 'easy' ? 'border-neon-green/40 bg-neon-green/15 text-neon-green'
                  : d === 'medium' ? 'border-yellow-400/40 bg-yellow-400/15 text-yellow-400'
                  : d === 'hard' ? 'border-red-400/40 bg-red-400/15 text-red-400'
                  : 'border-orange-400/40 bg-orange-400/15 text-orange-400'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {d}<kbd className="text-[8px] opacity-60 ml-0.5">{i}</kbd>
            </button>
          ))}
          {(search || difficultyFilter !== 'all') && (
            <span className="text-[10px] text-gray-400 ml-2">{recipes.length} match</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div role="status" aria-busy="true" aria-live="polite" className="col-span-full panel p-6 text-center text-gray-400">
            <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />Loading recipes...
          </div>
        ) : recipes.length === 0 ? (
          <div className="col-span-full panel p-6 text-center text-gray-400 flex flex-col items-center gap-3">
            <span>No recipes yet. Create your first one.</span>
            <button onClick={() => setShowCreate(true)} className="btn-neon">
              <Plus className="w-4 h-4 mr-2 inline" />Create your first recipe
            </button>
          </div>
        ) : recipes.map(r => {
          const mult = servingMultipliers[r.id] ?? 1;
          const badge = r.difficulty ? DIFFICULTY_BADGE[r.difficulty] : null;
          const adjustedServings = r.servings ? Math.round(r.servings * mult) : 0;
          const expanded = expandedRecipe === r.id;
          return (
            <motion.div key={r.id} layout className="panel p-4 flex flex-col gap-3">
              {/* Title row */}
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white truncate flex-1 mr-2">{r.name}</h3>
                <button onClick={() => remove(r.id)} disabled={deleteMut.isPending} className="text-gray-400 hover:text-red-400 shrink-0">{deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
              </div>

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.cuisine && <span className="px-2 py-0.5 rounded bg-lattice-elevated text-orange-300">{r.cuisine}</span>}
                {badge && (
                  <span className={cn('px-2 py-0.5 rounded font-semibold flex items-center gap-1', badge.color, DIFFICULTY_COLORS[r.difficulty])}>
                    <span className="tracking-tighter">{badge.icon}</span> {badge.label}
                  </span>
                )}
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                {(r.prepTime || r.cookTime) > 0 && (
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{(r.prepTime || 0) + (r.cookTime || 0)}m</span>
                )}
                {r.servings > 0 && (
                  <span className="flex items-center gap-1 text-neon-green">
                    <Users className="w-3 h-3" />{adjustedServings} serving{adjustedServings !== 1 ? 's' : ''}
                    {mult !== 1 && <span className="text-gray-400 ml-1">(×{mult})</span>}
                  </span>
                )}
              </div>

              {/* Serving adjuster */}
              {r.servings > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Servings:</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: Math.max(0.25, (p[r.id] ?? 1) - 0.25) }))}
                      className="w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-xs">−</button>
                    <span className="text-xs w-8 text-center font-medium text-white">{adjustedServings}</span>
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: (p[r.id] ?? 1) + 0.25 }))}
                      className="w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-xs">+</button>
                  </div>
                  {mult !== 1 && (
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: 1 }))} className="text-xs text-gray-400 hover:text-gray-400">reset</button>
                  )}
                </div>
              )}

              {/* Expand to show ingredients */}
              {r.ingredients && r.ingredients.length > 0 && (
                <div>
                  <button onClick={() => setExpandedRecipe(expanded ? null : r.id)}
                    className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                    {expanded ? 'Hide' : 'Show'} ingredients ({r.ingredients.length})
                  </button>
                  <AnimatePresence>
                    {expanded && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-2">
                        <IngredientChecklist ingredients={r.ingredients.map(ing => {
                          if (mult === 1) return ing;
                          const numMatch = ing.match(/^([\d.]+)\s*(.*)/);
                          if (numMatch) {
                            const adj = Math.round(parseFloat(numMatch[1]) * mult * 4) / 4;
                            return `${adj} ${numMatch[2]}`;
                          }
                          return ing;
                        })} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <RealtimeDataPanel domain="cooking" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Bespoke USDA FDC nutrition explorer with 3-tier collapsible card + Save-as-DTU */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <NutritionExplorer />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <CookingActionPanel />
        </section>
      </PipingProvider>

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="cooking" /></div>}
      </div>
    </div>
          <section className="mt-4"><LensFeedButton domain="cooking" label="Live recipe feed" /></section>
          <RecentMineCard domain="cooking" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="cooking" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="cooking" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
