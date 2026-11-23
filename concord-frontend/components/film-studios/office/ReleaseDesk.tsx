'use client';

/**
 * The release desk. A finished film (an uploaded video from this production)
 * goes out free to everyone or priced in Concord Coin through the
 * marketplace, where 95% of each sale goes to the filmmaker. Non-buyers see a
 * preview of up to 90 seconds; the stream itself enforces it. Festivals are
 * tracked below.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { FsDistributionPanel } from '@/components/film-studios/FsDistributionPanel';
import { cc, fs, runtime, uploadPoster, type Footage, type Release } from './fo';

export function ReleaseDesk({ projectId, onOpenCinema }: { projectId: string; onOpenCinema?: (releaseId: string) => void }) {
  const [mine, setMine] = useState<Release[] | null>(null);
  const [videos, setVideos] = useState<Footage[]>([]);
  const [form, setForm] = useState({ mediaId: '', title: '', logline: '', priced: true, price: '3', previewSec: 90 });
  const [poster, setPoster] = useState<{ mediaId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const posterRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      fs<{ releases: Release[] }>('film-release-list', { mine: true, projectId }),
      fs<{ media: Footage[] }>('media-list', { projectId }),
    ]);
    setMine(r.ok ? r.result?.releases || [] : []);
    if (!r.ok) setMsg({ kind: 'error', text: r.error || 'Could not read your releases.' });
    setVideos((m.result?.media || []).filter((f) => f.kind === 'video' && f.platformMediaId));
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const pickPoster = async (file?: File) => {
    if (!file) return;
    setMsg(null);
    const up = await uploadPoster(file, form.title || 'Film');
    if (!up.ok) { setMsg({ kind: 'error', text: up.error }); return; }
    setPoster({ mediaId: up.mediaId, url: URL.createObjectURL(file) });
  };

  const release = async () => {
    setMsg(null);
    if (!form.mediaId) { setMsg({ kind: 'error', text: 'Choose the film: an uploaded video from this production.' }); return; }
    const price = form.priced ? Number(form.price) : 0;
    if (form.priced && !(price >= 0.5 && price <= 1000)) { setMsg({ kind: 'error', text: 'A price is from 0.5 to 1000 CC.' }); return; }
    setBusy(true);
    const r = await fs<{ release: Release }>('film-release-create', {
      projectId, mediaId: form.mediaId, title: form.title.trim() || undefined, logline: form.logline,
      priceCC: Math.round(price * 100) / 100, ...(form.priced ? { previewSec: form.previewSec } : {}),
      ...(poster ? { posterMediaId: poster.mediaId } : {}),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'error', text: r.error || 'Could not release it.' }); return; }
    setMsg({ kind: 'ok', text: `“${r.result!.release.title}” is out${price > 0 ? ` at ${cc(price)}` : ', free to watch'}.` });
    setForm({ ...form, mediaId: '', title: '', logline: '' });
    setPoster(null);
    await load();
  };

  const withdraw = async (rel: Release) => {
    if (!window.confirm(`Take “${rel.title}” off the shelf? People who bought it keep it.`)) return;
    const r = await fs('film-release-withdraw', { id: rel.id });
    if (!r.ok) setMsg({ kind: 'error', text: r.error || 'Could not withdraw it.' });
    await load();
  };
  const reprice = async (rel: Release, value: string) => {
    const p = Math.round(Number(value) * 100) / 100;
    if (!(p >= 0.5 && p <= 1000) || p === rel.priceCC) return;
    setMine((all) => (all || []).map((x) => (x.id === rel.id ? { ...x, priceCC: p } : x)));
    const r = await fs('film-release-update', { id: rel.id, priceCC: p });
    if (!r.ok) { setMsg({ kind: 'error', text: r.error || 'Could not change the price.' }); await load(); }
  };

  const chosen = videos.find((v) => v.id === form.mediaId);

  return (
    <div className="space-y-5" data-testid="fo-release-desk">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="fo-sheet p-4" aria-label="Release a film">
          <h3 className="fo-slate text-[17px]">Release a film</h3>
          <p className="mt-1 text-[13px] text-[var(--fo-muted)]">Free to everyone, or sold in CC: 95% of each sale goes to you. Buyers keep it even if you withdraw.</p>
          {msg && <p className={`mt-3 ${msg.kind === 'ok' ? 'fo-ok' : 'fo-error'}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <button type="button" className="fo-onesheet flex items-center justify-center text-[#bbb]" onClick={() => posterRef.current?.click()} aria-label={poster ? 'Change the poster' : 'Add a poster'} data-testid="fo-poster-pick">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* Inline allowlist guard at the sink (CB-1280): CodeQL recognises the check here, not behind a helper call. */}
              {poster && (poster.url.startsWith('blob:') || poster.url.startsWith('data:image/png;base64,') || poster.url.startsWith('data:image/jpeg;base64,') || poster.url.startsWith('data:image/webp;base64,')) ? <img src={poster.url} alt="" /> : <span className="flex flex-col items-center gap-1 text-[12px]"><ImagePlus className="h-5 w-5" /> Poster</span>}
            </button>
            <input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickPoster(e.target.files?.[0]); }} data-testid="fo-poster-input" />
            <div className="space-y-2.5">
              <select className="fo-input" value={form.mediaId} onChange={(e) => setForm({ ...form, mediaId: e.target.value, title: form.title || videos.find((v) => v.id === e.target.value)?.name || '' })} aria-label="The film" data-testid="fo-release-media">
                <option value="">The film (an uploaded video)…</option>
                {videos.map((v) => <option key={v.id} value={v.id}>{v.name}{v.durationSec ? ` · ${runtime(v.durationSec)}` : ''}</option>)}
              </select>
              {videos.length === 0 && <p className="text-[12px] text-[var(--fo-muted)]">Upload the finished film in the Cutting room first.</p>}
              <input className="fo-input fo-slate !text-[18px]" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" data-testid="fo-release-title" />
              <textarea className="fo-input min-h-[64px]" placeholder="Logline: one or two sentences" value={form.logline} onChange={(e) => setForm({ ...form, logline: e.target.value })} aria-label="Logline" maxLength={600} />
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Price">
                <button type="button" className="fo-chip" aria-pressed={!form.priced} onClick={() => setForm({ ...form, priced: false })}>Free</button>
                <button type="button" className="fo-chip" aria-pressed={form.priced} onClick={() => setForm({ ...form, priced: true })}>Sell it</button>
                {form.priced && (
                  <>
                    <label className="flex items-center gap-1.5 text-[13px]"><input className="fo-input !w-24" type="number" min={0.5} max={1000} step={0.5} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} aria-label="Price in CC" data-testid="fo-release-price" /> CC</label>
                    <label className="flex items-center gap-1.5 text-[13px]">preview
                      <select className="fo-input !w-auto" value={form.previewSec} onChange={(e) => setForm({ ...form, previewSec: Number(e.target.value) })} aria-label="Preview length">
                        {[15, 30, 60, 90].map((s) => <option key={s} value={s}>{s} s</option>)}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {form.priced && Number(form.price) >= 0.5 && <p className="text-[12px] text-[var(--fo-muted)]">Each sale: about {cc(Math.round(Number(form.price) * 95) / 100)} to you{chosen?.durationSec ? `; non-buyers see the first ${form.previewSec} s of ${runtime(chosen.durationSec)}` : ''}.</p>}
              <button type="button" className="fo-btn fo-btn-tape" onClick={() => { void release(); }} disabled={busy || !form.mediaId} data-testid="fo-release-create">{busy ? 'Releasing…' : 'Release'}</button>
            </div>
          </div>
        </section>

        <aside className="fo-sheet p-4" aria-label="Your releases">
          <h3 className="fo-slate text-[17px]">On the shelf</h3>
          {mine === null ? <div className="fo-skeleton mt-3 h-24" /> : mine.length === 0 ? <p className="mt-2 text-[13px] text-[var(--fo-muted)]">Nothing released from this production yet.</p> : (
            <ul className="mt-2 space-y-2" data-testid="fo-my-releases">
              {mine.map((r) => (
                <li key={r.id} className="rounded border border-[var(--fo-rule)] bg-[var(--fo-input)] p-2.5 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => onOpenCinema?.(r.id)}>{r.title}</button>
                    <span className="fo-chip !px-2 !py-0.5 text-[11px]">{r.status === 'published' ? 'out' : 'withdrawn'}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--fo-muted)]">{r.priceCC > 0 ? `${cc(r.priceCC)} · ${r.buyers ?? 0} bought` : 'Free'} · {runtime(r.runtimeSec)}</p>
                  {r.status === 'published' && (
                    <div className="mt-2 flex items-center gap-2">
                      {r.priceCC > 0 && <label className="flex items-center gap-1 text-[12px]">price <input className="fo-input !min-h-[28px] !w-20 !py-0 text-[12px]" type="number" min={0.5} max={1000} step={0.5} defaultValue={r.priceCC} onBlur={(e) => { void reprice(r, e.target.value); }} aria-label={`Price of ${r.title}`} /></label>}
                      <button type="button" className="fo-btn fo-btn-quiet ml-auto !min-h-[28px] !px-2 text-[12px]" onClick={() => { void withdraw(r); }}>Withdraw</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <section className="fo-sheet p-4" aria-label="Festivals">
        <FsDistributionPanel projectId={projectId} />
      </section>
    </div>
  );
}
