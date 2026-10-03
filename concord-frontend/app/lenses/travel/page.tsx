'use client';

/**
 * Travel lens — real-world trip planning, parity target: TripIt (itinerary
 * organization + forwarded-email import + collaboration) and Hopper
 * (price-watch buy/wait guidance), with a Google-Travel-shape reference
 * sidebar (country/visa/currency/postal/parks lookups). See
 * `docs/lens-specs/travel-capability-map.md` for the full macro
 * enumeration + reference-parity checklist.
 *
 * NOT the in-game Concordia fast-travel system (`lib/world-lens/`,
 * `tests/fast-travel.test.ts`) — that is a separate feature.
 *
 * 2026-07-09 rebuild — architecture:
 *   - One real trip-detail surface (`TripWorkspace`, mounted via
 *     `TripWorkspaceSection` inside `TravelTripsSection`'s "My Trips" tab).
 *     The page used to run THREE overlapping trip-CRUD systems: this page's
 *     own `useLensData('travel','trip')` generic-artifact store (fake
 *     "status"/"spent" fields with no backing macro, fully disconnected
 *     from the real backend's itinerary/booking/budget/checklist state),
 *     `TravelTripsPanel`'s form-driven itinerary/booking/checklist CRUD,
 *     and `TripWorkspace`'s map/agenda/weather/search/import/status/share/
 *     budget tabs. All three are now one: `TripWorkspace` gained itinerary
 *     add/delete, booking add/delete, packing-checklist add/toggle/delete,
 *     and a budget-set form, and `TravelTripsPanel` was deleted.
 *   - The client-only ephemeral packing-list state (lost on refresh) is
 *     gone — packing now goes through the real `checklist-add/list/toggle`
 *     macros inside TripWorkspace's Packing tab, persisted per trip.
 *   - The generic scaffold trio (action-bar / auto-action-strip / recent-
 *     mine card) and the generic wrapper body (universal-actions +
 *     lens-feature-panel) are gone — no longer imported anywhere in this
 *     lens. Three bespoke tabs replace them: My Trips, Destination
 *     Reference, Quick Tools.
 *   - `TravelActionPanel`'s four quick-calculator macro calls
 *     (tripBudget/packingList/jetlagCalc/visaCheck) were silently sending
 *     and reading the WRONG field names (a `tripStyle` value the backend
 *     never checked, timezone-name strings instead of an hour offset,
 *     `required`/`type`/`daysValid` result fields that don't exist) — every
 *     click "succeeded" while rendering blank/undefined results. Fixed in
 *     that file to match `server/domains/travel.js`'s real shapes exactly.
 *   - `travel` carries no realtime socket channel (`useRealtimeLens`'s
 *     `DOMAIN_EVENTS` map has no `travel` entry) — the old header's
 *     "live" badge + `RealtimeDataPanel` always showed a permanently
 *     disconnected state. Dropped rather than displayed as decoration.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { TravelTripsSection } from '@/components/travel/TravelTripsSection';
import { ZippopotamPanel } from '@/components/travel/ZippopotamPanel';
import { ParksPanel } from '@/components/travel/ParksPanel';
import { TripPlannerPanel } from '@/components/travel/TripPlannerPanel';
import { TravelActionPanel } from '@/components/travel/TravelActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { StatTile, StatTileGrid, ErrorState, Skeleton, DensityToggle } from '@/components/ui';
import { Compass, Globe2, Wrench, Plane, Plus } from 'lucide-react';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type TopTab = 'trips' | 'reference' | 'tools';

interface TravelDashboard {
  trips: number;
  upcomingTrips: number;
  nextTrip: { id: string; name: string; destination: string; startDate: string } | null;
  priceWatches: number;
  watchesTriggered: number;
  savedPlaces: number;
  totalBooked: number;
}

const TOP_TABS: { id: TopTab; label: string; title: string; icon: typeof Compass; hint: string }[] = [
  { id: 'trips', label: 'My Trips', title: 'Where you are headed', icon: Compass, hint: 'trips · saved places · price watches · documents' },
  { id: 'reference', label: 'Destination Reference', title: 'What to know before you land', icon: Globe2, hint: 'country · visa · currency · postal · parks' },
  { id: 'tools', label: 'Quick Tools', title: 'Do the trip math', icon: Wrench, hint: 'budget · packing · jet lag · visa calculators' },
];

export default function TravelLensPage() {
  useLensNav('travel');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<TopTab>('trips');
  const dashFeedback = useMacroDispatchFeedback<TravelDashboard>();

  const refreshDashboard = useCallback(() => {
    void dashFeedback.dispatch('travel', 'travel-dashboard', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refreshDashboard(); }, [refreshDashboard]);

  useLensCommand(
    [
      { id: 'tab-trips', keys: '1', description: 'My Trips', category: 'navigation', action: () => setTab('trips') },
      { id: 'tab-reference', keys: '2', description: 'Destination Reference', category: 'navigation', action: () => setTab('reference') },
      { id: 'tab-tools', keys: '3', description: 'Quick Tools', category: 'navigation', action: () => setTab('tools') },
      { id: 'refresh-dashboard', keys: 'r', description: 'Refresh dashboard', category: 'actions', action: refreshDashboard },
    ],
    { lensId: 'travel' }
  );

  const dash = dashFeedback.result;
  const dashLoading = dashFeedback.status === 'dispatched' || dashFeedback.status === 'running';

  const current = TOP_TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="travel" asMain={false}>
      <FirstRunTour lensId="travel" />
      <DepthBadge lensId="travel" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="travel"
        crumb="Travel"
        title={`${current.title}${tab === 'trips' && who ? `, ${who}` : ''}`}
        subtitle="Trip planning, itineraries, price watches and destination reference."
        actions={<DensityToggle variant="dropdown" />}
        tabs={TOP_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, hint: t.hint }))}
        activeTab={tab}
        onTab={(id) => setTab(id as TopTab)}
        tabsLabel="Travel views"
        cta={{ label: 'Plan a trip', icon: Plus, onClick: () => setTab('trips'), title: 'Open My Trips to start a new trip' }}
      >
        <div className="space-y-6">
        {/* ── Real dashboard — travel-dashboard macro, honest loading/error/populated states ── */}
        {dashFeedback.status === 'error' ? (
          <ErrorState
            message={dashFeedback.error || 'Could not load the travel dashboard.'}
            onRetry={refreshDashboard}
            retrying={dashLoading}
            variant="inline"
          />
        ) : dashLoading && !dash ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="block" height={72} />)}
          </div>
        ) : dash ? (
          <div className="space-y-3">
            <StatTileGrid columns={5}>
              <StatTile label="Trips" value={dash.trips} icon={<Compass className="w-3.5 h-3.5" />} onClick={() => setTab('trips')} />
              <StatTile label="Upcoming" value={dash.upcomingTrips} icon={<Plane className="w-3.5 h-3.5" />} onClick={() => setTab('trips')} />
              <StatTile
                label="Price watches"
                value={dash.priceWatches}
                caption={dash.watchesTriggered > 0 ? `${dash.watchesTriggered} at target` : undefined}
                tone={dash.watchesTriggered > 0 ? 'positive' : 'neutral'}
                onClick={() => setTab('trips')}
              />
              <StatTile label="Saved places" value={dash.savedPlaces} onClick={() => setTab('trips')} />
              <StatTile label="Total booked" value={dash.totalBooked} unit="$" onClick={() => setTab('trips')} />
            </StatTileGrid>
              {dash.nextTrip && (
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#111] p-4">
                  <div className="flex items-center gap-3">
                    <Plane className="w-5 h-5 text-neon-cyan" />
                    <div>
                      <p className="text-sm font-medium text-white">
                        Next trip: <span className="text-neon-cyan">{dash.nextTrip.name}</span>
                      </p>
                      <p className="text-xs text-gray-400">{dash.nextTrip.destination} — {dash.nextTrip.startDate}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setTab('trips')} className="text-xs text-neon-cyan hover:underline">Open →</button>
                </div>
              )}
          </div>
        ) : null}

          {tab === 'trips' && <TravelTripsSection />}

          {tab === 'reference' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <TripPlannerPanel />
              </div>
              <ZippopotamPanel domain="travel" />
              <ParksPanel />
              <LensFeedButton domain="travel" label="Import real country travel guides (REST Countries → DTUs)" />
            </div>
          )}

          {tab === 'tools' && (
            <PipingProvider>
              <TravelActionPanel />
            </PipingProvider>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
