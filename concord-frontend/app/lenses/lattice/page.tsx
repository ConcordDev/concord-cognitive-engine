'use client';

/**
 * Lattice — brain self-training / consent corpus operator desk.
 * Thin shell: single `active` union → panels. REST routes live in panels.
 */

import { useState, type ComponentType } from 'react';
import {
  Network, Brain, ShieldCheck, Activity, RefreshCw,
  LineChart, CalendarClock, ScrollText, Code2 as Github, Brain as BrainIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const VIEWS: { id: LatticeView; label: string; keys: string; title: string; hint: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', title: 'The lattice', hint: 'Brain health, corpus size and recent runs', icon: Activity },
  { id: 'consent', label: 'Consent', keys: 'c', title: 'What you have consented to', hint: 'Opt-in training corpus', icon: ShieldCheck },
  { id: 'brains', label: 'Brains', keys: 'b', title: 'The brains', hint: 'Per-brain models and versions', icon: Brain },
  { id: 'training', label: 'Training', keys: 't', title: 'Every training run', hint: 'Run history, eval deltas, rollback', icon: LineChart },
  { id: 'schedule', label: 'Schedule', keys: 's', title: 'When the lattice refreshes', hint: 'Refresh schedule and A/B', icon: CalendarClock },
  { id: 'refresh', label: 'Refresh', keys: 'r', title: 'Refresh the lattice', hint: 'Trigger and watch a refresh', icon: RefreshCw },
  { id: 'audit', label: 'Audit', keys: 'a', title: 'What changed and drifted', hint: 'Audit trail and drift', icon: ScrollText },
  { id: 'federation', label: 'Federation', keys: 'f', title: 'The federation', hint: 'Peers sharing the lattice', icon: Network },
  { id: 'repos', label: 'Repos', keys: 'g', title: 'Lattice tooling', hint: 'External reference repos', icon: Github },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<LatticeView>('overview');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `tab-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'open-brain', keys: 'n', description: 'Open a brain', category: 'actions' as const, action: () => setActive('brains') },
    ],
    { lensId: 'lattice' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="lattice" asMain={false}>
      <FirstRunTour lensId="lattice" />
      <DepthBadge lensId="lattice" size="sm" className="ml-2" />
      <div data-lens-theme="lattice" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Lattice</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{active === 'overview' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Lattice sections">
          {VIEWS.map(({ id, label, keys, hint, icon: Icon }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                aria-current={on ? 'page' : undefined}
                title={`${hint} (${keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{keys}</kbd>
              </button>
            );
          })}
        </nav>

        <p className="mb-5 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Brain self-training · consent corpus · daily refresh · federation.
        </p>

        <div className="rounded-2xl border border-white/10 bg-[#111] p-5 text-fuchsia-50">
          <Panel />
        </div>

        <CrossLensRecentsPanel lensId="lattice" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('brains')}
          title="Open a brain (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <BrainIcon className="h-4 w-4" />
          Open a brain
        </button>
      </div>
    </LensShell>
  );
}
