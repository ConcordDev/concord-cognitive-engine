'use client';

/**
 * Search + map + listing inspector — the Zillow/Redfin product surface.
 * Map and rail share listings-list / listings-search. Inspector owns
 * listings-get / hot-score. Sheets mount saved/tours/alerts/agents without
 * a second page-level view machine.
 */

import { useCallback, useMemo, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import dynamic from 'next/dynamic';
import {
  Bell, Calendar, Heart, KeyRound, MapPin, Search, SlidersHorizontal,
  Users, X, Calculator,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { DensityToggle } from '@/components/ui/DensityToggle';
import ListingsBrowser, { type Listing, type ListingFilters } from './ListingsBrowser';
import { ListingInspectorPanel } from './ListingInspectorPanel';
import { useRealEstateSelection } from './RealEstateContext';
import AISearchBar from './AISearchBar';
import FavouritesPanel from './FavouritesPanel';
import ToursPanel from './ToursPanel';
import SavedSearchAlerts from './SavedSearchAlerts';
import OpenHouseCalendar from './OpenHouseCalendar';
import AgentMessenger from './AgentMessenger';
import PreApprovalFlow from './PreApprovalFlow';
import MapAreaSearch from './MapAreaSearch';
import RealEstateWorkbench from './RealEstateWorkbench';
import type { RealtorListing } from './RealtorShell';

const ListingsMap = dynamic(() => import('./ListingsMap').then((m) => m.ListingsMap), { ssr: false });

type SheetId = 'saved' | 'tours' | 'alerts' | 'open' | 'agents' | 'preapproval' | 'mapbounds';

const SHEETS: { id: SheetId; label: string; icon: typeof Heart }[] = [
  { id: 'saved', label: 'Saved', icon: Heart },
  { id: 'tours', label: 'Tours', icon: Calendar },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'open', label: 'Open houses', icon: Calendar },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'preapproval', label: 'Pre-approval', icon: KeyRound },
  { id: 'mapbounds', label: 'Bounds', icon: MapPin },
];

export function SearchMapPanel() {
  const reduceMotion = useReducedMotion();
  const { selected, setSelected, comparePicks, togglePick } = useRealEstateSelection();
  const [listings, setListings] = useState<Listing[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<ListingFilters | undefined>(undefined);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [tourFor, setTourFor] = useState<string | undefined>(undefined);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [showNl, setShowNl] = useState(false);

  const onListingsChange = useCallback((next: Listing[]) => {
    setListings(next);
  }, []);

  useLensCommand(
    [
      { id: 'open-workbench', keys: 'w', description: 'Mortgage / affordability workbench', category: 'navigation', action: () => setWorkbenchOpen(true) },
    ],
    { lensId: 'realestate' },
  );

  const requestTour = useCallback((id: string) => {
    setTourFor(id);
    setSheet('tours');
  }, []);

  const mapListings = useMemo<RealtorListing[]>(
    () =>
      listings.map((l) => ({
        id: l.id,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip,
        price: l.price,
        beds: l.beds,
        baths: l.baths,
        sqft: l.sqft,
        status: l.status,
        daysOnMarket: l.daysOnMarket,
        imageUrl: l.imageUrl,
        lat: l.lat ?? undefined,
        lng: l.lng ?? undefined,
      })),
    [listings],
  );

  const withCoords = mapListings.filter((l) => l.lat != null && l.lng != null).length;

  const sheetMotion = reduceMotion
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 6 }, transition: { duration: 0.16 } };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-400">
          <Search className="w-3.5 h-3.5 text-[var(--lens-secondary)]" />
          {listings.length} homes
          <span className="text-gray-600">·</span>
          {withCoords} mapped
        </div>
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {SHEETS.map((s) => {
            const Icon = s.icon;
            const on = sheet === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSheet(on ? null : s.id)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border',
                  on
                    ? 'border-[var(--lens-accent)]/50 bg-[var(--lens-accent)]/15 text-[var(--lens-secondary)]'
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5',
                )}
                aria-pressed={on}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowNl((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium',
              showNl ? 'text-[var(--lens-secondary)]' : 'text-gray-400 hover:text-white',
            )}
            aria-pressed={showNl}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> NL
          </button>
          <button
            type="button"
            onClick={() => setWorkbenchOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-400 hover:text-white"
            title="Mortgage · affordability · rent vs buy"
          >
            <Calculator className="w-3.5 h-3.5" />
            <kbd className="hidden md:inline text-[10px] font-mono text-white/30 border border-white/10 rounded px-1">W</kbd>
          </button>
          <DensityToggle variant="dropdown" showLabels={false} />
        </div>
      </div>

      {showNl && (
        <AISearchBar
          onParsed={(p) => {
            const f = p.filters as ListingFilters;
            setAppliedFilters({ ...f });
          }}
        />
      )}

      <AnimatePresence>
        {sheet && (
          <motion.div key={sheet} {...sheetMotion} className="rounded-xl border border-lattice-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-lattice-border bg-lattice-surface">
              <span className="text-[11px] uppercase tracking-wider text-gray-400">
                {SHEETS.find((s) => s.id === sheet)?.label}
              </span>
              <button type="button" aria-label="Close sheet" onClick={() => setSheet(null)} className={ds.btnGhost}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2">
              {sheet === 'saved' && (
                <FavouritesPanel
                  onSelect={(l) => {
                    setSelected(l);
                    setSheet(null);
                  }}
                />
              )}
              {sheet === 'tours' && <ToursPanel defaultListingId={tourFor} />}
              {sheet === 'alerts' && (
                <SavedSearchAlerts
                  onSelect={(l) => {
                    setSelected(l);
                    setSheet(null);
                  }}
                />
              )}
              {sheet === 'open' && <OpenHouseCalendar />}
              {sheet === 'agents' && <AgentMessenger />}
              {sheet === 'preapproval' && <PreApprovalFlow />}
              {sheet === 'mapbounds' && (
                <MapAreaSearch
                  onSelect={(l) => {
                    setSelected(l);
                    setSheet(null);
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'grid gap-3 items-stretch',
          selected ? 'grid-cols-1 xl:grid-cols-12' : 'grid-cols-1 lg:grid-cols-12',
        )}
      >
        <section className={cn('min-h-[280px] lg:min-h-[520px] rounded-xl border border-lattice-border overflow-hidden', selected ? 'xl:col-span-4' : 'lg:col-span-5')}>
          <ListingsMap
            listings={mapListings}
            onSelect={(l) => {
              const match = listings.find((x) => x.id === l.id);
              if (match) setSelected(match);
            }}
            className="h-[280px] lg:h-full min-h-[280px] w-full"
          />
        </section>
        <section className={cn(selected ? 'xl:col-span-4' : 'lg:col-span-7')}>
          <ListingsBrowser
            onSelect={setSelected}
            onPickForCompare={togglePick}
            comparePicks={comparePicks}
            onListingsChange={onListingsChange}
            appliedFilters={appliedFilters}
            selectedId={selected?.id}
          />
        </section>
        {selected && (
          <section className="xl:col-span-4 min-h-[420px]">
            <ListingInspectorPanel
              key={selected.id}
              listing={selected}
              onClose={() => setSelected(null)}
              onRequestTour={requestTour}
              className="h-full min-h-[420px]"
            />
          </section>
        )}
      </div>

      {comparePicks.length > 0 && (
        <p className="text-[11px] text-gray-400">
          {comparePicks.length} home{comparePicks.length === 1 ? '' : 's'} queued for compare — open the Comps view.
        </p>
      )}

      <RealEstateWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </div>
  );
}

export default SearchMapPanel;
