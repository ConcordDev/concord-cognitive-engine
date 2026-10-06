'use client';

/**
 * Commonsense — one ConceptNet / personal-triple-store knowledge app.
 *
 * Single view union (facts | workbench | concepts | actions). Accordion
 * booleans for KB/ConceptNet/ActionPanel are gone. Each view is a panel.
 * Page is a thin shell.
 */

import { useState, type ComponentType } from 'react';
import { Database, Network, Brain, Wrench, Plus } from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { FactsPanel } from '@/components/commonsense/FactsPanel';
import { KnowledgeBaseWorkbench } from '@/components/commonsense/KnowledgeBaseWorkbench';
import { ConceptExplorer } from '@/components/commonsense/ConceptExplorer';
import { CommonsenseActionPanel } from '@/components/commonsense/CommonsenseActionPanel';

type CommonsenseView = 'facts' | 'workbench' | 'concepts' | 'actions';

const VIEWS: { id: CommonsenseView; label: string; keys: string; title: string; hint: string; icon: typeof Database }[] = [
  { id: 'facts', title: 'What you hold true', label: 'Facts', keys: '1', hint: 'Triple store · list/graph/stats', icon: Database },
  { id: 'workbench', title: 'How the facts connect', label: 'Workbench', keys: '2', hint: 'Graph · inference · contradictions', icon: Wrench },
  { id: 'concepts', title: 'What the world says', label: 'ConceptNet', keys: '3', hint: 'External concept explorer', icon: Network },
  { id: 'actions', title: 'Does it make sense', label: 'Actions', keys: '4', hint: 'Plausibility · analogy · relatedness', icon: Brain },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('commonsense');
  const [active, setActive] = useState<CommonsenseView>('facts');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'add-fact', keys: 'n', description: 'Add a fact', category: 'actions' as const, action: () => setActive('facts') },
    ],
    { lensId: 'commonsense' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="commonsense" asMain={false}>
      <FirstRunTour lensId="commonsense" />
      <DepthBadge lensId="commonsense" size="sm" className="ml-2" />
      <div data-lens-theme="commonsense" className="relative min-h-full px-8 pb-28 pt-6">
        <a href="#commonsense-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to commonsense content
        </a>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Commonsense</p>
            <h1 className="mb-1 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'facts' && who ? `, ${who}` : ''}
            </h1>
            <p className="mb-5 max-w-2xl text-[14px] text-zinc-500">
              Your personal triple store and ConceptNet in one knowledge desk.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="commonsense" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
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
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main id="commonsense-main" className="min-w-0">
          <section key={active}>
            <Panel />
          </section>
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

        <CrossLensRecentsPanel lensId="commonsense" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('facts')}
          title="Add a fact (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Add a fact
        </button>
      </div>
    </LensShell>
  );
}
