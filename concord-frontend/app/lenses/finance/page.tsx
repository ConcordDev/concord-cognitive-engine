'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // FINANCE TERMINAL  — flagship rebuild (Frontend Rebuild Program)
 * ─────────────────────────────────────────────────────────────────────────
 * Bloomberg/terminal identity: dense dark monospace grids, real market data,
 * keyboard-driven navigation, high information-per-pixel. Built on the shared
 * ui/ primitives (DataTable, StatTile, StatusDot, EmptyState, ErrorState,
 * Skeleton, DensityToggle).
 *
 * Honest-by-construction — every number on screen traces to a REAL source:
 *   • header KPIs        → finance.dashboard-summary   (real; zeros when empty)
 *   • net-worth chart    → finance.net-worth-history   (real snapshots; honest
 *                          empty state — NOT the removed synthetic sine chart)
 *   • cash-flow mini     → finance.monthly-trend       (real ledger)
 *   • market monitor     → useRealtimeLens('finance')  (live Yahoo indices)
 *   • record snapshot    → finance.net-worth-snapshot  (honest macro spinner)
 *   • grouped panels     → bespoke components, each wired to its real macro
 *   • macro data         → FRED / World Bank / CoinGecko (live external APIs)
 *
 * REMOVED (fabrication the old page shipped): synthetic sine-wave "portfolio
 * performance" chart, fake 24h high/low (price×1.05 / ×0.95), fake order-book
 * depth, and the facade trade/orders/alerts surfaces (finance has no order
 * book — that lives in the separate `markets` domain). RETIRED generic
 * scaffold: AutoActionStrip, ShellPreview, UniversalActions strip, raw button
 * walls, RecentMineCard, CrossLensRecentsPanel.
 *
 * Full capability map: docs/lens-specs/finance-capability-map.md
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  RefreshCw,
  Loader2,
  Plus,
  X,
  Briefcase,
  ArrowLeftRight,
  Building2,
  Target,
  Receipt,
  Globe2,
  Sparkles,
  PieChart,
  Keyboard,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import {
  DataTable,
  StatTile,
  StatTileGrid,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusDot,
  DensityToggle,
} from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { useDensity } from '@/lib/hooks/useDensity';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// Bespoke, already-real sub-panels (each wired to its own real macro).
import NetWorthTracker from '@/components/finance/NetWorthTracker';
import EnvelopeBudget from '@/components/finance/EnvelopeBudget';
import InvestmentCheckup from '@/components/finance/InvestmentCheckup';
import TaxEstimator from '@/components/finance/TaxEstimator';
import RetirementSimulator from '@/components/finance/RetirementSimulator';
import SubscriptionDetector from '@/components/finance/SubscriptionDetector';
import BillsCalendar from '@/components/finance/BillsCalendar';
import GoalsTracker from '@/components/finance/GoalsTracker';
import RecurringInvestments from '@/components/finance/RecurringInvestments';
import HoldingsManager from '@/components/finance/HoldingsManager';
import AllocationPie from '@/components/finance/AllocationPie';
import DividendTracker from '@/components/finance/DividendTracker';
import SpendingInsights from '@/components/finance/SpendingInsights';
import CategorisationRules from '@/components/finance/CategorisationRules';
import TaxLossHarvester from '@/components/finance/TaxLossHarvester';
import AccountsPanel from '@/components/finance/AccountsPanel';
import FinanceAssistant from '@/components/finance/FinanceAssistant';
import BankAggregation from '@/components/finance/BankAggregation';
import TransactionFeed from '@/components/finance/TransactionFeed';
import HouseholdBudgets from '@/components/finance/HouseholdBudgets';
import CreditScoreMonitor from '@/components/finance/CreditScoreMonitor';
import CashFlowSankey from '@/components/finance/CashFlowSankey';
import BillReminders from '@/components/finance/BillReminders';
import RolloverRules from '@/components/finance/RolloverRules';
import { MarketsPulse } from '@/components/finance/MarketsPulse';
import { FredSeriesPanel } from '@/components/finance/FredSeriesPanel';
import { WorldBankPanel } from '@/components/global/WorldBankPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

