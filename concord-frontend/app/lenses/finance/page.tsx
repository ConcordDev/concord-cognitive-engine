'use client';

/**
 * Finance — one Bloomberg/terminal app.
 *
 * Single view union (overview | positions | cashflow | accounts | planning |
 * bills | macro | assistant). Inline chart/modal helpers extracted to panels.
 * KPI strip stays on the shell (real dashboard-summary). No Coinbase, no
 * securities trading books.
 */

import { useState, useRef, useEffect, useCallback, useMemo, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Plus,
  Briefcase,
  ArrowLeftRight,
  Building2,
  Target,
  Receipt,
  Globe2,
  Sparkles,
  PieChart,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import {
  StatTile,
  StatTileGrid,
  ErrorState,
  Skeleton,
  StatusDot,
  DensityToggle,
} from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import TickerTape from '@/components/finance/TickerTape';
import { SnapshotModal } from '@/components/finance/SnapshotModal';
import {
  OverviewPanel,
  type IndexQuote,
  type MonthlyTrend,
  type NetWorthSnapshot,
} from '@/components/finance/OverviewPanel';
import {
  PositionsGroupPanel,
  CashflowGroupPanel,
  AccountsGroupPanel,
  PlanningGroupPanel,
  BillsBudgetGroupPanel,
  MacroGroupPanel,
  AssistantGroupPanel,
} from '@/components/finance/FinanceGroupPanels';

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

type GroupId =
  | 'overview'
  | 'positions'
  | 'cashflow'
  | 'accounts'
  | 'planning'
  | 'bills'
  | 'macro'
  | 'assistant';

const GROUPS: { id: GroupId; title: string; label: string; hotkey: string; icon: typeof PieChart }[] = [
  { id: 'overview', title: 'What you hold', label: 'Overview', hotkey: '1', icon: PieChart },
  { id: 'positions', title: 'What you own', label: 'Positions', hotkey: '2', icon: Briefcase },
  { id: 'cashflow', title: 'Where money moves', label: 'Cash-flow', hotkey: '3', icon: ArrowLeftRight },
  { id: 'accounts', title: 'Where it lives', label: 'Accounts', hotkey: '4', icon: Building2 },
  { id: 'planning', title: 'Where you are headed', label: 'Planning', hotkey: '5', icon: Target },
  { id: 'bills', title: 'What is due', label: 'Bills & Budget', hotkey: '6', icon: Receipt },
  { id: 'macro', title: 'What the world is doing', label: 'Macro data', hotkey: '7', icon: Globe2 },
  { id: 'assistant', title: 'Ask about your money', label: 'Assistant', hotkey: '8', icon: Sparkles },
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

export default function FinanceTerminalPage() {
  useLensNav('finance');
  useLensIdentity('finance');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [group, setGroup] = useState<GroupId>('overview');
  const [showSnapshot, setShowSnapshot] = useState(false);

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
    { lensId: 'finance' },
  );

  const current = GROUPS.find((g) => g.id === group)!;

  const GroupBody: ComponentType = useMemo(() => {
    switch (group) {
      case 'overview':
        return function OverviewBody() {
          return <OverviewPanel indices={indices} isLive={isLive} history={history} trend={trend} />;
        };
      case 'positions':
        return PositionsGroupPanel;
      case 'cashflow':
        return CashflowGroupPanel;
      case 'accounts':
        return AccountsGroupPanel;
      case 'planning':
        return PlanningGroupPanel;
      case 'bills':
        return BillsBudgetGroupPanel;
      case 'macro':
        return MacroGroupPanel;
      case 'assistant':
        return AssistantGroupPanel;
      default:
        return function Empty() { return null; };
    }
  }, [group, indices, isLive, history, trend]);

  return (
    <LensShell lensId="finance" asMain={false}>
      <div data-lens-theme="finance" className="relative min-h-full space-y-5 px-8 pb-28 pt-6 text-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Finance</p>
            <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{group === 'overview' && who ? `, ${who}` : ''}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-zinc-500">
              <StatusDot state={isLive ? 'live' : 'idle'} size="xs" />
              <span>{isLive ? 'Market feed live' : 'Market feed idle'}</span>
              {lastUpdated && <span className="text-zinc-600">· {new Date(lastUpdated).toLocaleTimeString()}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-2">
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={() => setShowSnapshot(true)}
              title="Record a net-worth snapshot (S)"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[14px] text-zinc-300 transition-colors hover:text-white"
            >
              <Plus className="h-4 w-4" /> Snapshot
            </button>
            <DTUExportButton domain="finance" data={{ summary, history, trend }} compact />
          </div>
        </div>

        <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Finance views">
          {GROUPS.map((g) => {
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                aria-current={active ? 'page' : undefined}
                title={`${g.label} (${g.hotkey})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <g.icon className="h-3.5 w-3.5" />
                {g.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{g.hotkey}</kbd>
              </button>
            );
          })}
        </nav>

        <TickerTape className="-mx-4" />

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


        <AnimatePresence mode="wait">
          <motion.div
            key={group}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <GroupBody />
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => loadDashboard(true)}
          disabled={refreshing}
          title="Refresh dashboard (R)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <AnimatePresence>
        {showSnapshot && (
          <SnapshotModal onClose={() => setShowSnapshot(false)} onRecorded={() => loadDashboard(true)} />
        )}
      </AnimatePresence>
    </LensShell>
  );
}
