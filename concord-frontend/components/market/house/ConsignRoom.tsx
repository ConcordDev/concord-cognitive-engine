'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cc, house, LICENSE_LABEL, LICENSE_TEXT, uploadCover, type License, type Lot, type MyDtu, type Terms } from './houseApi';
import { LotPlate } from './LotPlate';

const LICENSES: License[] = ['nonexclusive', 'personal', 'exclusive', 'cc-by'];

/** Consign a DTU you made: pick it, dress it with a cover, price it. */
export function ConsignRoom({ signedIn, terms, onConsigned }: { signedIn: boolean; terms: Terms | null; onConsigned: (lot: Lot) => void }) {
  const [dtus, setDtus] = useState<MyDtu[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<MyDtu | null>(null);
  const [title, setTitle] = useState('');
  const [priceText, setPriceText] = useState('5');
  const [license, setLicense] = useState<License>('nonexclusive');
  const [note, setNote] = useState('');
  const [cover, setCover] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!signedIn) return;
    void house<{ dtus: MyDtu[] }>('house-my-dtus').then((r) => { if (r.ok) setDtus(r.result.dtus); else setError(r.message); });
  }, [signedIn]);
  useEffect(() => () => { if (cover?.url) URL.revokeObjectURL(cover.url); }, [cover]);

  const shown = useMemo(() => (dtus || []).filter((d) => !q || `${d.title} ${d.excerpt} ${d.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [dtus, q]);
  const priceNum = Number(priceText);
  const priceOk = priceText.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0 && (priceNum === 0 || priceNum >= 0.01);
  const fee = terms && priceOk && priceNum > 0 ? Math.round(priceNum * terms.combinedRate * 100) / 100 : 0;

  const choose = (d: MyDtu) => { setPick(d); setTitle(d.title); setFormError(null); };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setFormError(null);
    const r = await uploadCover(file, title || pick?.title || 'lot');
    setUploading(false);
    if (r.ok) setCover({ id: r.result.dtuId, url: URL.createObjectURL(file) }); else setFormError(r.message);
  };

  const consign = async () => {
    if (!pick) return;
    setBusy(true); setFormError(null);
    const r = await house<{ lot: Lot }>('house-consign', { dtuId: pick.id, title, price: priceNum, license, description: note, coverArtifactId: cover?.id });
    setBusy(false);
    if (!r.ok) { setFormError(r.message); return; }
    setDtus((list) => (list || []).map((d) => (d.id === pick.id ? { ...d, listedAs: r.result.lot.id } : d)));
    setPick(null); setCover(null); setNote('');
    onConsigned(r.result.lot);
  };

  if (!signedIn) {
    return <div className="ah-panel px-6 py-12 text-center"><p className="ah-title text-[24px]">Consigning needs an account.</p><a className="ah-btn ah-btn-house mt-4" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in</a></div>;
  }

  const preview: Lot | null = pick ? {
    id: 'preview0000', title: title || pick.title, kind: pick.isImage ? 'art' : pick.tier === 'mega' ? 'mega_dtu' : pick.tier === 'hyper' ? 'hyper_dtu' : 'dtu',
    price: priceOk ? Math.round(priceNum * 100) / 100 : 0, free: priceOk && priceNum === 0, license, status: 'active',
    seller: { id: '', name: 'you' }, cover: cover?.url || null, domain: pick.domain, tags: pick.tags, excerpt: pick.excerpt, counts: null,
    tier: pick.tier, hasFile: !!pick.file, artist: null, sold: 0, sold24h: 0, sold7d: 0, listedAt: new Date().toISOString(),
  } : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        <div>
          <p className="ah-label">Consign</p>
          <h2 className="ah-display text-[30px] italic">Put a DTU you made on the floor</h2>
          <p className="text-[13.5px] ah-muted">Only DTUs you made can be consigned. Bought copies and system records are left out.</p>
        </div>

        <section aria-label="Your DTUs">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ah-faint" aria-hidden />
            <input className="ah-input pl-9" placeholder="Find one of your DTUs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find one of your DTUs" />
          </label>
          {error && <p className="ah-error mt-3" role="alert">{error}</p>}
          {!dtus && !error && <div className="mt-3 space-y-2" role="status" aria-label="Loading your DTUs">{Array.from({ length: 4 }, (_, i) => <div key={i} className="ah-skeleton h-14" />)}</div>}
          {dtus && dtus.length === 0 && <p className="ah-note mt-3">You have no DTUs of your own yet. Make one in any lens and it will appear here.</p>}
          {dtus && dtus.length > 0 && (
            <ul className="ah-panel ah-scroll mt-3 max-h-[340px] overflow-y-auto" data-testid="ah-my-dtus">
              {shown.map((d) => (
                <li key={d.id}>
                  <button type="button" disabled={!!d.listedAs} onClick={() => choose(d)} aria-pressed={pick?.id === d.id}
                    className={cn('flex w-full items-baseline justify-between gap-3 border-b px-3 py-2.5 text-left ah-rule', pick?.id === d.id ? 'bg-[var(--ah-paper-2)]' : 'hover:bg-[var(--ah-paper)]', d.listedAs && 'opacity-55')}>
                    <span className="min-w-0">
                      <span className="ah-title block truncate text-[17px]">{d.title}</span>
                      <span className="block truncate text-[12px] ah-muted">{d.domain || d.tier} · {d.claims} claims · {d.words} words{d.isImage ? ' · image' : d.file ? ' · file' : ''}</span>
                    </span>
                    <span className="shrink-0 text-[12px] ah-faint">{d.listedAs ? 'on sale' : 'choose'}</span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-4 text-[13px] ah-muted">None match.</li>}
            </ul>
          )}
        </section>

        {pick && (
          <section className="ah-panel ah-rise space-y-4 p-5" aria-label="The lot" data-testid="ah-consign-form">
            <label className="block"><span className="ah-label">Title</span><input className="ah-input mt-1" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="ah-consign-title" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="ah-label">Price (CC, 0 for free)</span><input className="ah-input ah-num mt-1" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="ah-consign-price" /></label>
              <div>
                <span className="ah-label">Cover</span>
                <div className="mt-1 flex items-center gap-2">
                  <button type="button" className="ah-btn" onClick={() => fileRef.current?.click()} disabled={uploading}><ImagePlus className="h-4 w-4" />{uploading ? 'Uploading…' : cover ? 'Replace cover' : 'Upload a cover'}</button>
                  {cover && <button type="button" className="text-[12px] underline ah-muted" onClick={() => setCover(null)}>remove</button>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="ah-cover-input" />
                {!cover && pick.isImage && <p className="mt-1 text-[11.5px] ah-muted">This DTU is an image, so it is its own cover.</p>}
              </div>
            </div>
            <fieldset>
              <legend className="ah-label mb-1.5">Licence</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {LICENSES.map((l) => (
                  <label key={l} className={cn('cursor-pointer border p-2.5 text-[13px] ah-rule', license === l && 'border-[var(--ah-oxblood)] bg-[var(--ah-paper)]')}>
                    <input type="radio" name="license" className="mr-2" checked={license === l} onChange={() => setLicense(l)} />
                    <span className="font-medium">{LICENSE_LABEL[l]}</span>
                    <span className="mt-0.5 block text-[12px] ah-muted">{LICENSE_TEXT[l]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block"><span className="ah-label">A note for buyers (optional)</span><textarea className="ah-textarea mt-1" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {formError && <p className="ah-error" role="alert" data-testid="ah-consign-error">{formError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 ah-rule">
              <p className="text-[13px] ah-muted">{!priceOk ? 'Prices are 0 (free) or from 0.01 CC.' : priceNum === 0 ? 'Free: buyers take it at no cost.' : <>Each sale pays you <span className="ah-num ah-ink-2 font-semibold">{cc(Math.round((priceNum - fee) * 100) / 100)}</span> after the {terms ? (terms.combinedRate * 100).toFixed(2) : '5.46'}% house fee ({cc(fee)}).</>}</p>
              <button type="button" className="ah-btn ah-btn-house" onClick={consign} disabled={busy || !priceOk || !title.trim() || (license === 'exclusive' && priceNum === 0)} data-testid="ah-consign">{busy ? 'Consigning…' : 'Consign the lot'}</button>
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start" aria-label="Preview">
        <p className="ah-label">As it will hang</p>
        {preview ? <LotPlate lot={preview} onOpen={() => undefined} /> : <div className="ah-panel flex aspect-[3/4] items-center justify-center p-6 text-center text-[13px] ah-muted">Choose a DTU to see its plate.</div>}
      </aside>
    </div>
  );
}
