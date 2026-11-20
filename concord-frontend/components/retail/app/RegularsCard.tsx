'use client';

/**
 * "Back again" — what this customer's own orders say about them
 * (retail.customer-insights): visit count, usual buy, last visit, spend.
 * A customer with no orders yet is shown as a first visit, never padded.
 */

import { useEffect, useState } from 'react';
import { retail, money, type Insights } from './retailApi';

const ordinal = (n: number) => {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suf}`;
};

export function RegularsCard({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    retail<Insights>('customer-insights', { customerId }).then((r) => {
      if (!live) return;
      if (r.ok && r.result) setData(r.result); else setFailed(true);
    });
    return () => { live = false; };
  }, [customerId]);

  if (failed) return null;
  if (!data) return <div className="mb-1 h-[42px] animate-pulse rounded bg-black/5" aria-busy />;

  const last = data.daysSinceLastVisit;
  return (
    <div className="mb-1 rounded border border-dashed border-black/20 px-3 py-2 font-[family-name:var(--stall-font-hand)] text-[17px] leading-snug text-[color:var(--stall-ink)]" aria-label="Customer history">
      {data.visits === 0 ? (
        <>First visit — say hello to {data.name.split(' ')[0]}!</>
      ) : (
        <>
          {data.name.split(' ')[0]}&rsquo;s back — {ordinal(data.visits + 1)} visit
          {data.favorite && <>, usually gets <b>{data.favorite.name}</b></>}.
          <span className="block font-[family-name:var(--stall-font-till)] text-[11px] text-[color:var(--stall-ink-dim)]">
            {last === 0 ? 'Here earlier today' : last === 1 ? 'Last here yesterday' : `Last here ${last} days ago`} · spent {money(data.totalSpent)} · avg {money(data.avgOrder)}
          </span>
        </>
      )}
    </div>
  );
}

export default RegularsCard;
