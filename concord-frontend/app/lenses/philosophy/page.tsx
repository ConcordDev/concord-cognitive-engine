'use client';

/**
 * Philosophy — Are.na + IEP-shape curation rebuild (Frontend Rebuild
 * Program, Wave 2).
 *
 * Reference targets: Are.na (channels of connected blocks — text / link /
 * quote / image / embed — with cross-connection, collaboration and
 * publishing) for the curation substrate, and a real argument-mapping /
 * philosophy-encyclopedia idiom (Kialo-style structured argument mapping,
 * Stanford Encyclopedia of Philosophy / IEP-style reference pages) for the
 * dilemma-analysis side. See docs/lens-specs/philosophy-capability-map.md
 * for the full researched checklist and disposition of every item.
 *
 * This rebuild retires a generic multi-artifact-type CRUD library
 * (Argument/Concept/Thinker/Tradition/Dialogue, backed by the generic
 * `useLensData` DTU-artifact system at `/api/lens/philosophy`) that used to
 * be the PRIMARY surface of this page. That system was architecturally
 * disconnected from the real `philosophy` domain: user-typed free-text
 * records rendered as if they were a live philosophy substrate, while the
 * real STATE-backed Are.na-shape curation engine (channels / blocks /
 * debates / references) and the 4 real analysis macros (argumentMap /
 * thoughtExperiment / dialecticSynthesis / ethicalFramework) sat mounted
 * below as an afterthought in `DilemmaPanel` / `PhilosophyChannels` /
 * `PhilosophyCuration`. The "Run AI analysis" button on the fake CRUD
 * detail panel dispatched `philosophy.analyze`, which is not a registered
 * macro — it silently fell through to the generic utility-brain AI
 * catch-all (`server.js` lens.run's unregistered-action fallback) with no
 * UI surface to show the result. All of this is gone.
 *
 * Every number and action on this page now traces to a live `philosophy`
 * macro call.
 */

import { useState } from 'react';
import {
  BookOpen, LayoutDashboard, ScrollText, Network, Newspaper,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { PhilosophyOverview } from '@/components/philosophy/PhilosophyOverview';
import { DilemmaPanel } from '@/components/philosophy/DilemmaPanel';
import { PhilosophyChannels } from '@/components/philosophy/PhilosophyChannels';
import { PhilosophyCuration } from '@/components/philosophy/PhilosophyCuration';
import { PhiloFeed } from '@/components/philosophy/PhiloFeed';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

type Destination = 'overview' | 'dilemma' | 'curation' | 'pulse';

const DESTINATIONS: { id: Destination; label: string; icon: typeof BookOpen; desc: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, desc: 'Live curation KPIs & recent debates' },
  { id: 'dilemma', label: 'Dilemma Workbench', icon: ScrollText, desc: 'Argument map · thought experiment · dialectic · ethics' },
  { id: 'curation', label: 'Curation Studio', icon: Network, desc: 'Channels · image grid · discovery · reference pages · debates' },
  { id: 'pulse', label: 'Community Pulse', icon: Newspaper, desc: 'Real philosophy.stackexchange.com Q&A' },
];

export default function PhilosophyLensPage() {
  useLensNav('philosophy');
  const [dest, setDest] = useState<Destination>('overview');

  // Real navigation shortcuts only — the old "/" focus-search binding
  // targeted the retired generic CRUD library's search box. Curation
  // Studio and the analysis panels each own their own real search / input
  // fields; there is no single page-level search field to fake a shortcut
  // for, so none is registered here.
  useLensCommand(
    [
      { id: 'goto-overview', keys: 'g o', description: 'Go to Overview', category: 'navigation', action: () => setDest('overview') },
      { id: 'goto-dilemma', keys: 'g d', description: 'Go to Dilemma Workbench', category: 'navigation', action: () => setDest('dilemma') },
      { id: 'goto-curation', keys: 'g c', description: 'Go to Curation Studio', category: 'navigation', action: () => setDest('curation') },
      { id: 'goto-pulse', keys: 'g p', description: 'Go to Community Pulse', category: 'navigation', action: () => setDest('pulse') },
    ],
    { lensId: 'philosophy' }
  );

  return (
    <LensShell lensId="philosophy" asMain={false}>
      <FirstRunTour lensId="philosophy" />
      <div data-lens-theme="philosophy" className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">Philosophy</h1>
                <DepthBadge lensId="philosophy" size="sm" />
              </div>
              <p className="text-sm text-gray-400">
                Argument mapping, ethical frameworks, and an Are.na-shape channel/block idea-curation studio.
              </p>
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-2 border-b border-lattice-border pb-3" aria-label="Philosophy destinations">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const active = dest === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDest(d.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors min-w-[9rem]',
                  active ? 'bg-purple-500/15 border border-purple-500/40' : 'border border-transparent hover:bg-lattice-elevated hover:border-lattice-border'
                )}
              >
                <span className={cn('flex items-center gap-1.5 text-sm font-medium', active ? 'text-purple-200' : 'text-gray-300 group-hover:text-white')}>
                  <Icon className="w-4 h-4" /> {d.label}
                </span>
                <span className="text-[10px] text-gray-500 leading-tight">{d.desc}</span>
              </button>
            );
          })}
        </nav>

        {dest === 'overview' && <PhilosophyOverview onJump={(d) => setDest(d)} />}

        {dest === 'dilemma' && (
          <section aria-label="Dilemma workbench">
            <DilemmaPanel />
          </section>
        )}

        {dest === 'curation' && (
          <section aria-label="Curation studio" className="space-y-6">
            <WikipediaSearchPanel domain="philosophy" title="Wikipedia · quick search" />
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <PhilosophyChannels />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <PhilosophyCuration />
            </div>
          </section>
        )}

        {dest === 'pulse' && (
          <section aria-label="Community pulse" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PhiloFeed />
          </section>
        )}
      </div>

      {/* Accessibility skip-link sentinel — never visually displayed. */}
      <a href="#philosophy-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-purple-500 focus:outline-none">
        Skip to philosophy content
      </a>
    </LensShell>
  );
}
