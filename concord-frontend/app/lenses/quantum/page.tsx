'use client';

/**
 * Quantum — one IBM Quantum / Quirk-shaped composer desk.
 *
 * Single view union (composer | research). Inline composer sprawl extracted
 * to ComposerPanel; arXiv surfaces to ResearchPanel. Thin shell (paper gold).
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Atom } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ComposerPanel } from '@/components/quantum/ComposerPanel';
import { ResearchPanel } from '@/components/quantum/ResearchPanel';
import { QUANTUM_VIEWS, type QuantumView } from '@/components/quantum/quantum-shared';
import { cn } from '@/lib/utils';

const PANELS: Record<QuantumView, ComponentType> = {
  composer: ComposerPanel,
  research: ResearchPanel,
};

export default function QuantumLensPage() {
  useLensNav('quantum');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<QuantumView>('composer');

  useLensCommand(
    [
      { id: 'view-composer', keys: 'c', description: 'Circuit composer', category: 'navigation',
        action: () => setActive('composer') },
      { id: 'view-research', keys: 'r', description: 'Quantum research', category: 'navigation',
        action: () => setActive('research') },
    ],
    { lensId: 'quantum' },
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
    <LensShell lensId="quantum" asMain={false}>
      <FirstRunTour lensId="quantum" />
      <DepthBadge lensId="quantum" size="sm" className="ml-2" />
      <LensVerticalHero lensId="quantum" className="mx-6 mt-4" />

      <div data-lens-theme="quantum" className="p-6 space-y-6">
        <header className="flex items-center gap-3">
          <Atom className="w-7 h-7 text-neon-purple" />
          <div>
            <h1 className="text-xl font-bold">Quantum Composer</h1>
            <p className="text-sm text-gray-400">
              Visual circuit composer + real state-vector simulator
            </p>
          </div>
        </header>

        <nav className="flex items-center gap-1 border-b border-lattice-border pb-3" aria-label="Quantum views">
          {QUANTUM_VIEWS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                active === tab.id
                  ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border border-transparent',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>
      </div>

      <a href="#quantum-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to quantum content
      </a>
      <CrossLensRecentsPanel lensId="quantum" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
