'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, type ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  Activity,
  Database,
  Cpu,
  HardDrive,
  Users,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Brain,
  Box,
  Layers,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { MobileSectionJump } from '@/components/mobile/MobileSectionJump';
import { MonitoringPanel } from '@/components/admin/MonitoringPanel';
import { LiveSystemHealth } from '@/components/admin/LiveSystemHealth';
import { NervousSystem } from '@/components/nervous/NervousSystem';

interface DashboardData {
  ok: boolean;
  system: {
    version: string;
    uptime: { seconds: number; formatted: string };
    memory: { heapUsed: string; heapTotal: string; rss: string };
    nodeVersion: string;
  };
  dtus: { total: number; regular: number; mega: number; hyper: number; shadow: number };
  sessions: { total: number; active: number };
  organs: { total: number; healthy: number };
  llm: { ollamaReady: boolean; ollamaEnabled: boolean; defaultOn: boolean };
  queues: { maintenance: number; synthesis: number; hypotheses: number };
  plugins: { total: number; enabled: number };
  searchIndex: { documents: number; terms: number; dirty: boolean };
}

interface MetricsData {
  ok: boolean;
  chicken2: {
    continuityAvg: number;
    homeostasis: number;
    contradictionLoad: number;
    suffering: number;
    accepts: number;
    rejects: number;
  };
  growth: {
    bioAge: number;
    telomere: number;
    homeostasis: number;
    stress: { acute: number; chronic: number };
  };
  abstraction: { load: number; margin: number; enabled: boolean };
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: ComponentType<{ className?: string; size?: number | string }>;
  label: string;
  value: string | number;
  subValue?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'p-3')}
    >
      <div className="flex items-start justify-between">
        <div className="p-1.5 rounded border border-lattice-border text-[color:var(--lens-accent,#546E7A)]">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-xl font-mono tabular-nums text-white">{value}</p>
        <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</p>
        {subValue && <p className="text-xs text-gray-400 mt-1">{subValue}</p>}
      </div>
    </motion.div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const reduceMotion = useReducedMotion();
  const percentage = Math.min(Math.max(value, 0) * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono text-white">{percentage.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.5 }}
          className="h-full rounded-full bg-[color:var(--lens-accent,#546E7A)]"
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'healthy' | 'warning' | 'error' }) {
  const classes = {
    healthy: 'bg-green-500/20 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  const Icon = status === 'healthy' ? CheckCircle : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${classes[status]}`}>
      <Icon className="w-3 h-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function pct(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function OverviewPanel() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  useLensCommand(
    [
      {
        id: 'auto-refresh',
        keys: 'space',
        description: 'Toggle auto-refresh',
        category: 'view',
        action: () => setAutoRefresh((v) => !v),
      },
    ],
    { lensId: 'admin' },
  );

  const {
    data: dashboard,
    refetch: refetchDashboard,
    isLoading,
    isError,
    error,
  } = useQuery<DashboardData>({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiHelpers.admin.dashboard().then((r) => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: metrics, refetch: refetchMetrics } = useQuery<MetricsData>({
    queryKey: ['admin-metrics'],
    queryFn: () => apiHelpers.admin.metrics().then((r) => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: logs, refetch: refetchLogs } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => apiHelpers.admin.logs({ limit: 20 }).then((r) => r.data),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const systemHealth =
    dashboard?.llm?.ollamaReady || dashboard?.llm?.ollamaEnabled ? 'healthy' : 'warning';
  const organHealth =
    (dashboard?.organs?.healthy || 0) / (dashboard?.organs?.total || 1) > 0.7 ? 'healthy' : 'warning';

  if (isLoading && !dashboard) {
    return (
      <div className="space-y-3">
        <Skeleton variant="block" height={72} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={96} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load admin dashboard'}
        onRetry={() => {
          void refetchDashboard();
          void refetchMetrics();
          void refetchLogs();
        }}
      />
    );
  }

  const logRows = (logs?.logs || []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className={ds.textMuted}>
          Concord v{dashboard?.system?.version || '—'} · Uptime {dashboard?.system?.uptime?.formatted || '—'}
          {dashboard?.system?.nodeVersion ? ` · ${dashboard.system.nodeVersion}` : ''}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-lattice-deep border-lattice-border"
            />
            Auto-refresh
            <kbd className="px-1 py-0.5 rounded bg-black/30 border border-white/10 font-mono text-[10px]">space</kbd>
          </label>
          <button
            type="button"
            onClick={() => {
              void refetchDashboard();
              void refetchMetrics();
              void refetchLogs();
            }}
            className={ds.btnSecondary}
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      <div className={cn(ds.panel, 'flex items-center justify-between p-3')}>
        <div className="flex items-center gap-3">
          <Activity className={systemHealth === 'healthy' ? 'w-5 h-5 text-green-400' : 'w-5 h-5 text-yellow-400'} />
          <div>
            <p className="text-sm font-semibold text-white">System health</p>
            <p className="text-xs text-gray-400">Live dashboard + metrics macros</p>
          </div>
        </div>
        <div className="flex gap-2">
          <StatusBadge status={systemHealth} />
          <StatusBadge status={organHealth} />
          {dashboard?.searchIndex?.dirty && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-orange-500/20 text-orange-400 border-orange-500/30">
              Search index dirty
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={Database}
          label="DTUs"
          value={dashboard?.dtus?.total ?? 0}
          subValue={`${dashboard?.dtus?.mega ?? 0} mega · ${dashboard?.dtus?.hyper ?? 0} hyper`}
        />
        <StatCard
          icon={Users}
          label="Sessions"
          value={dashboard?.sessions?.total ?? 0}
          subValue={`${dashboard?.sessions?.active ?? 0} active`}
        />
        <StatCard
          icon={Brain}
          label="Organs"
          value={dashboard?.organs?.total ?? 0}
          subValue={`${dashboard?.organs?.healthy ?? 0} healthy`}
        />
        <StatCard
          icon={Box}
          label="Plugins"
          value={dashboard?.plugins?.total ?? 0}
          subValue={`${dashboard?.plugins?.enabled ?? 0} enabled`}
        />
        <StatCard
          icon={Layers}
          label="Queues"
          value={
            (dashboard?.queues?.maintenance ?? 0) +
            (dashboard?.queues?.synthesis ?? 0) +
            (dashboard?.queues?.hypotheses ?? 0)
          }
        />
        <StatCard
          icon={Zap}
          label="Search terms"
          value={dashboard?.searchIndex?.terms ?? 0}
          subValue={`${dashboard?.searchIndex?.documents ?? 0} docs`}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className={ds.panel} id="admin-section-reality-guard">
          <h2 className="font-semibold mb-4 flex items-center gap-2 text-sm scroll-mt-20">
            <Activity className="w-4 h-4 text-[color:var(--lens-accent,#546E7A)]" />
            Reality Guard (Chicken2)
          </h2>
          <div className="space-y-3">
            <ProgressBar value={pct(metrics?.chicken2.homeostasis)} label="Homeostasis" />
            <ProgressBar value={pct(metrics?.chicken2.continuityAvg)} label="Continuity" />
            <ProgressBar value={pct(metrics?.chicken2.contradictionLoad)} label="Contradiction load" />
            <ProgressBar value={pct(metrics?.chicken2.suffering)} label="Suffering boundary" />
            <div className="flex justify-between text-xs text-gray-400 pt-1 font-mono">
              <span>Accepts {metrics?.chicken2.accepts ?? 0}</span>
              <span>Rejects {metrics?.chicken2.rejects ?? 0}</span>
            </div>
          </div>
        </div>

        <div className={ds.panel} id="admin-section-growth">
          <h2 className="font-semibold mb-4 flex items-center gap-2 text-sm scroll-mt-20">
            <TrendingUp className="w-4 h-4 text-[color:var(--lens-accent,#546E7A)]" />
            Growth OS
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Bio age</span>
              <span className="text-lg font-mono tabular-nums text-white">
                {pct(metrics?.growth.bioAge).toFixed(1)}
              </span>
            </div>
            <ProgressBar value={pct(metrics?.growth.telomere)} label="Telomere" />
            <ProgressBar value={pct(metrics?.growth.homeostasis)} label="Homeostasis" />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="text-center rounded-lg border border-lattice-border p-2">
                <p className="text-lg font-mono tabular-nums text-yellow-400">
                  {(pct(metrics?.growth.stress.acute) * 100).toFixed(0)}%
                </p>
                <p className="text-[11px] text-gray-400">Acute stress</p>
              </div>
              <div className="text-center rounded-lg border border-lattice-border p-2">
                <p className="text-lg font-mono tabular-nums text-orange-400">
                  {(pct(metrics?.growth.stress.chronic) * 100).toFixed(0)}%
                </p>
                <p className="text-[11px] text-gray-400">Chronic stress</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className={ds.panel} id="admin-section-memory">
          <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm scroll-mt-20">
            <Cpu className="w-4 h-4" /> Memory
          </h2>
          <dl className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">Heap used</dt>
              <dd>{dashboard?.system?.memory?.heapUsed || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">Heap total</dt>
              <dd>{dashboard?.system?.memory?.heapTotal || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">RSS</dt>
              <dd>{dashboard?.system?.memory?.rss || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className={ds.panel} id="admin-section-llm">
          <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm scroll-mt-20">
            <HardDrive className="w-4 h-4" /> LLM
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Ollama ready</span>
              <span className={`status-dot ${dashboard?.llm?.ollamaReady ? 'success' : 'error'}`} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Ollama enabled</span>
              <span className={`status-dot ${dashboard?.llm?.ollamaEnabled ? 'success' : 'warning'}`} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Default on</span>
              <span className={`status-dot ${dashboard?.llm?.defaultOn ? 'success' : 'info'}`} />
            </div>
          </div>
        </div>

        <div className={ds.panel} id="admin-section-queues">
          <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm scroll-mt-20">
            <Clock className="w-4 h-4" /> Queues
          </h2>
          <dl className="space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">Maintenance</dt>
              <dd>{dashboard?.queues?.maintenance ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">Synthesis</dt>
              <dd>{dashboard?.queues?.synthesis ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400 font-sans">Hypotheses</dt>
              <dd>{dashboard?.queues?.hypotheses ?? 0}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className={ds.panel} id="admin-section-activity">
        <h2 className="font-semibold mb-3 flex items-center gap-2 text-sm scroll-mt-20">
          <Activity className="w-4 h-4" /> Recent activity
        </h2>
        {logRows.length === 0 ? (
          <EmptyState title="No recent activity" description="admin.logs returned an empty ring." />
        ) : (
          <div className="space-y-1 max-h-60 overflow-auto">
            {logRows.slice(0, 10).map((log, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-2 py-1.5 rounded bg-lattice-deep text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[color:var(--lens-accent,#546E7A)]">
                    {String(log.type ?? '')}
                  </span>
                  <span className="text-gray-400 truncate">{String(log.message ?? '')}</span>
                </div>
                <span className="text-[11px] text-gray-500 font-mono shrink-0 ml-2">{String(log.at ?? '')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <MonitoringPanel />
      <NervousSystem />
      <section className={cn(ds.panelBare, 'p-4')}>
        <LiveSystemHealth />
      </section>

      <MobileSectionJump
        sections={[
          { id: 'admin-section-reality-guard', label: 'Guard', icon: Activity },
          { id: 'admin-section-growth', label: 'Growth', icon: TrendingUp },
          { id: 'admin-section-memory', label: 'Mem', icon: Cpu },
          { id: 'admin-section-llm', label: 'LLM', icon: HardDrive },
          { id: 'admin-section-queues', label: 'Queues', icon: Clock },
          { id: 'admin-section-activity', label: 'Activity', icon: Activity },
        ]}
      />
    </div>
  );
}
