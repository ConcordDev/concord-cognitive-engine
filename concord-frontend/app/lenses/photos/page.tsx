'use client';

/**
 * Photos — the frame.
 *
 * One list: GET /api/photos/mine.
 * One action: Import a file, POST /api/photos/save, then the same GET
 * must contain the new id before the caption is shown.
 * Share and delete stay, and only after the route returns a real status
 * and the follow-up list agrees.
 *
 * Organize: search captions, favorites, inline caption edit and albums
 * (/api/photos/:id/update, /api/photos/albums*). Albums load only when the
 * Albums view or an add-to-album menu is opened.
 *
 * The world feed and friends visibility are other routes. They are not
 * on this screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useUIStore } from '@/store/ui';
import { PhotoLightboxModal } from '@/components/photos/PhotoLightboxModal';

interface Frame {
  id: string;
  caption: string | null;
  dtu_id: string | null;
  taken_at: number | null;
  favorite: boolean;
}

interface Album {
  id: string;
  name: string;
  count: number;
  cover_photo_id: string | null;
}

type View = 'all' | 'favorites' | 'albums';

function monthLabel(ts: number | null): string {
  if (!ts) return 'Undated';
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

type Phase = 'loading' | 'ready' | 'error';

function readAsPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable in this browser.');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image the browser can read.'));
    };
    img.src = url;
  });
}

function framesFrom(data: unknown): Frame[] {
  const rows = (data as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(rows)) return [];
  const out: Frame[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) continue;
    const caption = (row as { caption?: unknown }).caption;
    const dtu = (row as { dtu_id?: unknown }).dtu_id;
    const taken = Number((row as { taken_at?: unknown }).taken_at);
    out.push({
      id,
      caption: typeof caption === 'string' ? caption : null,
      dtu_id: typeof dtu === 'string' && dtu ? dtu : null,
      taken_at: Number.isFinite(taken) && taken > 0 ? taken : null,
      favorite: Boolean((row as { favorite?: unknown }).favorite),
    });
  }
  return out;
}

function albumsFrom(data: unknown): Album[] {
  const rows = (data as { albums?: unknown } | null)?.albums;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const r = row as Partial<Album> | null;
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') return [];
    return [{ id: r.id, name: r.name, count: Number(r.count) || 0, cover_photo_id: typeof r.cover_photo_id === 'string' ? r.cover_photo_id : null }];
  });
}

async function readJson(response: Response): Promise<{ ok?: boolean; error?: string; id?: string; dtuId?: string; photos?: unknown; albums?: unknown }> {
  return response.json().catch(() => ({}));
}

export default function PhotosLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const fileRef = useRef<HTMLInputElement>(null);
  const addToast = useUIStore((s) => s.addToast);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [albumMenuFor, setAlbumMenuFor] = useState<string | null>(null);
  const [openAlbum, setOpenAlbum] = useState<{ album: Album; ids: string[] } | null>(null);
  const [newAlbum, setNewAlbum] = useState('');

  const pull = useCallback(async () => {
    const response = await fetch('/api/photos/mine', { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return framesFrom(body);
  }, []);

  const applyPull = useCallback((rows: Frame[]) => {
    setFrames(rows);
    setPhase('ready');
    setLoadError('');
  }, []);

  const failPull = useCallback((err: unknown) => {
    setPhase('error');
    setLoadError(err instanceof Error ? err.message : 'Could not load your frames.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull()
      .then((rows) => { if (!cancelled) applyPull(rows); })
      .catch((err) => { if (!cancelled) failPull(err); });
    return () => { cancelled = true; };
  }, [pull, applyPull, failPull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then(applyPull).catch(failPull);
  }, [pull, applyPull, failPull]);

  const onFiles = useCallback(async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setImporting(true);
    setActionError('');
    try {
      for (const file of list) {
        try {
          const dataUrl = await readAsPngDataUrl(file);
          const caption = file.name.replace(/\.[^.]+$/, '');
          const response = await fetch('/api/photos/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, caption, visibility: 'private' }),
          });
          const body = await readJson(response);
          if (!response.ok || !body.ok || !body.id) {
            throw new Error(body.error === 'blob_too_large'
              ? 'Over the 5 MB limit once converted to PNG.'
              : (body.error || `HTTP ${response.status}`));
          }
          const rows = await pull();
          if (!rows.some((row) => row.id === body.id)) {
            throw new Error('Saved, but the frame did not read it back.');
          }
          applyPull(rows);
        } catch (e) {
          const message = e instanceof Error ? e.message : 'import failed';
          setActionError(`${file.name}: ${message}`);
          addToast({ type: 'error', message: `${file.name}: ${message}` });
        }
      }
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [addToast, applyPull, pull]);

  const share = useCallback(async (id: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/photos/${id}/share`, { method: 'POST', credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || !body.ok || !body.dtuId) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const rows = await pull();
      const row = rows.find((item) => item.id === id);
      if (row?.dtu_id !== body.dtuId) {
        throw new Error('Shared, but the frame did not read the DTU back.');
      }
      applyPull(rows);
      addToast({ type: 'success', message: 'Photo shared — DTU minted', duration: 2500 });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not share photo';
      setActionError(message);
      addToast({ type: 'error', message });
    }
  }, [addToast, applyPull, pull]);

  const remove = useCallback(async (id: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/photos/${id}/delete`, { method: 'POST', credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const rows = await pull();
      if (rows.some((row) => row.id === id)) throw new Error('Delete did not leave the frame.');
      applyPull(rows);
      addToast({ type: 'success', message: 'Photo deleted', duration: 2500 });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete photo';
      setActionError(message);
      addToast({ type: 'error', message });
    }
  }, [addToast, applyPull, pull]);

  const post = useCallback(async (url: string, payload?: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }, []);

  const fail = useCallback((e: unknown, fallback: string) => {
    const message = e instanceof Error ? e.message : fallback;
    setActionError(message);
    addToast({ type: 'error', message });
  }, [addToast]);

  const toggleFavorite = useCallback(async (frame: Frame) => {
    setActionError('');
    const next = !frame.favorite;
    setFrames((rows) => rows.map((r) => (r.id === frame.id ? { ...r, favorite: next } : r)));
    try {
      await post(`/api/photos/${frame.id}/update`, { favorite: next });
    } catch (e) {
      setFrames((rows) => rows.map((r) => (r.id === frame.id ? { ...r, favorite: frame.favorite } : r)));
      fail(e, 'Could not update favorite');
    }
  }, [post, fail]);

  const saveCaption = useCallback(async (id: string) => {
    setActionError('');
    try {
      const body = await post(`/api/photos/${id}/update`, { caption: editText });
      const caption = (body as { photo?: { caption?: string | null } }).photo?.caption ?? null;
      setFrames((rows) => rows.map((r) => (r.id === id ? { ...r, caption } : r)));
      setEditId(null);
    } catch (e) {
      fail(e, 'Could not save caption');
    }
  }, [post, editText, fail]);

  const loadAlbums = useCallback(async () => {
    try {
      const response = await fetch('/api/photos/albums', { credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      setAlbums(albumsFrom(body));
    } catch (e) {
      fail(e, 'Could not load albums');
    }
  }, [fail]);

  const openAlbumMenu = useCallback((id: string) => {
    setAlbumMenuFor((cur) => (cur === id ? null : id));
    if (albums === null) void loadAlbums();
  }, [albums, loadAlbums]);

  const showAlbums = useCallback(() => {
    setView('albums');
    setOpenAlbum(null);
    void loadAlbums();
  }, [loadAlbums]);

  const createAlbum = useCallback(async () => {
    const name = newAlbum.trim();
    if (!name) return;
    try {
      await post('/api/photos/albums', { name });
      setNewAlbum('');
      await loadAlbums();
    } catch (e) {
      fail(e, 'Could not create album');
    }
  }, [newAlbum, post, loadAlbums, fail]);

  const deleteAlbum = useCallback(async (album: Album) => {
    try {
      await post(`/api/photos/albums/${album.id}/delete`);
      setOpenAlbum(null);
      await loadAlbums();
      addToast({ type: 'success', message: `Album "${album.name}" deleted; photos kept`, duration: 2500 });
    } catch (e) {
      fail(e, 'Could not delete album');
    }
  }, [post, loadAlbums, addToast, fail]);

  const enterAlbum = useCallback(async (album: Album) => {
    try {
      const response = await fetch(`/api/photos/albums/${album.id}/photos`, { credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      setOpenAlbum({ album, ids: framesFrom(body).map((f) => f.id) });
    } catch (e) {
      fail(e, 'Could not open album');
    }
  }, [fail]);

  const setMembership = useCallback(async (album: Album, photoId: string, add: boolean) => {
    try {
      await post(`/api/photos/albums/${album.id}/items`, { photoId, add });
      setAlbumMenuFor(null);
      if (openAlbum?.album.id === album.id) {
        setOpenAlbum({ album, ids: add ? [...openAlbum.ids, photoId] : openAlbum.ids.filter((x) => x !== photoId) });
      }
      await loadAlbums();
      addToast({ type: 'success', message: add ? `Added to ${album.name}` : `Removed from ${album.name}`, duration: 2000 });
    } catch (e) {
      fail(e, 'Could not update album');
    }
  }, [post, openAlbum, loadAlbums, addToast, fail]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = frames;
    if (view === 'favorites') rows = rows.filter((f) => f.favorite);
    if (view === 'albums') rows = openAlbum ? rows.filter((f) => openAlbum.ids.includes(f.id)) : [];
    if (q) rows = rows.filter((f) => (f.caption || 'untitled').toLowerCase().includes(q));
    return rows;
  }, [frames, view, openAlbum, query]);

  const groups = useMemo(() => {
    const out: { label: string; rows: Frame[] }[] = [];
    for (const f of visible) {
      const label = monthLabel(f.taken_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(f);
      else out.push({ label, rows: [f] });
    }
    return out;
  }, [visible]);

  useLensCommand(
    [{ id: 'photos-import', keys: 'i', description: 'Import', category: 'actions', action: () => fileRef.current?.click() }],
    { lensId: 'photos' },
  );

  return (
    <LensShell lensId="photos" asMain={false}>
      <div data-lens-theme="photos" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Photos</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The frame{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Frame"
          className={`flex min-h-[22rem] flex-col items-center rounded-2xl border border-white/10 bg-zinc-950 px-6 ${phase === 'ready' && frames.length > 0 ? 'justify-start py-6' : 'justify-center py-16'}`}
        >
          {phase === 'loading' && (
            <p data-testid="photos-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the frame.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="photos-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && frames.length === 0 && (
            <p data-testid="photos-empty" className="text-[14px] text-zinc-500">No frame yet.</p>
          )}
          {phase === 'ready' && frames.length > 0 && (
            <div className="w-full self-stretch">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="Photo views" className="flex rounded-full border border-white/10 p-0.5 text-[13px]">
                  {([['all', 'All'], ['favorites', 'Favorites'], ['albums', 'Albums']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={view === key}
                      onClick={() => (key === 'albums' ? showAlbums() : (setView(key), setOpenAlbum(null)))}
                      className={`rounded-full px-3 py-1 ${view === key ? 'bg-zinc-100 text-black' : 'text-zinc-400 hover:text-zinc-100'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search captions"
                  aria-label="Search captions"
                  className="ml-auto w-48 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[13px] text-zinc-100 placeholder:text-zinc-600"
                />
              </div>

              {view === 'albums' && !openAlbum && (
                <div data-testid="photos-albums" className="mb-6">
                  <form
                    className="mb-4 flex gap-2"
                    onSubmit={(e) => { e.preventDefault(); void createAlbum(); }}
                  >
                    <input
                      value={newAlbum}
                      onChange={(e) => setNewAlbum(e.target.value)}
                      placeholder="New album name"
                      aria-label="New album name"
                      maxLength={80}
                      className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[13px] text-zinc-100"
                    />
                    <button type="submit" disabled={!newAlbum.trim()} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-[13px] text-black disabled:opacity-40">
                      Create album
                    </button>
                  </form>
                  {albums === null ? (
                    <p role="status" className="text-[13px] text-zinc-500">Loading albums.</p>
                  ) : albums.length === 0 ? (
                    <p className="text-[13px] text-zinc-500">No albums yet. Create one, then add photos from any view.</p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {albums.map((album) => (
                        <li key={album.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
                          <button type="button" onClick={() => void enterAlbum(album)} aria-label={`Open album ${album.name}`} className="block w-full text-left">
                            {album.cover_photo_id ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/photos/${album.cover_photo_id}/image`} alt="" className="aspect-square w-full object-cover" />
                            ) : (
                              <div className="flex aspect-square w-full items-center justify-center text-[12px] text-zinc-600">Empty</div>
                            )}
                            <span className="block px-3 pt-2 text-[14px] text-zinc-100">{album.name}</span>
                            <span className="block px-3 pb-2 text-[12px] text-zinc-500">{album.count} {album.count === 1 ? 'photo' : 'photos'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteAlbum(album)}
                            aria-label={`Delete album ${album.name}`}
                            className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] text-zinc-300 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {view === 'albums' && openAlbum && (
                <div className="mb-4 flex items-center gap-3 text-[13px]">
                  <button type="button" onClick={() => setOpenAlbum(null)} className="text-zinc-400 underline">All albums</button>
                  <span className="text-zinc-100">{openAlbum.album.name}</span>
                  <span className="text-zinc-500">{openAlbum.ids.length} {openAlbum.ids.length === 1 ? 'photo' : 'photos'}</span>
                </div>
              )}

              {(view !== 'albums' || openAlbum) && visible.length === 0 && (
                <p className="py-10 text-center text-[14px] text-zinc-500">
                  {query.trim() ? 'No captions match.' : view === 'favorites' ? 'No favorites yet. Star a photo to keep it here.' : 'This album is empty. Add photos from All.'}
                </p>
              )}

              <ul data-testid="photos-list" className="w-full space-y-6">
                {groups.map((group) => (
                  <li key={group.label}>
                    <h2 className="mb-2 text-[12px] uppercase tracking-wider text-zinc-500">{group.label}</h2>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {group.rows.map((frame) => {
                        const name = frame.caption || 'Untitled';
                        return (
                          <li key={frame.id} className="relative rounded-xl border border-white/10 bg-black/40 p-2">
                            <button
                              type="button"
                              onClick={() => setLightboxId(frame.id)}
                              aria-label={`View photo ${name}`}
                              className="block w-full text-left"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/photos/${frame.id}/image`}
                                alt={frame.caption || 'Untitled photo'}
                                className="mb-2 aspect-square w-full rounded-lg object-cover"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleFavorite(frame)}
                              aria-pressed={frame.favorite}
                              aria-label={`${frame.favorite ? 'Unfavorite' : 'Favorite'} ${name}`}
                              className={`absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[14px] ${frame.favorite ? 'text-amber-300' : 'text-zinc-400 hover:text-zinc-100'}`}
                            >
                              {frame.favorite ? '\u2605' : '\u2606'}
                            </button>
                            {editId === frame.id ? (
                              <form
                                className="flex gap-1"
                                onSubmit={(e) => { e.preventDefault(); void saveCaption(frame.id); }}
                              >
                                <input
                                  autoFocus
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setEditId(null); }}
                                  aria-label={`Caption for ${name}`}
                                  maxLength={280}
                                  className="min-w-0 flex-1 rounded border border-white/10 bg-black/60 px-2 py-0.5 text-[13px] text-zinc-100"
                                />
                                <button type="submit" className="text-[12px] text-teal-300">Save</button>
                              </form>
                            ) : (
                              <span className="block truncate text-[14px] text-zinc-100">{name}</span>
                            )}
                            {frame.dtu_id ? (
                              <p className="mt-1 text-[11px] text-zinc-500">DTU minted · royalty active</p>
                            ) : null}
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                              {editId !== frame.id && (
                                <button
                                  type="button"
                                  onClick={() => { setEditId(frame.id); setEditText(frame.caption || ''); }}
                                  aria-label={`Edit caption ${name}`}
                                  className="text-zinc-400 underline"
                                >
                                  Edit
                                </button>
                              )}
                              {!frame.dtu_id && (
                                <button
                                  type="button"
                                  onClick={() => void share(frame.id)}
                                  aria-label={`Share photo ${name}`}
                                  className="text-zinc-300 underline"
                                >
                                  Share
                                </button>
                              )}
                              {view === 'albums' && openAlbum ? (
                                <button
                                  type="button"
                                  onClick={() => void setMembership(openAlbum.album, frame.id, false)}
                                  aria-label={`Remove ${name} from ${openAlbum.album.name}`}
                                  className="text-zinc-400 underline"
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openAlbumMenu(frame.id)}
                                  aria-expanded={albumMenuFor === frame.id}
                                  aria-label={`Add ${name} to album`}
                                  className="text-zinc-400 underline"
                                >
                                  Album
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void remove(frame.id)}
                                aria-label={`Delete photo ${name}`}
                                className="text-zinc-500 underline"
                              >
                                Delete
                              </button>
                            </div>
                            {albumMenuFor === frame.id && (
                              <div role="menu" aria-label="Albums" className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-white/10 bg-zinc-900 p-1 text-[13px] shadow-lg">
                                {albums === null ? (
                                  <p role="status" className="px-2 py-1 text-zinc-500">Loading albums.</p>
                                ) : albums.length === 0 ? (
                                  <p className="px-2 py-1 text-zinc-500">No albums. Create one in Albums.</p>
                                ) : albums.map((album) => (
                                  <button
                                    key={album.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => void setMembership(album, frame.id, true)}
                                    className="block w-full rounded px-2 py-1 text-left text-zinc-200 hover:bg-white/10"
                                  >
                                    {album.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}
        </section>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Import photos"
          onChange={(event) => void onFiles(event.target.files)}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing || phase !== 'ready'}
          title="Import (I)"
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black disabled:opacity-60"
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
      <PhotoLightboxModal photoId={lightboxId} onClose={() => setLightboxId(null)} />
    </LensShell>
  );
}
