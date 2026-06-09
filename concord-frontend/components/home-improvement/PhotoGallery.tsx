'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Camera, Plus, Trash2, Loader2 } from 'lucide-react';

interface GalleryEntry {
  id: string;
  room: string;
  title: string;
  beforeImage: string;
  afterImage: string;
  caption: string;
  createdAt: string;
}

const DOMAIN = 'home-improvement';

export function PhotoGallery() {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<Record<string, 'before' | 'after'>>({});
  const [form, setForm] = useState({ room: 'kitchen', title: '', caption: '', beforeImage: '', afterImage: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<{ entries: GalleryEntry[] }>(DOMAIN, 'gallery-list', {});
    if (data.ok && data.result) setEntries(data.result.entries || []);
    else setError(data.error || 'Failed to load gallery');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const readFile = (file: File, key: 'beforeImage' | 'afterImage') => {
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, [key]: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const add = async () => {
    if (!form.room.trim() || (!form.beforeImage && !form.afterImage)) return;
    setBusy(true);
    setError(null);
    const { data } = await lensRun(DOMAIN, 'gallery-add', { ...form });
    if (data.ok) {
      setForm({ room: 'kitchen', title: '', caption: '', beforeImage: '', afterImage: '' });
      setShowForm(false);
      await load();
    } else setError(data.error || 'Failed to add entry');
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'gallery-delete', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <Camera className="w-4 h-4 text-amber-400" /> Before / After Gallery
          <span className="text-xs text-gray-400">({entries.length})</span>
        </h3>
        <button onClick={() => setShowForm((v) => !v)} className="text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300">
          <Plus className="w-3.5 h-3.5" /> Add photos
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showForm && (
        <div className="panel p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="Room" className="input-lattice" />
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" className="input-lattice" />
          </div>
          <input value={form.caption} onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))} placeholder="Caption (optional)" className="input-lattice w-full" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-400">Before photo
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], 'beforeImage')} className="block mt-1 text-xs" />
            </label>
            <label className="text-xs text-gray-400">After photo
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], 'afterImage')} className="block mt-1 text-xs" />
            </label>
          </div>
          <button onClick={add} disabled={busy || (!form.beforeImage && !form.afterImage)} className="btn-neon green w-full text-sm disabled:opacity-50">
            {busy ? 'Saving...' : 'Save Gallery Entry'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading gallery...</div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400">No before/after photos yet. Document your renovations.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {entries.map((e) => {
            const mode = view[e.id] || (e.afterImage ? 'after' : 'before');
            const src = mode === 'after' ? (e.afterImage || e.beforeImage) : (e.beforeImage || e.afterImage);
            return (
              <div key={e.id} className="panel p-2 space-y-2">
                <div className="relative">
                  {src ? (
                    <img src={src} alt={`${e.room} ${mode}`} className="w-full h-44 object-cover rounded-lg" />
                  ) : (
                    <div className="w-full h-44 rounded-lg bg-lattice-deep flex items-center justify-center text-xs text-gray-400">No image</div>
                  )}
                  <span className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded bg-black/70 text-white uppercase">{mode}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{e.title}</p>
                    <p className="text-xs text-gray-400">{e.room}{e.caption ? ` · ${e.caption}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {e.beforeImage && e.afterImage && (
                      <button onClick={() => setView((v) => ({ ...v, [e.id]: mode === 'before' ? 'after' : 'before' }))} className="text-xs px-2 py-1 bg-lattice-surface rounded text-amber-400">
                        {mode === 'before' ? 'See after' : 'See before'}
                      </button>
                    )}
                    <button aria-label="Delete" onClick={() => remove(e.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
