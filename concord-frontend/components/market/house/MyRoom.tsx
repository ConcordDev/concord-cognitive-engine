'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ago, cc, house, lotNo, price, type Library, type Lot, type Mine, type OpenDtu } from './houseApi';
import { LotPlate } from './LotPlate';

/** The caller's own room: lots on consignment, what they earned, what they own. */
export function MyRoom({ signedIn, onOpen, onReader, refreshKey, onChanged }: { signedIn: boolean; onOpen: (id: string) => void; onReader: (d: OpenDtu) => void; refreshKey: number; onChanged: () => void }) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [lib, setLib] = useState<Library | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; price: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([house<Mine>('house-mine'), house<Library>('house-library')]);
    if (a.ok) setMine(a.result); else setErr(a.message);
    if (b.ok) setLib(b.result); else setErr(b.message);
  }, []);
  useEffect(() => { if (signedIn) void load(); }, [signedIn, load, refreshKey]);

  if (!signedIn) return <div className="ah-panel px-6 py-12 text-center"><p className="ah-title text-[24px]">Your room opens when you sign in.</p><a className="ah-btn ah-btn-house mt-4" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in</a></div>;

  const reprice = async (l: Lot) => {
    const r = await house<{ lot: Lot }>('house-reprice', { id: l.id, price: Number(edit?.price) });
    if (r.ok) { setMsg({ ok: true, text: `Lot ${lotNo(l.id)} now ${price(r.result.lot)}.` }); setEdit(null); onChanged(); void load(); } else setMsg({ ok: false, text: r.message });
  };
  const withdraw = async (l: Lot) => {
    if (!window.confirm(`Withdraw “${l.title}” from sale? Buyers who own it keep it.`)) return;
    const r = await house('house-withdraw', { id: l.id });
    if (r.ok) { setMsg({ ok: true, text: `Lot ${lotNo(l.id)} withdrawn.` }); onChanged(); void load(); } else setMsg({ ok: false, text: r.message });
  };
  const read = async (args: { lotId?: string; submissionId?: string }) => {
    const r = await house<{ dtu: OpenDtu }>('house-open', args);
    if (r.ok) onReader({ ...r.result.dtu, fileHref: args.lotId && r.result.dtu.file ? `/api/economy/marketplace/listings/${args.lotId}/master` : undefined });
    else setMsg({ ok: false, text: r.message });
  };

  return (
    <div className="space-y-10">
      {err && <p className="ah-error" role="alert">{err}</p>}
      {msg && <p className={msg.ok ? 'ah-okay' : 'ah-error'} role="status">{msg.text}</p>}

      <section aria-label="Earnings">
        <p className="ah-label">Your account with the house</p>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="ah-earnings">
          <Figure label="Balance" value={cc(mine?.balance)} strong />
          <Figure label="Sales" value={mine ? String(mine.sales) : '—'} />
          <Figure label="Gross" value={cc(mine?.gross)} />
          <Figure label="After the house fee" value={cc(mine?.sellerNet)} />
          <Figure label="Royalties received" value={cc(mine?.royalties)} />
        </div>
      </section>

      <section aria-label="Your lots">
        <p className="ah-label mb-2">On consignment</p>
        {!mine ? <div className="ah-skeleton h-32" /> : mine.lots.length === 0 ? <p className="text-[13.5px] ah-muted">You have not consigned anything yet.</p> : (
          <ul className="ah-panel divide-y divide-[var(--ah-rule)]" data-testid="ah-my-lots">
            {mine.lots.map((l) => (
              <li key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3 sm:grid-cols-[1fr_120px_120px_auto]">
                <button type="button" className="min-w-0 text-left" onClick={() => onOpen(l.id)}>
                  <span className="ah-no mr-2 text-[12px]">Lot {lotNo(l.id)}</span>
                  <span className="ah-title text-[17px]">{l.title}</span>
                  <span className={cn('ml-2 text-[12px]', l.status === 'active' ? 'ah-good' : 'ah-muted')}>{l.status === 'active' ? 'on sale' : l.status}</span>
                </button>
                <span className="hidden text-right sm:block"><span className="ah-num block">{l.sold}</span><span className="text-[11px] ah-faint">sold</span></span>
                <span className="hidden text-right sm:block"><span className="ah-num block">{cc(l.revenue)}</span><span className="text-[11px] ah-faint">gross</span></span>
                <span className="flex items-center justify-end gap-2">
                  {l.status === 'active' && (edit?.id === l.id ? (
                    <>
                      <input className="ah-input ah-num w-24" autoFocus inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ id: l.id, price: e.target.value.replace(/[^0-9.]/g, '') })} onKeyDown={(e) => { if (e.key === 'Enter') void reprice(l); if (e.key === 'Escape') setEdit(null); }} aria-label="New price" />
                      <button type="button" className="ah-btn h-8" onClick={() => void reprice(l)}>Save</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ah-btn h-8" onClick={() => setEdit({ id: l.id, price: String(l.price || '') })}>{price(l)} · reprice</button>
                      <button type="button" className="ah-btn ah-btn-ghost h-8" onClick={() => void withdraw(l)}>Withdraw</button>
                    </>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Your library">
        <p className="ah-label mb-2">Your library</p>
        {!lib ? <div className="ah-skeleton h-32" /> : lib.bought.length === 0 && lib.commissioned.length === 0 ? <p className="text-[13.5px] ah-muted" data-testid="ah-library-empty">Nothing bought yet. Lots you buy and commissions delivered to you live here.</p> : (
          <div className="space-y-6">
            {lib.bought.length > 0 && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="ah-library">
                {lib.bought.map((l) => (
                  <div key={l.id} className="space-y-1.5">
                    <LotPlate lot={l} onOpen={onOpen} size="sm" />
                    <button type="button" className="ah-btn h-8 w-full" onClick={() => void read({ lotId: l.id })}>Read · paid {cc(l.paid)}</button>
                  </div>
                ))}
              </div>
            )}
            {lib.commissioned.length > 0 && (
              <ul className="ah-panel divide-y divide-[var(--ah-rule)]">
                {lib.commissioned.map((c) => (
                  <li key={c.submissionId} className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0"><span className="ah-title block text-[16px]">{c.title}</span><span className="block text-[12px] ah-muted">commissioned as “{c.commission}” · made by {c.creator} · {ago(c.deliveredAt)}</span></span>
                    <button type="button" className="ah-btn h-8" onClick={() => void read({ submissionId: c.submissionId })}>Read</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border-t-2 border-[var(--ah-rule-2)] pt-2">
      <p className="ah-label">{label}</p>
      <p className={cn('ah-num ah-display mt-0.5', strong ? 'text-[26px] font-semibold ah-oxblood' : 'text-[22px]')}>{value}</p>
    </div>
  );
}
