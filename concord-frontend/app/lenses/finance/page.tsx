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
  TrendingUp,
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
  Keyboard,
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

export default function FinanceTerminalPage() {
  useLensNav('finance');
  useLensIdentity('finance');

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
      <div data-lens-theme="finance" className="min-h-full bg-[#0a0d12] text-gray-200 font-mono p-4 space-y-4">
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
              type="button"
              onClick={() => setShowSnapshot(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 text-xs hover:bg-emerald-900/40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Snapshot
            </button>
            <button
              type="button"
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

        <nav className="flex items-center gap-1 overflow-x-auto border-b border-lattice-border pb-2" aria-label="Finance views">
          {GROUPS.map((g) => {
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
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
      </div>

      <AnimatePresence>
        {showSnapshot && (
          <SnapshotModal onClose={() => setShowSnapshot(false)} onRecorded={() => loadDashboard(true)} />
        )}
      </AnimatePresence>
    </LensShell>
  );
}
