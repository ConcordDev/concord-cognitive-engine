'use client';

/**
 * ArtStudioSection — Procreate + Krita shape drawing studio. Owns the
 * gallery + active-artwork state; the canvas and side panels hydrate
 * via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Palette, Plus, Brush, Droplet, Image as ImageIcon, Lightbulb, Loader2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ArtCanvas } from './ArtCanvas';
import { ArtPalettesPanel } from './ArtPalettesPanel';
import { ArtReferencesPanel } from './ArtReferencesPanel';
import { ArtInspirePanel } from './ArtInspirePanel';

interface ArtworkMeta {
  id: string; title: string; width: number; height: number; background: string;
  thumbnail: string | null; layerCount: number; strokeCount: number;
}
type TabId = 'studio' | 'palettes' | 'references' | 'inspire';
const TABS: { id: TabId; label: string; icon: typeof Brush }[] = [
  { id: 'studio', label: 'Studio', icon: Brush },
  { id: 'palettes', label: 'Palettes', icon: Droplet },
  { id: 'references', label: 'References', icon: ImageIcon },
  { id: 'inspire', label: 'Inspire', icon: Lightbulb },
];

const CANVAS_PRESETS = [
  { label: 'Landscape', width: 1280, height: 800 },
  { label: 'Portrait', width: 800, height: 1280 },
  { label: 'Square', width: 1000, height: 1000 },
];

export function ArtStudioSection() {
  const [tab, setTab] = useState<TabId>('studio');
  const [artworks, setArtworks] = useState<ArtworkMeta[]>([]);
  const [openArtwork, setOpenArtwork] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', preset: 0, background: '#ffffff' });

  const refresh = useCallback(async () => {
    const r = await lensRun('art', 'artwork-list', {});
    setArtworks(r.data?.result?.artworks || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createArtwork = async () => {
    const preset = CANVAS_PRESETS[form.preset];
    const r = await lensRun('art', 'artwork-create', {
      title: form.title.trim() || 'Untitled',
      width: preset.width, height: preset.height, background: form.background,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', preset: 0, background: '#ffffff' });
    setError(null);
    await refresh();
    if (r.data?.result?.artwork?.id) setOpenArtwork(r.data.result.artwork.id);
  };

  const delArtwork = async (id: string) => {
    await lensRun('art', 'artwork-delete', { id });
    if (openArtwork === id) setOpenArtwork(null);
    await refresh();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-violet-600/15 to-transparent">
        <Palette className="w-5 h-5 text-violet-400" />
        <h2 className="text-sm font-bold text-zinc-100">Art Studio</h2>
        <span className="text-[11px] text-zinc-400">Procreate + Krita shape · layered canvas, real brushes</span>
      </header>

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-violet-500',
                active ? 'bg-zinc-900 text-violet-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'studio' && (
          openArtwork ? (
            <ArtCanvas artworkId={openArtwork} onExit={() => { setOpenArtwork(null); void refresh(); }} />
          ) : (
            <div className="space-y-4">
              {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

              {/* New artwork */}
              <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
                <h3 className="text-xs font-semibold text-zinc-300">New canvas</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                  <select value={form.preset} onChange={(e) => setForm({ ...form, preset: Number(e.target.value) })}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                    {CANVAS_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label} · {p.width}×{p.height}</option>)}
                  </select>
                  <label className="flex items-center gap-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-400">
                    Paper
                    <input type="color" value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })}
                      className="w-7 h-7 bg-transparent cursor-pointer" />
                  </label>
                  <button type="button" onClick={createArtwork}
                    className="flex items-center justify-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg">
                    <Plus className="w-3.5 h-3.5" /> Create
                  </button>
                </div>
              </section>

              {/* Gallery */}
              {loading ? (
                <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : artworks.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic py-6 text-center">No artworks yet. Create a canvas above and start drawing.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {artworks.map((a) => (
                    <div key={a.id} className="group bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                      <button type="button" onClick={() => setOpenArtwork(a.id)}
                        className="block w-full aspect-[4/3] bg-zinc-800 overflow-hidden">
                        {a.thumbnail ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={a.thumbnail} alt={a.title} className="w-full h-full object-contain" />
                        ) : (
                          <span className="flex items-center justify-center h-full text-[10px] text-zinc-400">No preview</span>
                        )}
                      </button>
                      <div className="flex items-center justify-between px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-100 truncate">{a.title}</p>
                          <p className="text-[10px] text-zinc-400">{a.width}×{a.height} · {a.strokeCount} strokes</p>
                        </div>
                        <button aria-label="Delete" type="button" onClick={() => delArtwork(a.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {tab === 'palettes' && <ArtPalettesPanel />}
        {tab === 'references' && <ArtReferencesPanel />}
        {tab === 'inspire' && <ArtInspirePanel />}
      </div>
    </div>
  );
}
