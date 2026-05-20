'use client';

/**
 * MusicStreamingSection — Spotify + Apple Music 2026-shape streaming
 * library. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Music, Disc3, Play, BarChart3, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MusicLibraryPanel } from './MusicLibraryPanel';
import { MusicPlayerPanel } from './MusicPlayerPanel';
import { MusicStatsPanel } from './MusicStatsPanel';

interface Dash {
  tracks: number; liked: number; playlists: number; following: number;
  totalPlays: number; listenedHours: number; queued: number;
}
type TabId = 'library' | 'player' | 'stats';
const TABS: { id: TabId; label: string; icon: typeof Disc3 }[] = [
  { id: 'library', label: 'Library', icon: Disc3 },
  { id: 'player', label: 'Now Playing', icon: Play },
  { id: 'stats', label: 'Stats & Discover', icon: BarChart3 },
];

export function MusicStreamingSection() {
  const [tab, setTab] = useState<TabId>('library');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('music', 'music-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-600/15 to-transparent">
        <Music className="w-5 h-5 text-emerald-400" />
        <h2 className="text-sm font-bold text-zinc-100">Music Library</h2>
        <span className="text-[11px] text-zinc-500">Spotify + Apple Music shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Tracks" value={dash.tracks} />
          <Stat label="Liked" value={dash.liked} />
          <Stat label="Playlists" value={dash.playlists} />
          <Stat label="Following" value={dash.following} />
          <Stat label="Plays" value={dash.totalPlays} />
          <Stat label="Hours" value={dash.listenedHours} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500',
                active ? 'bg-zinc-900 text-emerald-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'library' && <MusicLibraryPanel onChange={refreshDash} />}
        {tab === 'player' && <MusicPlayerPanel onChange={refreshDash} />}
        {tab === 'stats' && <MusicStatsPanel onChange={refreshDash} />}
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
