'use client';

/**
 * Entity — one knowledge-graph / swarm-ops app.
 *
 * Single view union (registry | graph | wikidata | agents). Nested desk
 * toggle and co-located qualia/cognitive/agent panels are folded into
 * the union + panel files. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bot, Network, Search, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { SwarmRegistryPanel } from '@/components/entity/SwarmRegistryPanel';
import { KnowledgeGraphWorkbench } from '@/components/entity/KnowledgeGraphWorkbench';
import { WikidataSearch } from '@/components/entity/WikidataSearch';
import { AgentStatusPanel } from '@/components/entity/AgentStatusPanel';
import type { EntityView } from '@/components/entity/entity-model';

const VIEWS: { id: EntityView; label: string; keys: string; hint: string; icon: typeof Bot }[] = [
  { id: 'registry', label: 'Registry', keys: '1', hint: 'Swarm entities + terminal', icon: Users },
  { id: 'graph', label: 'Graph', keys: '2', hint: 'Knowledge-graph workbench', icon: Network },
  { id: 'wikidata', label: 'Wikidata', keys: '3', hint: 'Live Wikidata import', icon: Search },
  { id: 'agents', label: 'Agents', keys: '4', hint: 'Research agent status', icon: Bot },
];

function GraphPanel() {
  return (
    <div className="p-4">
      <KnowledgeGraphWorkbench />
    </div>
  );
}

function WikidataPanel() {
  return (
    <section className="m-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <WikidataSearch />
    </section>
  );
}

function AgentsPanel() {
  return (
    <div className="p-4">
      <AgentStatusPanel />
    </div>
  );
}

const PANELS: Record<EntityView, ComponentType> = {
  registry: SwarmRegistryPanel,
  graph: GraphPanel,
  wikidata: WikidataPanel,
  agents: AgentsPanel,
};

export default function EntityLensPage() {
  useLensNav('entity');
  useLensIdentity('entity');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<EntityView>('registry');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'entity' },
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
    <LensShell lensId="entity" asMain={false}>
      <FirstRunTour lensId="entity" />
      <DepthBadge lensId="entity" size="sm" className="ml-2" />
      <div data-lens-theme="entity" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Network className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Entity</h1>
              <p className={ds.textMuted}>
                Knowledge-graph workbench + swarm registry — one entity desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Entity views"
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

        <CrossLensRecentsPanel lensId="entity" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
