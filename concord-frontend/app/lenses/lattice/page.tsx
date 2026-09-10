'use client';

/**
 * Lattice — brain self-training / consent corpus operator desk.
 * Thin shell: single `active` union → panels. REST routes live in panels.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Network, Brain, ShieldCheck, Activity, RefreshCw,
  LineChart, CalendarClock, ScrollText, Code2 as Github,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { OverviewPanel } from '@/components/lattice/OverviewPanel';
import { ConsentPanel } from '@/components/lattice/ConsentPanel';
import { BrainsPanel } from '@/components/lattice/BrainsPanel';
import { TrainingRuns } from '@/components/lattice/TrainingRuns';
import { RefreshSchedule } from '@/components/lattice/RefreshSchedule';
import { RefreshPanel } from '@/components/lattice/RefreshPanel';
import { AuditAndDrift } from '@/components/lattice/AuditAndDrift';
import { FederationPanel } from '@/components/lattice/FederationPanel';
import { LatticeRepos } from '@/components/lattice/LatticeRepos';

type LatticeView =
  | 'overview' | 'consent' | 'brains' | 'training'
  | 'schedule' | 'refresh' | 'audit' | 'federation' | 'repos';

const VIEWS: { id: LatticeView; label: string; keys: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', icon: Activity },
  { id: 'consent', label: 'Consent', keys: 'c', icon: ShieldCheck },
  { id: 'brains', label: 'Brains', keys: 'b', icon: Brain },
  { id: 'training', label: 'Training', keys: 't', icon: LineChart },
  { id: 'schedule', label: 'Schedule', keys: 's', icon: CalendarClock },
  { id: 'refresh', label: 'Refresh', keys: 'r', icon: RefreshCw },
  { id: 'audit', label: 'Audit', keys: 'a', icon: ScrollText },
  { id: 'federation', label: 'Federation', keys: 'f', icon: Network },
  { id: 'repos', label: 'Repos', keys: 'g', icon: Github },
];

function TrainingPanel() {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Training runs &amp; eval</h2>
      <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
        Experiment-tracking surface — run history with eval deltas, loss/accuracy curves,
        per-version model rollback, and a corpus-sample inspector showing the actual rows
        that fed a run.
      </p>
      <TrainingRuns />
    </section>
  );
}

function SchedulePanel() {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Refresh schedule &amp; A/B</h2>
      <RefreshSchedule />
    </section>
  );
}

function AuditPanel() {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Audit &amp; drift</h2>
      <AuditAndDrift />
    </section>
  );
}

function ReposPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Lattice tooling (external reference)</h2>
      <LatticeRepos />
    </section>
  );
}

const PANELS: Record<LatticeView, ComponentType> = {
  overview: OverviewPanel,
  consent: ConsentPanel,
  brains: BrainsPanel,
  training: TrainingPanel,
  schedule: SchedulePanel,
  refresh: RefreshPanel,
  audit: AuditPanel,
  federation: FederationPanel,
  repos: ReposPanel,
};

export default function LatticeLensPage() {
  useLensNav('lattice');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LatticeView>('overview');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'lattice' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="lattice" asMain={false}>
      <FirstRunTour lensId="lattice" />
      <DepthBadge lensId="lattice" size="sm" className="ml-2" />
      <LensVerticalHero lensId="lattice" className="mx-6 mt-4" />
      <div className="min-h-screen bg-black pb-12 text-fuchsia-50">
        <header className="sticky top-0 z-10 border-b border-fuchsia-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Network className="h-6 w-6 text-fuchsia-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Lattice</h1>
              <p className="text-xs text-fuchsia-700">Brain self-training · consent corpus · daily refresh · federation</p>
            </div>
          </div>
        </header>

        <nav className="border-b border-fuchsia-900/30 px-4 md:px-8" aria-label="Lattice sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {VIEWS.map(({ id, label, keys, icon: Icon }) => {
              const on = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-fuchsia-400',
                    on
                      ? 'border-fuchsia-400 text-fuchsia-200'
                      : 'border-transparent text-fuchsia-700 hover:text-fuchsia-400',
                  )}
                  aria-pressed={on}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                    {keys}
                  </kbd>
                </button>
              );
            })}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel
          lensId="lattice"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3 px-4 md:px-8"
        />
      </div>
    </LensShell>
  );
}
