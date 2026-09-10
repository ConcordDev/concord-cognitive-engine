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
  ArrowLeft, BarChart3, Coins, FileText, Filter, LineChart, Sparkles, TrendingUp, Zap,
} from 'lucide-react';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { AnalyticsDeskPanel } from '@/components/analytics/AnalyticsDeskPanel';
import { PlatformGrowth } from '@/components/analytics/PlatformGrowth';
import { EventAnalytics } from '@/components/analytics/EventAnalytics';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';
import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { type AnalyticsView, type DeskMode } from '@/components/analytics/analytics-shared';

const VIEWS: { id: AnalyticsView; label: string; keys: string; hint: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', hint: 'Creator overview', icon: BarChart3 },
  { id: 'revenue', label: 'Revenue', keys: 'r', hint: 'Revenue breakdown', icon: Coins },
  { id: 'dtus', label: 'DTUs', keys: 'd', hint: 'DTU performance', icon: FileText },
  { id: 'actions', label: 'Actions', keys: 'a', hint: 'Analyst bench', icon: Zap },
  { id: 'platform', label: 'Platform', keys: 'p', hint: 'Platform growth', icon: TrendingUp },
  { id: 'events', label: 'Events', keys: 'e', hint: 'Event analytics', icon: LineChart },
  { id: 'advanced', label: 'Advanced', keys: 'v', hint: 'Advanced analytics', icon: Sparkles },
  { id: 'funnels', label: 'Funnels', keys: 'f', hint: 'Funnel analysis', icon: Filter },
];

const DESK_MODES = new Set<AnalyticsView>(['overview', 'revenue', 'dtus', 'actions']);

export default function AnalyticsPage() {
  useLensNav('analytics');
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
      <div className="min-h-screen bg-lattice-void text-white">
        <header className="bg-lattice-surface border-b border-lattice-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Link href="/" className="p-2 rounded-lg hover:bg-lattice-elevated transition-colors" aria-label="Back">
                  <ArrowLeftIcon />
                </Link>
                <div>
                  <h1 className="text-xl font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-neon-cyan" />
                    Analytics
                  </h1>
                  <p className="text-xs text-gray-400">Creator performance · revenue · DTUs · funnels</p>
                </div>
              </div>
            </div>
            <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Analytics views">
              {VIEWS.map((v) => {
                const Icon = v.icon;
                const on = active === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActive(v.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                      on
                        ? 'border-neon-cyan text-neon-cyan'
                        : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                    )}
                    aria-current={on ? 'page' : undefined}
                  >
                    <Icon className="w-4 h-4" />
                    {v.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {body}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <a href="#analytics-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to analytics content</a>
      <CrossLensRecentsPanel lensId="analytics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function ArrowLeftIcon() {
  return <ArrowLeft className="w-4 h-4 text-gray-400" />;
}
