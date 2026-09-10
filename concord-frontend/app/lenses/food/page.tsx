'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  ChefHat as MobileTabChef,
  Calendar as MobileTabCal,
  ShoppingCart as MobileTabCart,
  Apple as MobileTabApple,
  Package as MobileTabPkg,
  UtensilsCrossed as MobileTabKitchen,
} from 'lucide-react';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FoodYelpSection } from '@/components/food/FoodYelpSection';
import { OpenFoodFactsSearch } from '@/components/food/OpenFoodFactsSearch';
import { BreweryPanel } from '@/components/food/BreweryPanel';
import { UsdaFoodSearch } from '@/components/cooking/UsdaFoodSearch';
import { FoodActionPanel } from '@/components/food/FoodActionPanel';
import { FoodParityPanel } from '@/components/food/FoodParityPanel';
import { FoodKitchenWorkbench, type KitchenGroup } from '@/components/food/FoodKitchenWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ChefHat, AlertTriangle } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';

/** NYT Cooking / Paprika: cook, plan, pantry, then kitchen ops — one union. */
export type FoodView = KitchenGroup | 'track' | 'discover' | 'ops';

const VIEWS: { id: FoodView; label: string }[] = [
  { id: 'cook', label: 'Recipes' },
  { id: 'plan', label: 'Plan' },
  { id: 'pantry', label: 'Pantry' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'track', label: 'Nutrition' },
  { id: 'discover', label: 'Discover' },
  { id: 'ops', label: 'Ops' },
];

const KITCHEN_GROUPS = new Set<FoodView>(['cook', 'plan', 'pantry', 'kitchen']);

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function FoodLensPage() {
  useLensNav('food');
  useLensIdentity('food');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('food');
  const [activeView, setActive] = useState<FoodView>('cook');
  const reduced = prefersReducedMotion();

  useLensCommand(
    [
      { id: 'tab-cook', keys: 'r', description: 'Recipes', category: 'navigation', action: () => setActive('cook') },
      { id: 'tab-plan', keys: 'm', description: 'Meal plan', category: 'navigation', action: () => setActive('plan') },
      { id: 'tab-pantry', keys: 'p', description: 'Pantry', category: 'navigation', action: () => setActive('pantry') },
      { id: 'tab-kitchen', keys: 'k', description: 'Kitchen ops', category: 'navigation', action: () => setActive('kitchen') },
      { id: 'tab-track', keys: 'n', description: 'Nutrition', category: 'navigation', action: () => setActive('track') },
      { id: 'tab-discover', keys: 'd', description: 'Discover', category: 'navigation', action: () => setActive('discover') },
    ],
    { lensId: 'food' },
  );

  return (
    <LensShell lensId="food" asMain={false}>
      <FirstRunTour lensId="food" />
      <DepthBadge lensId="food" size="sm" className="ml-2" />
      <div data-lens-theme="food" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <ChefHat className="w-8 h-8 shrink-0 text-orange-400" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Food</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>
                Cook from a card, plan the week, shop the pantry — Paprika density.
                <kbd className="ml-2 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">R</kbd> recipes
                <kbd className="ml-1 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">P</kbd> pantry
              </p>
            </div>
          </div>
          <DTUExportButton domain="food" data={{}} compact />
        </header>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            Not nutritional or dietary advice. Numbers come from logged recipes and Open Food Facts — not a clinician.
          </p>
        </div>

        <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap" aria-label="Food views">
          {VIEWS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                activeView === tab.id
                  ? 'bg-orange-500/20 text-orange-200 border border-orange-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border border-transparent',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            {KITCHEN_GROUPS.has(activeView) && <FoodKitchenWorkbench group={activeView as KitchenGroup} />}
            {activeView === 'track' && <FoodParityPanel />}
            {activeView === 'discover' && (
              <div className="space-y-4">
                <FoodYelpSection />
                <UsdaFoodSearch domain="food" />
                <BreweryPanel domain="food" />
                <section className={cn(ds.panel, 'p-4')}>
                  <OpenFoodFactsSearch />
                </section>
              </div>
            )}
            {activeView === 'ops' && (
              <PipingProvider>
                <FoodActionPanel />
              </PipingProvider>
            )}
          </motion.div>
        </AnimatePresence>

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="food"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        <RealtimeDataPanel domain="food" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <section className="mt-4">
          <LensFeedButton domain="food" label="Live food-product feed" />
        </section>
          <CrossLensRecentsPanel lensId="food" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
        <MobileTabBar
          tabs={[
            { id: 'cook', label: 'Recipes', icon: MobileTabChef },
            { id: 'plan', label: 'Plan', icon: MobileTabCal },
            { id: 'discover', label: 'Discover', icon: MobileTabCart },
            { id: 'track', label: 'Nutri', icon: MobileTabApple },
            { id: 'pantry', label: 'Pantry', icon: MobileTabPkg },
            { id: 'kitchen', label: 'Kitchen', icon: MobileTabKitchen },
          ]}
          active={activeView}
          onSelect={(id) => setActive(id as FoodView)}
        />
      </div>
    </LensShell>
  );
}
