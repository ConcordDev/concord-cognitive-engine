'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, BookOpen, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cc, house, KIND_LABEL, LICENSE_LABEL, LICENSE_TEXT, lotNo, price, ago, type LotDetail, type OpenDtu } from './houseApi';
import { LotPlate } from './LotPlate';

type Phase = 'idle' | 'confirm' | 'buying';

/** One lot, opened from the catalogue: the plate, its record, and the buy. */
export function LotSheet({ id, signedIn, onClose, onOpen, onBought, onReader }: {
  id: string;
  signedIn: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onBought: (balance: number) => void;
  onReader: (dtu: OpenDtu) => void;
}) {
  const [d, setD] = useState<LotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [buyError, setBuyError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [broken, setBroken] = useState(false);

  const load = useCallback(async () => {
    const r = await house<LotDetail>('house-lot', { id });
    if (r.ok) { setD(r.result); setError(null); } else setError(r.message);
  }, [id]);
  useEffect(() => { setD(null); setPhase('idle'); setBuyError(null); setFresh(false); setBroken(false); void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (phase === 'confirm') setPhase('idle'); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const buy = async () => {
    if (!d) return;
    setPhase('buying'); setBuyError(null);
    const r = await house<{ balance: number; lotStatus: string }>('house-buy', { id: d.lot.id, expectPrice: d.lot.price });
    if (!r.ok) {
      setPhase('idle');
      setBuyError(r.message);
      if (r.error === 'price_changed' || r.error === 'lot_not_found') void load();
      return;
    }
    onBought(r.result.balance);
    setFresh(true);
    setPhase('idle');
    await load();
  };

  const read = async () => {
    const r = await house<{ dtu: OpenDtu }>('house-open', { lotId: id });
    if (r.ok) onReader({ ...r.result.dtu, fileHref: r.result.dtu.file ? `/api/economy/marketplace/listings/${id}/master` : undefined }); else setBuyError(r.message);
  };

  const lot = d?.lot;
  const balance = d?.terms.balance ?? null;
  const after = lot && balance != null ? Math.round((balance - lot.price) * 100) / 100 : null;
  const short = lot && balance != null && !lot.free && balance < lot.price;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label={lot ? `Lot ${lotNo(lot.id)}` : 'Lot'} data-testid="ah-sheet">
      <button type="button" className="ah-scrim hidden flex-1 sm:block" aria-label="Close the lot" onClick={onClose} />
      <article className="ah-sheet ah-scroll ah-rise h-full w-full max-w-[640px] overflow-y-auto pb-24 sm:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b ah-rule bg-[var(--ah-paper)] px-5 py-3">
          <span className="ah-no text-[14px]">{lot ? `Lot ${lotNo(lot.id)}` : 'Lot'}</span>
          <button type="button" className="ah-btn ah-btn-ghost h-8 px-2" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /><span className="ah-kbd">esc</span></button>
        </header>

        {error && <p className="ah-error m-5" role="alert">{error}</p>}
        {!d && !error && <div className="m-5 space-y-3" role="status" aria-label="Loading the lot"><div className="ah-skeleton aspect-[4/3]" /><div className="ah-skeleton h-8 w-3/4" /><div className="ah-skeleton h-4 w-1/2" /></div>}

        {lot && d && (
          <div className="space-y-6 p-5">
            <div className="ah-cover relative border ah-rule">
              {lot.cover && !broken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lot.cover} alt={`Cover of ${lot.title}`} onError={() => setBroken(true)} />
              ) : (
                <div className="ah-cover-blank" aria-hidden><span className="ah-no">Lot {lotNo(lot.id)}</span><span className="ah-title text-[30px]">{lot.title}</span><span className="ah-label">{lot.domain || KIND_LABEL[lot.kind]}</span></div>
              )}
              {lot.status === 'sold' && <span className="ah-sold" data-fresh={fresh}>Sold</span>}
            </div>

            <div>
              <p className="ah-label">{KIND_LABEL[lot.kind] || lot.kind}{lot.domain ? ` · ${lot.domain}` : ''}</p>
              <h2 className="ah-title mt-1 text-[32px]" data-testid="ah-lot-title">{lot.title}</h2>
              <p className="mt-1 text-[14px] ah-muted">by <span className="ah-ink-2">{lot.seller.name || lot.artist || 'a maker'}</span> · consigned {ago(lot.listedAt)}</p>
            </div>

            {/* the bid card */}
            <section className="ah-panel p-4" aria-label="Buy">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="ah-label">{lot.status === 'sold' ? 'Sold for' : 'Price'}</p>
                  <p className="ah-num ah-display text-[34px] font-semibold ah-oxblood" data-testid="ah-lot-price">{price(lot)}</p>
                </div>
                {d.owned ? (
                  <button type="button" className="ah-btn ah-btn-house h-10" onClick={read} data-testid="ah-read"><BookOpen className="h-4 w-4" />{d.isSeller ? 'Read your lot' : 'Read in full'}</button>
                ) : lot.status !== 'active' ? (
                  <span className="text-[13px] ah-muted">This lot is closed.</span>
                ) : !signedIn ? (
                  <a className="ah-btn ah-btn-house h-10" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>{lot.free ? 'Sign in to take it' : 'Sign in to buy'}</a>
                ) : phase === 'idle' ? (
                  <button type="button" className="ah-btn ah-btn-house h-10" onClick={() => setPhase('confirm')} disabled={!!short} data-testid="ah-buy"><Gavel className="h-4 w-4" />{lot.free ? 'Take it' : 'Buy'}</button>
                ) : null}
              </div>

              {phase !== 'idle' && !d.owned && (
                <div className="ah-rise mt-4 border-t ah-rule pt-4" data-testid="ah-confirm">
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[13.5px]">
                    <dt className="ah-muted">You pay</dt><dd className="ah-num text-right">{cc(lot.price)}</dd>
                    {!lot.free && <><dt className="ah-muted">The maker receives (after the {(d.terms.combinedRate * 100).toFixed(2)}% house fee)</dt><dd className="ah-num text-right">{cc(Math.round((lot.price - Math.round(lot.price * d.terms.combinedRate * 100) / 100) * 100) / 100)}</dd></>}
                    {balance != null && <><dt className="ah-muted">Your balance after</dt><dd className="ah-num text-right font-semibold">{cc(after)}</dd></>}
                  </dl>
                  <p className="mt-2 text-[12.5px] ah-muted">{LICENSE_LABEL[lot.license]}: {LICENSE_TEXT[lot.license]}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="ah-btn ah-btn-house flex-1" onClick={buy} disabled={phase === 'buying'} data-testid="ah-confirm-buy">{phase === 'buying' ? 'Buying…' : `Confirm · ${price(lot)}`}</button>
                    <button type="button" className="ah-btn" onClick={() => setPhase('idle')} disabled={phase === 'buying'}>Cancel</button>
                  </div>
                </div>
              )}
              {short && phase === 'idle' && !d.owned && <p className="mt-3 text-[13px] ah-bad">You need {cc(lot.price)}; your balance is {cc(balance)}. Add Concord Coin from your wallet.</p>}
              {d.owned && !d.isSeller && <p className="ah-okay mt-3" data-testid="ah-owned">You own this lot.</p>}
              {buyError && <p className="ah-error mt-3" role="alert" data-testid="ah-buy-error">{buyError}</p>}
            </section>

            {lot.excerpt && (
              <section>
                <p className="ah-label mb-1.5">From the lot</p>
                <blockquote className="ah-display border-l-2 border-[var(--ah-brass)] pl-4 text-[19px] italic leading-snug ah-ink-2">{lot.excerpt}</blockquote>
              </section>
            )}
            {d.description && <section><p className="ah-label mb-1.5">The maker's note</p><p className="whitespace-pre-line text-[14px] ah-ink-2">{d.description}</p></section>}

            <section className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" aria-label="Particulars">
              {lot.counts && <Particular label="Claims" value={lot.counts.claims} />}
              {lot.counts && <Particular label="Words" value={lot.counts.words} />}
              <Particular label="Sold" value={lot.sold} sub={lot.sold7d ? `${lot.sold7d} this week` : undefined} />
              <Particular label="Licence" value={LICENSE_LABEL[lot.license]} />
              {d.isSeller && d.revenue != null && <Particular label="Your gross" value={cc(d.revenue)} />}
            </section>
            <p className="text-[12.5px] ah-muted">{LICENSE_TEXT[lot.license]}</p>

            {lot.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{lot.tags.map((t) => <span key={t} className="ah-chip">#{t}</span>)}</div>}

            <section>
              <p className="ah-label mb-2">Provenance</p>
              {d.royalties.length ? (
                <ul className="space-y-1.5 text-[13.5px]">
                  {d.royalties.map((r) => (
                    <li key={`${r.contentId}-${r.generation}`} className="ah-check" data-pass="true">
                      <span>Cites work by <span className="ah-ink-2 font-medium">{r.creator}</span></span>
                      <span className="ah-check-leader" />
                      <span className="ah-num ah-muted">gen {r.generation}{r.rate != null ? ` · ${(r.rate * 100).toFixed(2)}% royalty` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13.5px] ah-muted">An original: it cites no registered work, so the whole sale goes to its maker (after the house fee).</p>}
            </section>

            {d.moreFromSeller.length > 0 && (
              <section>
                <p className="ah-label mb-2">More from {lot.seller.name || 'this maker'}</p>
                <div className="grid grid-cols-2 gap-3">{d.moreFromSeller.map((m) => <LotPlate key={m.id} lot={m} onOpen={onOpen} size="sm" />)}</div>
              </section>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

function Particular({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <p className="ah-label">{label}</p>
      <p className={cn('ah-num text-[18px] ah-display font-semibold')}>{value}</p>
      {sub && <p className="text-[11.5px] ah-faint">{sub}</p>}
    </div>
  );
}

/** The full DTU, for those who own it. */
export function Reader({ dtu, onClose }: { dtu: OpenDtu; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = (title: string, items: string[]) => items.length ? (
    <section><p className="ah-label mb-2">{title}</p><ol className="list-decimal space-y-1.5 pl-5 text-[14.5px] ah-ink-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ol></section>
  ) : null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[var(--ah-paper)] p-4 sm:p-10" role="dialog" aria-modal aria-label={`Reading ${dtu.title}`} data-testid="ah-reader">
      <article className="ah-rise w-full max-w-[720px] space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="ah-label">{dtu.tier} DTU{dtu.domain ? ` · ${dtu.domain}` : ''} · {dtu.words} words</p>
            <h2 className="ah-title mt-1 text-[36px]">{dtu.title || 'Untitled'}</h2>
          </div>
          <button type="button" className="ah-btn" onClick={onClose}><X className="h-4 w-4" />Close</button>
        </div>
        <div className="ah-double" />
        {dtu.summary && <p className="ah-display whitespace-pre-line text-[20px] leading-relaxed">{dtu.summary}</p>}
        {list('Claims', dtu.claims)}
        {list('Definitions', dtu.definitions)}
        {list('Examples', dtu.examples)}
        {dtu.file && (
          <p className="ah-note">
            This DTU carries a file ({dtu.file.type || 'file'}{dtu.file.size ? `, ${Math.round(dtu.file.size / 1024)} KB` : ''}).
            {dtu.fileHref && <> <a className="underline" href={dtu.fileHref} download>Download it</a>.</>}
          </p>
        )}
        {dtu.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{dtu.tags.map((t) => <span key={t} className="ah-chip">#{t}</span>)}</div>}
      </article>
    </div>
  );
}
