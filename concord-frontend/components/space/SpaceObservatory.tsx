'use client';

/**
 * SpaceObservatory — the live-data feature deck for the space lens.
 * Surfaces the eight backlog features: live ISS tracking, visible-pass
 * prediction, 3D orbit visualization, launch countdown + webcast, rocket
 * detail pages, sky map / planetarium, filtered launch explorer, and the
 * NASA APOD imagery feed. Each tab is a purpose-built component backed by
 * a real free public API or pure-compute orbital mechanics.
 */

import { useState } from 'react';
import {
  Satellite, Eye, Orbit, Timer, Rocket, Compass, Filter, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IssLiveTracker } from './IssLiveTracker';
import { VisiblePassPredictor } from './VisiblePassPredictor';
import { Orbit3DGlobe } from './Orbit3DGlobe';
import { LaunchCountdown } from './LaunchCountdown';
import { RocketDetail } from './RocketDetail';
import { SkyMap } from './SkyMap';
import { LaunchExplorer } from './LaunchExplorer';
import { ApodFeed } from './ApodFeed';

type ObsTab =
  | 'iss'
  | 'passes'
  | 'orbit3d'
  | 'countdown'
  | 'rocket'
  | 'skymap'
  | 'explorer'
  | 'apod';

const TABS: { key: ObsTab; label: string; icon: typeof Satellite }[] = [
  { key: 'iss', label: 'ISS Tracker', icon: Satellite },
  { key: 'passes', label: 'Visible Passes', icon: Eye },
  { key: 'orbit3d', label: '3D Orbit', icon: Orbit },
  { key: 'countdown', label: 'Countdown', icon: Timer },
  { key: 'rocket', label: 'Vehicles', icon: Rocket },
  { key: 'skymap', label: 'Sky Map', icon: Compass },
  { key: 'explorer', label: 'Launch Explorer', icon: Filter },
  { key: 'apod', label: 'NASA Imagery', icon: ImageIcon },
];

export function SpaceObservatory() {
  const [tab, setTab] = useState<ObsTab>('iss');

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Satellite className="w-4 h-4 text-indigo-400" /> Live Observatory
        </h2>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          Real-time tracking, pass prediction, orbit visualization &amp; NASA imagery
        </p>
      </div>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
              tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'iss' && <IssLiveTracker />}
        {tab === 'passes' && <VisiblePassPredictor />}
        {tab === 'orbit3d' && <Orbit3DGlobe />}
        {tab === 'countdown' && <LaunchCountdown />}
        {tab === 'rocket' && <RocketDetail />}
        {tab === 'skymap' && <SkyMap />}
        {tab === 'explorer' && <LaunchExplorer />}
        {tab === 'apod' && <ApodFeed />}
      </div>
    </section>
  );
}