// ── Real macro result shapes ───────────────────────────────────────────────

interface DashboardSummary {
  netWorth: number;
  delta: number;
  deltaPct: number;
  breakdown: { cash: number; investments: number; credit: number; loans: number };
  buyingPower: number;
  budgetUsedPct: number;
  activeGoalCount: number;
  accountCount: number;
  positionCount: number;
}

interface NetWorthSnapshot {
  date: string;
  total: number;
  cash?: number;
  investments?: number;
}

interface MonthlyTrendPoint {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number;
}

interface MonthlyTrend {
  series: MonthlyTrendPoint[];
  avgMonthlyIncome: number;
  avgMonthlySpend: number;
  avgNet: number;
}

interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

type GroupId =
  | 'overview'
  | 'positions'
  | 'cashflow'
  | 'accounts'
  | 'planning'
  | 'bills'
  | 'macro'
  | 'assistant';

const GROUPS: { id: GroupId; label: string; hotkey: string; icon: typeof PieChart }[] = [
  { id: 'overview', label: 'Overview', hotkey: '1', icon: PieChart },
  { id: 'positions', label: 'Positions', hotkey: '2', icon: Briefcase },
  { id: 'cashflow', label: 'Cash-flow', hotkey: '3', icon: ArrowLeftRight },
  { id: 'accounts', label: 'Accounts', hotkey: '4', icon: Building2 },
  { id: 'planning', label: 'Planning', hotkey: '5', icon: Target },
  { id: 'bills', label: 'Bills & Budget', hotkey: '6', icon: Receipt },
  { id: 'macro', label: 'Macro data', hotkey: '7', icon: Globe2 },
  { id: 'assistant', label: 'Assistant', hotkey: '8', icon: Sparkles },
];

const INDEX_NAMES: Record<string, string> = {
  GSPC: 'S&P 500',
  DJI: 'Dow Jones',
  IXIC: 'NASDAQ Composite',
  RUT: 'Russell 2000',
  VIX: 'CBOE VIX',
};

const fmtUsd = (v: number, opts: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  }).format(v);

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

// ── Net-worth trajectory — real snapshots only ─────────────────────────────

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

// ── Monthly cash-flow mini (income vs spend) — real ledger ─────────────────

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

// ── Record-snapshot modal — real macro dispatch w/ honest spinner ──────────

