'use client';

/**
 * LightroomCollectionsPanel — albums and shoots. Create albums, add
 * photos to them, create shoots and assign photos.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, FolderOpen, Camera, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Album { id: string; name: string; photoCount: number }
interface Shoot { id: string; name: string; date: string | null; location: string | null; photoCount: number }
interface Photo { id: string; title: string; shootId: string | null }

export function LightroomCollectionsPanel({ onChange }: { onChange: () => void }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [shoots, setShoots] = useState<Shoot[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumName, setAlbumName] = useState('');
  const [shootForm, setShootForm] = useState({ name: '', date: '', location: '' });
  const [openAlbum, setOpenAlbum] = useState<string | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, s, p] = await Promise.all([
      lensRun('photography', 'album-list', {}),
      lensRun('photography', 'shoot-list', {}),
      lensRun('photography', 'photo-list', {}),
    ]);
    setAlbums(a.data?.result?.albums || []);
    setShoots(s.data?.result?.shoots || []);
    setPhotos(p.data?.result?.photos || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createAlbum = async () => {
    if (!albumName.trim()) { setError('Album name is required.'); return; }
    const r = await lensRun('photography', 'album-create', { name: albumName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setAlbumName(''); setError(null);
    await refresh(); onChange();
  };
  const createShoot = async () => {
    if (!shootForm.name.trim()) { setError('Shoot name is required.'); return; }
    const r = await lensRun('photography', 'shoot-create', {
      name: shootForm.name.trim(), date: shootForm.date, location: shootForm.location.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setShootForm({ name: '', date: '', location: '' }); setError(null);
    await refresh(); onChange();
  };
  const openAlbumDetail = async (id: string) => {
    if (openAlbum === id) { setOpenAlbum(null); return; }
    setOpenAlbum(id);
    const r = await lensRun('photography', 'album-detail', { id });
    setAlbumPhotos(r.data?.ok === false ? [] : (r.data?.result?.photos || []));
  };
  const toggleInAlbum = async (albumId: string, photoId: string, inAlbum: boolean) => {
    await lensRun('photography', 'album-add-photo', { albumId, photoId, remove: inAlbum });
    const r = await lensRun('photography', 'album-detail', { id: albumId });
    setAlbumPhotos(r.data?.result?.photos || []);
    await refresh();
  };
  const delAlbum = async (id: string) => {
    await lensRun('photography', 'album-delete', { id });
    if (openAlbum === id) setOpenAlbum(null);
    await refresh(); onChange();
  };
  const assignShoot = async (photoId: string, shootId: string) => {
    await lensRun('photography', 'shoot-assign', { photoId, shootId });
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Albums */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> Albums
        </h3>
        <div className="flex gap-2 mb-2">
          <input value={albumName} onChange={(e) => setAlbumName(e.target.value)} placeholder="New album name"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createAlbum}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {albums.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No albums.</p>
        ) : (
          <ul className="space-y-2">
            {albums.map((al) => (
              <li key={al.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="flex items-center">
                  <button type="button" onClick={() => openAlbumDetail(al.id)}
                    className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                    <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', openAlbum === al.id && 'rotate-90')} />
                    <span className="text-sm font-semibold text-zinc-100">{al.name}</span>
                    <span className="text-[11px] text-zinc-400">{al.photoCount} photos</span>
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => delAlbum(al.id)} className="px-3 text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {openAlbum === al.id && (
                  <div className="border-t border-zinc-800 p-3 bg-zinc-950/50 space-y-1">
                    {photos.length === 0 ? (
                      <p className="text-[11px] text-zinc-400 italic">No photos in the catalog yet.</p>
                    ) : photos.map((p) => {
                      const inAlbum = albumPhotos.some((x) => x.id === p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                          <input type="checkbox" checked={inAlbum}
                            onChange={() => toggleInAlbum(al.id, p.id, inAlbum)}
                            className="accent-indigo-500" />
                          {p.title}
                        </label>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shoots */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Camera className="w-3.5 h-3.5 text-indigo-400" /> Shoots
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Shoot name" value={shootForm.name} onChange={(e) => setShootForm({ ...shootForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={shootForm.date} onChange={(e) => setShootForm({ ...shootForm, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Location" value={shootForm.location} onChange={(e) => setShootForm({ ...shootForm, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createShoot}
            className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {shoots.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No shoots.</p>
        ) : (
          <ul className="space-y-1">
            {shoots.map((sh) => (
              <li key={sh.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{sh.name}</p>
                  <p className="text-[10px] text-zinc-400">
                    {[sh.date, sh.location].filter(Boolean).join(' · ') || 'No details'} · {sh.photoCount} photos
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {shoots.length > 0 && photos.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Assign photos to a shoot</p>
            {photos.slice(0, 12).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{p.title}</span>
                <select value={p.shootId || ''} onChange={(e) => assignShoot(p.id, e.target.value)}
                  className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-100">
                  <option value="">— unassigned —</option>
                  {shoots.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
