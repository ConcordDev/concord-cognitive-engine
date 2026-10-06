'use client';

/**
 * Agents — one agent-control-center app.
 *
 * Single view union (fleet | roster | fork). Fleet owns CRUD + executeRun +
 * diagnostics; roster is the adjacent /api/agents research system; fork is
 * the lattice-fork preview. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bot, GitFork, Plus, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { FleetPanel } from '@/components/agents/FleetPanel';
import { AgentRoster } from '@/components/agents/AgentRoster';
import { ForkPreviewPanel } from '@/components/agents/ForkPreviewPanel';
import type { AgentsView } from '@/components/agents/agents-model';

const VIEWS: { id: AgentsView; label: string; keys: string; title: string; hint: string; icon: typeof Bot }[] = [
  { id: 'fleet', title: 'Who is working for you', label: 'Fleet', keys: 'f', hint: 'Control center + runtime', icon: Bot },
  { id: 'roster', title: 'The research roster', label: 'Roster', keys: 'r', hint: '/api/agents research roster', icon: Users },
  { id: 'fork', title: 'Your forked self', label: 'Forked self', keys: 'k', hint: 'Lattice fork preview', icon: GitFork },
];

const PANELS: Record<AgentsView, ComponentType> = {
  fleet: FleetPanel,
  roster: AgentRoster,
  fork: ForkPreviewPanel,
};

export default function AgentsLensPage() {
  useLensNav('agents');
  useLensIdentity('agents');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('agents');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<'fleet' | 'roster' | 'fork'>('fleet');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'agents' },
  );

  const Panel = PANELS[active];
  const current = VIEWS.find((v) => v.id === active)!;
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
    <LensShell lensId="agents" asMain={false}>
      <FirstRunTour lensId="agents" />
      <DepthBadge lensId="agents" size="sm" className="ml-2" />
      <div data-lens-theme="agents" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Agents</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'fleet' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="agents" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Agents views">
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
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="agents"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <SessionRail lensId="agents" hideWhenEmpty className="mt-4" />
        <CrossLensRecentsPanel lensId="agents" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />

        <button
          type="button"
          onClick={() => {
            setActive('fleet');
            requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('agents:new')));
          }}
          title="New agent (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New agent
        </button>
      </div>
    </LensShell>
  );
}
