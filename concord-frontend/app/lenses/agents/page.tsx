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
import { Bot, GitFork, Users } from 'lucide-react';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { FleetPanel } from '@/components/agents/FleetPanel';
import { AgentRoster } from '@/components/agents/AgentRoster';
import { ForkPreviewPanel } from '@/components/agents/ForkPreviewPanel';
import type { AgentsView } from '@/components/agents/agents-model';

const VIEWS: { id: AgentsView; label: string; keys: string; hint: string; icon: typeof Bot }[] = [
  { id: 'fleet', label: 'Fleet', keys: 'f', hint: 'Control center + runtime', icon: Bot },
  { id: 'roster', label: 'Roster', keys: 'r', hint: '/api/agents research roster', icon: Users },
  { id: 'fork', label: 'Forked self', keys: 'k', hint: 'Lattice fork preview', icon: GitFork },
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
      <div data-lens-theme="agents" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Bot className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Agents</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="agents" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                AutoGPT-shaped control center — fleet, research roster, fork preview.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Agents views"
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
      </div>
    </LensShell>
  );
}
