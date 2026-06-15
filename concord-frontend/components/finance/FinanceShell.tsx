'use client';

/**
 * FinanceShell — a portfolio surface.
 *
 * Dominant net-worth header with hide toggle and time-range chips,
 * portfolio sparkline, Trade / Transfer / Budget action triple,
 * two-column body (holdings with mini-sparklines on the left,
 * watchlist + buying power on the right), recent activity rail at
 * the bottom. Drop into the finance lens above the existing
 * MarketsPulse / NetWorthTracker stack and the page reads as a
 * brokerage + budgeting app inside 200ms.
 */

import React, { useState } from 'react';
import {
  Eye, EyeOff, ArrowUpRight, ArrowDownRight, ArrowLeftRight,
  TrendingUp, TrendingDown, Plus, Star, ChevronRight, Wallet, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type FinanceRange = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL';

export interface FinanceHolding {
  id: string;
  symbol: string;
  name: string;
  kind: 'stock' | 'etf' | 'crypto' | 'cash' | 'cc' | 'dtu';
  shares?: number;
  price: number;
  value: number;
  changePct: number;
  sparkline?: number[];
}

export interface FinanceWatchItem {
  id: string;
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

export interface FinanceActivity {
  id: string;
  kind: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'dividend' | 'royalty' | 'budget';
  label: string;
  amount: number;
  timestamp: string;
  asset?: string;
}

export interface FinanceShellProps {
  netWorth: number;
  netWorthDelta: number;
  netWorthDeltaPct: number;
  range: FinanceRange;
  onRangeChange?: (range: FinanceRange) => void;
  sparkline?: number[];
  buyingPower: number;
  budgetUsedPct?: number;
  holdings: FinanceHolding[];
  watchlist: FinanceWatchItem[];
  activity: FinanceActivity[];
  fiatSymbol?: string;
  onTrade?: () => void;
  onTransfer?: () => void;
  onBudget?: () => void;
  onSelectHolding?: (h: FinanceHolding) => void;
  onAddWatch?: () => void;
  className?: string;
}

const RANGES: FinanceRange[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'];

function fmt(n: number, sym = '$'): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${sym}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${sym}${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShort(n: number, sym = '$'): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

function Sparkline({ data, positive, className }: { data: number[]; positive: boolean; className?: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 100;
  const h = 28;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-7 w-24', className)}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        strokeWidth="1.5"
        stroke={positive ? '#34d399' : '#fb7185'}
        points={points}
      />
    </svg>
  );
}

function HeroSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return <div className="h-24" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 600;
  const h = 96;
  const step = w / (data.length - 1);
  const linePoints = data
    .map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`)
    .join(' ');
  const areaPoints = `0,${h} ${linePoints} ${w},${h}`;
  const stroke = positive ? '#34d399' : '#fb7185';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24" aria-hidden="true">
      <defs>
        <linearGradient id="fin-spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#fin-spark-fill)" />
      <polyline fill="none" strokeWidth="2" stroke={stroke} points={linePoints} />
    </svg>
  );
}

export function FinanceShell({
  netWorth,
  netWorthDelta,
  netWorthDeltaPct,
  range,
  onRangeChange,
  sparkline,
  buyingPower,
  budgetUsedPct,
  holdings,
  watchlist,
  activity,
  fiatSymbol = '$',
  onTrade,
  onTransfer,
  onBudget,
  onSelectHolding,
  onAddWatch,
  className,
}: FinanceShellProps) {
  const [hidden, setHidden] = useState(false);
  const positive = netWorthDelta >= 0;

  return (
    <div className={cn('flex flex-col gap-5 p-5 bg-[#0d0e12] text-gray-100', className)}>
      {/* Hero: net worth + sparkline + range chips */}
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-400">Net worth</span>
          <button
            type="button"
            onClick={() => setHidden((v) => !v)}
            aria-pressed={hidden}
            className="text-gray-400 hover:text-gray-300"
            title={hidden ? 'Show balance' : 'Hide balance'}
          >
            {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-5xl font-mono font-semibold text-white tabular-nums">
            {hidden ? '••••••' : fmt(netWorth, fiatSymbol)}
          </span>
          {!hidden && (
            <span
              className={cn(
                'text-sm font-mono tabular-nums inline-flex items-center gap-1',
                positive ? 'text-emerald-300' : 'text-rose-300'
              )}
            >
              {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {positive ? '+' : ''}{fmtShort(netWorthDelta, fiatSymbol)} ({positive ? '+' : ''}{netWorthDeltaPct.toFixed(2)}%) · {range}
            </span>
          )}
        </div>
        <HeroSparkline data={sparkline ?? []} positive={positive} />
        <div role="tablist" aria-label="Time range" className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              onClick={() => onRangeChange?.(r)}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-mono tracking-wider transition',
                r === range
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {/* Action triple */}
      <div className="grid grid-cols-3 gap-2">
        <ActionTile icon={ArrowUpRight} label="Trade" onClick={onTrade} />
        <ActionTile icon={ArrowLeftRight} label="Transfer" onClick={onTransfer} />
        <ActionTile icon={Target} label="Budget" onClick={onBudget} />
      </div>

      {/* Buying power + budget meter */}
      <div className="grid grid-cols-2 gap-2">
        <MetaTile
          icon={Wallet}
          label="Buying power"
          value={hidden ? '••••' : fmt(buyingPower, fiatSymbol)}
        />
        <MetaTile
          icon={Target}
          label="Budget used"
          value={budgetUsedPct === undefined ? '—' : `${budgetUsedPct.toFixed(0)}%`}
          meter={budgetUsedPct}
        />
      </div>

      {/* Two-column: holdings + watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Holdings (rows with mini-sparklines) */}
        <section className="lg:col-span-2">
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-400">Holdings</h2>
            <span className="text-[11px] text-gray-400 font-mono">{holdings.length} positions</span>
          </header>
          {holdings.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-3 py-6 text-center border border-dashed border-white/10 rounded-md">
              No positions yet. Trade to open one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {holdings.map((h) => {
                const pos = h.changePct >= 0;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => onSelectHolding?.(h)}
                      className="w-full grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 text-left"
                    >
                      <div className={cn(
                        'w-9 h-9 rounded-md flex items-center justify-center text-[11px] font-mono font-semibold',
                        h.kind === 'crypto' ? 'bg-amber-500/15 text-amber-300'
                          : h.kind === 'cc' ? 'bg-cyan-500/15 text-cyan-300'
                          : h.kind === 'dtu' ? 'bg-violet-500/15 text-violet-300'
                          : h.kind === 'cash' ? 'bg-gray-500/15 text-gray-300'
                          : h.kind === 'etf' ? 'bg-blue-500/15 text-blue-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                      )}>
                        {h.symbol.slice(0, 4)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{h.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {h.shares !== undefined ? `${h.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ ${fmtShort(h.price, fiatSymbol)}` : fmtShort(h.price, fiatSymbol)}
                        </div>
                      </div>
                      <Sparkline data={h.sparkline ?? []} positive={pos} className="hidden md:block" />
                      <div className="text-right">
                        <div className="text-sm font-mono tabular-nums text-white">
                          {hidden ? '••••' : fmt(h.value, fiatSymbol)}
                        </div>
                        <div className={cn(
                          'text-[11px] font-mono tabular-nums',
                          pos ? 'text-emerald-300' : 'text-rose-300'
                        )}>
                          {pos ? '+' : ''}{h.changePct.toFixed(2)}%
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Watchlist */}
        <section>
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-400">Watchlist</h2>
            <button
              type="button"
              onClick={onAddWatch}
              aria-label="Add to watchlist"
              className="text-gray-400 hover:text-cyan-300"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </header>
          {watchlist.length === 0 ? (
            <p className="text-xs text-gray-400 italic px-3 py-4 text-center border border-dashed border-white/10 rounded-md">
              Star tickers to track here.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {watchlist.map((w) => {
                const pos = w.changePct >= 0;
                return (
                  <li
                    key={w.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2.5 py-2 rounded-md hover:bg-white/5"
                  >
                    <Star className="w-3 h-3 text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{w.symbol}</div>
                      <div className="text-[11px] text-gray-400 truncate">{w.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono tabular-nums text-white">{fmtShort(w.price, fiatSymbol)}</div>
                      <div className={cn(
                        'text-[10px] font-mono tabular-nums',
                        pos ? 'text-emerald-300' : 'text-rose-300'
                      )}>
                        {pos ? '+' : ''}{w.changePct.toFixed(2)}%
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Activity */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No activity yet.</p>
        ) : (
          <ul className="space-y-1">
            {activity.slice(0, 8).map((a) => {
              const credit = a.kind === 'sell' || a.kind === 'deposit' || a.kind === 'dividend' || a.kind === 'royalty';
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5"
                >
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    a.kind === 'buy' ? 'bg-emerald-500/20 text-emerald-300'
                      : a.kind === 'sell' ? 'bg-rose-500/20 text-rose-300'
                      : a.kind === 'deposit' ? 'bg-cyan-500/20 text-cyan-300'
                      : a.kind === 'withdraw' ? 'bg-gray-500/20 text-gray-300'
                      : a.kind === 'dividend' ? 'bg-violet-500/20 text-violet-300'
                      : a.kind === 'royalty' ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-blue-500/20 text-blue-300'
                  )}>
                    {a.kind === 'buy' ? <ArrowDownRight className="w-4 h-4" />
                      : a.kind === 'sell' ? <ArrowUpRight className="w-4 h-4" />
                      : a.kind === 'deposit' ? <ArrowDownRight className="w-4 h-4" />
                      : a.kind === 'withdraw' ? <ArrowUpRight className="w-4 h-4" />
                      : a.kind === 'budget' ? <Target className="w-4 h-4" />
                      : '·'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate capitalize">
                      {a.kind} {a.asset ?? ''} <span className="text-gray-400 font-normal">— {a.label}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {new Date(a.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className={cn(
                    'text-sm font-mono tabular-nums',
                    credit ? 'text-emerald-300' : 'text-rose-300'
                  )}>
                    {credit ? '+' : '-'}{fmtShort(Math.abs(a.amount), fiatSymbol)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ActionTileProps {
  icon: typeof ArrowUpRight;
  label: string;
  onClick?: () => void;
}

function ActionTile({ icon: Icon, label, onClick }: ActionTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 flex flex-col items-center gap-1.5 text-sm font-medium text-white hover:bg-white/10 hover:border-white/20 transition"
    >
      <Icon className="w-5 h-5 text-cyan-300" aria-hidden="true" />
      {label}
    </button>
  );
}

interface MetaTileProps {
  icon: typeof Wallet;
  label: string;
  value: string;
  meter?: number;
}

function MetaTile({ icon: Icon, label, value, meter }: MetaTileProps) {
  const clamped = meter === undefined ? 0 : Math.max(0, Math.min(100, meter));
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <div className="text-lg font-mono tabular-nums text-white">{value}</div>
      {meter !== undefined && (
        <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              clamped > 90 ? 'bg-rose-400' : clamped > 70 ? 'bg-amber-400' : 'bg-emerald-400'
            )}
            style={{ width: `${clamped}%` }}
            role="progressbar"
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  );
}

export default FinanceShell;
