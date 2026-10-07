'use client';

/**
 * Paper lens — one Overleaf/Zotero research-writing app.
 *
 * Single view union (library | editor | workbench | discover). Accordion
 * booleans for workbench/arXiv/Open Library/CrossRef are gone. Each view
 * is a panel that owns its hooks. Page is a thin shell.
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookMarked, FileText, Highlighter, Plus, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
import { requestAddPaper } from '@/components/paper/PaperLibrary';

const TITLES: Record<string, string> = {
  library: 'The paper in front of you',
  editor: 'The manuscript',
  workbench: 'Read it closely',
  discover: 'What to read next',
};

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<PaperView>('library');
  const addPaper = useCallback(() => {
    setActive('library');
    requestAddPaper();
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
      { id: 'add-paper', keys: 'n', description: 'Add a paper', category: 'actions' as const, action: addPaper },
    ],
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
      <div data-lens-theme="paper" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Paper</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {TITLES[active]}{active === 'library' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="paper" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Paper views">
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

        <button
          type="button"
          onClick={addPaper}
          title="Add a paper (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Add a paper
        </button>
      </div>
    </LensShell>
  );
}
