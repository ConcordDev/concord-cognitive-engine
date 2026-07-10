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
import { motion, AnimatePresence } from 'framer-motion';
import { Compass, Globe2, Wrench, Plane } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const TOP_TABS: { id: TopTab; label: string; icon: typeof Compass; hint: string }[] = [
  { id: 'trips', label: 'My Trips', icon: Compass, hint: 'trips · saved places · price watches · documents' },
  { id: 'reference', label: 'Destination Reference', icon: Globe2, hint: 'country · visa · currency · postal · parks' },
  { id: 'tools', label: 'Quick Tools', icon: Wrench, hint: 'budget · packing · jet lag · visa calculators' },
];

export default function TravelLensPage() {
  useLensNav('travel');
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

  return (
    <LensShell lensId="travel" asMain={false}>
      <FirstRunTour lensId="travel" />
      <div data-lens-theme="travel" className="p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/30 to-teal-500/30 border border-cyan-500/20 flex items-center justify-center">
              <Compass className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">Travel</h1>
                <DepthBadge lensId="travel" size="sm" />
              </div>
              <p className="text-sm text-gray-400">Trip planning &amp; travel management — TripIt + Hopper shape</p>
            </div>
          </div>
          <DensityToggle variant="dropdown" />
        </header>

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
            <AnimatePresence>
              {dash.nextTrip && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-transparent to-teal-500/10 p-4 flex items-center justify-between">
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}

        {/* ── Top-level tabs ── */}
        <div className="flex gap-1 bg-lattice-surface p-1 rounded-lg border border-lattice-border overflow-x-auto">
          {TOP_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                tab === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === 'trips' && <TravelTripsSection />}

            {tab === 'reference' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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
          </motion.div>
        </AnimatePresence>
      </div>
    </LensShell>
  );
}
