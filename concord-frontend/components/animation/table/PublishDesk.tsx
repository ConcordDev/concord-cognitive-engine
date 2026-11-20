'use client';

/**
 * Publish a rendered animation: free for everyone, or sold in Concord Coin
 * (95% of each sale to you) with a short preview for everyone else — shorter
 * than the piece, enforced by the stream. The poster is an image you upload,
 * or the drawing open on the table.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Brush } from 'lucide-react';
import { an, cc, secs, uploadMedia, type Release } from './lt';
import { drawFrame, type Anim } from './draw';

const PREVIEWS = [3, 5, 10, 15, 30, 60, 90];

export function PublishDesk({ anim, mediaId, runtimeSec, openDrawing, onOpenScreening }: {
  anim: Anim; mediaId: string | null; runtimeSec: number | null; openDrawing: number; onOpenScreening?: (id: string) => void;
}) {
  const [mine, setMine] = useState<Release[] | null>(null);
  const [form, setForm] = useState({ title: anim.title, logline: '', priced: false, price: '1', previewSec: 3 });
  const [poster, setPoster] = useState<{ mediaId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await an<{ releases: Release[] }>('anim-release-list', { mine: true, animId: anim.id });
    setMine(r.ok ? r.result?.releases || [] : []);
  }, [anim.id]);
  useEffect(() => { void load(); }, [load]);

  // A preview must be shorter than the piece; 0 means no preview at all
  // (only buyers watch it) — the only choice for a piece under 3 seconds.
  const previews = [...PREVIEWS.filter((p) => !runtimeSec || p < runtimeSec), 0];
  useEffect(() => { if (!previews.includes(form.previewSec)) setForm((f) => ({ ...f, previewSec: previews[0] })); }, [runtimeSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPosterFrom = async (blob: Blob, name: string, url: string) => {
    setMsg(null);
    const up = await uploadMedia(blob, { title: `${anim.title} poster`, filename: name, mediaType: 'image', tags: ['animation-poster'] });
    if (!up.ok) { setMsg({ kind: 'error', text: up.error }); return; }
    setPoster({ mediaId: up.mediaId, url });
  };
  const posterFromDrawing = async () => {
    const cv = document.createElement('canvas');
    cv.width = anim.width; cv.height = anim.height;
    const c = cv.getContext('2d'); if (!c) return;
    drawFrame(c, anim.frames[openDrawing], anim.background);
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
    if (blob) await setPosterFrom(blob, `drawing-${openDrawing + 1}.png`, cv.toDataURL('image/png'));
  };
  const posterFromFile = async (f?: File) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { setMsg({ kind: 'error', text: 'The poster must be PNG, JPEG or WebP.' }); return; }
    await setPosterFrom(f, f.name, URL.createObjectURL(f));
  };

  const publish = async () => {
    setMsg(null);
    if (!mediaId) { setMsg({ kind: 'error', text: 'Export a video first, then press “Publish this render”.' }); return; }
    const price = form.priced ? Math.round(Number(form.price) * 100) / 100 : 0;
    if (form.priced && !(price >= 0.5 && price <= 1000)) { setMsg({ kind: 'error', text: 'A price is from 0.5 to 1000 CC.' }); return; }
    setBusy(true);
    const r = await an<{ release: Release }>('anim-release-create', {
      animId: anim.id, platformMediaId: mediaId, title: form.title.trim() || undefined, logline: form.logline,
      priceCC: price, ...(form.priced ? { previewSec: form.previewSec } : {}), ...(poster ? { posterMediaId: poster.mediaId } : {}),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'error', text: r.error || 'Could not publish it.' }); return; }
    setMsg({ kind: 'ok', text: `“${r.result!.release.title}” is out${price ? ` at ${cc(price)}` : ', free to watch'}.` });
    await load();
  };
  const withdraw = async (rel: Release) => {
    if (!window.confirm(`Take “${rel.title}” down? People who bought it keep it.`)) return;
    const r = await an('anim-release-withdraw', { id: rel.id });
    if (!r.ok) setMsg({ kind: 'error', text: r.error || 'Could not take it down.' });
    await load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]" data-testid="lt-publish">
      <div className="space-y-2.5">
        {msg && <p className={msg.kind === 'ok' ? 'lt-ok' : 'lt-error'} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
        {!mediaId && <p className="text-[13px] text-[var(--lt-muted)]">Render it first: export WebM or MP4 above and press <b>Publish this render</b>. What you publish is exactly that file.</p>}
        {mediaId && <p className="lt-mono text-[12px] text-[var(--lt-muted)]">Render ready{runtimeSec ? ` · ${secs(runtimeSec)}` : ''}</p>}
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <div className="lt-reel !aspect-[4/5] flex items-center justify-center text-[11px] text-[#a9a39a]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {poster ? <img src={poster.url} alt="Poster" /> : 'No poster'}
            </div>
            <button type="button" className="lt-btn lt-btn-quiet w-full !min-h-[30px] text-[12px]" onClick={() => { void posterFromDrawing(); }} data-testid="lt-poster-drawing"><Brush className="h-3.5 w-3.5" /> Drawing {openDrawing + 1}</button>
            <button type="button" className="lt-btn lt-btn-quiet w-full !min-h-[30px] text-[12px]" onClick={() => fileRef.current?.click()}><ImagePlus className="h-3.5 w-3.5" /> Upload</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void posterFromFile(e.target.files?.[0]); }} />
          </div>
          <div className="space-y-2">
            <input className="lt-input lt-title !text-[17px]" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" data-testid="lt-publish-title" />
            <textarea className="lt-input min-h-[56px]" placeholder="One line about it" value={form.logline} maxLength={600} onChange={(e) => setForm({ ...form, logline: e.target.value })} aria-label="Logline" />
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Price">
              <button type="button" className="lt-chip" aria-pressed={!form.priced} onClick={() => setForm({ ...form, priced: false })}>Free</button>
              <button type="button" className="lt-chip" aria-pressed={form.priced} onClick={() => setForm({ ...form, priced: true })}>Sell it</button>
              {form.priced && (
                <>
                  <label className="flex items-center gap-1.5 text-[13px]"><input className="lt-input !w-20" type="number" min={0.5} max={1000} step={0.5} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} aria-label="Price in CC" data-testid="lt-publish-price" /> CC</label>
                  <label className="flex items-center gap-1.5 text-[13px]">preview
                    <select className="lt-input !w-auto" value={form.previewSec} onChange={(e) => setForm({ ...form, previewSec: Number(e.target.value) })} aria-label="Preview length" data-testid="lt-publish-preview">
                      {previews.map((s) => <option key={s} value={s}>{s ? `${s} s` : 'no preview'}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
            {form.priced && Number(form.price) >= 0.5 && <p className="text-[12px] text-[var(--lt-muted)]">Each sale: about {cc(Math.round(Number(form.price) * 95) / 100)} to you. {form.previewSec ? `Everyone else sees the first ${form.previewSec} s.` : 'Only buyers can watch it; everyone else sees the poster.'}</p>}
            <button type="button" className="lt-btn lt-btn-red" onClick={() => { void publish(); }} disabled={busy || !mediaId} data-testid="lt-publish-go">{busy ? 'Publishing…' : 'Publish'}</button>
          </div>
        </div>
      </div>
      <aside className="space-y-2">
        <h3 className="lt-label">Published from this shot</h3>
        {mine === null ? <div className="lt-skeleton h-16" /> : mine.length === 0 ? <p className="text-[12.5px] text-[var(--lt-muted)]">Nothing yet.</p> : (
          <ul className="space-y-1.5" data-testid="lt-my-releases">
            {mine.map((r) => (
              <li key={r.id} className="rounded border border-[#e2ded4] bg-[#fffefb] p-2 text-[12.5px]">
                <button type="button" className="font-semibold hover:underline" onClick={() => onOpenScreening?.(r.id)}>{r.title}</button>
                <p className="text-[11.5px] text-[var(--lt-muted)]">{r.status === 'published' ? (r.priceCC > 0 ? `${cc(r.priceCC)} · ${r.buyers ?? 0} bought` : 'Free') : 'Taken down'} · {secs(r.runtimeSec)}</p>
                {r.status === 'published' && <button type="button" className="mt-1 text-[11.5px] text-[var(--lt-red)] hover:underline" onClick={() => { void withdraw(r); }}>Take it down</button>}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
