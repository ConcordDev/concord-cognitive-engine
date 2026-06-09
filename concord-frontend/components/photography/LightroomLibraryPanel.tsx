'use client';

/**
 * LightroomLibraryPanel — catalog grid with import, star rating,
 * pick/reject flags, colour labels, keywords and filters.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Flag, Check, X, Trash2, Tag } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Photo {
  id: string; filename: string; title: string; camera: string | null; lens: string | null;
  iso: number | null; rating: number; flag: string; colorLabel: string | null;
  keywords: string[]; develop: Record<string, number>;
}

const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7',
};

export function LightroomLibraryPanel({ onChange }: { onChange: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ flag?: string; minRating?: number }>({});
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ filename: '', title: '', camera: '', lens: '', iso: '' });
  const [kwInput, setKwInput] = useState<{ id: string; value: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('photography', 'photo-list', filter);
    setPhotos(r.data?.result?.photos || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const importPhoto = async () => {
    if (!form.filename.trim()) { setError('Filename is required.'); return; }
    const r = await lensRun('photography', 'photo-import', {
      filename: form.filename.trim(), title: form.title.trim(),
      camera: form.camera.trim(), lens: form.lens.trim(), iso: Number(form.iso) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ filename: '', title: '', camera: '', lens: '', iso: '' });
    setShowImport(false); setError(null);
    await refresh(); onChange();
  };

  const rate = async (p: Photo, rating: number) => {
    await lensRun('photography', 'photo-rate', { id: p.id, rating: p.rating === rating ? 0 : rating });
    await refresh(); onChange();
  };
  const flag = async (p: Photo, f: string) => {
    await lensRun('photography', 'photo-flag', { id: p.id, flag: p.flag === f ? 'unflagged' : f });
    await refresh(); onChange();
  };
  const colorLabel = async (p: Photo, c: string) => {
    await lensRun('photography', 'photo-color-label', { id: p.id, colorLabel: p.colorLabel === c ? '' : c });
    await refresh();
  };
  const del = async (id: string) => { await lensRun('photography', 'photo-delete', { id }); await refresh(); onChange(); };
  const addKeyword = async (id: string) => {
    if (!kwInput?.value.trim()) { setKwInput(null); return; }
    await lensRun('photography', 'keyword-add', { id, keyword: kwInput.value.trim() });
    setKwInput(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <FilterChip label="All" active={!filter.flag && !filter.minRating} onClick={() => setFilter({})} />
          <FilterChip label="Picks" active={filter.flag === 'pick'} onClick={() => setFilter({ flag: 'pick' })} />
          <FilterChip label="Rejects" active={filter.flag === 'reject'} onClick={() => setFilter({ flag: 'reject' })} />
          <FilterChip label="5★" active={filter.minRating === 5} onClick={() => setFilter({ minRating: 5 })} />
        </div>
        <button type="button" onClick={() => setShowImport((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Import
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showImport && (
        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Filename" value={form.filename} onChange={(e) => setForm({ ...form, filename: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="ISO" inputMode="numeric" value={form.iso} onChange={(e) => setForm({ ...form, iso: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Camera" value={form.camera} onChange={(e) => setForm({ ...form, camera: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Lens" value={form.lens} onChange={(e) => setForm({ ...form, lens: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={importPhoto}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Import photo</button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No photos in the catalog. Import one to begin.
        </div>
      ) : (
        <ul className="space-y-2">
          {photos.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {p.colorLabel && <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR_HEX[p.colorLabel] }} />}
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{p.title}</p>
                    <p className="text-[10px] text-zinc-400 font-mono">
                      {p.filename}{p.camera ? ` · ${p.camera}` : ''}{p.iso ? ` · ISO ${p.iso}` : ''}
                      {Object.keys(p.develop).length > 0 ? ' · edited' : ''}
                    </p>
                  </div>
                </div>
                <button aria-label="Delete" type="button" onClick={() => del(p.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-2">
                {/* stars */}
                <span className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button aria-label="Favorite" key={n} type="button" onClick={() => rate(p, n)}>
                      <Star className={cn('w-3.5 h-3.5', n <= p.rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
                    </button>
                  ))}
                </span>
                {/* flags */}
                <button aria-label="Confirm" type="button" onClick={() => flag(p, 'pick')}
                  className={cn('p-1 rounded', p.flag === 'pick' ? 'bg-emerald-700/30 text-emerald-300' : 'text-zinc-600 hover:text-emerald-400')}>
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => flag(p, 'reject')}
                  className={cn('p-1 rounded', p.flag === 'reject' ? 'bg-rose-700/30 text-rose-300' : 'text-zinc-600 hover:text-rose-400')}>
                  <X className="w-3.5 h-3.5" />
                </button>
                {/* colour labels */}
                <span className="flex items-center gap-1">
                  {Object.entries(COLOR_HEX).map(([c, hex]) => (
                    <button key={c} type="button" onClick={() => colorLabel(p, c)}
                      className={cn('w-3 h-3 rounded-full border', p.colorLabel === c ? 'border-white' : 'border-transparent')}
                      style={{ background: hex }} aria-label={c} />
                  ))}
                </span>
                <Flag className="w-3 h-3 text-zinc-700" />
              </div>

              <div className="flex flex-wrap items-center gap-1 mt-2">
                {p.keywords.map((k) => (
                  <span key={k} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    <Tag className="w-2.5 h-2.5" />{k}
                  </span>
                ))}
                {kwInput?.id === p.id ? (
                  <input autoFocus value={kwInput.value}
                    onChange={(e) => setKwInput({ id: p.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(p.id); if (e.key === 'Escape') setKwInput(null); }}
                    onBlur={() => addKeyword(p.id)}
                    placeholder="keyword"
                    className="w-24 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                ) : (
                  <button type="button" onClick={() => setKwInput({ id: p.id, value: '' })}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-300">
                    + keyword
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('text-[11px] px-2 py-0.5 rounded-full border',
        active ? 'border-indigo-700/50 bg-indigo-950/40 text-indigo-300' : 'border-zinc-700 text-zinc-400')}>
      {label}
    </button>
  );
}
