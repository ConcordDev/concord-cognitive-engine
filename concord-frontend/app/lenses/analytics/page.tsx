'use client';

/**
 * Analytics — one Bloomberg-style creator analytics desk.
 *
 * Single view union. Inline revenue/DTU sections extracted to
 * AnalyticsDeskPanel; Platform/Event/Advanced/Funnels accordion booleans
 * folded into the active union. Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3, Coins, FileText, Filter, LineChart, Sparkles, TrendingUp, Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { cn } from '@/lib/utils';
import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';
import { PlatformGrowth } from '@/components/analytics/PlatformGrowth';
import { EventAnalytics } from '@/components/analytics/EventAnalytics';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';
import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { type AnalyticsView, type DeskMode } from '@/components/analytics/analytics-shared';

const VIEWS: { id: AnalyticsView; label: string; keys: string; title: string; hint: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', title: 'How you are doing', label: 'Overview', keys: 'o', hint: 'Creator overview', icon: BarChart3 },
  { id: 'revenue', title: 'Where the money comes from', label: 'Revenue', keys: 'r', hint: 'Revenue breakdown', icon: Coins },
  { id: 'dtus', title: 'What your DTUs are doing', label: 'DTUs', keys: 'd', hint: 'DTU performance', icon: FileText },
  { id: 'actions', title: 'Put the analyst to work', label: 'Actions', keys: 'a', hint: 'Analyst bench', icon: Zap },
  { id: 'platform', title: 'How the platform is growing', label: 'Platform', keys: 'p', hint: 'Platform growth', icon: TrendingUp },
  { id: 'events', title: 'What happened, and when', label: 'Events', keys: 'e', hint: 'Event analytics', icon: LineChart },
  { id: 'advanced', title: 'The deeper numbers', label: 'Advanced', keys: 'v', hint: 'Advanced analytics', icon: Sparkles },
  { id: 'funnels', title: 'Where people drop off', label: 'Funnels', keys: 'f', hint: 'Funnel analysis', icon: Filter },
];

const DESK_MODES = new Set<AnalyticsView>(['overview', 'revenue', 'dtus', 'actions']);

export default function AnalyticsPage() {
  useLensNav('analytics');
  useLensIdentity('analytics');
  const { isLive, lastUpdated } = useRealtimeLens('analytics');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AnalyticsView>('overview');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'analytics' },
  );

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

  const current = VIEWS.find((v) => v.id === active)!;
  let body: ReactNode = null;
  if (DESK_MODES.has(active)) {
    body = <AnalyticsDeskPanel mode={active as DeskMode} />;
  } else if (active === 'platform') {
    body = <PlatformGrowth />;
  } else if (active === 'events') {
    body = <EventAnalytics />;
  } else if (active === 'advanced') {
    body = <AdvancedAnalytics />;
  } else {
    body = <FunnelsPanel />;
  }

  return (
    <LensShell lensId="analytics" asMain={false}>
      <FirstRunTour lensId="analytics" />
      <DepthBadge lensId="analytics" size="sm" className="ml-2" />
      <div data-lens-theme="analytics" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Analytics</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'overview' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="analytics" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Analytics views">
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {body}
          </motion.div>
        </AnimatePresence>

        {active !== 'actions' && (
          <button
            type="button"
            onClick={() => setActive('actions')}
            title="Open the analyst bench (A)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Zap className="h-4 w-4" />
            Ask the analyst
          </button>
        )}
      </div>
      <a href="#analytics-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to analytics content</a>
      <CrossLensRecentsPanel lensId="analytics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
