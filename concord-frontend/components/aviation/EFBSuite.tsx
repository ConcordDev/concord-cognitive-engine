'use client';

/**
 * EFBSuite — the visual electronic-flight-bag core of the aviation lens.
 *
 * Bundles the seven ForeFlight feature-parity backlog items into one
 * tabbed surface:
 *   - Moving map  → interactive chart overlays, route plotting, TFRs,
 *                   weather radar + winds-aloft  (items 1, 2, 3)
 *   - Filing      → flight plan filing to ATC                  (item 4)
 *   - Plates      → approach-plate / airport-diagram viewer    (item 5)
 *   - Logbook     → endorsements + ratings tracking            (item 6)
 *   - EFIS        → synthetic-vision attitude display          (item 7)
 */

import { useState } from 'react';
import { Map, Send, FileText, Stamp, Gauge } from 'lucide-react';
import EFBMovingMap from './EFBMovingMap';
import EFBFiling from './EFBFiling';
import EFBPlates from './EFBPlates';
import EFBEndorsements from './EFBEndorsements';
import EFBSyntheticVision from './EFBSyntheticVision';

type Tab = 'map' | 'filing' | 'plates' | 'logbook' | 'efis';

const TABS: { id: Tab; label: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Moving map', icon: Map },
  { id: 'filing', label: 'ATC filing', icon: Send },
  { id: 'plates', label: 'Approach plates', icon: FileText },
  { id: 'logbook', label: 'Endorsements', icon: Stamp },
  { id: 'efis', label: 'Synthetic vision', icon: Gauge },
];

export default function EFBSuite() {
  const [tab, setTab] = useState<Tab>('map');

  return (
    <section className="rounded-xl border border-sky-500/20 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Map className="w-4 h-4 text-sky-400" />
        <h2 className="text-sm font-semibold text-sky-200 uppercase tracking-wider">
          Electronic Flight Bag
        </h2>
      </div>
      <nav className="flex items-center gap-1 border-b border-sky-900/40 pb-2 mb-3 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition ' +
                (active
                  ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                  : 'text-gray-400 hover:text-sky-200 border border-transparent')
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tab === 'map' && <EFBMovingMap />}
        {tab === 'filing' && <EFBFiling />}
        {tab === 'plates' && <EFBPlates />}
        {tab === 'logbook' && <EFBEndorsements />}
        {tab === 'efis' && <EFBSyntheticVision />}
      </div>
    </section>
  );
}
