'use client';

/**
 * Commonsense — one ConceptNet / personal-triple-store knowledge app.
 *
 * Single view union (facts | workbench | concepts | actions). Accordion
 * booleans for KB/ConceptNet/ActionPanel are gone. Each view is a panel.
 * Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Lightbulb, Database, Network, Brain, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { FactsPanel } from '@/components/commonsense/FactsPanel';
import { KnowledgeBaseWorkbench } from '@/components/commonsense/KnowledgeBaseWorkbench';
import { ConceptExplorer } from '@/components/commonsense/ConceptExplorer';
import { CommonsenseActionPanel } from '@/components/commonsense/CommonsenseActionPanel';

type CommonsenseView = 'facts' | 'workbench' | 'concepts' | 'actions';

const VIEWS: { id: CommonsenseView; label: string; keys: string; hint: string; icon: typeof Database }[] = [
  { id: 'facts', label: 'Facts', keys: '1', hint: 'Triple store · list/graph/stats', icon: Database },
  { id: 'workbench', label: 'Workbench', keys: '2', hint: 'Graph · inference · contradictions', icon: Wrench },
  { id: 'concepts', label: 'ConceptNet', keys: '3', hint: 'External concept explorer', icon: Network },
  { id: 'actions', label: 'Actions', keys: '4', hint: 'Plausibility · analogy · relatedness', icon: Brain },
];

function ActionsPane() {
  return (
    <PipingProvider>
      <CommonsenseActionPanel />
    </PipingProvider>
  );
}

const PANELS: Record<CommonsenseView, ComponentType> = {
  facts: FactsPanel,
  workbench: KnowledgeBaseWorkbench,
  concepts: ConceptExplorer,
  actions: ActionsPane,
};

export default function CommonsenseLensPage() {
  useLensNav('commonsense');
  useLensIdentity('commonsense');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('commonsense');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<CommonsenseView>('facts');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'commonsense' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="commonsense" asMain={false}>
      <FirstRunTour lensId="commonsense" />
      <DepthBadge lensId="commonsense" size="sm" className="ml-2" />
      <div data-lens-theme="commonsense" className={ds.pageContainer}>
        <a href="#commonsense-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to commonsense content
        </a>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Lightbulb className="w-6 h-6 text-neon-yellow" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Commonsense</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="commonsense" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Personal triple store + ConceptNet — one knowledge desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Commonsense views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main id="commonsense-main" className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        {realtimeData && (
          <RealtimeDataPanel
            domain="commonsense"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="commonsense" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
