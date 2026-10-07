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

import { useCallback, useState } from 'react';
import {
  LayoutDashboard, ScrollText, Network, Newspaper, Play,
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
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type Destination = 'overview' | 'dilemma' | 'curation' | 'pulse';

const DESTINATIONS: { id: Destination; label: string; title: string; keys: string; icon: typeof LayoutDashboard; desc: string }[] = [
  { id: 'overview', title: 'The question on the table', keys: 'g o', label: 'Overview', icon: LayoutDashboard, desc: 'Live curation KPIs & recent debates' },
  { id: 'dilemma', title: 'Work the problem', keys: 'g d', label: 'Dilemma Workbench', icon: ScrollText, desc: 'Argument map · thought experiment · dialectic · ethics' },
  { id: 'curation', title: 'Collect the ideas', keys: 'g c', label: 'Curation Studio', icon: Network, desc: 'Channels · image grid · discovery · reference pages · debates' },
  { id: 'pulse', title: 'What others are asking', keys: 'g p', label: 'Community Pulse', icon: Newspaper, desc: 'Real philosophy.stackexchange.com Q&A' },
];

export default function PhilosophyLensPage() {
  useLensNav('philosophy');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [dest, setDest] = useState<Destination>('overview');

  const begin = useCallback(() => {
    setDest('dilemma');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="philosophy"] section[aria-label="Dilemma workbench"] textarea, [data-lens-theme="philosophy"] section[aria-label="Dilemma workbench"] input');
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

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
      { id: 'begin', keys: 'b', description: 'Begin — open the dilemma workbench', category: 'actions', action: begin },
      { id: 'goto-pulse', keys: 'g p', description: 'Go to Community Pulse', category: 'navigation', action: () => setDest('pulse') },
    ],
    { lensId: 'philosophy' }
  );

  return (
    <LensShell lensId="philosophy" asMain={false}>
      <FirstRunTour lensId="philosophy" />
      <DepthBadge lensId="philosophy" size="sm" className="ml-2" />
      <div data-lens-theme="philosophy" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Philosophy</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {DESTINATIONS.find((d) => d.id === dest)!.title}{dest === 'overview' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Philosophy destinations">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const on = dest === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDest(d.id)}
                aria-current={on ? 'page' : undefined}
                title={`${d.desc} (${d.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {d.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{d.keys}</kbd>
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
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PhilosophyChannels />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PhilosophyCuration />
            </div>
          </section>
        )}

        {dest === 'pulse' && (
          <section aria-label="Community pulse" className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <PhiloFeed />
          </section>
        )}

        <CrossLensRecentsPanel lensId="philosophy" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={begin}
          title="Begin (B)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Play className="h-4 w-4" />
          Begin
        </button>
      </div>

      {/* Accessibility skip-link sentinel — never visually displayed. */}
      <a href="#philosophy-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-purple-500 focus:outline-none">
        Skip to philosophy content
      </a>
    </LensShell>
  );
}
