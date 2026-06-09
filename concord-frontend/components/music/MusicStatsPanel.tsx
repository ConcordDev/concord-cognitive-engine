'use client';

/**
 * MusicStatsPanel — listening stats, a Wrapped-style annual summary,
 * top tracks/artists, the daily mix and followed artists.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, TrendingUp, Play, UserPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Stats { totalPlays: number; listenedMinutes: number; listenedHours: number; byGenre: Record<string, number>; libraryTracks: number }
interface Wrapped { year: string; totalPlays: number; minutesListened: number; topTracks: { title: string; plays: number }[]; topArtists: { artist: string; plays: number }[] }
interface Track { id: string; title: string; artist: string; playCount: number }
interface ArtistFollow { name: string; trackCount: number }

export function MusicStatsPanel({ onChange }: { onChange: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const [topTracks, setTopTracks] = useState<Track[]>([]);
  const [dailyMix, setDailyMix] = useState<Track[]>([]);
  const [artists, setArtists] = useState<ArtistFollow[]>([]);
  const [loading, setLoading] = useState(true);
  const [followName, setFollowName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, w, tt, dm, a] = await Promise.all([
      lensRun('music', 'listening-stats', {}),
      lensRun('music', 'wrapped', {}),
      lensRun('music', 'top-tracks', {}),
      lensRun('music', 'daily-mix', {}),
      lensRun('music', 'artist-list', {}),
    ]);
    setStats((s.data?.result as Stats | null) || null);
    setWrapped((w.data?.result as Wrapped | null) || null);
    setTopTracks(tt.data?.result?.tracks || []);
    setDailyMix(dm.data?.result?.tracks || []);
    setArtists(a.data?.result?.artists || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const follow = async () => {
    if (!followName.trim()) return;
    await lensRun('music', 'artist-follow', { name: followName.trim() });
    setFollowName('');
    await refresh();
  };
  const play = async (id: string) => { await lensRun('music', 'play-track', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Wrapped */}
      {wrapped && wrapped.totalPlays > 0 && (
        <section className="bg-gradient-to-br from-emerald-900/40 to-zinc-900 border border-emerald-800/40 rounded-xl p-4">
          <h3 className="flex items-center gap-1 text-xs font-bold text-emerald-300 mb-2">
            <Sparkles className="w-3.5 h-3.5" /> Your {wrapped.year} Wrapped
          </h3>
          <p className="text-2xl font-bold text-zinc-100">{wrapped.minutesListened} min</p>
          <p className="text-[11px] text-zinc-400 mb-2">{wrapped.totalPlays} plays this year</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-zinc-400 uppercase mb-0.5">Top tracks</p>
              {wrapped.topTracks.map((t, i) => (
                <p key={i} className="text-[11px] text-zinc-300 truncate">{i + 1}. {t.title}</p>
              ))}
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 uppercase mb-0.5">Top artists</p>
              {wrapped.topArtists.map((a, i) => (
                <p key={i} className="text-[11px] text-zinc-300 truncate">{i + 1}. {a.artist}</p>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.totalPlays}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Plays</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.listenedHours}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Hours</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{stats.libraryTracks}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Library</p>
          </div>
        </div>
      )}

      {/* Top tracks */}
      {topTracks.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Top tracks
          </h3>
          <ul className="space-y-1">
            {topTracks.slice(0, 8).map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="w-4 text-zinc-600">{i + 1}</span>
                <span className="text-zinc-200 truncate flex-1">{t.title} <span className="text-zinc-400">— {t.artist}</span></span>
                <span className="text-zinc-400">{t.playCount} plays</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Daily mix */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Daily Mix</h3>
        {dailyMix.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Add and play tracks to seed your daily mix.</p>
        ) : (
          <ul className="space-y-1">
            {dailyMix.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <button aria-label="Play" type="button" onClick={() => play(t.id)} className="text-emerald-400 hover:text-emerald-300">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-zinc-300 truncate">{t.title} <span className="text-zinc-400">— {t.artist}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Followed artists */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <UserPlus className="w-3.5 h-3.5 text-emerald-400" /> Following
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={followName} onChange={(e) => setFollowName(e.target.value)} placeholder="Follow an artist…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={follow}
            className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Follow</button>
        </div>
        {artists.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {artists.map((a) => (
              <span key={a.name} className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-950/40 text-emerald-300">
                {a.name} <span className="text-zinc-400">· {a.trackCount}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
