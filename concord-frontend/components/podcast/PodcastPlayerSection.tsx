'use client';

/**
 * PodcastPlayerSection — Spotify / Apple Podcasts 2026-shape listening
 * workbench. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Headphones, Play, Compass, Library, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PodcastListenPanel } from './PodcastListenPanel';
import { PodcastBrowsePanel } from './PodcastBrowsePanel';
import { PodcastLibraryPanel } from './PodcastLibraryPanel';

interface Dash {
  subscriptions: number; queueLength: number; downloads: number;
  inProgress: number; playlists: number; listenedHours: number;
}
type TabId = 'listen' | 'browse' | 'library';
const TABS: { id: TabId; label: string; icon: typeof Play }[] = [
  { id: 'listen', label: 'Listen', icon: Play },
  { id: 'browse', label: 'Browse', icon: Compass },
  { id: 'library', label: 'Library', icon: Library },
];

export function PodcastPlayerSection() {
  const [tab, setTab] = useState<TabId>('listen');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('podcast', 'podcast-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-violet-600/15 to-transparent">
        <Headphones className="w-5 h-5 text-violet-400" />
        <h2 className="text-sm font-bold text-zinc-100">Podcasts</h2>
        <span className="text-[11px] text-zinc-500">Spotify + Apple Podcasts shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Subscribed" value={dash.subscriptions} />
          <Stat label="In progress" value={dash.inProgress} />
          <Stat label="Up next" value={dash.queueLength} />
          <Stat label="Downloads" value={dash.downloads} />
          <Stat label="Playlists" value={dash.playlists} />
          <Stat label="Hours" value={dash.listenedHours} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-violet-500',
                active ? 'bg-zinc-900 text-violet-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'listen' && <PodcastListenPanel onChange={refreshDash} />}
        {tab === 'browse' && <PodcastBrowsePanel onChange={refreshDash} />}
        {tab === 'library' && <PodcastLibraryPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
