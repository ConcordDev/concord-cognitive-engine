'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ago, cc, house, lotNo, price, type Trending } from './houseApi';

/** The sales record: what actually sold, counted from fulfilled purchases. */
export function SalesRecord({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: number }) {
  const [span, setSpan] = useState<'24h' | '7d'>('24h');
  const [data, setData] = useState<Trending | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    void house<Trending>('house-trending', { window: span, limit: 30 }).then((r) => {
      if (!live) return;
      if (r.ok) { setData(r.result); setError(null); } else setError(r.message);
    });
    return () => { live = false; };
  }, [span, refreshKey]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ah-label">The sales record</p>
          <h2 className="ah-display text-[30px] italic">What sold{span === '24h' ? ' today' : ' this week'}</h2>
          {data && <p className="text-[13.5px] ah-muted" data-testid="ah-record-total"><span className="ah-num ah-ink-2 font-semibold">{data.total.sales}</span> {data.total.sales === 1 ? 'sale' : 'sales'} · <span className="ah-num">{cc(data.total.revenue)}</span> changed hands</p>}
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Window">
          {(['24h', '7d'] as const).map((w) => (
            <button key={w} type="button" role="tab" aria-selected={span === w} className={cn('ah-chip h-8 px-3 text-[13px]')} onClick={() => setSpan(w)}>{w === '24h' ? 'Last 24 hours' : 'Last 7 days'}</button>
          ))}
        </div>
      </div>

      {error && <p className="ah-error" role="alert">{error}</p>}
      {!data && !error && <div className="space-y-2" role="status" aria-label="Loading the record">{Array.from({ length: 5 }, (_, i) => <div key={i} className="ah-skeleton h-14" />)}</div>}
      {data && data.lots.length === 0 && (
        <div className="ah-panel px-6 py-10 text-center" data-testid="ah-record-empty">
          <p className="ah-title text-[22px]">No sales {span === '24h' ? 'in the last 24 hours' : 'this week'}.</p>
          <p className="mt-1 text-[13.5px] ah-muted">The record fills only with real purchases.</p>
        </div>
      )}
      {data && data.lots.length > 0 && (
        <ol className="ah-panel px-3" data-testid="ah-record">
          {data.lots.map((l, i) => (
            <li key={l.id}>
              <button type="button" onClick={() => onOpen(l.id)} className="ah-ledger-row w-full grid-cols-[28px_52px_1fr_auto] text-left sm:grid-cols-[28px_52px_1fr_110px_110px]">
                <span className="ah-display ah-num text-[22px] ah-brass">{i + 1}</span>
                <span className="h-[52px] w-[52px] overflow-hidden border ah-rule bg-[var(--ah-paper-2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.cover ? <img src={l.cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center ah-no text-[11px]">{lotNo(l.id)}</span>}
                </span>
                <span className="min-w-0">
                  <span className="ah-title block truncate text-[18px]">{l.title}</span>
                  <span className="block truncate text-[12.5px] ah-muted">by {l.seller.name || 'a maker'} · {price(l)}{l.status === 'sold' ? ' · sold out' : ''}</span>
                </span>
                <span className="text-right">
                  <span className="ah-num block text-[16px] font-semibold">{l.windowSales}</span>
                  <span className="block text-[11px] ah-faint">{l.windowSales === 1 ? 'sale' : 'sales'}</span>
                </span>
                <span className="hidden text-right sm:block">
                  <span className="ah-num block text-[14px]">{cc(l.windowRevenue)}</span>
                  <span className="block text-[11px] ah-faint">last {ago(l.lastSaleAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
