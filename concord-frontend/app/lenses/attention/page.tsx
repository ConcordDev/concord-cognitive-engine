'use client';

/**
 * Attention — one RescueTime/Sunsama focus desk.
 *
 * Single view union (focus | threads | emergent). Filter/sort for threads
 * lives inside ThreadsDeskPanel. Computational macros live with the Focus
 * Toolkit that feeds them. Page is a thin shell.
 */

import { useState, type ComponentType } from 'react';
import { Focus, Layers, Brain, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { FocusDeskPanel } from '@/components/attention/FocusDeskPanel';
import { ThreadsDeskPanel } from '@/components/attention/ThreadsDeskPanel';
import { EmergentDeskPanel } from '@/components/attention/EmergentDeskPanel';

type AttentionView = 'focus' | 'threads' | 'emergent';

const VIEWS: { id: AttentionView; label: string; keys: string; title: string; hint: string; icon: typeof Focus }[] = [
  { id: 'focus', title: 'Where your focus goes', label: 'Focus', keys: '1', hint: 'Pomodoro · planner · macros', icon: Focus },
  { id: 'threads', title: 'What is holding your attention', label: 'Threads', keys: '2', hint: 'Cognitive threads · queue', icon: Layers },
  { id: 'emergent', title: 'What runs in the background', label: 'Cognition', keys: '3', hint: 'Dream · forget · repair', icon: Brain },
];

const PANELS: Record<AttentionView, ComponentType> = {
  focus: FocusDeskPanel,
  threads: ThreadsDeskPanel,
  emergent: EmergentDeskPanel,
};

export default function AttentionLensPage() {
  useLensNav('attention');
  useLensIdentity('attention');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('attention');
  const [active, setActive] = useState<AttentionView>('focus');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `attention-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'attention-focus-now', keys: 'n', description: 'Start a focus session', category: 'actions' as const, action: () => setActive('focus') },
      { id: 'attention-all', keys: 'a', description: 'All threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-active', keys: 'v', description: 'Active threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-pending', keys: 'p', description: 'Pending threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-completed', keys: 'c', description: 'Completed threads', category: 'view' as const, action: () => setActive('threads') },
    ],
    { lensId: 'attention' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="attention" asMain={false}>
      <FirstRunTour lensId="attention" />
      <DepthBadge lensId="attention" size="sm" className="ml-2" />
      <div data-lens-theme="attention" className="relative min-h-full px-8 pb-28 pt-6">
        <a href="#attention-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to attention content
        </a>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Attention</p>
            <h1 className="mb-1 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'focus' && who ? `, ${who}` : ''}
            </h1>
            <p className="mb-5 max-w-2xl text-[14px] text-zinc-500">
              Focus sessions, cognitive threads, and emergent cognition.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="attention" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
          aria-label="Attention views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main id="attention-main" className="min-w-0">
          <section key={active}>
            <Panel />
          </section>
        </main>

        <CrossLensRecentsPanel lensId="attention" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('focus')}
          title="Start a focus session (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Start focus
        </button>
      </div>
    </LensShell>
  );
}
