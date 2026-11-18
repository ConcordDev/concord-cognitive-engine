'use client';

/**
 * TodayStrip — the register's at-a-glance line: today's sales, orders,
 * 7-day sales, average order, and what needs attention (low stock, parked
 * sales). Every figure is retail.analytics-summary / retail.low-stock; the
 * sales basis the server reports is shown on hover so "sales" never means
 * two different things.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { retail, money, type Summary } from './retailApi';
import type { RetailSection } from './sections';

export function TodayStrip({ refreshKey, onNavigate }: { refreshKey: number; onNavigate: (s: RetailSection, sub?: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lowCount, setLowCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      retail<Summary>('analytics-summary'),
      retail<{ lowStock: unknown[] }>('low-stock', { threshold: 5 }),
    ]).then(([s, l]) => {
      if (!live) return;
      setFailed(!s.ok);
      if (s.ok && s.result) setSummary(s.result);
      if (l.ok && l.result) setLowCount(l.result.lowStock.length);
    });
    return () => { live = false; };
  }, [refreshKey]);

  const cell = 'flex min-w-0 flex-col px-4 py-2.5';
  const label = 'text-[11px] text-zinc-500';
  const value = 'font-mono text-[15px] tabular-nums text-zinc-100';

  return (
    <div className="flex flex-shrink-0 items-stretch divide-x divide-white/[0.06] overflow-x-auto border-b border-white/[0.06]" title={summary?.salesBasis} aria-busy={!summary && !failed}>
      <div className={cell}><span className={label}>Sales today</span><span className={value}>{summary ? money(summary.revenueToday) : '—'}</span></div>
      <div className={cell}><span className={label}>Orders today</span><span className={value}>{summary ? summary.ordersToday : '—'}</span></div>
      <div className={cn(cell, 'hidden sm:flex')}><span className={label}>Last 7 days</span><span className={value}>{summary ? money(summary.revenue7d) : '—'}</span></div>
      <div className={cn(cell, 'hidden md:flex')}><span className={label}>Avg order</span><span className={value}>{summary ? money(summary.avgOrderValue) : '—'}</span></div>
      <button type="button" onClick={() => onNavigate('products', 'lowstock')} className={cn(cell, 'text-left hover:bg-white/[0.03]')}>
        <span className={label}>Low stock</span>
        <span className={cn(value, lowCount ? 'text-amber-300' : '')}>{lowCount ?? '—'}</span>
      </button>
      <div className="flex-1" />
      {failed && <div role="alert" className="flex items-center px-4 text-[12px] text-rose-300">Store figures unavailable</div>}
    </div>
  );
}

export default TodayStrip;
