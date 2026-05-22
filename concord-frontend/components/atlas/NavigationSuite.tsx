'use client';

/**
 * NavigationSuite — tabbed container for the Google-Maps-parity
 * navigation features added to the atlas lens: multi-modal directions,
 * live traffic + ETA, transit directions, real-time navigation mode,
 * street-level imagery, place details, and offline map areas.
 *
 * Each tab mounts a real, purpose-built panel wired to its atlas macro.
 */

import { useState } from 'react';
import {
  Navigation, TrafficCone, TrainFront, Compass, Camera, Info, DownloadCloud,
} from 'lucide-react';
import { MultiModalDirections } from './MultiModalDirections';
import { LiveTrafficPanel } from './LiveTrafficPanel';
import { TransitDirections } from './TransitDirections';
import { NavigationMode } from './NavigationMode';
import { StreetImagery } from './StreetImagery';
import { PlaceDetails } from './PlaceDetails';
import { OfflineAreas } from './OfflineAreas';

type SuiteTab =
  | 'directions' | 'traffic' | 'transit' | 'navigate' | 'imagery' | 'details' | 'offline';

const TABS: Array<{ id: SuiteTab; label: string; icon: typeof Navigation }> = [
  { id: 'directions', label: 'Directions', icon: Navigation },
  { id: 'traffic', label: 'Traffic', icon: TrafficCone },
  { id: 'transit', label: 'Transit', icon: TrainFront },
  { id: 'navigate', label: 'Navigate', icon: Compass },
  { id: 'imagery', label: 'Imagery', icon: Camera },
  { id: 'details', label: 'Details', icon: Info },
  { id: 'offline', label: 'Offline', icon: DownloadCloud },
];

export function NavigationSuite() {
  const [tab, setTab] = useState<SuiteTab>('directions');

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Navigation &amp; maps suite</h2>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-zinc-900 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition ${active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'directions' && <MultiModalDirections />}
      {tab === 'traffic' && <LiveTrafficPanel />}
      {tab === 'transit' && <TransitDirections />}
      {tab === 'navigate' && <NavigationMode />}
      {tab === 'imagery' && <StreetImagery />}
      {tab === 'details' && <PlaceDetails />}
      {tab === 'offline' && <OfflineAreas />}
    </div>
  );
}
