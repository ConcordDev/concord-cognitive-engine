'use client';

/**
 * Home Improvement — one renovation workbench.
 *
 * Single view union. Projects/Budget/Calculators extracted to panels;
 * existing feature components (Gantt, Gallery, Ideas, …) mounted by router.
 * Page is a thin shell.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Hammer, DollarSign, Calculator, Camera, Lightbulb, ShoppingCart, Boxes,
  GanttChartSquare, CalendarClock, Wrench, Home,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HomeImprovementFeed } from '@/components/home-improvement/HomeImprovementFeed';
import { PhotoGallery } from '@/components/home-improvement/PhotoGallery';
import { IdeaBoards } from '@/components/home-improvement/IdeaBoards';
import { ContractorDirectory } from '@/components/home-improvement/ContractorDirectory';
import { ShoppingList } from '@/components/home-improvement/ShoppingList';
import { HomeInventory } from '@/components/home-improvement/HomeInventory';
import { ProjectGantt } from '@/components/home-improvement/ProjectGantt';
import { MaintenanceReminders } from '@/components/home-improvement/MaintenanceReminders';
import { ProductRecalls } from '@/components/home-improvement/ProductRecalls';
import { ProjectsPanel, HiStatsHeader } from '@/components/home-improvement/ProjectsPanel';
import { BudgetPanel } from '@/components/home-improvement/BudgetPanel';
import { CalculatorsPanel } from '@/components/home-improvement/CalculatorsPanel';
import type { HiView } from '@/components/home-improvement/hi-shared';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

const TABS: { id: HiView; label: string; keys: string; icon: typeof Hammer }[] = [
  { id: 'projects', label: 'Projects', keys: 'p', icon: Hammer },
  { id: 'budget', label: 'Budget', keys: 'b', icon: DollarSign },
  { id: 'calculators', label: 'Calculators', keys: 'x', icon: Calculator },
  { id: 'timeline', label: 'Timeline', keys: 't', icon: GanttChartSquare },
  { id: 'gallery', label: 'Gallery', keys: 'g', icon: Camera },
  { id: 'ideas', label: 'Ideas', keys: 'i', icon: Lightbulb },
  { id: 'pros', label: 'Contractors', keys: 'c', icon: Wrench },
  { id: 'shopping', label: 'Shopping', keys: 's', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventory', keys: 'v', icon: Boxes },
  { id: 'maintenance', label: 'Maintenance', keys: 'm', icon: CalendarClock },
  { id: 'discussion', label: 'Discussion', keys: 'd', icon: Lightbulb },
];

function TimelinePanel() {
  return <div className="panel p-4"><ProjectGantt /></div>;
}
function GalleryPanel() {
  return <div className="panel p-4"><PhotoGallery /></div>;
}
function IdeasPanel() {
  return <div className="panel p-4"><IdeaBoards /></div>;
}
function ProsPanel() {
  return <div className="panel p-4"><ContractorDirectory /></div>;
}
function ShoppingPanel() {
  return <div className="panel p-4"><ShoppingList /></div>;
}
function InventoryPanel() {
  return <div className="panel p-4"><HomeInventory /></div>;
}
function MaintenancePanel() {
  return <div className="panel p-4"><MaintenanceReminders /></div>;
}
function DiscussionPanel() {
  return <div className="panel p-4"><HomeImprovementFeed /></div>;
}

const PANELS: Record<HiView, ComponentType> = {
  projects: ProjectsPanel,
  budget: BudgetPanel,
  calculators: CalculatorsPanel,
  timeline: TimelinePanel,
  gallery: GalleryPanel,
  ideas: IdeasPanel,
  pros: ProsPanel,
  shopping: ShoppingPanel,
  inventory: InventoryPanel,
  maintenance: MaintenancePanel,
  discussion: DiscussionPanel,
};

export default function HomeImprovementLensPage() {
  useLensNav('home-improvement');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('home-improvement');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<HiView>('projects');

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'home-improvement' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="home-improvement" asMain={false}>
      <FirstRunTour lensId="home-improvement" />
      <DepthBadge lensId="home-improvement" size="sm" className="ml-2" />
      <div data-lens-theme="home-improvement" className="p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Home className="w-6 h-6 text-amber-400" />
            <div>
              <h1 className="text-xl font-bold">Home Improvement Lens</h1>
              <p className="text-sm text-gray-400">Renovation &amp; improvement projects</p>
            </div>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="home-improvement" data={realtimeData || {}} compact />
          </div>
        </header>

        <HiStatsHeader />

        <nav
          className="flex flex-wrap gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1"
          aria-label="Home improvement views"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all justify-center',
                  on
                    ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: 20 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          >
            <Panel />
          </motion.div>
        </AnimatePresence>

        <RealtimeDataPanel domain="home-improvement" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <section className="mt-4"><ProductRecalls /></section>
        <CrossLensRecentsPanel lensId="home-improvement" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
