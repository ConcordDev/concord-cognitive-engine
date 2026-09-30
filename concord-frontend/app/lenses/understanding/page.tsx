'use client';

/**
 * Understanding lens — one compounding-knowledge app.
 *
 * Single `active` union. Screens live in components/understanding/.
 * Notes substrate (NotesWorkbench/Outline/Review/Graph) and engine
 * substrate (Browse/Compose/Evolution/Lineage) share one nav rail.
 * Extracted from the prior welded page — macros preserved, none invented.
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Lightbulb, Search, Plus, GitBranch, TrendingUp, RefreshCw,
  FileText, Network, ListTree, Clock,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { NotesWorkbench } from '@/components/understanding/NotesWorkbench';
import { KnowledgeGraph } from '@/components/understanding/KnowledgeGraph';
import { OutlineView } from '@/components/understanding/OutlineView';
import { ReviewQueue } from '@/components/understanding/ReviewQueue';
import { BrowsePanel } from '@/components/understanding/BrowsePanel';
import { ComposePanel } from '@/components/understanding/ComposePanel';
import { EvolutionPanel } from '@/components/understanding/EvolutionPanel';
import { LineagePanel } from '@/components/understanding/LineagePanel';
import { StatsStrip } from '@/components/understanding/StatsStrip';
import {
  understandingMacro,
  type SubjectKind,
  type EvolutionStats,
  type NotesOverview,
} from '@/components/understanding/understanding-shared';

type View =
  | 'notes'
  | 'outline'
  | 'review'
  | 'graph'
  | 'browse'
  | 'compose'
  | 'evolution'
  | 'lineage';

const TABS: { id: View; label: string; keys: string; icon: typeof FileText }[] = [
  { id: 'notes', label: 'Notes', keys: 'n', icon: FileText },
  { id: 'outline', label: 'Outline', keys: 'o', icon: ListTree },
  { id: 'review', label: 'Review', keys: 'r', icon: Clock },
  { id: 'graph', label: 'Graph', keys: 'g', icon: Network },
  { id: 'browse', label: 'Browse', keys: 'b', icon: Search },
  { id: 'compose', label: 'Compose', keys: 'c', icon: Plus },
  { id: 'evolution', label: 'Evolution', keys: 'e', icon: TrendingUp },
  { id: 'lineage', label: 'Lineage', keys: 'l', icon: GitBranch },
];

function UnderstandingPane({
  active,
  subjectKinds,
  pendingNoteId,
  onOpenNote,
  onChanged,
}: {
  active: View;
  subjectKinds: SubjectKind[];
  pendingNoteId: string | null;
  onOpenNote: (id: string) => void;
  onChanged: () => void;
}) {
  if (active === 'notes') {
    return (
      <NotesWorkbench
        key={pendingNoteId ?? 'workbench'}
        initialNoteId={pendingNoteId}
        onChanged={onChanged}
      />
    );
  }
  if (active === 'outline') return <OutlineView onOpenNote={onOpenNote} />;
  if (active === 'review') return <ReviewQueue onOpenNote={onOpenNote} onChanged={onChanged} />;
  if (active === 'graph') return <KnowledgeGraph onOpenNote={onOpenNote} />;
  if (active === 'browse') return <BrowsePanel subjectKinds={subjectKinds} />;
  if (active === 'compose') return <ComposePanel subjectKinds={subjectKinds} onComposed={onChanged} />;
  if (active === 'evolution') return <EvolutionPanel onChanged={onChanged} />;
  return <LineagePanel />;
}

export default function UnderstandingPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<View>('notes');
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [subjectKinds, setSubjectKinds] = useState<SubjectKind[]>([]);
  const [stats, setStats] = useState<EvolutionStats | null>(null);
  const [notesOverview, setNotesOverview] = useState<NotesOverview | null>(null);
  const [headerErr, setHeaderErr] = useState<string | null>(null);

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'understanding' },
  );

  const refreshHeader = useCallback(async () => {
    setHeaderErr(null);
    try {
      const [k, s] = await Promise.all([
        understandingMacro<{ ok: boolean; kinds?: SubjectKind[] }>('subject_kinds').catch(() => null),
        understandingMacro<{ ok: boolean; stats?: EvolutionStats }>('evolution_stats').catch(() => null),
      ]);
      if (k?.kinds) setSubjectKinds(k.kinds);
      if (s?.stats) setStats(s.stats);
      const ov = await lensRun<NotesOverview>('understanding', 'overview', {}).catch(() => null);
      if (ov?.data?.ok && ov.data.result) setNotesOverview(ov.data.result);
    } catch (e) {
      setHeaderErr(e instanceof Error ? e.message : 'header refresh failed');
    }
  }, []);

  useEffect(() => { refreshHeader(); }, [refreshHeader]);

  const openNoteInWorkbench = useCallback((id: string) => {
    setPendingNoteId(id);
    setActive('notes');
  }, []);

  return (
    <LensShell lensId="understanding" asMain={false}>
      <FirstRunTour lensId="understanding" />
      <DepthBadge lensId="understanding" size="sm" className="ml-2" />
      <LensVerticalHero lensId="understanding" className="mx-6 mt-4" />
      <main className={cn(ds.pageContainer, 'max-w-6xl mx-auto text-white')}>
        <header className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold text-violet-300 inline-flex items-center gap-2">
              <Lightbulb className="w-7 h-7" /> Understanding
            </h1>
            <p className="text-gray-400 mt-1">
              Compounding-knowledge substrate. Parse → compose → evolve → consolidate.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshHeader}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </header>

        <StatsStrip stats={stats} subjectKindsCount={subjectKinds.length} notesOverview={notesOverview} />
        {headerErr && <p className="text-xs text-red-400 mb-3">{headerErr}</p>}

        <nav
          className="flex gap-1 mt-5 mb-5 border-b border-white/10 overflow-x-auto"
          aria-label="Understanding views"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors',
                  on
                    ? 'border-violet-400 text-violet-300 bg-violet-500/10'
                    : 'border-transparent text-white/70 hover:text-white hover:bg-white/5',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                <kbd className="hidden sm:inline text-[10px] text-white/30 font-mono">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            <UnderstandingPane
              active={active}
              subjectKinds={subjectKinds}
              pendingNoteId={pendingNoteId}
              onOpenNote={openNoteInWorkbench}
              onChanged={refreshHeader}
            />
          </motion.div>
        </AnimatePresence>
      </main>
      <CrossLensRecentsPanel lensId="understanding" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
