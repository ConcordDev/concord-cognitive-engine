'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface Piece { id: string; title: string; width: number; height: number; background: string; thumbnail: string | null; layerCount: number; strokeCount: number; updatedAt: string }
interface Dashboard { artworks: number; totalStrokes: number; palettes: number; referenceBoards: number; promptOfTheDay: { category: string; text: string } | null }

const SIZES = [
  { label: 'Landscape', width: 1280, height: 800 },
  { label: 'Portrait', width: 800, height: 1280 },
  { label: 'Square', width: 1000, height: 1000 },
];
const GROUNDS = [
  { label: 'Gesso', value: '#faf7f1' },
  { label: 'White', value: '#ffffff' },
  { label: 'Toned', value: '#d9c9ab' },
  { label: 'Charcoal', value: '#2a2622' },
];

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** Your pieces, hung small; start a new one or open another. */
export function PiecesDrawer({ pieces, current, onClose, onOpen, onChanged, onDeletedCurrent }: {
  pieces: Piece[] | null;
  current: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: () => Promise<unknown>;
  onDeletedCurrent: () => void;
}) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [title, setTitle] = useState('');
  const [size, setSize] = useState(0);
  const [ground, setGround] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void lensRun<Dashboard>('art', 'art-dashboard', {}).then((r) => { if (r.data?.ok) setDash(r.data.result); }); }, [pieces]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async () => {
    setBusy(true); setErr(null);
    const s = SIZES[size];
    const r = await lensRun<{ artwork: { id: string } }>('art', 'artwork-create', { title: title.trim(), width: s.width, height: s.height, background: GROUNDS[ground].value });
    setBusy(false);
    const id = r.data?.result?.artwork?.id;
    if (!r.data?.ok || !id) { setErr(r.data?.error || 'The canvas could not be made.'); return; }
    setTitle('');
    await onChanged();
    onOpen(id);
  };
  const remove = async (p: Piece) => {
    if (!window.confirm(`Delete “${p.title}”? Its layers and marks go with it.`)) return;
    const r = await lensRun('art', 'artwork-delete', { id: p.id });
    if (r.data?.ok === false) { setErr(r.data?.error || 'It could not be deleted.'); return; }
    if (p.id === current) onDeletedCurrent(); else await onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label="Your pieces" data-testid="at-pieces">
      <button type="button" className="at-scrim hidden flex-1 sm:block" aria-label="Close" onClick={onClose} />
      <section className="at-drawer at-scroll at-rise h-full w-full max-w-[520px] overflow-y-auto p-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="at-label">The studio</p>
            <h2 className="at-display text-[28px] leading-tight">Your pieces</h2>
            {dash && <p className="mt-1 text-[12.5px] text-[color:var(--at-muted)] at-num">{dash.artworks} pieces · {dash.totalStrokes} marks · {dash.palettes} palettes · {dash.referenceBoards} reference boards</p>}
          </div>
          <button type="button" className="at-btn at-btn-quiet" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        {dash?.promptOfTheDay?.text && <p className="at-note mb-4"><span className="at-label mr-2">Today’s prompt · {dash.promptOfTheDay.category}</span>{dash.promptOfTheDay.text}</p>}

        <div className="at-card mb-5 space-y-3 p-4">
          <p className="at-label">Stretch a new canvas</p>
          <input className="at-input" placeholder="Name it" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void create(); }} aria-label="Name the new piece" data-testid="at-new-title" />
          <div className="flex flex-wrap gap-1.5">
            {SIZES.map((s, i) => <button key={s.label} type="button" className="at-tab rounded-md border" aria-pressed={size === i} onClick={() => setSize(i)}>{s.label} <span className="at-num text-[10.5px] text-[color:var(--at-faint)]">{s.width}×{s.height}</span></button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[color:var(--at-muted)]">Ground</span>
            {GROUNDS.map((g, i) => <button key={g.label} type="button" className="at-dab" aria-pressed={ground === i} style={{ background: g.value }} title={g.label} aria-label={`${g.label} ground`} onClick={() => setGround(i)} />)}
          </div>
          {err && <p className="at-error" role="alert">{err}</p>}
          <button type="button" className="at-btn at-btn-paint" disabled={busy || !title.trim()} onClick={create} data-testid="at-create"><Plus className="h-4 w-4" />{busy ? 'Stretching…' : 'Start painting'}</button>
        </div>

        {!pieces ? (
          <div className="grid grid-cols-2 gap-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="at-skeleton aspect-[4/3]" />)}</div>
        ) : pieces.length === 0 ? (
          <p className="text-[13px] text-[color:var(--at-muted)]">No pieces yet. Stretch your first canvas above.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4" data-testid="at-piece-list">
            {pieces.map((p) => (
              <li key={p.id} className="group relative">
                <button type="button" className="at-piece block w-full overflow-hidden text-left" data-current={p.id === current} onClick={() => onOpen(p.id)} aria-label={`Open ${p.title}`}>
                  <span className="block aspect-[4/3] w-full" style={{ background: p.background }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-full w-full object-contain" /> : null}
                  </span>
                  <span className="block border-t border-[color:var(--at-rule)] px-2 py-1.5">
                    <span className="at-display block truncate text-[15px]">{p.title}</span>
                    <span className="block text-[11px] text-[color:var(--at-muted)] at-num">{p.layerCount} layers · {p.strokeCount} marks · {ago(p.updatedAt)}</span>
                  </span>
                </button>
                <button type="button" onClick={() => void remove(p)} aria-label={`Delete ${p.title}`} className="absolute right-1.5 top-1.5 hidden rounded bg-[var(--at-gesso)] p-1 text-[color:var(--at-bad)] shadow group-hover:block group-focus-within:block"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
