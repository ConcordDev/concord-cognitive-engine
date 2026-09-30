'use client';

/**
 * Worldmodel — one digital-twin / counterfactual-simulation app.
 *
 * Reference: Palantir Foundry (entity-graph world model + bounded sim).
 * Single `active` union + tab bar. Every tab is a panel under
 * components/worldmodel/. Not the 3D Concordia game client (`world`).
 */

import { useMemo, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Globe2, Loader2, Network, Boxes, GitFork, Play, GitCompareArrows,
  Camera, Library, Upload, FileSearch, RefreshCcw, type LucideIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
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

const VIEWS: { id: WmView; label: string; icon: LucideIcon; keys: string; countKey?: 'entities' | 'relations' }[] = [
  { id: 'graph', label: 'Graph', icon: Network, keys: 'g' },
  { id: 'entities', label: 'Entities', icon: Boxes, keys: 'e', countKey: 'entities' },
  { id: 'relations', label: 'Relations', icon: GitFork, keys: 'r', countKey: 'relations' },
  { id: 'simulate', label: 'Simulate', icon: Play, keys: 'i' },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows, keys: 'c' },
  { id: 'snapshots', label: 'Snapshots', icon: Camera, keys: 'n' },
  { id: 'library', label: 'Library', icon: Library, keys: 'l' },
  { id: 'ingest', label: 'Ingest', icon: Upload, keys: 'd' },
  { id: 'arxiv', label: 'arXiv', icon: FileSearch, keys: 'x' },
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
  const reduceMotion = useReducedMotion();
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
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -10 },
          transition: { duration: 0.18 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="worldmodel" asMain={false}>
      <DepthBadge lensId="worldmodel" size="sm" className="ml-2" />
      <div className="min-h-screen bg-black pb-12 text-emerald-50">
        <header className="sticky top-0 z-10 border-b border-emerald-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Globe2 className="h-6 w-6 text-emerald-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Worldmodel</h1>
              <p className="text-xs text-emerald-700">Digital twin · entity graph · counterfactual simulation</p>
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs text-emerald-600">
              {status.data && (
                <>
                  <span>{status.data.entities ?? 0} entities</span>
                  <span>{status.data.relations ?? 0} relations</span>
                  <span>{status.data.simulations ?? 0} sims</span>
                  <span>{status.data.snapshots ?? 0} snapshots</span>
                </>
              )}
            </div>
          </div>
        </header>

        <nav className="border-b border-emerald-900/30 px-4 md:px-8" aria-label="Worldmodel sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {VIEWS.map(({ id, label, icon: Icon, countKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                  active === id ? 'border-emerald-400 text-emerald-200' : 'border-transparent text-emerald-700 hover:text-emerald-400'
                }`}
                aria-pressed={active === id}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                {countKey && (
                  <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    {counts[countKey]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {sharedLoading && !sharedError && (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 text-xs text-emerald-600 md:px-8"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>Loading world model…</span>
          </div>
        )}

        {sharedError && (
          <div
            role="alert"
            className="mx-auto my-3 flex max-w-7xl flex-wrap items-center gap-3 rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 md:mx-8"
          >
            <span className="font-medium">Could not load the world model.</span>
            <span className="text-xs text-rose-400/80">{sharedError.message}</span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400"
              onClick={() => invalidateWorldModel(qc)}
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> Retry
            </button>
          </div>
        )}

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.section key={active} {...motionProps}>
              <Panel />
            </motion.section>
          </AnimatePresence>
        </main>
      </div>
    </LensShell>
  );
}
