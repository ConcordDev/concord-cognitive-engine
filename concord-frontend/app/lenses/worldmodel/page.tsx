'use client';

/**
 * Worldmodel — one digital-twin / counterfactual-simulation app.
 *
 * Reference: Palantir Foundry (entity-graph world model + bounded sim).
 * Single `active` union + tab bar. Every tab is a panel under
 * components/worldmodel/. Not the 3D Concordia game client (`world`).
 */

import { useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Network, Boxes, GitFork, Play, GitCompareArrows, Library as LibraryIcon,
  Camera, Upload, FileSearch, RefreshCcw, type LucideIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { GraphPanel } from '@/components/worldmodel/GraphPanel';
import { EntitiesPanel } from '@/components/worldmodel/EntitiesPanel';
import { RelationsPanel } from '@/components/worldmodel/RelationsPanel';
import { SimulatePanel } from '@/components/worldmodel/SimulatePanel';
import { ComparePanel } from '@/components/worldmodel/ComparePanel';
import { SnapshotsPanel } from '@/components/worldmodel/SnapshotsPanel';
import { LibraryPanel } from '@/components/worldmodel/LibraryPanel';
import { IngestPanel } from '@/components/worldmodel/IngestPanel';
import { WorldModelArxiv } from '@/components/worldmodel/WorldModelArxiv';
import { invalidateWorldModel, wmRun, WM_QUERY_KEYS } from '@/components/worldmodel/wm-shared';

type WmView =
  | 'graph'
  | 'entities'
  | 'relations'
  | 'simulate'
  | 'compare'
  | 'snapshots'
  | 'library'
  | 'ingest'
  | 'arxiv';

const VIEWS: { id: WmView; label: string; icon: LucideIcon; keys: string; title: string; countKey?: 'entities' | 'relations' }[] = [
  { id: 'graph', label: 'Graph', icon: Network, keys: 'g', title: 'The model' },
  { id: 'entities', label: 'Entities', icon: Boxes, keys: 'e', title: 'Everything in the model', countKey: 'entities' },
  { id: 'relations', label: 'Relations', icon: GitFork, keys: 'r', title: 'How things connect', countKey: 'relations' },
  { id: 'simulate', label: 'Simulate', icon: Play, keys: 'i', title: 'What happens if' },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows, keys: 'c', title: 'Two futures, side by side' },
  { id: 'snapshots', label: 'Snapshots', icon: Camera, keys: 'n', title: 'The model, frozen in time' },
  { id: 'library', label: 'Library', icon: LibraryIcon, keys: 'l', title: 'Models you can open' },
  { id: 'ingest', label: 'Ingest', icon: Upload, keys: 'd', title: 'Feed the model' },
  { id: 'arxiv', label: 'arXiv', icon: FileSearch, keys: 'x', title: 'Research behind world models' },
];

const PANELS: Record<WmView, ComponentType> = {
  graph: GraphPanel,
  entities: EntitiesPanel,
  relations: RelationsPanel,
  simulate: SimulatePanel,
  compare: ComparePanel,
  snapshots: SnapshotsPanel,
  library: LibraryPanel,
  ingest: IngestPanel,
  arxiv: WorldModelArxiv,
};

export default function WorldmodelLensPage() {
  useLensNav('worldmodel');
  const qc = useQueryClient();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<WmView>('graph');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'worldmodel' },
  );

  const status = useQuery({
    queryKey: WM_QUERY_KEYS.status,
    queryFn: () => wmRun<Record<string, number>>('wm_status'),
    refetchInterval: 30_000,
  });
  const entities = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: unknown[] }>('wm_list_entities'),
  });
  const relations = useQuery({
    queryKey: WM_QUERY_KEYS.relations,
    queryFn: () => wmRun<{ relations: unknown[] }>('wm_list_relations'),
  });
  const graph = useQuery({
    queryKey: WM_QUERY_KEYS.graph,
    queryFn: () => wmRun('graph'),
  });

  const sharedError =
    (status.isError && (status.error as Error)) ||
    (entities.isError && (entities.error as Error)) ||
    (relations.isError && (relations.error as Error)) ||
    (graph.isError && (graph.error as Error)) ||
    null;
  const sharedLoading =
    status.isLoading || entities.isLoading || relations.isLoading || graph.isLoading;

  const counts: Record<'entities' | 'relations', number> = {
    entities: status.data?.entities ?? entities.data?.entities?.length ?? 0,
    relations: status.data?.relations ?? relations.data?.relations?.length ?? 0,
  };

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;
  const stats = status.data;

  return (
    <LensShell lensId="worldmodel" asMain={false}>
      <FirstRunTour lensId="worldmodel" />
      <DepthBadge lensId="worldmodel" size="sm" className="ml-2" />
      <div data-lens-theme="worldmodel" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">World Model</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'graph' && who ? `, ${who}` : ''}
            </h1>
          </div>
          {stats && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[13px] text-zinc-500">
              <span>{stats.entities ?? 0} entities</span>
              <span>{stats.relations ?? 0} relations</span>
              <span>{stats.simulations ?? 0} sims</span>
              <span>{stats.snapshots ?? 0} snapshots</span>
            </div>
          )}
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Worldmodel sections">
          {VIEWS.map(({ id, label, icon: Icon, keys, countKey }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                aria-current={on ? 'page' : undefined}
                title={`${label} (${keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
                {countKey && (
                  <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-zinc-300">{counts[countKey]}</span>
                )}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{keys}</kbd>
              </button>
            );
          })}
        </nav>

        {sharedLoading && !sharedError && (
          <div role="status" aria-live="polite" className="mb-4 flex items-center gap-2 text-[13px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>Loading world model…</span>
          </div>
        )}

        {sharedError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            <span className="font-medium">Could not load the world model.</span>
            <span className="text-xs text-rose-400/80">{sharedError.message}</span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400"
              onClick={() => invalidateWorldModel(qc)}
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> Retry
            </button>
          </div>
        )}

        <section key={active}>
          <Panel />
        </section>

        <CrossLensRecentsPanel lensId="worldmodel" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('library')}
          title="Open a model (L)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <LibraryIcon className="h-4 w-4" />
          Open a model
        </button>
      </div>
    </LensShell>
  );
}
