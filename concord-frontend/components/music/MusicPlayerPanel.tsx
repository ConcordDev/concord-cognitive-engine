'use client';

/**
 * MusicPlayerPanel — now-playing with a progress scrubber, the up-next
 * queue and recently played.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, Disc3, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Track { id: string; title: string; artist: string; durationSec: number }
interface NowPlaying { track: Track; positionSec: number }

function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

export function MusicPlayerPanel({ onChange }: { onChange: () => void }) {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [np, q, r] = await Promise.all([
      lensRun('music', 'now-playing', {}),
      lensRun('music', 'queue-list', {}),
      lensRun('music', 'recently-played', {}),
    ]);
    setNowPlaying((np.data?.result?.nowPlaying as NowPlaying | null) || null);
    setQueue(q.data?.result?.tracks || []);
    setRecent(r.data?.result?.tracks || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const scrub = async (positionSec: number) => {
    await lensRun('music', 'playback-progress', { positionSec });
    await refresh();
  };
  const play = async (id: string) => { await lensRun('music', 'play-track', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Now playing */}
      <section className="bg-gradient-to-br from-emerald-900/40 to-zinc-900 border border-emerald-800/40 rounded-xl p-4">
        {nowPlaying ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-800/40 flex items-center justify-center shrink-0">
                <Disc3 className="w-6 h-6 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-100 truncate">{nowPlaying.track.title}</p>
                <p className="text-xs text-zinc-400 truncate">{nowPlaying.track.artist}</p>
              </div>
            </div>
            <input type="range" min={0} max={nowPlaying.track.durationSec} value={nowPlaying.positionSec}
              onChange={(e) => scrub(Number(e.target.value))}
              className="w-full mt-3 accent-emerald-500" />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>{dur(nowPlaying.positionSec)}</span>
              <span>{dur(nowPlaying.track.durationSec)}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-500 italic text-center py-4">Nothing playing. Press play on a track in your library.</p>
        )}
      </section>

      {/* Queue */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Up next</h3>
        {queue.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">Queue is empty.</p>
        ) : (
          <ul className="space-y-1">
            {queue.map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => play(t.id)} className="text-emerald-400 hover:text-emerald-300">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-zinc-200 truncate flex-1">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
                <span className="text-[10px] text-zinc-600">{dur(t.durationSec)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently played */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Recently played</h3>
        {recent.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No listening history yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.slice(0, 10).map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => play(t.id)} className="text-emerald-400 hover:text-emerald-300">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-zinc-300 truncate">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
