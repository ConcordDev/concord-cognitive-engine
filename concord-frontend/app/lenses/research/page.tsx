'use client';

/**
 * Research — one Zotero/Obsidian research desk.
 *
 * Single `active` union (search | library | crossref | arxiv | workbench).
 * Floating workbench drawer accordion is folded into the tab bar.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Search,
  BookMarked,
  Link2,
  Newspaper,
  FileText,
  Plus,
} from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { SearchDeskPanel } from '@/components/research/SearchDeskPanel';
import { ResearchLibrarySection } from '@/components/research/ResearchLibrarySection';
import { CrossRefPanel } from '@/components/research/CrossRefPanel';
import { ResearchArxiv } from '@/components/research/ResearchArxiv';
import { ResearchWorkbench } from '@/components/research/ResearchWorkbench';

type ResearchView = 'search' | 'library' | 'crossref' | 'arxiv' | 'workbench';

const VIEWS: { id: ResearchView; label: string; keys: string; title: string; hint: string; icon: typeof Search }[] = [
  { id: 'search', title: 'What the substrate knows', label: 'Search', keys: 's', hint: 'DTU search · analyze', icon: Search },
  { id: 'library', title: 'What you have collected', label: 'Library', keys: 'l', hint: 'Zotero references', icon: BookMarked },
  { id: 'crossref', title: 'Resolve any DOI', label: 'CrossRef', keys: 'c', hint: 'DOI lookup', icon: Link2 },
  { id: 'arxiv', title: 'What is new on arXiv', label: 'arXiv', keys: 'a', hint: 'Preprint feed', icon: Newspaper },
  { id: 'workbench', title: 'Where the notes live', label: 'Workbench', keys: 'n', hint: 'Notes · graph · canvas', icon: FileText },
];

function LibraryPanel() {
  return (
    <div className="px-1">
      <ResearchLibrarySection />
    </div>
  );
}

function CrossRefViewPanel() {
  return <CrossRefPanel domain="research" />;
}

function ArxivViewPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <ResearchArxiv />
    </section>
  );
}

function WorkbenchViewPanel() {
  return <ResearchWorkbench embedded />;
}

const PANELS: Record<ResearchView, ComponentType> = {
  search: SearchDeskPanel,
  library: LibraryPanel,
  crossref: CrossRefViewPanel,
  arxiv: ArxivViewPanel,
  workbench: WorkbenchViewPanel,
};

export default function ResearchLensPage() {
  useLensNav('research');
  useLensIdentity('research');
  const reduceMotion = useReducedMotion();
  const { isLive, lastUpdated } = useRealtimeLens('research');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<ResearchView>('search');
  const current = VIEWS.find((v) => v.id === active)!;

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'research' },
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
    <LensShell lensId="research" asMain={false}>
      <FirstRunTour lensId="research" />
      <DepthBadge lensId="research" size="sm" className="ml-2" />
      <div data-lens-theme="research" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Research</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'search' && who ? `, ${who}` : ''}
            </h1>
          </div>
          {active !== 'search' && (
            <div className="flex shrink-0 items-center gap-3 pt-2">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="research" data={{}} compact />
            </div>
          )}
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Research views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="research" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        {active !== 'workbench' && (
          <button
            type="button"
            onClick={() => setActive('workbench')}
            title="Open the notes workbench (N)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            New note
          </button>
        )}
      </div>
    </LensShell>
  );
}
