'use client';

/**
 * MusicNewReleasesPanel — "New Releases" browse surface backed by the real
 * `music.feed` macro (Apple Music marketing RSS → top-album DTUs). The list
 * renders the ingested album DTUs (queried from the global realm by the
 * `top-albums` tag `music.feed` stamps); the "Fetch latest" button ingests a
 * fresh batch. Real data only — an empty catalog shows an honest empty state
 * and a failed/unreachable feed surfaces the real backend error verbatim.
 */

import { useCallback, useEffect, useState } from 'react';
import { Disc3, Loader2, RefreshCw, ExternalLink, Sparkles } from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';

interface AlbumDTU {
  id: string;
  title: string;
  meta?: { name?: string; artist?: string; releaseDate?: string; url?: string };
}

export function MusicNewReleasesPanel() {
  const [albums, setAlbums] = useState<AlbumDTU[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState('');

  const loadFromRealm = useCallback(async () => {
    try {
      const res = await api.get('/api/realm/global', { params: { tags: 'top-albums', limit: 24, sort: 'newest' } });
      setAlbums((res.data?.dtus as AlbumDTU[]) || []);
    } catch {
      setAlbums([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadFromRealm(); }, [loadFromRealm]);

  const fetchLatest = async () => {
    setFetching(true); setMsg('');
    const r = await lensRun('music', 'feed', { limit: 15 });
    if (r.data?.ok) {
      const res = r.data.result as { ingested: number; skipped: number };
      setMsg(`Refreshed from Apple Music — ${res.ingested} new, ${res.skipped} already in your catalog.`);
      await loadFromRealm();
    } else {
      setMsg(r.data?.error || 'Apple Music feed unreachable from this deployment.');
    }
    setFetching(false);
  };

  return (
    <div className="space-y-4">
      <section className="bg-gradient-to-br from-emerald-900/30 to-zinc-900 border border-emerald-800/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-zinc-100">New Releases</h3>
          <span className="text-[10px] text-zinc-400">Apple Music top albums</span>
        </div>
        <button type="button" onClick={fetchLatest} disabled={fetching}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
          {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Fetch latest from Apple Music
        </button>
        {msg && <p className="mt-2 text-[11px] text-emerald-300">{msg}</p>}
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : albums.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">
          No new releases ingested yet. Tap &ldquo;Fetch latest&rdquo; to pull the current Apple Music top albums into your lattice.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {albums.map((d) => {
            const name = d.meta?.name || d.title;
            const artist = d.meta?.artist || '';
            return (
              <li key={d.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="w-9 h-9 rounded bg-emerald-900/40 flex items-center justify-center shrink-0">
                  <Disc3 className="w-5 h-5 text-emerald-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100 truncate">{name}</p>
                  <p className="text-[10px] text-zinc-400 truncate">{artist}{d.meta?.releaseDate ? ` · ${d.meta.releaseDate}` : ''}</p>
                </div>
                {d.meta?.url && (
                  <a href={d.meta.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} on Apple Music`}
                    className="text-zinc-500 hover:text-emerald-300 shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
