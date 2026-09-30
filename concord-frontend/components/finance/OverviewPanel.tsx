'use client';

/**
 * OverviewPanel — market monitor + net-worth trajectory + cash-flow mini.
 * Extracted from finance page; macros stay in page KPI loader
 * (dashboard-summary / net-worth-history / monthly-trend) and realtime indices.
 */

import { useState } from 'react';
import { TrendingUp, ArrowLeftRight } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  StatusDot,
} from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useDensity } from '@/lib/hooks/useDensity';

export interface NetWorthSnapshot {
  date: string;
  total: number;
  cash?: number;
  investments?: number;
}

export interface MonthlyTrendPoint {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number;
}

export interface MonthlyTrend {
  series: MonthlyTrendPoint[];
  avgMonthlyIncome: number;
  avgMonthlySpend: number;
  avgNet: number;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

const fmtUsd = (v: number, opts: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  }).format(v);

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

function Panel({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-lattice-border bg-lattice-surface/60 overflow-hidden', className)}>
      <header className="flex items-center justify-between px-3 py-2 border-b border-lattice-border bg-lattice-elevated/40">
        <h2 className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{title}</h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function NetWorthChart({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        compact
        icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
        title="No net-worth snapshots yet."
        description="Record a snapshot to start tracking your real net-worth trajectory over time. Nothing here is simulated."
        ariaLabel="Net worth history empty"
      />
    );
  }

  const W = 640;
  const H = 160;
  const PAD = 8;
  const totals = snapshots.map((s) => s.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const range = max - min || Math.abs(max) || 1;
  const pts = snapshots.map((s, i) => {
    const x = PAD + (i / Math.max(1, snapshots.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (s.total - min) / range) * (H - PAD * 2);
    return { x, y, s };
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${path} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD} L${pts[0].x.toFixed(1)},${H - PAD} Z`;
  const latest = snapshots[snapshots.length - 1];
  const first = snapshots[0];
  const rising = latest.total >= first.total;
  const stroke = rising ? '#34d399' : '#fb7185';

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label="Net worth over time">
        <defs>
          <linearGradient id="nwfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#nwfill)" />
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={stroke} />
      </svg>
      <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono mt-1">
        <span>{first.date}</span>
        <span className="text-gray-300">
          {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
        </span>
        <span>{latest.date}</span>
      </div>
    </div>
  );
}

function CashFlowMini({ trend }: { trend: MonthlyTrend | null }) {
  if (!trend || trend.series.length === 0) {
    return (
      <EmptyState
        compact
        icon={<ArrowLeftRight className="h-5 w-5" aria-hidden="true" />}
        title="No ledger activity yet."
        description="Ingest or import transactions in the Cash-flow tab to see monthly income vs. spend."
        ariaLabel="Monthly trend empty"
      />
    );
  }
  const series = trend.series.slice(-12);
  const peak = Math.max(1, ...series.map((m) => Math.max(m.income, m.spend)));
  return (
    <div>
      <div className="flex items-end gap-1.5 h-28">
        {series.map((m) => (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${m.month}  net ${fmtUsd(m.net)}`}>
            <div className="w-full flex items-end justify-center gap-0.5 h-24">
              <div
                className="w-1/2 rounded-sm bg-emerald-500/70"
                style={{ height: `${(m.income / peak) * 100}%` }}
                aria-hidden="true"
              />
              <div
                className="w-1/2 rounded-sm bg-rose-500/60"
                style={{ height: `${(m.spend / peak) * 100}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-[9px] text-gray-500 font-mono">{m.month.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px] font-mono">
        <span className="flex items-center gap-1 text-gray-400">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Income {fmtUsd(trend.avgMonthlyIncome)}/mo
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          <span className="w-2 h-2 rounded-sm bg-rose-500/60" /> Spend {fmtUsd(trend.avgMonthlySpend)}/mo
        </span>
        <span className={cn('ml-auto', trend.avgNet >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
          Net {fmtUsd(trend.avgNet)}/mo
        </span>
      </div>
    </div>
  );
}

export function OverviewPanel({
  indices,
  isLive,
  history,
  trend,
}: {
  indices: IndexQuote[];
  isLive: boolean;
  history: NetWorthSnapshot[];
  trend: MonthlyTrend | null;
}) {
  const { density } = useDensity();
  const tableDensity: 'compact' | 'comfortable' = density === 'low' ? 'comfortable' : 'compact';
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);

  const indexColumns: DataTableColumn<IndexQuote>[] = [
    { id: 'symbol', header: 'Index', accessor: (r) => (
      <div className="flex flex-col leading-tight">
        <span className="text-gray-100 font-semibold">{r.symbol}</span>
        <span className="text-[10px] text-gray-500">{r.name}</span>
      </div>
    ), sortValue: (r) => r.symbol, sortable: true },
    { id: 'price', header: 'Last', accessor: (r) => r.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sortValue: (r) => r.price, align: 'right', sortable: true, monospace: true },
    { id: 'change', header: 'Chg', accessor: (r) => (
      <span className={r.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
        {r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}
      </span>
    ), sortValue: (r) => r.change, align: 'right', sortable: true, monospace: true },
    { id: 'pct', header: '%', accessor: (r) => (
      <span className={r.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmtPct(r.changePercent)}</span>
    ), sortValue: (r) => r.changePercent, align: 'right', sortable: true, monospace: true },
  ];

  const selectedQuote = indices.find((q) => q.symbol === selectedIndex) || null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Panel
        title="Market monitor — live indices"
        right={
          <StatusDot
            state={isLive ? 'live' : 'idle'}
            size="sm"
            label={isLive ? 'Live' : 'Offline'}
            showLabel
          />
        }
      >
        {indices.length === 0 ? (
          <EmptyState
            compact
            title={isLive ? 'Awaiting first market tick…' : 'Market feed offline.'}
            description={
              isLive
                ? 'Connected — the live index feed will populate on the next tick.'
                : 'The realtime market feed (Yahoo Finance indices) is not currently connected. No prices are shown rather than fabricated ones.'
            }
            ariaLabel="Market monitor empty"
          />
        ) : (
          <>
            <DataTable
              columns={indexColumns}
              rows={indices}
              getRowId={(r) => r.symbol}
              density={tableDensity}
              selectedRowId={selectedIndex}
              onRowClick={(r) => setSelectedIndex((cur) => (cur === r.symbol ? null : r.symbol))}
              caption="Live market indices"
              defaultSort={{ columnId: 'pct', direction: 'desc' }}
            />
            {selectedQuote && (
              <div className="mt-2 flex items-center gap-4 px-3 py-2 rounded bg-lattice-deep/60 text-xs font-mono">
                <span className="text-gray-300 font-semibold">{selectedQuote.name}</span>
                <span className="text-gray-400">Last {selectedQuote.price.toLocaleString()}</span>
                <span className={selectedQuote.changePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {selectedQuote.change >= 0 ? '+' : ''}{selectedQuote.change.toFixed(2)} ({fmtPct(selectedQuote.changePercent)})
                </span>
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel title="Net-worth trajectory — your snapshots">
        <NetWorthChart snapshots={history} />
      </Panel>

      <Panel title="Monthly cash-flow — income vs. spend" className="xl:col-span-2">
        <CashFlowMini trend={trend} />
      </Panel>
    </div>
  );
}
