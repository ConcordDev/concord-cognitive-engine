'use client';

/**
 * The screening wall: published animations. Free ones play in full; a priced
 * one plays its preview (the stream only sends that much) and stops cleanly
 * there with a buy; once it is yours it plays all the way through.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ticket } from 'lucide-react';
import { an, cc, secs, type Release } from './lt';

export function Screening({ initialId, onConsumedInitial }: { initialId?: string | null; onConsumedInitial?: () => void }) {
  const [shelf, setShelf] = useState<'all' | 'mine'>('all');
  const [list, setList] = useState<Release[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialId || null);
  useEffect(() => { if (initialId) { setOpenId(initialId); onConsumedInitial?.(); } }, [initialId, onConsumedInitial]);

  const load = useCallback(async () => {
    const r = await an<{ releases: Release[] }>('anim-release-list', shelf === 'mine' ? { owned: true } : {});
    if (!r.ok) { setErr(r.error); setList([]); return; }
    setErr(null); setList(r.result?.releases || []);
  }, [shelf]);
  useEffect(() => { void load(); }, [load]);

  if (openId) return <Showing id={openId} onBack={() => { setOpenId(null); void load(); }} />;
  return (
    <div className="space-y-4" data-testid="lt-screening">
      <div className="flex gap-2">
        <button type="button" className="lt-btn lt-desk-btn !min-h-[32px]" aria-pressed={shelf === 'all'} onClick={() => setShelf('all')}>Showing now</button>
        <button type="button" className="lt-btn lt-desk-btn !min-h-[32px]" aria-pressed={shelf === 'mine'} onClick={() => setShelf('mine')}>Bought</button>
      </div>
      {err && <p className="lt-error" role="alert">{err}</p>}
      {list === null ? <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="lt-reel" />)}</div>
        : list.length === 0 ? <p className="py-10 text-center text-[14px] text-[#b9b2a6]">{shelf === 'mine' ? 'Animations you buy show up here.' : 'Nothing is showing yet. Publish one from the light table.'}</p>
          : (
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="lt-reels">
              {list.map((r) => (
                <li key={r.id}>
                  <button type="button" className="block w-full text-left" onClick={() => setOpenId(r.id)} aria-label={`${r.title}, ${r.priceCC > 0 ? cc(r.priceCC) : 'free'}`}>
                    <div className="lt-reel lt-rise">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r.poster ? <img src={r.poster} alt="" loading="lazy" /> : <span className="lt-title absolute inset-0 flex items-center justify-center p-3 text-center text-[20px] text-[#e9e2d4]">{r.title}</span>}
                    </div>
                    <p className="lt-title mt-2 text-[15px] text-[#f6f1e7]">{r.title}</p>
                    <p className="text-[12px] text-[#b9b2a6]">{r.animator.name} · {secs(r.runtimeSec)} · {r.owned || r.animator.isMe ? 'yours' : r.priceCC > 0 ? cc(r.priceCC) : 'free'}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

function Showing({ id, onBack }: { id: string; onBack: () => void }) {
  const [rel, setRel] = useState<Release | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [bought, setBought] = useState(false);
  const load = useCallback(async () => {
    const r = await an<{ release: Release }>('anim-release-get', { id });
    if (!r.ok) { setErr(r.error); return; }
    setRel(r.result!.release);
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const buy = async () => {
    setBusy(true); setErr(null);
    const r = await an('anim-release-buy', { id });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setBought(true); setEnded(false);
    await load();
  };

  if (!rel) return (
    <div>
      <button type="button" className="lt-btn lt-desk-btn" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Screening</button>
      {err ? <p className="lt-error mt-4" role="alert">{err}</p> : <div className="mt-4 h-64 rounded bg-[#2a2723]" role="status" aria-label="Loading" />}
    </div>
  );
  const preview = !rel.canWatchFull && rel.priceCC > 0;
  const locked = preview && !rel.previewSec; // sold with no preview: nothing streams until bought
  return (
    <article className="space-y-4" data-testid="lt-showing">
      <button type="button" className="lt-btn lt-desk-btn" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Screening</button>
      <div className="lt-screen">
        {locked ? (
          <div className="relative flex aspect-video items-center justify-center bg-[#1b1916]" data-testid="lt-locked">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {rel.poster && <img src={rel.poster} alt="" className="absolute inset-0 h-full w-full object-contain opacity-60" />}
            <p className="lt-title relative text-[20px] text-[#fbfaf6]">Buy it to watch it</p>
          </div>
        ) : (
        <video key={`${rel.id}:${rel.canWatchFull}`} src={rel.streamUrl} controls playsInline preload="metadata" data-testid="lt-showing-video"
          onTimeUpdate={(e) => { const v = e.currentTarget; if (preview && rel.previewSec && v.currentTime >= rel.previewSec) { v.pause(); v.currentTime = rel.previewSec; setEnded(true); } }} />
        )}
        {preview && ended && rel.status === 'published' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-center" data-testid="lt-preview-ended">
            <p className="lt-title text-[22px] text-[#fbfaf6]">That&rsquo;s the preview.</p>
            <button type="button" className="lt-btn lt-btn-red" onClick={() => { void buy(); }} disabled={busy}><Ticket className="h-4 w-4" /> Watch it all · {cc(rel.priceCC)}</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="lt-title text-[30px] leading-tight text-[#fbfaf6]">{rel.title}</h2>
          <p className="text-[13px] text-[#b9b2a6]">by {rel.animator.isMe ? 'you' : rel.animator.name} · {secs(rel.runtimeSec)}{rel.fps ? ` · ${rel.fps} fps` : ''}{rel.width ? ` · ${rel.width}×${rel.height}` : ''}{rel.status !== 'published' ? ' · taken down' : ''}</p>
          {rel.logline && <p className="mt-2 max-w-[60ch] text-[15px] text-[#ece6da]">{rel.logline}</p>}
          {preview && <p className="mt-2 text-[12.5px] text-[#b9b2a6]">{rel.previewSec ? <>You&rsquo;re seeing the first {rel.previewSec} seconds.</> : 'This one has no preview: buy it to watch.'}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {preview && rel.status === 'published' && <button type="button" className="lt-btn lt-btn-red" onClick={() => { void buy(); }} disabled={busy} data-testid="lt-showing-buy"><Ticket className="h-4 w-4" /> {busy ? 'Buying…' : `Buy · ${cc(rel.priceCC)}`}</button>}
          {rel.owned && <span className="lt-chip !border-[#7fd19b] !text-[#c4f0d2]">{bought ? 'Bought. It’s yours.' : 'Yours'}</span>}
          {rel.animator.isMe && rel.priceCC > 0 && <span className="text-[12px] text-[#b9b2a6]">{rel.buyers ?? 0} bought</span>}
        </div>
      </div>
      {err && <p className="lt-error" role="alert">{err}</p>}
    </article>
  );
}
