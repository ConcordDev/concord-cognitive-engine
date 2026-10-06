'use client';

import { useState, useEffect, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RecipeBoxSection } from '@/components/cooking/RecipeBoxSection';
import { RecipeKitchen } from '@/components/cooking/RecipeKitchen';
import { NutritionExplorer } from '@/components/cooking/NutritionExplorer';
import { UsdaFoodSearch } from '@/components/cooking/UsdaFoodSearch';
import { CookingActionPanel } from '@/components/cooking/CookingActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import {
  Timer, BookOpen, CalendarCheck, ShoppingBasket, Package, FolderHeart,
  Flame, Apple, UtensilsCrossed,
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
        <div key={t.label} className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4">
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
              <input type="number" min={0} max={99} value={minutes} onChange={e => { const m = Math.max(0, Number(e.target.value)); setMinutes(m); setRemaining(m * 60 + seconds); }}
                className="w-16 input-lattice text-center text-sm" placeholder="min" />
              <span className="text-gray-400">:</span>
              <input type="number" min={0} max={59} value={seconds} onChange={e => { const sec = Math.max(0, Math.min(59, Number(e.target.value))); setSeconds(sec); setRemaining(minutes * 60 + sec); }}
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

type CookingView = 'recipes' | 'kitchen' | 'nutrition' | 'timer' | 'bench';

const COOKING_TITLES: Record<CookingView, string> = {
  recipes: 'What is cooking',
  kitchen: 'Cook it step by step',
  nutrition: 'What is in it',
  timer: 'Keep an eye on the clock',
  bench: 'The kitchen bench',
};

const COOKING_TABS: { id: CookingView; label: string; icon: typeof BookOpen; keys: string }[] = [
  { id: 'recipes', label: 'Recipes', icon: BookOpen, keys: 'r' },
  { id: 'kitchen', label: 'Cook', icon: Flame, keys: 'k' },
  { id: 'nutrition', label: 'Nutrition', icon: Apple, keys: 'n' },
  { id: 'timer', label: 'Timer', icon: Timer, keys: 't' },
  { id: 'bench', label: 'Bench', icon: UtensilsCrossed, keys: 'b' },
];

export default function CookingLensPage() {
  useLensNav('cooking');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('cooking');
  const [activeView, setActiveView] = useState<CookingView>('recipes');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useLensCommand(
    COOKING_TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActiveView(t.id),
    })),
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

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="cooking" asMain={false}>
      <FirstRunTour lensId="cooking" />
      <DepthBadge lensId="cooking" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="cooking"
        theme="cooking"
        crumb="Cooking"
        title={`${COOKING_TITLES[activeView]}${activeView === 'recipes' && who ? `, ${who}` : ''}`}
        subtitle="Recipes, meal prep and kitchen management."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="cooking" data={realtimeData || {}} compact />
          </>
        }
        tabs={COOKING_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={activeView}
        onTab={(id) => setActiveView(id as CookingView)}
        tabsLabel="Cooking views"
        cta={{ label: 'Start cooking', icon: Flame, onClick: () => setActiveView('kitchen'), title: 'Open the step-by-step cook mode' }}
      >
        <div className="space-y-5">
          {dashboardError && !summary && (
            <div role="alert">
              <ErrorState error={dashboardError} onRetry={() => setRefreshTick(t => t + 1)} />
            </div>
          )}
          <KitchenDashboardStrip summary={summary} />

          <div className="space-y-4">
            {activeView === 'recipes' && <RecipeBoxSection />}
            {activeView === 'kitchen' && <RecipeKitchen />}
            {activeView === 'nutrition' && (
              <>
                <UsdaFoodSearch domain="cooking" />
                <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <NutritionExplorer />
                </section>
              </>
            )}
            {activeView === 'timer' && <CookingTimer />}
            {activeView === 'bench' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <PipingProvider>
                  <CookingActionPanel />
                </PipingProvider>
              </section>
            )}
          </div>

          <RealtimeDataPanel domain="cooking" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
          <section><LensFeedButton domain="cooking" label="Live recipe feed" /></section>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
