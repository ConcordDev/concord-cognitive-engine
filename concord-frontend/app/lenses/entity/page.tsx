'use client';

/**
 * Entity lens: the north-star look (serif title, pill tabs, teal floating CTA)
 * over a full workbench. Registry is a real world-model desk (stats, filters,
 * inspector, simulate, snapshots, DTU extraction, council-gated terminal);
 * Minds opens the qualia engine; Graph, Wikidata and Agents are the existing
 * workbenches.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bot, Brain, Network, Search, Users, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';
import { SwarmRegistryPanel } from '@/components/entity/SwarmRegistryPanel';
import { MindsPanel } from '@/components/entity/MindsPanel';
import { KnowledgeGraphWorkbench } from '@/components/entity/KnowledgeGraphWorkbench';
import { WikidataSearch } from '@/components/entity/WikidataSearch';
import { AgentStatusPanel } from '@/components/entity/AgentStatusPanel';
import type { EntityView } from '@/components/entity/entity-model';

const VIEWS: { id: EntityView; label: string; keys: string; hint: string; icon: typeof Bot }[] = [
  { id: 'registry', label: 'Registry', keys: '1', hint: 'World-model entities, relations and simulation', icon: Users },
  { id: 'minds', label: 'Minds', keys: '2', hint: 'Emergent entities and their qualia', icon: Brain },
  { id: 'graph', label: 'Graph', keys: '3', hint: 'Knowledge-graph workbench', icon: Network },
  { id: 'wikidata', label: 'Wikidata', keys: '4', hint: 'Live Wikidata import', icon: Search },
  { id: 'agents', label: 'Agents', keys: '5', hint: 'Research agent status', icon: Bot },
];

const PANELS: Record<Exclude<EntityView, 'registry'>, ComponentType> = {
  minds: MindsPanel,
  graph: KnowledgeGraphWorkbench,
  wikidata: WikidataSearch,
  agents: AgentStatusPanel,
};

export default function EntityLensPage() {
  useLensNav('entity');
  useLensIdentity('entity');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<EntityView>('registry');
  const [createOpen, setCreateOpen] = useState(false);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'entity-spawn',
        keys: 'n',
        description: 'Spawn entity',
        category: 'actions' as const,
        action: () => { setActive('registry'); setCreateOpen(true); },
      },
    ],
    { lensId: 'entity' },
  );

  const Panel = active === 'registry' ? null : PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.16 } }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="entity" asMain={false}>

      <DepthBadge lensId="entity" size="sm" className="ml-2" />
      <div data-lens-theme="entity" className="relative min-h-full px-8 pb-10 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Entities</h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Entity views">
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
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {Panel ? <Panel /> : <SwarmRegistryPanel createOpen={createOpen} onCreateClose={() => setCreateOpen(false)} />}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="entity" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        {active === 'registry' && (
          <button
            type="button"
            onClick={() => setCreateOpen((o) => !o)}
            title="Spawn entity (N)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            Spawn entity
          </button>
        )}
      </div>
    </LensShell>
  );
}
