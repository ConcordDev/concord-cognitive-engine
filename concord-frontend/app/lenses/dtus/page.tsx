'use client';

/**
 * DTUs — one Roam/Obsidian-style vault browser.
 *
 * Single view union (browser | workbench | trending | ops). Stacked
 * workbench/ops/trending accordion piles are folded into the union.
 * Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Database, Wrench, TrendingUp, Cpu } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { BrowserPanel } from '@/components/dtus/BrowserPanel';
import { WorkbenchPanel } from '@/components/dtus/WorkbenchPanel';
import { TrendingDtus } from '@/components/dtus/TrendingDtus';
import { OpsPanel } from '@/components/dtus/OpsPanel';

type DtusView = 'browser' | 'workbench' | 'trending' | 'ops';

const VIEWS: { id: DtusView; label: string; keys: string; hint: string; icon: typeof Database }[] = [
  { id: 'browser', label: 'Browser', keys: '1', hint: 'Vault list · compute actions', icon: Database },
  { id: 'workbench', label: 'Workbench', keys: '2', hint: 'Citation · lineage · bulk · layers', icon: Wrench },
  { id: 'trending', label: 'Trending', keys: '3', hint: 'Discovery trending', icon: TrendingUp },
  { id: 'ops', label: 'Operations', keys: '4', hint: 'Substrate macro probes', icon: Cpu },
];

function TrendingPane() {
  return (
    <section className="rounded-xl border border-lattice-border bg-lattice-deep/40 p-4">
      <TrendingDtus />
    </section>
  );
}

const PANELS: Record<DtusView, ComponentType> = {
  browser: BrowserPanel,
  workbench: WorkbenchPanel,
  trending: TrendingPane,
  ops: OpsPanel,
};

export default function DTUBrowserPage() {
  useLensNav('dtus');
  useLensIdentity('dtus');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<DtusView>('browser');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'dtus' },
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
    <LensShell lensId="dtus" asMain={false}>
      <FirstRunTour lensId="dtus" />
      <DepthBadge lensId="dtus" size="sm" className="ml-2" />
      <div data-lens-theme="dtus" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-neon-blue to-neon-cyan flex items-center justify-center">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>DTU Browser</h1>
              <p className={ds.textMuted}>
                Personal vault + knowledge workbench — one discrete-thought desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="DTU views"
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

        <main className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="dtus" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
