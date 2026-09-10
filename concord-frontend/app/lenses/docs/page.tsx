'use client';

/**
 * Docs — one Notion/Confluence documentation app.
 *
 * Single `active` union drives the tab bar. Accordion toggles for
 * DocsWorkspace / DocsToolingGallery are gone. Each view is a panel.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  Layers,
  Zap,
  Code2,
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { WorkspacePanel } from '@/components/docs/WorkspacePanel';
import { GuidePanel } from '@/components/docs/GuidePanel';
import { AnalysisPanel } from '@/components/docs/AnalysisPanel';
import { ApiHubPanel } from '@/components/docs/ApiHubPanel';
import { DocsToolingGallery } from '@/components/docs/DocsToolingGallery';

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
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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
  const [active, setActive] = useState<DocsView>('workspace');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
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
      <div data-lens-theme="docs" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl" aria-hidden>📚</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Docs</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="docs" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Notion workspace + handbook — one documentation desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Docs views"
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
        <CrossLensRecentsPanel lensId="docs" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
