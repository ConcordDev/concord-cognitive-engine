'use client';

/**
 * Graph lens — Neo4j Bloom / Obsidian-graph product.
 *
 * One perspective union. The Explore canvas owns every live graph query
 * wire (DTU paginate, worldmodel relations, graph.force/visual, nodeAnalysis /
 * clusterDetect / graphMetrics, entity create). Maps / mind-map / genome /
 * catalog are sibling perspectives, each owning their own hooks.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Network, Workflow, GitMerge, Dna, Library,
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
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { GraphBloomCanvas } from '@/components/graph/GraphBloomCanvas';
import { GraphParityPanel } from '@/components/graph/GraphParityPanel';
import { MindMapBuilder } from '@/components/graph/MindMapBuilder';
import { GraphRepos } from '@/components/graph/GraphRepos';
import KnowledgeGenomeBrowser from '@/components/visualizations/KnowledgeGenomeBrowser';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

const PERSPECTIVES = [
  { id: 'explore', label: 'Explore', hint: 'Force graph', icon: Network },
  { id: 'maps', label: 'Maps', hint: 'Filters · groups · timeline', icon: GitMerge },
  { id: 'mindmap', label: 'Mind map', hint: 'Topics · edges', icon: Workflow },
  { id: 'genome', label: 'Genome', hint: 'DTU lineage', icon: Dna },
  { id: 'catalog', label: 'Catalog', hint: 'External graph tooling', icon: Library },
] as const;

type GraphPerspective = (typeof PERSPECTIVES)[number]['id'];

export default function GraphLensPage() {
  useLensNav('graph');
  useLensIdentity('graph');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('graph');
  const [active, setActive] = useState<GraphPerspective>('explore');

  useLensCommand(
    [
      { id: 'graph-explore', keys: '1', description: 'Explore canvas', category: 'navigation', action: () => setActive('explore') },
      { id: 'graph-maps', keys: '2', description: 'Maps / filters', category: 'navigation', action: () => setActive('maps') },
      { id: 'graph-mindmap', keys: '3', description: 'Mind map', category: 'navigation', action: () => setActive('mindmap') },
      { id: 'graph-genome', keys: '4', description: 'Knowledge genome', category: 'navigation', action: () => setActive('genome') },
      { id: 'graph-catalog', keys: '5', description: 'Graph catalog', category: 'navigation', action: () => setActive('catalog') },
    ],
    { lensId: 'graph' },
  );

  return (
    <LensShell lensId="graph" asMain={false}>
      <FirstRunTour lensId="graph" />
      <div
        data-lens-theme="graph"
        className="h-full min-h-0 flex flex-col bg-[#0a0e14] text-gray-200"
        style={{ backgroundImage: 'var(--lens-gradient)' }}
      >
        <header className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-indigo-500/20 bg-[#070b12]/90">
          <Network className="w-5 h-5" style={{ color: 'var(--lens-accent)' }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-wide text-white">Graph</h1>
              <DepthBadge lensId="graph" size="sm" />
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            </div>
            <p className="text-[11px] text-gray-500 font-mono truncate">
              Bloom scene · Obsidian maps · live DTU lattice
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DTUExportButton domain="graph" data={realtimeData || {}} compact />
            <RealtimeDataPanel
              domain="graph"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={insights}
              compact
            />
          </div>
        </header>

        <nav className={cn(ds.tabBar, 'shrink-0 border-indigo-500/20 px-2')} aria-label="Graph perspectives">
          {PERSPECTIVES.map((p) => {
            const Icon = p.icon;
            const on = active === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActive(p.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                  on
                    ? 'text-indigo-300 border-indigo-400'
                    : 'text-gray-500 border-transparent hover:text-gray-200 hover:border-gray-600',
                )}
                title={`${p.hint} (${PERSPECTIVES.indexOf(p) + 1})`}
              >
                <Icon className="w-3.5 h-3.5" />
                {p.label}
                <kbd className="hidden sm:inline ml-1 px-1 rounded bg-white/5 font-mono text-[10px] text-gray-500">
                  {PERSPECTIVES.indexOf(p) + 1}
                </kbd>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-h-0 relative">
          {/* Keep the canvas mounted so physics + query cache survive perspective hops. */}
          <div className={cn('absolute inset-0', active !== 'explore' && 'invisible pointer-events-none')}>
            <GraphBloomCanvas interactive={active === 'explore'} />
          </div>

          <AnimatePresence mode="wait">
            {active !== 'explore' && (
              <motion.div
                key={active}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 overflow-auto p-4"
              >
                {active === 'maps' && <GraphParityPanel />}
                {active === 'mindmap' && <MindMapBuilder />}
                {active === 'genome' && <KnowledgeGenomeBrowser />}
                {active === 'catalog' && (
                  <section className={cn(ds.panel, 'border-indigo-500/20 bg-[#070b12]/80')}>
                    <GraphRepos />
                  </section>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0 px-4 py-2 border-t border-indigo-500/15">
          <FeedbackWidget targetType="lens" targetId="graph" />
          <CrossLensRecentsPanel lensId="graph" sinceDays={7} limit={6} hideWhenEmpty className="mt-2" />
        </div>
      </div>
    </LensShell>
  );
}
