'use client';

/**
 * Services — one Square/Booksy service-business app.
 *
 * Single view union (desk | suite | feed | retention). Accordion
 * toggles for feed/retention and the bolted-on BookingSuite are folded
 * into the union. Page is a thin shell; ServicesDeskPanel owns ModeTab CRUD
 * + report macros.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Scissors, CalendarRange, MessageSquare, TrendingUp } from 'lucide-react';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ServicesDeskPanel } from '@/components/services/ServicesDeskPanel';
import { BookingSuite } from '@/components/services/BookingSuite';
import { ServicesFeed } from '@/components/services/ServicesFeed';
import { RevenueRetentionPanel } from '@/components/services/RevenueRetentionPanel';
import type { ServicesView } from '@/components/services/services-model';

const VIEWS: { id: ServicesView; label: string; keys: string; hint: string; icon: typeof Scissors }[] = [
  { id: 'desk', label: 'Desk', keys: '1', hint: 'Appointments · clients · POS', icon: Scissors },
  { id: 'suite', label: 'Booking suite', keys: '2', hint: 'Grid · self-book · shifts', icon: CalendarRange },
  { id: 'feed', label: 'Discussion', keys: '3', hint: 'Small-business feed', icon: MessageSquare },
  { id: 'retention', label: 'Revenue', keys: '4', hint: 'Revenue · retention', icon: TrendingUp },
];

function SuitePanel() {
  return (
    <section className="m-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <BookingSuite />
    </section>
  );
}

function FeedPanel() {
  return (
    <section className="m-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <ServicesFeed />
    </section>
  );
}

function RetentionPanel() {
  return (
    <section className="m-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <RevenueRetentionPanel />
    </section>
  );
}

const PANELS: Record<ServicesView, ComponentType> = {
  desk: ServicesDeskPanel,
  suite: SuitePanel,
  feed: FeedPanel,
  retention: RetentionPanel,
};

export default function ServicesLensPage() {
  useLensNav('services');
  useLensIdentity('services');
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('services');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ServicesView>('desk');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'services' },
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
    <LensShell lensId="services" asMain={false}>
      <FirstRunTour lensId="services" />
      <DepthBadge lensId="services" size="sm" className="ml-2" />
      <div data-lens-theme="services" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Scissors className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Services</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="services" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                Square Appointments desk — bookings, POS, staff, retention.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Services views"
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

        <CrossLensRecentsPanel lensId="services" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
