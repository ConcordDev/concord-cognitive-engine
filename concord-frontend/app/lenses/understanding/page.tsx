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
  Search, Plus, GitBranch, TrendingUp, RefreshCw,
  FileText, Network, ListTree, Clock,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';
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

const TABS: { id: View; label: string; keys: string; title: string; icon: typeof FileText }[] = [
  { id: 'notes', label: 'Notes', keys: 'n', title: 'What you understand', icon: FileText },
  { id: 'outline', label: 'Outline', keys: 'o', title: 'How it is organised', icon: ListTree },
  { id: 'review', label: 'Review', keys: 'r', title: 'What is due to revisit', icon: Clock },
  { id: 'graph', label: 'Graph', keys: 'g', title: 'How it connects', icon: Network },
  { id: 'browse', label: 'Browse', keys: 'b', title: 'What the substrate knows', icon: Search },
  { id: 'compose', label: 'Compose', keys: 'c', title: 'Bring one unit in', icon: Plus },
  { id: 'evolution', label: 'Evolution', keys: 'e', title: 'How it is compounding', icon: TrendingUp },
  { id: 'lineage', label: 'Lineage', keys: 'l', title: 'Where it came from', icon: GitBranch },
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
  useLensNav('understanding');
  useLensIdentity('understanding');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = TABS.find((t) => t.id === active)!;

  return (
    <LensShell lensId="understanding" asMain={false}>
      <FirstRunTour lensId="understanding" />
      <DepthBadge lensId="understanding" size="sm" className="ml-2" />
      <div data-lens-theme="understanding" className="relative min-h-full px-8 pb-28 pt-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Understanding</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'notes' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <button
              type="button"
              onClick={refreshHeader}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[13px] text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-400/50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <DTUExportButton domain="understanding" data={{}} compact />
          </div>
        </div>

        <StatsStrip stats={stats} subjectKindsCount={subjectKinds.length} notesOverview={notesOverview} />
        {headerErr && <p className="text-xs text-red-400 mb-3">{headerErr}</p>}

        <nav className="mb-6 mt-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Understanding views">
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
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
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

        <CrossLensRecentsPanel lensId="understanding" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('compose')}
          title="Compose a unit (C)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Compose a unit
        </button>
      </div>
    </LensShell>
  );
}
