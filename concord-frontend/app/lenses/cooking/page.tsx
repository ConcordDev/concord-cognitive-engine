'use client';

import { useState, useEffect, useRef } from 'react';
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
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import {
  ChefHat, Timer, BookOpen, CalendarCheck, ShoppingBasket, Package, FolderHeart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ── Kitchen dashboard — real cooking.cooking-dashboard-summary macro ──
interface DashboardSummary {
  recipeCount: number;
  collectionCount: number;
  plannedMealsThisWeek: number;
  shoppingItems: number;
  shoppingChecked: number;
  pantryItems: number;
}

function KitchenDashboardStrip({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) return null;
  const tiles = [
    { icon: BookOpen, label: 'Recipes', value: summary.recipeCount, color: 'text-orange-400' },
    { icon: FolderHeart, label: 'Collections', value: summary.collectionCount, color: 'text-pink-400' },
    { icon: CalendarCheck, label: 'Planned this week', value: summary.plannedMealsThisWeek, color: 'text-neon-cyan' },
    { icon: ShoppingBasket, label: 'Shopping list', value: `${summary.shoppingChecked}/${summary.shoppingItems}`, color: 'text-neon-green' },
    { icon: Package, label: 'Pantry items', value: summary.pantryItems, color: 'text-yellow-400' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className={ds.panel}>
          <t.icon className={cn('w-5 h-5 mb-2', t.color)} />
          <p className={ds.textMuted}>{t.label}</p>
          <p className="text-xl font-bold text-white">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Standalone kitchen timer (independent of any single recipe step —
// RecipeKitchen's CookMode already runs per-step timers parsed from
// instructions; this one is for "set a timer while I do something else"). ──
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
      <h3 className="font-semibold flex items-center gap-2"><Timer className="w-4 h-4 text-orange-400" />Kitchen Timer</h3>
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

export default function CookingLensPage() {
  useLensNav('cooking');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('cooking');
  const [showTimer, setShowTimer] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useLensCommand(
    [
      { id: 'toggle-timer', keys: 't', description: 'Toggle kitchen timer', category: 'view', action: () => setShowTimer((v) => !v) },
    ],
    { lensId: 'cooking' }
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDashboardError(null);
      try {
        const s = await lensRun('cooking', 'cooking-dashboard-summary', {});
        if (cancelled) return;
        if (s.data?.ok && s.data.result) setSummary(s.data.result as DashboardSummary);
        else setDashboardError(s.data?.error || 'Could not load the kitchen dashboard.');
      } catch (e) {
        if (cancelled) return;
        console.error('[cooking] dashboard summary fetch failed', e);
        setDashboardError(e instanceof Error ? e.message : 'Could not reach the cooking backend.');
      }
    })();
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <LensShell lensId="cooking" asMain={false}>
      <FirstRunTour lensId="cooking" />
      <ManifestActionBar />
      <DepthBadge lensId="cooking" size="sm" className="ml-2" />
      <div data-lens-theme="cooking" className="p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ChefHat className="w-6 h-6 text-orange-400" />
            <div>
              <h1 className="text-xl font-bold">Cooking Lens</h1>
              <p className="text-sm text-gray-400">Recipes, meal prep &amp; kitchen management</p>
            </div>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="cooking" data={realtimeData || {}} compact />
          </div>
          <button onClick={() => setShowTimer(t => !t)} className={cn('btn-neon', showTimer && 'bg-orange-500/20 border-orange-500/40')}>
            <Timer className="w-4 h-4 mr-1 inline" /> Timer <kbd className="text-[9px] opacity-60 ml-1">t</kbd>
          </button>
        </header>

        <AnimatePresence>
          {showTimer && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <CookingTimer />
            </motion.div>
          )}
        </AnimatePresence>

        {dashboardError && !summary && (
          <div role="alert">
            <ErrorState error={dashboardError} onRetry={() => setRefreshTick(t => t + 1)} />
          </div>
        )}
        <KitchenDashboardStrip summary={summary} />

        {/* Paprika 3 + Samsung Food + Plan to Eat parity: recipe box,
            scaling, meal-plan calendar, aisle-grouped shopping list,
            pantry + cook suggestions, AI meal planner, recipe folders. */}
        <RecipeBoxSection />

        {/* Paprika 3 + Samsung Food gap-closing surface: URL/photo
            import, full-screen cook mode, ratings + made-it log,
            USDA-linked nutrition, multi-store shopping, printable export. */}
        <RecipeKitchen />

        {/* Real USDA FoodData Central search */}
        <UsdaFoodSearch domain="cooking" />

        {/* Bespoke USDA FDC nutrition explorer with 3-tier collapsible card + Save-as-DTU */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <NutritionExplorer />
        </section>

        {/* Home-cook bench: scale/nutrition-estimate/substitution against a
            structured ingredient editor, USDA lookups, pipe publish/DM/mint/agent. */}
        <PipingProvider>
          <section className="mt-6">
            <CookingActionPanel />
          </section>
        </PipingProvider>

        <RealtimeDataPanel domain="cooking" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      </div>
      <section className="mt-4 px-4"><LensFeedButton domain="cooking" label="Live recipe feed" /></section>
      <div className="px-4">
        <RecentMineCard domain="cooking" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="cooking" hideWhenEmpty className="mt-3" title="More actions" />
        <CrossLensRecentsPanel lensId="cooking" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
