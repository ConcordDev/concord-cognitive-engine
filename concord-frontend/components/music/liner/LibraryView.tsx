'use client';

/**
 * Your library: records you bought, songs you saved, your playlists and what
 * you played lately. Built on the library macros (library-purchases,
 * liked-songs, playlist-*, recently-played, radio-start).
 */

import { useCallback, useEffect, useState } from 'react';
import { Heart, ListMusic, Plus, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { fmtDuration, libraryToPlayerTrack, music, type ArtistCard, type LibraryTrack, type Playlist, type Release } from './linerApi';
import { Cover, Empty, Grid, ReleaseTile, Section, TileSkeleton } from './parts';
import { playQueue } from './play';
import { ReplayPanel, SoundPanel } from './Extras';

type Tab = 'purchases' | 'songs' | 'playlists' | 'recent' | 'replay' | 'sound';
const TABS: Array<[Tab, string]> = [['purchases', 'Purchased'], ['songs', 'Saved songs'], ['playlists', 'Playlists'], ['recent', 'Recently played'], ['replay', 'Replay'], ['sound', 'Sound']];

function SongList({ tracks, onRadio, testId, lists, onAdd }: { tracks: LibraryTrack[]; onRadio?: (t: LibraryTrack) => void; testId?: string; lists?: Playlist[]; onAdd?: (trackId: string, playlistId: string) => void }) {
  const playable = tracks.map((t, i) => libraryToPlayerTrack(t, i));
  return (
    <ol className="divide-y ln-divide" data-testid={testId}>
      {tracks.map((t, i) => (
        <li key={t.id} className="ln-row flex items-center gap-3 px-2 py-2">
          <Cover url={t.coverUrl || t.artworkUrl || null} title={t.album || t.title} size="sm" />
          <button
            type="button"
            disabled={!playable[i]}
            onClick={() => playQueue(playable.filter(Boolean) as NonNullable<(typeof playable)[number]>[], playable.slice(0, i).filter(Boolean).length)}
            className="min-w-0 flex-1 text-left disabled:opacity-60"
            aria-label={`Play ${t.title}`}
            title={playable[i] ? undefined : 'No audio is attached to this library entry'}
          >
            <span className="block truncate text-sm font-medium">{t.title}{t.liked && <Heart className="ml-1.5 inline h-3 w-3 fill-[var(--ln-accent)] text-[color:var(--ln-accent)]" aria-label="Saved" />}</span>
            <span className="block truncate text-xs text-[color:var(--ln-muted)]">{t.artist}{t.album ? ` · ${t.album}` : ''}</span>
          </button>
          {lists && lists.length > 0 && onAdd && (
            <select value="" onChange={(e) => { if (e.target.value) onAdd(t.id, e.target.value); }} aria-label={`Add ${t.title} to a playlist`} className="ln-input h-7 max-w-[7.5rem] px-1.5 text-xs">
              <option value="">Add to…</option>
              {lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {onRadio && <button type="button" onClick={() => onRadio(t)} className="rounded-full p-1.5 text-[color:var(--ln-muted)] hover:text-[color:var(--ln-ink)]" aria-label={`Start a station from ${t.title}`} title="Start a station"><Radio className="h-4 w-4" /></button>}
          <span className="ln-mono w-12 text-right text-xs text-[color:var(--ln-muted)]">{fmtDuration(t.durationSec)}</span>
        </li>
      ))}
    </ol>
  );
}

export function LibraryView({ initialTab, onTab, onRelease, onArtist }: {
  initialTab: Tab;
  onTab: (t: Tab) => void;
  onRelease: (id: string) => void;
  onArtist: (a: ArtistCard) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [purchases, setPurchases] = useState<Release[] | null>(null);
  const [songs, setSongs] = useState<LibraryTrack[] | null>(null);
  const [recent, setRecent] = useState<LibraryTrack[] | null>(null);
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openTracks, setOpenTracks] = useState<LibraryTrack[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: Tab) => {
    setError(null);
    if (t === 'purchases') { const r = await music<{ releases: Release[] }>('library-purchases'); if (r.ok) setPurchases(r.result?.releases || []); else setError(r.error || 'Could not load purchases.'); }
    if (t === 'songs') {
      const [r, pl] = await Promise.all([music<{ tracks: LibraryTrack[] }>('liked-songs'), music<{ playlists: Playlist[] }>('playlist-list')]);
      if (r.ok) setSongs(r.result?.tracks || []); else setError(r.error || 'Could not load saved songs.');
      if (pl.ok) setLists(pl.result?.playlists || []);
    }
    if (t === 'recent') { const r = await music<{ tracks: LibraryTrack[] }>('recently-played'); if (r.ok) setRecent(r.result?.tracks || []); else setError(r.error || 'Could not load your history.'); }
    if (t === 'playlists') { const r = await music<{ playlists: Playlist[] }>('playlist-list'); if (r.ok) setLists(r.result?.playlists || []); else setError(r.error || 'Could not load playlists.'); }
  }, []);
  useEffect(() => { void load(tab); }, [tab, load]);

  const pick = (t: Tab) => { setTab(t); onTab(t); setOpen(null); };

  const radio = async (t: LibraryTrack) => {
    const r = await music<{ station: { label: string }; tracks: LibraryTrack[] }>('radio-start', { seedTrackId: t.id });
    if (!r.ok || !r.result) { showToast('warning', r.error || 'Could not start a station.'); return; }
    const queue = [t, ...(r.result.tracks || [])].map((x, i) => libraryToPlayerTrack(x, i)).filter(Boolean) as NonNullable<ReturnType<typeof libraryToPlayerTrack>>[];
    if (!queue.length) { showToast('warning', 'Nothing in that station has audio to play yet.'); return; }
    playQueue(queue, 0);
    showToast('success', `${r.result.station?.label || 'Station'}: ${queue.length} songs from your library.`);
  };

  const addTo = async (trackId: string, playlistId: string) => {
    const r = await music<{ trackCount: number }>('playlist-add-track', { playlistId, trackId });
    const name = (lists || []).find((p) => p.id === playlistId)?.name || 'the playlist';
    if (!r.ok) { showToast('error', r.error || 'Could not add that song.'); return; }
    setLists((l) => (l || []).map((p) => (p.id === playlistId && !p.trackIds.includes(trackId) ? { ...p, trackIds: [...p.trackIds, trackId] } : p)));
    showToast('success', `Added to ${name}.`);
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const r = await music<{ playlist: Playlist }>('playlist-create', { name: n });
    if (!r.ok || !r.result) { showToast('error', r.error || 'Could not make the playlist.'); return; }
    setName('');
    setLists((l) => [r.result!.playlist, ...(l || [])]);
  };

  const openList = async (id: string) => {
    setOpen(id);
    setOpenTracks(null);
    const r = await music<{ tracks: LibraryTrack[] }>('playlist-detail', { id });
    setOpenTracks(r.ok ? r.result?.tracks || [] : []);
  };

  return (
    <div className="px-4 pb-16 pt-8 sm:px-8" data-testid="ln-library">
      <p className="ln-eyebrow">Library</p>
      <h1 className="ln-serif mb-5 mt-1 text-4xl">Yours</h1>
      <div className="mb-8 flex flex-wrap gap-1.5" role="tablist" aria-label="Library">
        {TABS.map(([t, label]) => <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => pick(t)} className="ln-chip px-4 py-1 text-sm">{label}</button>)}
      </div>
      {error && <Empty title="Library is not loading">{error}</Empty>}

      {tab === 'purchases' && !error && (purchases === null ? <TileSkeleton /> : purchases.length ? (
        <Grid>{purchases.map((r) => <ReleaseTile key={r.id} release={r} onOpen={onRelease} onArtist={() => onArtist(r.artist)} />)}</Grid>
      ) : <Empty title="No purchases yet">When you buy a release it lives here, in full, for good.</Empty>)}

      {tab === 'songs' && !error && (songs === null ? <TileSkeleton n={1} /> : songs.length ? <SongList tracks={songs} onRadio={(t) => void radio(t)} testId="ln-saved-songs" lists={lists || []} onAdd={(trackId, playlistId) => void addTo(trackId, playlistId)} /> : <Empty title="No saved songs">Tap the heart next to any song to keep it here.</Empty>)}

      {tab === 'recent' && !error && (recent === null ? <TileSkeleton n={1} /> : recent.length ? <SongList tracks={recent} /> : <Empty title="Nothing played yet">Songs you save and play show up here.</Empty>)}

      {tab === 'replay' && <ReplayPanel />}
      {tab === 'sound' && <SoundPanel />}

      {tab === 'playlists' && !error && (
        <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div>
            <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="mb-3 flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="New playlist" aria-label="New playlist name" className="ln-input h-9 min-w-0 flex-1 px-3 text-sm" />
              <button type="submit" disabled={!name.trim()} className="ln-btn ln-btn-quiet h-9 w-9" aria-label="Create playlist"><Plus className="h-4 w-4" /></button>
            </form>
            {lists === null ? <TileSkeleton n={1} /> : lists.length ? (
              <ul className="space-y-0.5">
                {lists.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => void openList(p.id)} aria-current={open === p.id ? 'page' : undefined} className={cn('ln-nav-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm')}>
                      <ListMusic className="h-4 w-4 flex-shrink-0" aria-hidden /><span className="truncate">{p.name}</span><span className="ln-mono ml-auto text-xs text-[color:var(--ln-muted)]">{p.trackIds.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[color:var(--ln-muted)]">No playlists yet.</p>}
          </div>
          <div>
            {!open && <Empty title="Pick a playlist">Save songs with the heart, then add them to playlists from your saved songs.</Empty>}
            {open && (openTracks === null ? <TileSkeleton n={1} /> : openTracks.length ? <SongList tracks={openTracks} /> : <Empty title="This playlist is empty" />)}
          </div>
        </div>
      )}
    </div>
  );
}

export type LibraryTab = Tab;
