'use client';

/**
 * Paper lens — one Overleaf/Zotero research-writing app.
 *
 * Single view union (library | editor | workbench | discover). Accordion
 * booleans for workbench/arXiv/Open Library/CrossRef are gone. Each view
 * is a panel that owns its hooks. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookMarked, FileText, Highlighter, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { LibraryPanel } from '@/components/paper/LibraryPanel';
import { EditorPanel } from '@/components/paper/EditorPanel';
import { WorkbenchPanel } from '@/components/paper/WorkbenchPanel';
import { DiscoverPanel } from '@/components/paper/DiscoverPanel';

type PaperView = 'library' | 'editor' | 'workbench' | 'discover';

const VIEWS: { id: PaperView; label: string; keys: string; hint: string; icon: typeof FileText }[] = [
  { id: 'library', label: 'Library', keys: '1', hint: 'Zotero collections', icon: BookMarked },
  { id: 'editor', label: 'Manuscript', keys: '2', hint: 'Overleaf editor', icon: FileText },
  { id: 'workbench', label: 'Workbench', keys: '3', hint: 'PDF · DOI · groups', icon: Highlighter },
  { id: 'discover', label: 'Discover', keys: '4', hint: 'arXiv · books · DOI', icon: Search },
];

const PANELS: Record<PaperView, ComponentType> = {
  library: LibraryPanel,
  editor: EditorPanel,
  workbench: WorkbenchPanel,
  discover: DiscoverPanel,
};

export default function PaperLensPage() {
  useLensNav('paper');
  useLensIdentity('paper');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('paper');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PaperView>('library');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'paper' },
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
    <LensShell lensId="paper" asMain={false}>
      <FirstRunTour lensId="paper" />
      <DepthBadge lensId="paper" size="sm" className="ml-2" />
      <div data-lens-theme="paper" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <FileText className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Paper</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="paper" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Overleaf manuscript + Zotero library — one research-writing desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Paper views"
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="research"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
        />
        <RealtimeDataPanel data={realtimeInsights} />

        <section className="mt-3">
          <SessionRail lensId="paper" hideWhenEmpty />
        </section>
          <CrossLensRecentsPanel lensId="paper" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
