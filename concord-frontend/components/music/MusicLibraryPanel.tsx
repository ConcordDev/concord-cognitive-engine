'use client';

/**
 * MusicLibraryPanel — track library with add / like / play / queue and
 * playlist management.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Heart, Play, ListPlus, Trash2, ListMusic, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Track { id: string; title: string; artist: string; album: string | null; genre: string; durationSec: number; liked: boolean; playCount: number }
interface Playlist { id: string; name: string; trackCount: number; durationSec: number }

function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export function MusicLibraryPanel({ onChange }: { onChange: () => void }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', artist: '', album: '', genre: 'pop', durationMin: '' });
  const [plName, setPlName] = useState('');
  const [openPl, setOpenPl] = useState<string | null>(null);
  const [plTracks, setPlTracks] = useState<Track[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, p] = await Promise.all([
      lensRun('music', 'track-list', query.trim() ? { query: query.trim() } : {}),
      lensRun('music', 'playlist-list', {}),
    ]);
    setTracks(t.data?.result?.tracks || []);
    setPlaylists(p.data?.result?.playlists || []);
    setLoading(false);
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.title.trim()) { setError('Track title is required.'); return; }
    const r = await lensRun('music', 'track-add', {
      title: form.title.trim(), artist: form.artist.trim(), album: form.album.trim(),
      genre: form.genre, durationSec: Math.round((Number(form.durationMin) || 3.5) * 60),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', artist: '', album: '', genre: 'pop', durationMin: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const like = async (id: string) => { await lensRun('music', 'track-like', { id }); await refresh(); onChange(); };
  const play = async (id: string) => { await lensRun('music', 'play-track', { id }); await refresh(); onChange(); };
  const queue = async (id: string) => { await lensRun('music', 'queue-add', { trackId: id }); await refresh(); onChange(); };
  const del = async (id: string) => { await lensRun('music', 'track-delete', { id }); await refresh(); onChange(); };
  const createPlaylist = async () => {
    if (!plName.trim()) { setError('Playlist name is required.'); return; }
    await lensRun('music', 'playlist-create', { name: plName.trim() });
    setPlName(''); setError(null);
    await refresh(); onChange();
  };
  const openPlaylist = async (id: string) => {
    if (openPl === id) { setOpenPl(null); return; }
    setOpenPl(id);
    const r = await lensRun('music', 'playlist-detail', { id });
    setPlTracks(r.data?.ok === false ? [] : (r.data?.result?.tracks || []));
  };
  const addToPlaylist = async (playlistId: string, trackId: string) => {
    await lensRun('music', 'playlist-add-track', { playlistId, trackId });
    const r = await lensRun('music', 'playlist-detail', { id: playlistId });
    setPlTracks(r.data?.result?.tracks || []);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Playlists */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ListMusic className="w-3.5 h-3.5 text-emerald-400" /> Playlists
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={plName} onChange={(e) => setPlName(e.target.value)} placeholder="New playlist name"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createPlaylist}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {playlists.length > 0 && (
          <ul className="space-y-1">
            {playlists.map((p) => (
              <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
                <button type="button" onClick={() => openPlaylist(p.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900">
                  <ChevronRight className={cn('w-3.5 h-3.5 text-zinc-600 transition-transform', openPl === p.id && 'rotate-90')} />
                  <span className="text-xs text-zinc-200">{p.name}</span>
                  <span className="text-[10px] text-zinc-500">{p.trackCount} tracks · {dur(p.durationSec)}</span>
                </button>
                {openPl === p.id && (
                  <div className="border-t border-zinc-800 p-2 bg-zinc-950/50">
                    {plTracks.length > 0 && (
                      <ul className="mb-2 space-y-0.5">
                        {plTracks.map((t) => <li key={t.id} className="text-[11px] text-zinc-400">{t.title} — {t.artist}</li>)}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {tracks.filter((t) => !plTracks.some((x) => x.id === t.id)).slice(0, 10).map((t) => (
                        <button key={t.id} type="button" onClick={() => addToPlaylist(p.id, t.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-emerald-700/50 hover:text-emerald-300">
                          + {t.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Tracks */}
      <section>
        <div className="flex gap-2 mb-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tracks…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAdd && (
          <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-2">
            <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Mins" inputMode="decimal" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Artist" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Album" value={form.album} onChange={(e) => setForm({ ...form, album: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Genre" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={add}
              className="col-span-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add to library</button>
          </div>
        )}

        {tracks.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
            No tracks. Add music to your library.
          </div>
        ) : (
          <ul className="space-y-1">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => play(t.id)} className="text-emerald-400 hover:text-emerald-300 shrink-0">
                  <Play className="w-4 h-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-200 truncate">{t.title}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{t.artist}{t.album ? ` · ${t.album}` : ''} · {dur(t.durationSec)}{t.playCount > 0 ? ` · ${t.playCount} plays` : ''}</p>
                </div>
                <button type="button" onClick={() => like(t.id)}
                  className={cn('shrink-0', t.liked ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-400')}>
                  <Heart className={cn('w-3.5 h-3.5', t.liked && 'fill-current')} />
                </button>
                <button type="button" onClick={() => queue(t.id)} className="text-zinc-600 hover:text-zinc-300 shrink-0">
                  <ListPlus className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => del(t.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
