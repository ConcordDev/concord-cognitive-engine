'use client';

/**
 * Docs — one Notion/Confluence documentation app.
 *
 * Single `active` union drives the tab bar. Accordion toggles for
 * DocsWorkspace / DocsToolingGallery are gone. Each view is a panel.
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  Layers,
  Zap,
  Code2,
  Plus,
  Wrench,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { WorkspacePanel } from '@/components/docs/WorkspacePanel';
import { GuidePanel } from '@/components/docs/GuidePanel';
import { AnalysisPanel } from '@/components/docs/AnalysisPanel';
import { ApiHubPanel } from '@/components/docs/ApiHubPanel';
import { DocsToolingGallery } from '@/components/docs/DocsToolingGallery';
import { requestNewDoc } from '@/components/docs/DocsWorkspace';

const TITLES: Record<string, string> = {
  workspace: 'The document',
  guide: 'The handbook',
  analysis: 'How it reads',
  hub: 'The API, documented',
  tooling: 'Reference worth keeping',
};

type DocsView = 'workspace' | 'guide' | 'analysis' | 'hub' | 'tooling';

const VIEWS: { id: DocsView; label: string; keys: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'workspace', label: 'Workspace', keys: '1', hint: 'Notion pages · blocks', icon: Layers },
  { id: 'guide', label: 'Guide', keys: '2', hint: 'Handbook sections', icon: BookOpen },
  { id: 'analysis', label: 'Analysis', keys: '3', hint: 'Readability · refs · diff', icon: Zap },
  { id: 'hub', label: 'API Hub', keys: '4', hint: 'Auto-generated API docs', icon: Code2 },
  { id: 'tooling', label: 'Tooling', keys: '5', hint: 'External reference gallery', icon: Wrench },
];

function ToolingPanel() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <DocsToolingGallery />
    </section>
  );
}

const PANELS: Record<DocsView, ComponentType> = {
  workspace: WorkspacePanel,
  guide: GuidePanel,
  analysis: AnalysisPanel,
  hub: ApiHubPanel,
  tooling: ToolingPanel,
};

export default function DocsLensPage() {
  useLensNav('docs');
  useLensIdentity('docs');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('docs');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DocsView>('workspace');
  const newDoc = useCallback(() => {
    setActive('workspace');
    requestNewDoc();
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'new-doc', keys: 'n', description: 'New doc', category: 'actions' as const, action: newDoc },
    ],
    { lensId: 'docs' },
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
    <LensShell lensId="docs" asMain={false}>
      <FirstRunTour lensId="docs" />
      <DepthBadge lensId="docs" size="sm" className="ml-2" />
      <a href="#docs-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to docs content
      </a>
      <div data-lens-theme="docs" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Docs</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {TITLES[active]}{active === 'workspace' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="docs" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Docs views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                title={`${v.hint} (${v.keys})`}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <main id="docs-main">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        {realtimeData && (
          <RealtimeDataPanel
            domain="docs"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <ConnectiveTissueBar lensId="docs" />
        <CrossLensRecentsPanel lensId="docs" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={newDoc}
          title="New doc (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New doc
        </button>
      </div>
    </LensShell>
  );
}
