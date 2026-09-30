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
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { SearchDeskPanel } from '@/components/research/SearchDeskPanel';
import { ResearchLibrarySection } from '@/components/research/ResearchLibrarySection';
import { CrossRefPanel } from '@/components/research/CrossRefPanel';
import { ResearchArxiv } from '@/components/research/ResearchArxiv';
import { ResearchWorkbench } from '@/components/research/ResearchWorkbench';

type ResearchView = 'search' | 'library' | 'crossref' | 'arxiv' | 'workbench';

const VIEWS: { id: ResearchView; label: string; keys: string; hint: string; icon: typeof Search }[] = [
  { id: 'search', label: 'Search', keys: 's', hint: 'DTU search · analyze', icon: Search },
  { id: 'library', label: 'Library', keys: 'l', hint: 'Zotero references', icon: BookMarked },
  { id: 'crossref', label: 'CrossRef', keys: 'c', hint: 'DOI lookup', icon: Link2 },
  { id: 'arxiv', label: 'arXiv', keys: 'a', hint: 'Preprint feed', icon: Newspaper },
  { id: 'workbench', label: 'Workbench', keys: 'n', hint: 'Notes · graph · canvas', icon: FileText },
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
  const [active, setActive] = useState<ResearchView>('search');

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
      <div data-lens-theme="research" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <BookMarked className="w-6 h-6 text-neon-cyan shrink-0" />
            <div className="min-w-0">
              <h1 className={ds.heading1}>Research</h1>
              <p className={ds.textMuted}>
                Zotero library + Obsidian workbench — one research desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Research views"
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

        <CrossLensRecentsPanel lensId="research" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
