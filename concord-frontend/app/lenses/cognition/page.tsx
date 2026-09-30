'use client';

/**
 * Cognition — one HLR/HLM/breakthrough/forgetting/drift app.
 * Thin shell + single `active` union. Secondary reasoning sub-views live in ReasoningPanel.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { BrainPoolStatus } from '@/components/cognition/BrainPoolStatus';
import { ReasoningPanel } from '@/components/cognition/ReasoningPanel';
import { TopologyPanel } from '@/components/cognition/TopologyPanel';
import { BreakthroughPanel } from '@/components/cognition/BreakthroughPanel';
import { ForgettingPanel } from '@/components/cognition/ForgettingPanel';
import { DriftPanel } from '@/components/cognition/DriftPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Brain, Activity, Trash2, Network, Lightbulb, type LucideIcon,
} from 'lucide-react';

type CogView = 'reasoning' | 'topology' | 'breakthrough' | 'forgetting' | 'drift';

const VIEWS: { id: CogView; label: string; keys: string; icon: LucideIcon }[] = [
  { id: 'reasoning', label: 'Reasoning', keys: 'r', icon: Brain },
  { id: 'topology', label: 'Lattice Topology', keys: 't', icon: Network },
  { id: 'breakthrough', label: 'Breakthroughs', keys: 'b', icon: Lightbulb },
  { id: 'forgetting', label: 'Forgetting', keys: 'f', icon: Trash2 },
  { id: 'drift', label: 'Drift', keys: 'd', icon: Activity },
];

const PANELS: Record<CogView, ComponentType> = {
  reasoning: ReasoningPanel,
  topology: TopologyPanel,
  breakthrough: BreakthroughPanel,
  forgetting: ForgettingPanel,
  drift: DriftPanel,
};

export default function CognitionLensPage() {
  useLensNav('cognition');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<CogView>('reasoning');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'cognition' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="cognition" asMain={false}>
      <FirstRunTour lensId="cognition" />
      <DepthBadge lensId="cognition" size="sm" className="ml-2" />
      <div data-lens-theme="cognition" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Brain className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Cognition</h1>
              <p className={ds.textMuted}>HLR · HLM · Breakthroughs · Forgetting · Drift</p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Cognition views"
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
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            className="pt-4"
          >
            <Panel />
          </motion.div>
        </AnimatePresence>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <BrainPoolStatus />
        </section>

        <CrossLensRecentsPanel lensId="cognition" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
