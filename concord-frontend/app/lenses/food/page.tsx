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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
import { AlertTriangle, CalendarDays, ChefHat as TabChef, Compass, Package, Salad, ClipboardList, UtensilsCrossed } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';

/** NYT Cooking / Paprika: cook, plan, pantry, then kitchen ops — one union. */
export type FoodView = KitchenGroup | 'track' | 'discover' | 'ops';

const VIEWS: { id: FoodView; label: string; keys: string; icon: typeof TabChef }[] = [
  { id: 'cook', label: 'Recipes', keys: 'r', icon: TabChef },
  { id: 'plan', label: 'Plan', keys: 'm', icon: CalendarDays },
  { id: 'pantry', label: 'Pantry', keys: 'p', icon: Package },
  { id: 'kitchen', label: 'Kitchen', keys: 'k', icon: UtensilsCrossed },
  { id: 'track', label: 'Nutrition', keys: 'n', icon: Salad },
  { id: 'discover', label: 'Discover', keys: 'd', icon: Compass },
  { id: 'ops', label: 'Ops', keys: 'o', icon: ClipboardList },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  useLensCommand(
    [
      { id: 'tab-cook', keys: 'r', description: 'Recipes', category: 'navigation', action: () => setActive('cook') },
      { id: 'tab-plan', keys: 'm', description: 'Meal plan', category: 'navigation', action: () => setActive('plan') },
      { id: 'tab-pantry', keys: 'p', description: 'Pantry', category: 'navigation', action: () => setActive('pantry') },
      { id: 'tab-kitchen', keys: 'k', description: 'Kitchen ops', category: 'navigation', action: () => setActive('kitchen') },
      { id: 'tab-track', keys: 'n', description: 'Nutrition', category: 'navigation', action: () => setActive('track') },
      { id: 'tab-discover', keys: 'd', description: 'Discover', category: 'navigation', action: () => setActive('discover') },
      { id: 'tab-ops', keys: 'o', description: 'Ops', category: 'navigation', action: () => setActive('ops') },
    ],
    { lensId: 'food' },
  );

  const tabs = VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }));
  const titles: Record<FoodView, string> = {
    cook: `Cook something good${who ? `, ${who}` : ''}`,
    plan: 'Plan the week',
    pantry: 'Know what you have',
    kitchen: 'Run the kitchen',
    track: 'See what you eat',
    discover: 'Find your next meal',
    ops: 'Work the pass',
  };

  return (
    <LensShell lensId="food" asMain={false}>
      <FirstRunTour lensId="food" />
      <DepthBadge lensId="food" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="food"
        crumb="Food"
        title={titles[activeView]}
        subtitle="Cook from a card, plan the week, shop the pantry."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="food" data={{}} compact />
          </>
        )}
        tabs={tabs}
        activeTab={activeView}
        onTab={(id) => setActive(id as FoodView)}
        tabsLabel="Food views"
        cta={{ label: 'Plan the week', icon: CalendarDays, onClick: () => setActive('plan'), title: 'Open the meal plan (M)' }}
      >
        <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-200">
            Not nutritional or dietary advice. Numbers come from logged recipes and Open Food Facts — not a clinician.
          </p>
        </div>

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
                <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
      </NorthStarFrame>
    </LensShell>
  );
}
