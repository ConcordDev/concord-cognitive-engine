'use client';

/**
 * NewsParitySuite — Ground News + Apple News parity surface. Tabbed container
 * for the bias-spectrum comparison, story clustering, audio mode, push alerts,
 * offline reading, source transparency and digest scheduling components.
 */

import { useState } from 'react';
import { Scale, Layers, Headphones, Bell, WifiOff, ShieldCheck, CalendarClock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { NewsBiasSpectrum } from './NewsBiasSpectrum';
import { NewsStoryClusters } from './NewsStoryClusters';
import { NewsAudioMode } from './NewsAudioMode';
import { NewsAlerts } from './NewsAlerts';
import { NewsOfflineSync } from './NewsOfflineSync';
import { NewsSourceTransparency } from './NewsSourceTransparency';
import { NewsDigestSchedule } from './NewsDigestSchedule';

type TabId = 'spectrum' | 'clusters' | 'audio' | 'alerts' | 'offline' | 'transparency' | 'digest';

const TABS: { id: TabId; label: string; icon: typeof Scale }[] = [
  { id: 'spectrum', label: 'Bias Spectrum', icon: Scale },
  { id: 'clusters', label: 'Story Clusters', icon: Layers },
  { id: 'transparency', label: 'Source Transparency', icon: ShieldCheck },
  { id: 'audio', label: 'Audio Mode', icon: Headphones },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'offline', label: 'Offline', icon: WifiOff },
  { id: 'digest', label: 'Digest Schedule', icon: CalendarClock },
];

export function NewsParitySuite() {
  const [tab, setTab] = useState<TabId>('spectrum');

  return (
    <div className="space-y-3">
      <nav className="flex gap-1 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-rose-500',
                active
                  ? 'bg-rose-600 text-white'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'spectrum' && <NewsBiasSpectrum />}
      {tab === 'clusters' && <NewsStoryClusters />}
      {tab === 'transparency' && <NewsSourceTransparency />}
      {tab === 'audio' && <NewsAudioMode />}
      {tab === 'alerts' && <NewsAlerts />}
      {tab === 'offline' && <NewsOfflineSync />}
      {tab === 'digest' && <NewsDigestSchedule />}
    </div>
  );
}
