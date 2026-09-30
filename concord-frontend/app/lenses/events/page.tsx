'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NasaEarthEvents } from '@/components/events/NasaEarthEvents';
import { EventPlanner } from '@/components/events/EventPlanner';
import { EventOps } from '@/components/events/EventOps';
import { EventsWorkbench, MODE_TABS, type ModeTab } from '@/components/events/EventsWorkbench';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  LayoutDashboard as MTabDash,
  CalendarDays as MTabCal,
  MapPin as MTabPin,
  Truck as MTabTruck,
  Users as MTabUsers,
  Ticket as MTabTicket,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Sparkles, CalendarHeart, Globe2, PartyPopper } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/** Luma / Partiful: one invite feed, one host console, no accordion pile. */
export type EventsView = ModeTab | 'host' | 'plan' | 'earth';

const VIEWS: { id: EventsView; label: string }[] = [
  { id: 'dashboard', label: 'Discover' },
  { id: 'events', label: 'Events' },
  { id: 'host', label: 'Host' },
  { id: 'venues', label: 'Venues' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'guests', label: 'Guests' },
  { id: 'runofshow', label: 'Run of show' },
  { id: 'budget', label: 'Budget' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'plan', label: 'Plan' },
  { id: 'earth', label: 'Earth' },
];

const WORKBENCH_VIEWS = new Set<EventsView>(MODE_TABS.map((t) => t.id));

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function EventsLensPage() {
  useLensNav('events');
  useLensIdentity('events');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('events');
  const [activeView, setActive] = useState<EventsView>('dashboard');
  const reduced = prefersReducedMotion();

  useLensCommand(
    [
      { id: 'tab-events', keys: 'e', description: 'Events', category: 'navigation', action: () => setActive('events') },
      { id: 'tab-dashboard', keys: 'd', description: 'Discover', category: 'navigation', action: () => setActive('dashboard') },
      { id: 'tab-host', keys: 'h', description: 'Host console', category: 'navigation', action: () => setActive('host') },
      { id: 'tab-vendors', keys: 'v', description: 'Vendors', category: 'navigation', action: () => setActive('vendors') },
      { id: 'tab-venues', keys: 'n', description: 'Venues', category: 'navigation', action: () => setActive('venues') },
      { id: 'tab-runofshow', keys: 'r', description: 'Run of show', category: 'navigation', action: () => setActive('runofshow') },
      { id: 'tab-budget', keys: 'b', description: 'Budget', category: 'navigation', action: () => setActive('budget') },
      { id: 'tab-tickets', keys: 't', description: 'Tickets', category: 'navigation', action: () => setActive('tickets') },
      { id: 'tab-guests', keys: 'g', description: 'Guests', category: 'navigation', action: () => setActive('guests') },
      { id: 'tab-plan', keys: 'p', description: 'Planning workbench', category: 'navigation', action: () => setActive('plan') },
    ],
    { lensId: 'events' },
  );

  return (
    <LensShell lensId="events" asMain={false}>
      <FirstRunTour lensId="events" />
      <DepthBadge lensId="events" size="sm" className="ml-2" />
      <div data-lens-theme="events" className={ds.pageContainer} style={{ ['--lens-accent' as string]: 'var(--lens-accent, #AD1457)' }}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <PartyPopper className="w-7 h-7 shrink-0" style={{ color: 'var(--lens-accent, #AD1457)' }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Events</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              </div>
              <p className={ds.textMuted}>
                Invite, host, check in — Luma-dense, nothing invented.
                <kbd className="ml-2 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">E</kbd> events
                <kbd className="ml-1 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">H</kbd> host
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DTUExportButton domain="events" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <button type="button" onClick={() => setActive('host')} className={ds.btnPrimary}>
              <Sparkles className="w-4 h-4" /> Host an event
            </button>
          </div>
        </header>

        <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap" aria-label="Events views">
          {VIEWS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                activeView === tab.id
                  ? 'bg-[color:var(--lens-accent,#AD1457)]/20 text-pink-200 border border-pink-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border border-transparent',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {WORKBENCH_VIEWS.has(activeView) && (
              <EventsWorkbench
                mode={activeView as ModeTab}
                onOpenHost={() => setActive('host')}
                onSelectMode={(m) => setActive(m)}
              />
            )}
            {activeView === 'host' && (
              <section className={cn(ds.panel, 'p-4')}>
                <h2 className={ds.heading2}>Host console</h2>
                <p className={cn(ds.textMuted, 'mb-3')}>Ticketing, floor, check-in, blasts — the real events engine.</p>
                <EventOps />
              </section>
            )}
            {activeView === 'plan' && (
              <section className={cn(ds.panel, 'p-4')}>
                <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
                  <CalendarHeart className="w-4 h-4 text-neon-cyan" /> Planning workbench
                </h2>
                <EventPlanner />
              </section>
            )}
            {activeView === 'earth' && (
              <section className={cn(ds.panel, 'p-4')}>
                <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
                  <Globe2 className="w-4 h-4 text-emerald-400" /> NASA Earth events
                </h2>
                <p className={cn(ds.textMuted, 'mb-3')}>External EONET feed — reference only, not your guest list.</p>
                <NasaEarthEvents />
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="events"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
        <CrossLensRecentsPanel lensId="events" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
        <MobileTabBar
          tabs={[
            { id: 'dashboard', label: 'Discover', icon: MTabDash },
            { id: 'events', label: 'Events', icon: MTabCal },
            { id: 'host', label: 'Host', icon: MTabTicket },
            { id: 'venues', label: 'Venues', icon: MTabPin },
            { id: 'vendors', label: 'Vendors', icon: MTabTruck },
            { id: 'guests', label: 'Guests', icon: MTabUsers },
          ]}
          active={activeView}
          onSelect={(id) => setActive(id as EventsView)}
        />
      </div>
    </LensShell>
  );
}
