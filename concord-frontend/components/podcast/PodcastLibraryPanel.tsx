'use client';

/**
 * PodcastLibraryPanel — downloaded episodes and playlists.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Download, ListMusic, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Episode { id: string; title: string; showTitle: string; durationSec: number; played: boolean }
interface Playlist { id: string; name: string; episodeCount: number }

function fmt(sec: number): string { const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

export function PodcastLibraryPanel({ onChange }: { onChange: () => void }) {
  const [downloads, setDownloads] = useState<Episode[]>([]);
  const [totalSec, setTotalSec] = useState(0);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plName, setPlName] = useState('');
  const [openPl, setOpenPl] = useState<string | null>(null);
  const [plEpisodes, setPlEpisodes] = useState<Episode[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, p] = await Promise.all([
      lensRun('podcast', 'download-list', {}),
      lensRun('podcast', 'playlist-list', {}),
    ]);
    setDownloads(d.data?.result?.episodes || []);
    setTotalSec(d.data?.result?.totalSec || 0);
    setPlaylists(p.data?.result?.playlists || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const removeDownload = async (id: string) => { await lensRun('podcast', 'download-remove', { episodeId: id }); await refresh(); };
  const createPlaylist = async () => {
    if (!plName.trim()) { setError('Playlist name is required.'); return; }
    const r = await lensRun('podcast', 'playlist-create', { name: plName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setPlName(''); setError(null);
    await refresh();
  };
  const openPlaylist = async (id: string) => {
    if (openPl === id) { setOpenPl(null); return; }
    setOpenPl(id);
    const r = await lensRun('podcast', 'playlist-detail', { id });
    setPlEpisodes(r.data?.ok === false ? [] : (r.data?.result?.episodes || []));
  };
  const addDownloadToPlaylist = async (playlistId: string, episodeId: string) => {
    await lensRun('podcast', 'playlist-add-episode', { playlistId, episodeId });
    const r = await lensRun('podcast', 'playlist-detail', { id: playlistId });
    setPlEpisodes(r.data?.result?.episodes || []);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Downloads */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Download className="w-3.5 h-3.5 text-violet-400" /> Downloaded
          {downloads.length > 0 && <span className="text-[10px] text-zinc-400">· {fmt(totalSec)} total</span>}
        </h3>
        {downloads.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No downloads. Download episodes from a show.</p>
        ) : (
          <ul className="space-y-1">
            {downloads.map((e) => (
              <li key={e.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-200 truncate">{e.title}</p>
                  <p className="text-[10px] text-zinc-400">{e.showTitle} · {fmt(e.durationSec)}</p>
                </div>
                <button aria-label="Delete" type="button" onClick={() => removeDownload(e.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Playlists */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ListMusic className="w-3.5 h-3.5 text-violet-400" /> Playlists
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={plName} onChange={(e) => setPlName(e.target.value)} placeholder="New playlist name"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createPlaylist}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {playlists.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No playlists.</p>
        ) : (
          <ul className="space-y-2">
            {playlists.map((pl) => (
              <li key={pl.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                <button type="button" onClick={() => openPlaylist(pl.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', openPl === pl.id && 'rotate-90')} />
                  <span className="text-sm font-semibold text-zinc-100">{pl.name}</span>
                  <span className="text-[11px] text-zinc-400">{pl.episodeCount} episodes</span>
                </button>
                {openPl === pl.id && (
                  <div className="border-t border-zinc-800 p-3 bg-zinc-950/50 space-y-2">
                    {plEpisodes.length > 0 ? (
                      <ul className="space-y-1">
                        {plEpisodes.map((e) => (
                          <li key={e.id} className="text-[11px] text-zinc-300">{e.title} <span className="text-zinc-600">· {e.showTitle}</span></li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-zinc-400 italic">Empty playlist.</p>
                    )}
                    {downloads.filter((e) => !plEpisodes.some((x) => x.id === e.id)).length > 0 && (
                      <div>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Add from downloads</p>
                        <div className="flex flex-wrap gap-1">
                          {downloads.filter((e) => !plEpisodes.some((x) => x.id === e.id)).map((e) => (
                            <button key={e.id} type="button" onClick={() => addDownloadToPlaylist(pl.id, e.id)}
                              className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-violet-700/50 hover:text-violet-300">
                              + {e.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