function SnapshotModal({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const { status, error, dispatch } = useMacroDispatchFeedback();
  const [form, setForm] = useState({ cash: '', investments: '', realEstate: '', crypto: '', liabilities: '' });
  const busy = status === 'dispatched' || status === 'running';

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (busy) return;
    const input = {
      cash: parseFloat(form.cash) || 0,
      investments: parseFloat(form.investments) || 0,
      realEstate: parseFloat(form.realEstate) || 0,
      crypto: parseFloat(form.crypto) || 0,
      liabilities: parseFloat(form.liabilities) || 0,
    };
    const res = await dispatch('finance', 'net-worth-snapshot', input);
    if (res) {
      onRecorded();
      onClose();
    }
  };

  const fields: { k: keyof typeof form; label: string }[] = [
    { k: 'cash', label: 'Cash' },
    { k: 'investments', label: 'Investments' },
    { k: 'realEstate', label: 'Real estate' },
    { k: 'crypto', label: 'Crypto' },
    { k: 'liabilities', label: 'Liabilities' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-lattice-border bg-lattice-surface p-5 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label="Record net-worth snapshot"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-emerald-100">Record net-worth snapshot</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2.5">
          {fields.map((f) => (
            <label key={f.k} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 w-24">{f.label}</span>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form[f.k]}
                  onChange={set(f.k)}
                  placeholder="0"
                  className="w-full pl-5 pr-2 py-1.5 rounded bg-lattice-deep border border-lattice-border text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </label>
          ))}
        </div>
        {status === 'error' && (
          <p className="mt-3 text-xs text-rose-300" role="alert">
            {error || 'Failed to record snapshot.'}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-4 w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {busy ? 'Recording…' : 'Record snapshot'}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── Section frame ──────────────────────────────────────────────────────────

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

export default function FinanceTerminalPage() {
  useLensNav('finance');
  const { density } = useDensity();
  const tableDensity: 'compact' | 'comfortable' = density === 'low' ? 'comfortable' : 'compact';

  const [group, setGroup] = useState<GroupId>('overview');
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);

  // Live market indices (real Yahoo Finance via useRealtimeLens).
  const { latestData, isLive, lastUpdated } = useRealtimeLens('finance');
  const indices: IndexQuote[] = useMemo(() => {
    const quotes = ((latestData as { quotes?: Array<Record<string, unknown>> } | null)?.quotes) || [];
    return quotes.map((q) => {
      const symbol = String(q.symbol || '').replace('^', '');
      return {
        symbol,
        name: INDEX_NAMES[symbol] || symbol,
        price: Number(q.price) || 0,
        change: Number(q.change) || 0,
        changePercent: Number(q.changePercent) || 0,
      };
    });
  }, [latestData]);

  // Dashboard state (real macros).
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [history, setHistory] = useState<NetWorthSnapshot[]>([]);
  const [trend, setTrend] = useState<MonthlyTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const [sumRes, histRes, trendRes] = await Promise.all([
        lensRun<DashboardSummary>('finance', 'dashboard-summary', {}),
        lensRun<{ snapshots: NetWorthSnapshot[] }>('finance', 'net-worth-history', { range: 'ALL' }),
        lensRun<MonthlyTrend>('finance', 'monthly-trend', { months: 12 }),
      ]);
      if (!mounted.current) return;
      if (sumRes.data.ok && sumRes.data.result) setSummary(sumRes.data.result);
      else if (!sumRes.data.ok) setLoadError(sumRes.data.error || 'Failed to load dashboard summary.');
      setHistory(histRes.data.result?.snapshots || []);
      setTrend(trendRes.data.result || null);
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof Error ? e.message : 'Failed to load finance data.');
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  // Keyboard: 1-8 switch groups; r refresh; s snapshot.
  useLensCommand(
    [
      ...GROUPS.map((g) => ({
        id: `group-${g.id}`,
        keys: g.hotkey,
        description: `Go to ${g.label}`,
        category: 'navigation' as const,
        action: () => setGroup(g.id),
      })),
      { id: 'refresh', keys: 'r', description: 'Refresh dashboard', category: 'actions', action: () => loadDashboard(true) },
      { id: 'snapshot', keys: 's', description: 'Record net-worth snapshot', category: 'actions', action: () => setShowSnapshot(true) },
    ],
    { lensId: 'finance' }
  );

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

  const renderGroup = () => {
    switch (group) {
      case 'overview':
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
      case 'positions':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <HoldingsManager />
              <InvestmentCheckup />
            </div>
            <AllocationPie />
          </div>
        );
      case 'cashflow':
        return (
          <div className="space-y-4">
            <TransactionFeed />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CashFlowSankey />
              <SpendingInsights />
            </div>
          </div>
        );
      case 'accounts':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AccountsPanel />
            <BankAggregation />
            <CreditScoreMonitor />
            <NetWorthTracker />
          </div>
        );
      case 'planning':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GoalsTracker />
            <RetirementSimulator />
            <TaxEstimator />
            <TaxLossHarvester />
          </div>
        );
      case 'bills':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BillsCalendar />
            <BillReminders />
            <EnvelopeBudget />
            <RolloverRules />
            <HouseholdBudgets />
            <RecurringInvestments />
            <SubscriptionDetector />
            <DividendTracker />
            <CategorisationRules />
          </div>
        );
      case 'macro':
        return (
          <div className="space-y-4">
            <FredSeriesPanel />
            <WorldBankPanel domain="finance" />
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <MarketsPulse />
            </div>
            <LensFeedPanel lensId="finance" />
          </div>
        );
      case 'assistant':
        return <FinanceAssistant />;
      default:
        return null;
    }
  };

  return (
    <LensShell lensId="finance" asMain={false}>
      <div data-lens-theme="finance" className="min-h-full bg-[#0a0d12] text-gray-200 font-mono p-4 space-y-4">
        {/* Command bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-emerald-900/40 border border-emerald-700/30 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-emerald-100">
                CONCORD <span className="text-gray-600">{'//'}</span> FINANCE TERMINAL
              </h1>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <StatusDot state={isLive ? 'live' : 'idle'} size="xs" />
                <span>{isLive ? 'Market feed live' : 'Market feed idle'}</span>
                {lastUpdated && <span className="text-gray-600">· {new Date(lastUpdated).toLocaleTimeString()}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1 text-[10px] text-gray-600" title="1–8 switch view · r refresh · s snapshot">
              <Keyboard className="w-3.5 h-3.5" /> 1–8 · r · s
            </span>
            <DensityToggle variant="dropdown" />
            <button
              onClick={() => setShowSnapshot(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 text-xs hover:bg-emerald-900/40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Snapshot
            </button>
            <button
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="p-1.5 rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors disabled:opacity-50"
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </button>
            <DTUExportButton domain="finance" data={{ summary, history, trend }} compact />
          </div>
        </header>

        {/* KPI strip — real dashboard-summary */}
        {loading ? (
          <StatTileGrid columns={6}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-black/40 p-3">
                <Skeleton variant="line" lines={2} />
              </div>
            ))}
          </StatTileGrid>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => loadDashboard(false)} retrying={refreshing} />
        ) : summary ? (
          <StatTileGrid columns={6}>
            <StatTile
              label="Net worth"
              value={fmtUsd(summary.netWorth)}
              deltaPct={summary.deltaPct || undefined}
              deltaLabel={summary.delta ? `${summary.delta >= 0 ? '+' : ''}${fmtUsd(summary.delta)}` : 'no prior snapshot'}
            />
            <StatTile label="Cash" value={fmtUsd(summary.breakdown.cash)} caption="checking + savings" />
            <StatTile label="Investments" value={fmtUsd(summary.breakdown.investments)} caption={`${summary.positionCount} positions`} />
            <StatTile label="Buying power" value={fmtUsd(summary.buyingPower)} caption="available cash" />
            <StatTile
              label="Budget used"
              value={summary.budgetUsedPct}
              unit="%"
              tone={summary.budgetUsedPct > 90 ? 'negative' : summary.budgetUsedPct > 70 ? 'neutral' : 'positive'}
              caption="of monthly income"
            />
            <StatTile label="Accounts" value={summary.accountCount} caption={`${summary.activeGoalCount} goals`} />
          </StatTileGrid>
        ) : null}

        {/* Group tab bar — terminal function-key style */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-lattice-border pb-2" aria-label="Finance views">
          {GROUPS.map((g) => {
            const active = group === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs whitespace-nowrap border transition-colors',
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'text-gray-400 hover:text-emerald-200 hover:bg-emerald-900/10 border-transparent'
                )}
              >
                <span className="text-[10px] text-gray-600 tabular-nums">{g.hotkey}</span>
                <g.icon className="w-3.5 h-3.5" />
                {g.label}
              </button>
            );
          })}
        </nav>

        {/* Group content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={group}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {renderGroup()}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showSnapshot && (
          <SnapshotModal onClose={() => setShowSnapshot(false)} onRecorded={() => loadDashboard(true)} />
        )}
      </AnimatePresence>
    </LensShell>
  );
}
