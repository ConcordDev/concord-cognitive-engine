'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  ChefHat, Plus, Search, Trash2, Clock, Users, Flame,
  Star, UtensilsCrossed, Layers, ChevronDown, Timer,
  CheckSquare, Square, Minus, Check,
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
            {(running || finished) && <button onClick={reset} className="px-3 py-1.5 rounded-lg text-sm bg-white/5 border border-white/10 hover:bg-white/10">Reset</button>}
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
  const toggle = (i: number) => setChecked(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  if (!ingredients || ingredients.length === 0) return <p className="text-xs text-gray-500 italic">No ingredients listed.</p>;
  return (
    <ul className="space-y-1.5">
      {ingredients.map((ing, i) => (
        <li key={i} onClick={() => toggle(i)} className="flex items-center gap-2 cursor-pointer group">
          {checked.has(i)
            ? <CheckSquare className="w-4 h-4 text-neon-green shrink-0" />
            : <Square className="w-4 h-4 text-gray-500 shrink-0 group-hover:text-gray-300" />}
          <span className={cn('text-sm transition-colors', checked.has(i) ? 'line-through text-gray-500' : 'text-gray-200')}>{ing}</span>
        </li>
      ))}
      {checked.size > 0 && (
        <li className="text-xs text-gray-500 pt-1">{checked.size}/{ingredients.length} checked</li>
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
  const [showFeatures, setShowFeatures] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [servingMultipliers, setServingMultipliers] = useState<Record<string, number>>({});
  const [newRecipe, setNewRecipe] = useState({ name: '', cuisine: '', difficulty: 'easy' as 'easy' | 'medium' | 'hard', prepTime: 0, cookTime: 0, servings: 4 });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<RecipeData>('cooking', 'recipe', { seed: [] });

  const recipes = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Untitled Recipe' }))
      .filter(r => !search || r.name?.toLowerCase().includes(search.toLowerCase()) || r.cuisine?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
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

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="cooking" className="p-6 space-y-6">
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

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipes..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full panel p-6 text-center text-gray-400">Loading recipes...</div>
        ) : recipes.length === 0 ? (
          <div className="col-span-full panel p-6 text-center text-gray-400">No recipes yet. Create your first one.</div>
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
                <button onClick={() => remove(r.id)} className="text-gray-500 hover:text-red-400 shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.cuisine && <span className="px-2 py-0.5 rounded bg-lattice-elevated text-orange-300">{r.cuisine}</span>}
                {badge && (
                  <span className={cn('px-2 py-0.5 rounded font-semibold flex items-center gap-1', badge.color)}>
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
                    {mult !== 1 && <span className="text-gray-500 ml-1">(×{mult})</span>}
                  </span>
                )}
              </div>

              {/* Serving adjuster */}
              {r.servings > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Servings:</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: Math.max(0.25, (p[r.id] ?? 1) - 0.25) }))}
                      className="w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-xs">−</button>
                    <span className="text-xs w-8 text-center font-medium text-white">{adjustedServings}</span>
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: (p[r.id] ?? 1) + 0.25 }))}
                      className="w-6 h-6 rounded bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-xs">+</button>
                  </div>
                  {mult !== 1 && (
                    <button onClick={() => setServingMultipliers(p => ({ ...p, [r.id]: 1 }))} className="text-xs text-gray-600 hover:text-gray-400">reset</button>
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

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="cooking" /></div>}
      </div>
    </div>
  );
}
