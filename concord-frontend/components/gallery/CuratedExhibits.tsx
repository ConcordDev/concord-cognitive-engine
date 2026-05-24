'use client';

/**
 * CuratedExhibits — build curated thematic exhibits / stories with
 * narrative sequencing. Backs gallery exhibit-* macros: each exhibit
 * is an ordered set of narrated artwork panels the user assembles.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  BookOpen, Plus, Loader2, AlertTriangle, Trash2, ArrowUp, ArrowDown,
  Frame, Globe, ChevronLeft,
} from 'lucide-react';

interface ExhibitPanel {
  id: string;
  title: string;
  artist: string;
  date?: string | null;
  image?: string | null;
  museum?: string | null;
  wallText?: string | null;
}
interface ExhibitDetail {
  id: string;
  title: string;
  theme?: string | null;
  intro?: string | null;
  panels: ExhibitPanel[];
  published: boolean;
}
interface ExhibitSummary {
  id: string;
  title: string;
  theme?: string | null;
  panelCount: number;
  published: boolean;
  cover?: string | null;
}

export function CuratedExhibits() {
  const [exhibits, setExhibits] = useState<ExhibitSummary[]>([]);
  const [active, setActive] = useState<ExhibitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newTheme, setNewTheme] = useState('');
  const [busy, setBusy] = useState(false);

  // New-panel form fields.
  const [pTitle, setPTitle] = useState('');
  const [pArtist, setPArtist] = useState('');
  const [pImage, setPImage] = useState('');
  const [pWall, setPWall] = useState('');

  const refreshList = useCallback(async () => {
    const r = await lensRun<{ exhibits: ExhibitSummary[] }>('gallery', 'exhibit-list', {});
    if (r.data?.ok && r.data.result) setExhibits(r.data.result.exhibits || []);
    setLoading(false);
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openExhibit = useCallback(async (id: string) => {
    setError(null);
    const r = await lensRun<{ exhibit: ExhibitDetail }>('gallery', 'exhibit-detail', { id });
    if (r.data?.ok && r.data.result?.exhibit) setActive(r.data.result.exhibit);
    else setError(r.data?.error || 'Could not open exhibit.');
  }, []);

  const createExhibit = useCallback(async () => {
    if (!newTitle.trim()) { setError('Exhibit title required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun<{ exhibit: ExhibitDetail }>('gallery', 'exhibit-create', {
      title: newTitle.trim(), theme: newTheme.trim() || undefined,
    });
    if (r.data?.ok && r.data.result?.exhibit) {
      setNewTitle(''); setNewTheme('');
      await refreshList();
      setActive(r.data.result.exhibit);
    } else setError(r.data?.error || 'Could not create exhibit.');
    setBusy(false);
  }, [newTitle, newTheme, refreshList]);

  const addPanel = useCallback(async () => {
    if (!active || !pTitle.trim()) { setError('Panel artwork title required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('gallery', 'exhibit-add-panel', {
      exhibitId: active.id, title: pTitle.trim(),
      artist: pArtist.trim() || undefined,
      image: pImage.trim() || undefined,
      wallText: pWall.trim() || undefined,
    });
    if (r.data?.ok) {
      setPTitle(''); setPArtist(''); setPImage(''); setPWall('');
      await openExhibit(active.id);
    } else setError(r.data?.error || 'Could not add panel.');
    setBusy(false);
  }, [active, pTitle, pArtist, pImage, pWall, openExhibit]);

  const movePanel = useCallback(async (idx: number, dir: -1 | 1) => {
    if (!active) return;
    const next = active.panels.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setBusy(true);
    const r = await lensRun('gallery', 'exhibit-reorder-panels', { exhibitId: active.id, order: next });
    if (r.data?.ok) await openExhibit(active.id);
    setBusy(false);
  }, [active, openExhibit]);

  const removePanel = useCallback(async (panelId: string) => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun('gallery', 'exhibit-remove-panel', { exhibitId: active.id, panelId });
    if (r.data?.ok) await openExhibit(active.id);
    setBusy(false);
  }, [active, openExhibit]);

  const togglePublish = useCallback(async () => {
    if (!active) return;
    setBusy(true); setError(null);
    const r = await lensRun<{ published: boolean }>('gallery', 'exhibit-publish', {
      id: active.id, published: !active.published,
    });
    if (r.data?.ok) { await openExhibit(active.id); await refreshList(); }
    else setError(r.data?.error || 'Could not change publish state.');
    setBusy(false);
  }, [active, openExhibit, refreshList]);

  const deleteExhibit = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('gallery', 'exhibit-delete', { id });
    if (r.data?.ok) { setActive(null); await refreshList(); }
    setBusy(false);
  }, [refreshList]);

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <BookOpen className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Curated exhibits</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Stories</span>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {!active ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
              placeholder="New exhibit title"
            />
            <input
              type="text" value={newTheme} onChange={(e) => setNewTheme(e.target.value)}
              className="flex-1 min-w-[120px] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white"
              placeholder="Theme (optional)"
            />
            <button
              type="button" onClick={createExhibit} disabled={busy}
              className="flex items-center gap-1 rounded bg-amber-600/80 hover:bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
            </button>
          </div>

          {loading ? (
            <div className="py-6 text-center text-zinc-400"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          ) : exhibits.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-zinc-400 italic">No exhibits yet. Create one to start sequencing artworks into a narrative.</div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {exhibits.map((e) => (
                <li key={e.id}>
                  <button
                    type="button" onClick={() => openExhibit(e.id)}
                    className="w-full flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-2 text-left hover:border-amber-400/50 transition-colors"
                  >
                    <div className="h-12 w-12 shrink-0 rounded bg-zinc-950 overflow-hidden flex items-center justify-center">
                      {e.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                        <img src={e.cover} alt={e.title} className="h-full w-full object-cover" />
                      ) : <Frame className="w-5 h-5 text-zinc-700" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-zinc-100 truncate">{e.title}</div>
                      <div className="text-[10px] text-zinc-400">
                        {e.panelCount} panel{e.panelCount === 1 ? '' : 's'}
                        {e.theme ? ` · ${e.theme}` : ''}
                        {e.published ? ' · published' : ''}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button type="button" onClick={() => setActive(null)} className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white">
              <ChevronLeft className="w-3.5 h-3.5" /> All exhibits
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button" onClick={togglePublish} disabled={busy}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] border ${active.published ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'} disabled:opacity-40`}
              >
                <Globe className="w-3 h-3" /> {active.published ? 'Published' : 'Publish'}
              </button>
              <button type="button" onClick={() => deleteExhibit(active.id)} disabled={busy} className="rounded border border-red-500/30 bg-red-500/10 p-1 text-red-300 hover:bg-red-500/20 disabled:opacity-40" aria-label="Delete exhibit">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-base font-bold text-white">{active.title}</h4>
            {active.theme && <p className="text-[11px] text-amber-300">{active.theme}</p>}
          </div>

          {/* Add-panel form */}
          <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Add a narrated panel</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={pTitle} onChange={(e) => setPTitle(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Artwork title *" />
              <input type="text" value={pArtist} onChange={(e) => setPArtist(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Artist" />
            </div>
            <input type="text" value={pImage} onChange={(e) => setPImage(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Image URL (optional)" />
            <textarea value={pWall} onChange={(e) => setPWall(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="Curatorial wall text" />
            <button type="button" onClick={addPanel} disabled={busy} className="flex items-center gap-1 rounded bg-amber-600/80 hover:bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add panel
            </button>
          </div>

          {active.panels.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-zinc-400 italic">No panels yet. Add artworks to sequence the story.</div>
          ) : (
            <ol className="space-y-2">
              {active.panels.map((p, i) => (
                <li key={p.id} className="flex gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-2">
                  <div className="text-[11px] font-mono text-amber-400 w-5 shrink-0 pt-0.5">{i + 1}</div>
                  <div className="h-16 w-16 shrink-0 rounded bg-zinc-950 overflow-hidden flex items-center justify-center">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host
                      <img src={p.image} alt={p.title} className="h-full w-full object-cover" />
                    ) : <Frame className="w-5 h-5 text-zinc-700" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-zinc-100 truncate">{p.title}</div>
                    <div className="text-[10px] text-zinc-400">{p.artist}{p.date ? ` · ${p.date}` : ''}</div>
                    {p.wallText && <p className="mt-1 text-[10px] text-zinc-400 italic line-clamp-3">{p.wallText}</p>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button type="button" onClick={() => movePanel(i, -1)} disabled={busy || i === 0} className="rounded bg-zinc-800 p-1 hover:bg-zinc-700 disabled:opacity-30" aria-label="Move up">
                      <ArrowUp className="w-3 h-3 text-zinc-300" />
                    </button>
                    <button type="button" onClick={() => movePanel(i, 1)} disabled={busy || i === active.panels.length - 1} className="rounded bg-zinc-800 p-1 hover:bg-zinc-700 disabled:opacity-30" aria-label="Move down">
                      <ArrowDown className="w-3 h-3 text-zinc-300" />
                    </button>
                    <button type="button" onClick={() => removePanel(p.id)} disabled={busy} className="rounded bg-red-500/10 p-1 hover:bg-red-500/20 disabled:opacity-40" aria-label="Remove panel">
                      <Trash2 className="w-3 h-3 text-red-300" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
