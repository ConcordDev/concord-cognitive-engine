'use client';

/**
 * Cognition lens: the north-star look (serif title, pill views, teal floating
 * CTA) over HLR reasoning, lattice topology, breakthroughs, forgetting and
 * drift, with the brain-pool status kept on screen. The CTA opens the
 * reasoning prompt so a new trace can be started.
 */

import { useCallback, useState, type ComponentType } from 'react';
import { Activity, Brain, Lightbulb, Network, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { BrainPoolStatus } from '@/components/cognition/BrainPoolStatus';
import { ReasoningPanel } from '@/components/cognition/ReasoningPanel';
import { TopologyPanel } from '@/components/cognition/TopologyPanel';
import { BreakthroughPanel } from '@/components/cognition/BreakthroughPanel';
import { ForgettingPanel } from '@/components/cognition/ForgettingPanel';
import { DriftPanel } from '@/components/cognition/DriftPanel';
import { cn } from '@/lib/utils';

type CogView = 'reasoning' | 'topology' | 'breakthrough' | 'forgetting' | 'drift';

const VIEWS: { id: CogView; label: string; keys: string; title: string; hint: string; icon: LucideIcon }[] = [
  { id: 'reasoning', label: 'Reasoning', keys: 'r', title: 'The trace', hint: 'HLR reasoning traces', icon: Brain },
  { id: 'topology', label: 'Lattice Topology', keys: 't', title: 'The shape of it', hint: 'Lattice topology graph', icon: Network },
  { id: 'breakthrough', label: 'Breakthroughs', keys: 'b', title: 'What clicked', hint: 'Detected breakthroughs', icon: Lightbulb },
  { id: 'forgetting', label: 'Forgetting', keys: 'f', title: 'What fades', hint: 'Forgetting engine', icon: Trash2 },
  { id: 'drift', label: 'Drift', keys: 'd', title: 'What moved', hint: 'Drift alerts and timeline', icon: Activity },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<CogView>('reasoning');

  const openTrace = useCallback(() => {
    setActive('reasoning');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-lens-theme="cognition"] textarea[placeholder="What do you want HLR to reason about?"]',
      );
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `tab-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'open-trace', keys: 'n', description: 'Open a trace', category: 'actions' as const, action: openTrace },
    ],
    { lensId: 'cognition' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="cognition" asMain={false}>
      <FirstRunTour lensId="cognition" />
      <DepthBadge lensId="cognition" size="sm" className="ml-2" />
      <div data-lens-theme="cognition" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Cognition</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{active === 'reasoning' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Cognition views">
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
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <Panel />

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <BrainPoolStatus />
        </section>

        <CrossLensRecentsPanel lensId="cognition" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openTrace}
          title="Open a trace (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Open a trace
        </button>
      </div>
    </LensShell>
  );
}
