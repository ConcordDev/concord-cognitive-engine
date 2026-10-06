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
  GanttChartSquare, CalendarClock, Wrench, Plus,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><ProjectGantt /></div>;
}
function GalleryPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><PhotoGallery /></div>;
}
function IdeasPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><IdeaBoards /></div>;
}
function ProsPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><ContractorDirectory /></div>;
}
function ShoppingPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><ShoppingList /></div>;
}
function InventoryPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><HomeInventory /></div>;
}
function MaintenancePanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><MaintenanceReminders /></div>;
}
function DiscussionPanel() {
  return <div className="rounded-2xl border border-white/10 bg-[#111] p-4"><HomeImprovementFeed /></div>;
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="home-improvement"
        crumb="Home improvement"
        title={`Build the next room${active === 'projects' && who ? `, ${who}` : ''}`}
        subtitle="Projects, budget, calculators, timeline, contractors, shopping, inventory and maintenance."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="home-improvement" data={realtimeData || {}} compact />
          </>
        }
        tabs={TABS}
        activeTab={active}
        onTab={(id) => setActive(id as HiView)}
        tabsLabel="Home improvement views"
        cta={{ label: 'New project', icon: Plus, onClick: () => setActive('projects') }}
      >
        <div className="mb-5"><HiStatsHeader /></div>

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
      </NorthStarFrame>
    </LensShell>
  );
}
