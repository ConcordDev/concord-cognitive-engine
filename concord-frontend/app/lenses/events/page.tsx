'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Sparkles, CalendarHeart, Globe2 } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/** Luma / Partiful: one invite feed, one host console, no accordion pile. */
export type EventsView = ModeTab | 'host' | 'plan' | 'earth';

const VIEWS: { id: EventsView; label: string; keys?: string; title: string }[] = [
  { id: 'dashboard', label: 'Discover', keys: 'd', title: 'Find the next gathering' },
  { id: 'events', label: 'Events', keys: 'e', title: 'Track every event' },
  { id: 'host', label: 'Host', keys: 'h', title: 'Host the night' },
  { id: 'venues', label: 'Venues', keys: 'n', title: 'Scout the venues' },
  { id: 'vendors', label: 'Vendors', keys: 'v', title: 'Line up the vendors' },
  { id: 'guests', label: 'Guests', keys: 'g', title: 'Manage the guest list' },
  { id: 'runofshow', label: 'Run of show', keys: 'r', title: 'Call the run of show' },
  { id: 'budget', label: 'Budget', keys: 'b', title: 'Keep the budget honest' },
  { id: 'tickets', label: 'Tickets', keys: 't', title: 'Sell the tickets' },
  { id: 'plan', label: 'Plan', keys: 'p', title: 'Plan it out' },
  { id: 'earth', label: 'Earth', title: 'Watch the Earth' },
];

const WORKBENCH_VIEWS = new Set<EventsView>(MODE_TABS.map((t) => t.id));

export default function EventsLensPage() {
  useLensNav('events');
  useLensIdentity('events');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('events');
  const [activeView, setActive] = useState<EventsView>('dashboard');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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

  const current = VIEWS.find((v) => v.id === activeView)!;

  return (
    <LensShell lensId="events" asMain={false}>
      <FirstRunTour lensId="events" />
      <DepthBadge lensId="events" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="events"
        crumb="Events"
        title={`${current.title}${activeView === 'dashboard' && who ? `, ${who}` : ''}`}
        subtitle="Invite, host, check in — Luma-dense, nothing invented."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="events" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys }))}
        activeTab={activeView}
        onTab={(id) => setActive(id as EventsView)}
        tabsLabel="Events views"
        cta={{ label: 'Host an event', icon: Sparkles, onClick: () => setActive('host') }}
      >
        {WORKBENCH_VIEWS.has(activeView) && (
              <EventsWorkbench
                mode={activeView as ModeTab}
                onOpenHost={() => setActive('host')}
                onSelectMode={(m) => setActive(m)}
              />
            )}
            {activeView === 'host' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <h2 className={ds.heading2}>Host console</h2>
                <p className={cn(ds.textMuted, 'mb-3')}>Ticketing, floor, check-in, blasts — the real events engine.</p>
                <EventOps />
              </section>
            )}
            {activeView === 'plan' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
                  <CalendarHeart className="w-4 h-4 text-neon-cyan" /> Planning workbench
                </h2>
                <EventPlanner />
              </section>
            )}
            {activeView === 'earth' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
                  <Globe2 className="w-4 h-4 text-emerald-400" /> NASA Earth events
                </h2>
                <p className={cn(ds.textMuted, 'mb-3')}>External EONET feed — reference only, not your guest list.</p>
                <NasaEarthEvents />
              </section>
            )}

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
      </NorthStarFrame>
    </LensShell>
  );
}
