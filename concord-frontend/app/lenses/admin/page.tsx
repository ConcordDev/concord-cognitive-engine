'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Database,
  Cpu,
  HardDrive,
  Users,
  Layers,
  RefreshCw,
  Settings,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Brain,
  Box,
  ChevronDown,
  FileText,
  Grid3X3,
  HeartPulse,
  Loader2,
  XCircle,
  ChevronRight,
} from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { useUIStore } from '@/store/ui';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { NervousSystem } from '@/components/nervous/NervousSystem';
import { MonitoringPanel } from '@/components/admin/MonitoringPanel';
import { Download, Globe, DollarSign, PieChart, BarChart3, Search, Power } from 'lucide-react';

interface DashboardData {
  ok: boolean;
  system: {
    version: string;
    uptime: { seconds: number; formatted: string };
    memory: { heapUsed: string; heapTotal: string; rss: string };
    nodeVersion: string;
  };
  dtus: {
    total: number;
    regular: number;
    mega: number;
    hyper: number;
    shadow: number;
  };
  sessions: {
    total: number;
    active: number;
  };
  organs: {
    total: number;
    healthy: number;
  };
  llm: {
    ollamaReady: boolean;
    ollamaEnabled: boolean;
    defaultOn: boolean;
  };
  queues: {
    maintenance: number;
    synthesis: number;
    hypotheses: number;
  };
  plugins: {
    total: number;
    enabled: number;
  };
  searchIndex: {
    documents: number;
    terms: number;
    dirty: boolean;
  };
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
  abstraction: {
    load: number;
    margin: number;
    enabled: boolean;
  };
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color = 'blue',
  trend,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  color?: 'blue' | 'purple' | 'green' | 'pink' | 'orange';
  trend?: 'up' | 'down' | 'stable';
}) {
  const colorClasses = {
    blue: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
    purple: 'text-neon-purple bg-neon-purple/10 border-neon-purple/30',
    green: 'text-neon-green bg-neon-green/10 border-neon-green/30',
    pink: 'text-neon-pink bg-neon-pink/10 border-neon-pink/30',
    orange: 'text-neon-orange bg-neon-orange/10 border-neon-orange/30',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
      className="dashboard-card"
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg border ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <TrendingUp
            className={`w-4 h-4 ${
              trend === 'up'
                ? 'text-green-400'
                : trend === 'down'
                  ? 'text-red-400 rotate-180'
                  : 'text-gray-400'
            }`}
          />
        )}
      </div>
      <div className="mt-4">
        <p className="dashboard-stat">{value}</p>
        <p className="dashboard-label">{label}</p>
        {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
      </div>
    </motion.div>
  );
}

function ProgressBar({
  value,
  max = 100,
  color = 'blue',
  label,
}: {
  value: number;
  max?: number;
  color?: string;
  label?: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const colorClass =
    color === 'green'
      ? 'bg-neon-green'
      : color === 'purple'
        ? 'bg-neon-purple'
        : color === 'pink'
          ? 'bg-neon-pink'
          : 'bg-neon-blue';

  return (
    <div>
      {label && (
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">{label}</span>
          <span className="text-white">{percentage.toFixed(1)}%</span>
        </div>
      )}
      <div className="progress-bar">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`progress-fill ${colorClass}`}
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
  const icons = {
    healthy: CheckCircle,
    warning: AlertCircle,
    error: AlertCircle,
  };
  const Icon = icons[status];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${classes[status]}`}
    >
      <Icon className="w-3 h-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function AdminDashboardPage() {
  useLensNav('admin');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('admin');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showTreasury, setShowTreasury] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showMacros, setShowMacros] = useState(false);

  const {
    data: dashboard,
    refetch: refetchDashboard,
    isLoading: dashboardLoading,
    isError: isError,
    error: error,
  } = useQuery<DashboardData>({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiHelpers.guidance.health().then((r) => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const {
    data: metrics,
    refetch: refetchMetrics,
    isError: isError2,
    error: error2,
  } = useQuery<MetricsData>({
    queryKey: ['admin-metrics'],
    queryFn: () => apiHelpers.perf.metrics().then((r) => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const {
    data: logs,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => apiHelpers.eventsLog.list({ limit: 20 }).then((r) => r.data),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // Treasury dashboard data (admin only)
  const { data: treasuryData } = useQuery({
    queryKey: ['admin-treasury'],
    queryFn: () => apiHelpers.economy.adminTreasury().then((r) => r.data as {
      ok: boolean;
      totalBalance: number;
      reserve80: number;
      operating10: number;
      payroll10: number;
      platformBalance: number;
      revenueHistory: Array<{ date: string; totalFees: number; reserves: number; operating: number; payroll: number; txCount: number }>;
      feeCollectionRate: number;
      recentFees: number;
      priorFees: number;
      totalDistributed: number;
      distributionCount: number;
    }),
    enabled: showTreasury,
    retry: false,
    refetchInterval: showTreasury && autoRefresh ? 30000 : false,
  });

  const handleRefresh = () => {
    refetchDashboard();
    refetchMetrics();
  };

  const systemHealth =
    dashboard?.llm.ollamaReady || dashboard?.llm.ollamaEnabled
      ? 'healthy'
      : 'warning';
  const organHealth =
    (dashboard?.organs.healthy || 0) / (dashboard?.organs.total || 1) > 0.7 ? 'healthy' : 'warning';

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => {
            refetch3();
          }}
        />
      </div>
    );
  }
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neon-purple/10 border border-neon-purple/30">
            <Settings className="w-6 h-6 text-neon-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-gray-400">
              Concord v{dashboard?.system.version || '...'} • Uptime:{' '}
              {dashboard?.system.uptime.formatted || '...'}
            </p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="admin" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-lattice-deep border-lattice-border"
            />
            Auto-refresh
          </label>
          <button onClick={handleRefresh} className="btn-neon">
            <RefreshCw
              className={`w-4 h-4 mr-2 inline ${dashboardLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </header>

      <RealtimeDataPanel
        domain="admin"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={realtimeInsights}
        compact
      />

      {/* System Health Gauge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-xl bg-gradient-to-r from-neon-purple/5 via-neon-blue/5 to-neon-green/5 border border-lattice-border p-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="3"
                />
                <motion.path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={systemHealth === 'healthy' ? '#22c55e' : '#eab308'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ strokeDasharray: '0, 100' }}
                  animate={{ strokeDasharray: `${systemHealth === 'healthy' ? 92 : 60}, 100` }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Activity
                  className={`w-5 h-5 ${systemHealth === 'healthy' ? 'text-green-400' : 'text-yellow-400'}`}
                />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">System Health</p>
              <p className="text-xs text-gray-500">All subsystems monitored in real-time</p>
            </div>
          </div>
          <div className="flex gap-4">
            <StatusBadge status={systemHealth} />
            <StatusBadge status={organHealth} />
          </div>
        </div>
      </motion.div>

      {/* System Health Gauge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-xl bg-gradient-to-r from-neon-purple/5 via-neon-blue/5 to-neon-green/5 border border-lattice-border p-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                <motion.path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={systemHealth === 'healthy' ? '#22c55e' : '#eab308'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ strokeDasharray: '0, 100' }}
                  animate={{ strokeDasharray: `${systemHealth === 'healthy' ? 92 : 60}, 100` }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Activity className={`w-5 h-5 ${systemHealth === 'healthy' ? 'text-green-400' : 'text-yellow-400'}`} />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">System Health</p>
              <p className="text-xs text-gray-500">All subsystems monitored in real-time</p>
            </div>
          </div>
          <div className="flex gap-4">
            <StatusBadge status={systemHealth} />
            <StatusBadge status={organHealth} />
          </div>
        </div>
      </motion.div>

      {/* Status Overview */}
      <div className="flex gap-4 sr-only">
        <StatusBadge status={systemHealth} />
        <StatusBadge status={organHealth} />
        {dashboard?.searchIndex.dirty && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-orange-500/20 text-orange-400 border-orange-500/30">
            Search index needs rebuild
          </span>
        )}
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard
          icon={Database}
          label="Total DTUs"
          value={dashboard?.dtus.total || 0}
          subValue={`${dashboard?.dtus.mega || 0} mega, ${dashboard?.dtus.hyper || 0} hyper`}
          color="blue"
        />
        <StatCard
          icon={Users}
          label="Sessions"
          value={dashboard?.sessions.total || 0}
          subValue={`${dashboard?.sessions.active || 0} active`}
          color="purple"
        />
        <StatCard
          icon={Brain}
          label="Organs"
          value={dashboard?.organs.total || 0}
          subValue={`${dashboard?.organs.healthy || 0} healthy`}
          color="green"
        />
        <StatCard
          icon={Box}
          label="Plugins"
          value={dashboard?.plugins.total || 0}
          subValue={`${dashboard?.plugins.enabled || 0} enabled`}
          color="pink"
        />
        <StatCard
          icon={Layers}
          label="Queue Items"
          value={
            (dashboard?.queues.maintenance || 0) +
            (dashboard?.queues.synthesis || 0) +
            (dashboard?.queues.hypotheses || 0)
          }
          color="orange"
        />
        <StatCard
          icon={Zap}
          label="Search Terms"
          value={dashboard?.searchIndex.terms || 0}
          subValue={`${dashboard?.searchIndex.documents || 0} docs`}
          color="blue"
        />
      </div>

      {/* Metrics Section */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Chicken2 Metrics */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="panel p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-neon-cyan" />
            Reality Guard (Chicken2)
          </h2>
          <div className="space-y-4">
            <ProgressBar
              value={(metrics?.chicken2.homeostasis || 0.8) * 100}
              label="Homeostasis"
              color="green"
            />
            <ProgressBar
              value={(metrics?.chicken2.continuityAvg || 0) * 100}
              label="Continuity"
              color="blue"
            />
            <ProgressBar
              value={(metrics?.chicken2.contradictionLoad || 0) * 100}
              label="Contradiction Load"
              color="pink"
            />
            <ProgressBar
              value={(metrics?.chicken2.suffering || 0) * 100}
              label="Suffering Boundary"
              color="purple"
            />
            <div className="flex justify-between text-sm mt-4">
              <span className="text-gray-400">Accepts: {metrics?.chicken2.accepts || 0}</span>
              <span className="text-gray-400">Rejects: {metrics?.chicken2.rejects || 0}</span>
            </div>
          </div>
        </motion.div>

        {/* Growth OS Metrics */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="panel p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-neon-green" />
            Growth OS
          </h2>
          <div className="space-y-4">
            <div className="metric-card">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Bio Age</span>
                <span className="text-2xl font-bold text-neon-green">
                  {(metrics?.growth.bioAge || 0).toFixed(1)}
                </span>
              </div>
            </div>
            <ProgressBar
              value={(metrics?.growth.telomere || 1) * 100}
              label="Telomere"
              color="green"
            />
            <ProgressBar
              value={(metrics?.growth.homeostasis || 0.9) * 100}
              label="Homeostasis"
              color="blue"
            />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="metric-card text-center">
                <p className="text-xl font-bold text-yellow-400">
                  {((metrics?.growth.stress.acute || 0) * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-gray-400">Acute Stress</p>
              </div>
              <div className="metric-card text-center">
                <p className="text-xl font-bold text-orange-400">
                  {((metrics?.growth.stress.chronic || 0) * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-gray-400">Chronic Stress</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* System Resources */}
      <div className="grid md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="panel p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-neon-blue" />
            Memory
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Heap Used</span>
              <span>{dashboard?.system.memory.heapUsed || '...'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Heap Total</span>
              <span>{dashboard?.system.memory.heapTotal || '...'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">RSS</span>
              <span>{dashboard?.system.memory.rss || '...'}</span>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="panel p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-neon-purple" />
            LLM Status
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Ollama</span>
              <span
                className={`status-dot ${
                  dashboard?.llm.ollamaReady ? 'success' : 'error'
                }`}
              />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Ollama</span>
              <span
                className={`status-dot ${dashboard?.llm.ollamaEnabled ? 'success' : 'warning'}`}
              />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Default On</span>
              <span className={`status-dot ${dashboard?.llm.defaultOn ? 'success' : 'info'}`} />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="panel p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-neon-green" />
            Queues
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Maintenance</span>
              <span>{dashboard?.queues.maintenance || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Synthesis</span>
              <span>{dashboard?.queues.synthesis || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Hypotheses</span>
              <span>{dashboard?.queues.hypotheses || 0}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Logs */}
      <div className="panel p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-cyan" />
          Recent Activity
        </h2>
        <div className="space-y-2 max-h-60 overflow-auto">
          {(logs?.logs || []).slice(0, 10).map((log: Record<string, unknown>, i: number) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="text-neon-purple font-mono">{String(log.type)}</span>
                <span className="text-gray-400">{String(log.message)}</span>
              </div>
              <span className="text-xs text-gray-500">{String(log.at)}</span>
            </div>
          ))}
          {(!logs?.logs || logs.logs.length === 0) && (
            <p className="text-gray-500 text-center py-4">No recent activity</p>
          )}
        </div>

        {/* Real-time Data Panel */}
        {realtimeData && (
          <RealtimeDataPanel
            domain="admin"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>

      {/* System Monitoring — request rate, latency, error rate, circuit breakers */}
      <MonitoringPanel />

      {/* Nervous System — live brain/circuit/event/trace/integrity monitoring */}
      <NervousSystem />

      {/* Backup Health */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowBackupHealth(!showBackupHealth)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <HardDrive className="w-4 h-4" />
            Backup Health
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showBackupHealth ? 'rotate-180' : ''}`}
          />
        </button>
        {showBackupHealth && (
          <div className="px-4 pb-4">
            <BackupHealth />
          </div>
        )}
      </div>

      {/* CDN Status */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowCDNStatus(!showCDNStatus)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            CDN Status
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showCDNStatus ? 'rotate-180' : ''}`}
          />
        </button>
        {showCDNStatus && (
          <div className="px-4 pb-4">
            <CDNStatus />
          </div>
        )}
      </div>

      {/* Code Engine Status */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowCodeEngine(!showCodeEngine)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Code2 className="w-4 h-4" />
            Code Engine Status
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showCodeEngine ? 'rotate-180' : ''}`}
          />
        </button>
        {showCodeEngine && (
          <div className="px-4 pb-4">
            <CodeEngineStatus />
          </div>
        )}
      </div>

      {/* Repair Dashboard */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowRepairDashboard(!showRepairDashboard)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Repair Dashboard
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showRepairDashboard ? 'rotate-180' : ''}`}
          />
        </button>
        {showRepairDashboard && (
          <div className="px-4 pb-4">
            <RepairDashboard />
          </div>
        )}
      </div>

      {/* Browser Extension */}
      <div className="panel p-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Globe className="w-5 h-5 text-neon-cyan" />
          Browser Extension
        </h2>
        <p className="text-sm text-gray-400 mb-3">
          Install the Concord Lens browser extension to get structural truth overlays on any
          website. The extension injects a content script that connects to your local Concord
          instance.
        </p>
        <div className="flex items-center gap-3">
          <a
            href="/extension"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/20 transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            Install Concord Browser Extension
          </a>
          <span className="text-xs text-gray-500">v0.1.0 — Chrome / Firefox (Manifest V3)</span>
        </div>
      </div>

      {/* Treasury Dashboard (Admin Only) */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowTreasury(!showTreasury)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Treasury Dashboard
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showTreasury ? 'rotate-180' : ''}`}
          />
        </button>
        {showTreasury && (
          <div className="px-4 pb-4">
            <TreasuryDashboard data={treasuryData} />
          </div>
        )}
      </div>

      {/* Feature 45: Plugin Manager */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowPlugins(!showPlugins)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Box className="w-4 h-4" />
            Plugin Manager
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showPlugins ? 'rotate-180' : ''}`}
          />
        </button>
        {showPlugins && <PluginManagerPanel />}
      </div>

      {/* Feature 46: Macro Explorer */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowMacros(!showMacros)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Macro Explorer
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showMacros ? 'rotate-180' : ''}`}
          />
        </button>
        {showMacros && <MacroExplorerPanel />}
      </div>

      {/* API Keys Management */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowApiKeys(!showApiKeys)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            API Keys
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showApiKeys ? 'rotate-180' : ''}`}
          />
        </button>
        {showApiKeys && <ApiKeysPanel />}
      </div>

      {/* Organizations */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowOrgs(!showOrgs)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Building className="w-4 h-4" />
            Organizations
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showOrgs ? 'rotate-180' : ''}`} />
        </button>
        {showOrgs && (
          <div className="px-4 pb-4 space-y-3">
            {orgsData?.orgs?.length > 0 ? (
              orgsData.orgs.map((org: { id: string; name: string; memberCount?: number }) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5"
                >
                  <div>
                    <p className="text-sm text-white font-medium">{org.name}</p>
                    {org.memberCount !== undefined && (
                      <p className="text-xs text-gray-500">{org.memberCount} members</p>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      api
                        .post(`/api/org/${org.id}/promote`, { dtuId: '' })
                        .then((r) => r.data)
                        .catch((e) => {
                          console.error('[Admin] Failed to promote org:', e);
                          useUIStore
                            .getState()
                            .addToast({ type: 'error', message: 'Failed to promote organization' });
                        })
                    }
                    className="text-xs px-3 py-1.5 rounded-md bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30 font-medium transition-colors"
                  >
                    Promote
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 p-3">No organizations found.</p>
            )}
          </div>
        )}
      </div>

      {/* Quality Thresholds */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowQuality(!showQuality)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Quality Thresholds
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showQuality ? 'rotate-180' : ''}`}
          />
        </button>
        {showQuality && (
          <div className="px-4 pb-4 space-y-3">
            {qualityData ? (
              <pre className="text-xs text-gray-300 p-3 bg-black/30 rounded-lg border border-white/5 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(qualityData, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-gray-500 p-3">Loading quality thresholds...</p>
            )}
            {flywheelData && (
              <div className="p-3 bg-black/30 rounded-lg border border-white/5">
                <p className="text-xs text-gray-400 mb-1">Flywheel Velocity</p>
                <p className="text-lg font-bold text-white">
                  {Math.round((flywheelData.velocity ?? flywheelData.metrics?.velocity ?? 0) * 100)}
                  %
                </p>
              </div>
            )}
            {flywheelHistoryData?.history?.length > 0 && (
              <div className="p-3 bg-black/30 rounded-lg border border-white/5 space-y-2">
                <p className="text-xs text-gray-400 font-medium">Flywheel History</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {flywheelHistoryData.history.map(
                    (
                      entry: {
                        timestamp?: string;
                        date?: string;
                        velocity?: number;
                        score?: number;
                      },
                      idx: number
                    ) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">
                          {entry.timestamp ?? entry.date ?? `Entry ${idx + 1}`}
                        </span>
                        <span className="text-white font-medium">
                          {Math.round((entry.velocity ?? entry.score ?? 0) * 100)}%
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pipeline Executions */}
      {pipelineExecsData?.executions?.length > 0 && (
        <div className="border-t border-white/10 px-4 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Pipeline Executions
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pipelineExecsData.executions.map(
              (
                exec: {
                  id: string;
                  name?: string;
                  status?: string;
                  startedAt?: string;
                  duration?: number;
                },
                idx: number
              ) => (
                <div
                  key={exec.id ?? idx}
                  className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5"
                >
                  <div>
                    <p className="text-sm text-white font-medium">{exec.name ?? exec.id}</p>
                    {exec.startedAt && <p className="text-xs text-gray-500">{exec.startedAt}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {exec.duration !== undefined && (
                      <span className="text-xs text-gray-500">{exec.duration}ms</span>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        exec.status === 'success'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : exec.status === 'failed'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {exec.status ?? 'unknown'}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Backend Computational Actions ─────────────────────────────── */}

      {/* Audit Log Analysis */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowAuditLog(!showAuditLog)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-neon-cyan" />
            Audit Log Analysis
            <span className="text-xs px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan/70 font-mono">
              brain action
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showAuditLog ? 'rotate-180' : ''}`}
          />
        </button>
        <AnimatePresence>
          {showAuditLog && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Analyzes audit log entries for anomalies — detects rapid-fire bursts, frequency
                    spikes, dormancy alerts, failed access patterns, and suspicious IP diversity.
                  </p>
                  <button
                    onClick={handleRunAuditLog}
                    disabled={auditLogLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/20 disabled:opacity-50 transition-colors flex-shrink-0 ml-4"
                  >
                    {auditLogLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    {auditLogLoading ? 'Analyzing...' : 'Run Audit Analysis'}
                  </button>
                </div>

                {auditLogError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    {auditLogError}
                  </div>
                )}

                {auditLogResult && <AuditLogResultPanel result={auditLogResult} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Permission Matrix */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowPermMatrix(!showPermMatrix)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-neon-purple" />
            Permission Matrix
            <span className="text-xs px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple/70 font-mono">
              brain action
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showPermMatrix ? 'rotate-180' : ''}`}
          />
        </button>
        <AnimatePresence>
          {showPermMatrix && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Builds and analyzes a role-permission matrix — finds over-privileged roles,
                    redundant role pairs, separation-of-duty violations, and orphan assignments.
                  </p>
                  <button
                    onClick={handleRunPermMatrix}
                    disabled={permMatrixLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-neon-purple/10 text-neon-purple border border-neon-purple/30 rounded-lg hover:bg-neon-purple/20 disabled:opacity-50 transition-colors flex-shrink-0 ml-4"
                  >
                    {permMatrixLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Grid3X3 className="w-4 h-4" />
                    )}
                    {permMatrixLoading ? 'Analyzing...' : 'Run Permission Analysis'}
                  </button>
                </div>

                {permMatrixError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    {permMatrixError}
                  </div>
                )}

                {permMatrixResult && <PermissionMatrixResultPanel result={permMatrixResult} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* System Health Scoring */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowSysHealth(!showSysHealth)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-neon-green" />
            System Health Scoring
            <span className="text-xs px-1.5 py-0.5 rounded bg-neon-green/10 text-neon-green/70 font-mono">
              brain action
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showSysHealth ? 'rotate-180' : ''}`}
          />
        </button>
        <AnimatePresence>
          {showSysHealth && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Computes weighted system health scores from CPU, memory, disk, latency, and
                    error-rate metrics with trend analysis and threshold alerts.
                  </p>
                  <button
                    onClick={handleRunSysHealth}
                    disabled={sysHealthLoading}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-neon-green/10 text-neon-green border border-neon-green/30 rounded-lg hover:bg-neon-green/20 disabled:opacity-50 transition-colors flex-shrink-0 ml-4"
                  >
                    {sysHealthLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <HeartPulse className="w-4 h-4" />
                    )}
                    {sysHealthLoading ? 'Scoring...' : 'Run Health Scoring'}
                  </button>
                </div>

                {sysHealthError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    {sysHealthError}
                  </div>
                )}

                {sysHealthResult && <SystemHealthResultPanel result={sysHealthResult} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* System Monitoring — request rate, latency, error rate, circuit breakers */}
      <MonitoringPanel />

      {/* Nervous System — live brain/circuit/event/trace/integrity monitoring */}
      <NervousSystem />

      {/* Browser Extension */}
      <div className="panel p-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Globe className="w-5 h-5 text-neon-cyan" />
          Browser Extension
        </h2>
        <p className="text-sm text-gray-400 mb-3">
          Install the Concord Lens browser extension to get structural truth overlays on any website.
          The extension injects a content script that connects to your local Concord instance.
        </p>
        <div className="flex items-center gap-3">
          <a
            href="/extension"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/20 transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            Install Concord Browser Extension
          </a>
          <span className="text-xs text-gray-500">
            v0.1.0 — Chrome / Firefox (Manifest V3)
          </span>
        </div>
      </div>

      {/* Treasury Dashboard (Admin Only) */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowTreasury(!showTreasury)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Treasury Dashboard
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showTreasury ? 'rotate-180' : ''}`} />
        </button>
        {showTreasury && (
          <div className="px-4 pb-4">
            <TreasuryDashboard data={treasuryData} />
          </div>
        )}
      </div>

      {/* Feature 45: Plugin Manager */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowPlugins(!showPlugins)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Box className="w-4 h-4" />
            Plugin Manager
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showPlugins ? 'rotate-180' : ''}`} />
        </button>
        {showPlugins && <PluginManagerPanel />}
      </div>

      {/* Feature 46: Macro Explorer */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowMacros(!showMacros)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Macro Explorer
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showMacros ? 'rotate-180' : ''}`} />
        </button>
        {showMacros && <MacroExplorerPanel />}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="admin" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Treasury Dashboard Component ────────────────────────────────────────────

interface TreasuryData {
  ok: boolean;
  totalBalance: number;
  reserve80: number;
  operating10: number;
  payroll10: number;
  platformBalance: number;
  revenueHistory: Array<{ date: string; totalFees: number; reserves: number; operating: number; payroll: number; txCount: number }>;
  feeCollectionRate: number;
  recentFees: number;
  priorFees: number;
  totalDistributed: number;
  distributionCount: number;
}

function TreasuryDashboard({ data }: { data?: TreasuryData }) {
  if (!data || !data.ok) {
    return (
      <div className="text-center py-8">
        <DollarSign className="w-8 h-8 mx-auto text-gray-600 mb-2" />
        <p className="text-gray-500 text-sm">Loading treasury data...</p>
      </div>
    );
  }

  const totalSplit = data.reserve80 + data.operating10 + data.payroll10;
  const reservePct = totalSplit > 0 ? (data.reserve80 / totalSplit) * 100 : 80;
  const operatingPct = totalSplit > 0 ? (data.operating10 / totalSplit) * 100 : 10;
  const payrollPct = totalSplit > 0 ? (data.payroll10 / totalSplit) * 100 : 10;

  // Revenue chart: max value for scaling
  const maxFee = Math.max(...data.revenueHistory.map(d => d.totalFees), 1);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="dashboard-card">
          <div className="flex items-start justify-between">
            <div className="p-2 rounded-lg border text-neon-green bg-neon-green/10 border-neon-green/30">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <p className="dashboard-stat">${data.totalBalance.toLocaleString()}</p>
            <p className="dashboard-label">Total Treasury</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="flex items-start justify-between">
            <div className="p-2 rounded-lg border text-neon-blue bg-neon-blue/10 border-neon-blue/30">
              <PieChart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <p className="dashboard-stat">${data.totalDistributed.toLocaleString()}</p>
            <p className="dashboard-label">Total Distributed</p>
            <p className="text-xs text-gray-500 mt-1">{data.distributionCount} distributions</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="flex items-start justify-between">
            <div className="p-2 rounded-lg border text-neon-purple bg-neon-purple/10 border-neon-purple/30">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <p className="dashboard-stat">${data.recentFees.toLocaleString()}</p>
            <p className="dashboard-label">Fees (30d)</p>
            <p className={`text-xs mt-1 ${data.feeCollectionRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {data.feeCollectionRate >= 0 ? '+' : ''}{data.feeCollectionRate}% vs prior 30d
            </p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="flex items-start justify-between">
            <div className="p-2 rounded-lg border text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <p className="dashboard-stat">${data.platformBalance.toLocaleString()}</p>
            <p className="dashboard-label">Platform Balance</p>
          </div>
        </div>
      </div>

      {/* 80/10/10 Split Bars */}
      <div className="panel p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <PieChart className="w-5 h-5 text-neon-green" />
          Fee Split (80/10/10)
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Reserves (80%)</span>
              <span className="text-white font-mono">${data.reserve80.toLocaleString()} ({reservePct.toFixed(1)}%)</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill bg-neon-green" style={{ width: `${reservePct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Operating (10%)</span>
              <span className="text-white font-mono">${data.operating10.toLocaleString()} ({operatingPct.toFixed(1)}%)</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill bg-neon-blue" style={{ width: `${operatingPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Payroll (10%)</span>
              <span className="text-white font-mono">${data.payroll10.toLocaleString()} ({payrollPct.toFixed(1)}%)</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill bg-neon-purple" style={{ width: `${payrollPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Over Time (CSS bar chart -- Recharts can be wired in when available) */}
      {data.revenueHistory.length > 0 && (
        <div className="panel p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-neon-cyan" />
            Revenue Over Time
          </h3>
          <div className="flex items-end gap-1 h-40">
            {data.revenueHistory.slice(-30).map((day, i) => {
              const height = (day.totalFees / maxFee) * 100;
              return (
                <div
                  key={day.date || i}
                  className="flex-1 flex flex-col items-center gap-1 group relative"
                >
                  <div
                    className="w-full bg-neon-cyan/60 rounded-t hover:bg-neon-cyan transition-colors"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 bg-lattice-surface border border-lattice-border rounded-lg p-2 text-xs whitespace-nowrap shadow-lg">
                    <p className="text-white font-medium">{day.date}</p>
                    <p className="text-neon-cyan">${day.totalFees.toFixed(2)}</p>
                    <p className="text-gray-400">{day.txCount} tx</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>{data.revenueHistory[Math.max(0, data.revenueHistory.length - 30)]?.date || ''}</span>
            <span>{data.revenueHistory[data.revenueHistory.length - 1]?.date || ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature 45: Plugin Manager Panel ───────────────────────────────────────

function PluginManagerPanel() {
  const { data: pluginData, isLoading } = useQuery({
    queryKey: ['admin-plugins'],
    queryFn: () => apiHelpers.plugins.list().then(r => r.data),
  });

  const { data: metricsData } = useQuery({
    queryKey: ['admin-plugins-metrics'],
    queryFn: () => apiHelpers.plugins.metrics().then(r => r.data),
    retry: false,
  });

  const plugins = pluginData?.plugins || [];
  const metrics = metricsData;

  if (isLoading) {
    return <div className="px-4 pb-4 text-sm text-gray-400">Loading plugins...</div>;
  }

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-lattice-deep border border-white/5 text-center">
          <p className="text-xl font-bold text-white">{metrics?.loadedCount ?? plugins.length}</p>
          <p className="text-xs text-gray-400">Loaded</p>
        </div>
        <div className="p-3 rounded-lg bg-lattice-deep border border-white/5 text-center">
          <p className="text-xl font-bold text-neon-purple">{metrics?.pendingGovernanceCount ?? 0}</p>
          <p className="text-xs text-gray-400">Pending</p>
        </div>
        <div className="p-3 rounded-lg bg-lattice-deep border border-white/5 text-center">
          <p className="text-xl font-bold text-green-400">{metrics?.metrics?.totalHookCalls ?? 0}</p>
          <p className="text-xs text-gray-400">Hook Calls</p>
        </div>
        <div className="p-3 rounded-lg bg-lattice-deep border border-white/5 text-center">
          <p className="text-xl font-bold text-neon-cyan">{metrics?.metrics?.totalMacroCalls ?? 0}</p>
          <p className="text-xs text-gray-400">Macro Calls</p>
        </div>
      </div>

      {/* Plugin list */}
      {plugins.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No plugins installed</p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin: { id: string; name: string; version?: string; description?: string; author?: string; isEmergentGen?: boolean; macros?: string[]; hooks?: string[]; hasTick?: boolean; loadedAt?: string }) => (
            <div key={plugin.id} className="p-3 rounded-lg bg-lattice-deep border border-white/5 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{plugin.name || plugin.id}</span>
                  {plugin.version && <span className="text-xs text-gray-500">v{plugin.version}</span>}
                  {plugin.isEmergentGen && <span className="text-xs px-1.5 py-0.5 bg-neon-purple/20 text-neon-purple rounded">emergent</span>}
                </div>
                <p className="text-xs text-gray-500 truncate">{plugin.description || `${(plugin.macros || []).length} macros, ${(plugin.hooks || []).length} hooks`}</p>
              </div>
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4 text-green-400" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Feature 46: Macro Explorer Panel ───────────────────────────────────────

function MacroExplorerPanel() {
  const [macroSearch, setMacroSearch] = useState('');

  const { data: macroData, isLoading } = useQuery({
    queryKey: ['admin-macros-all'],
    queryFn: () => apiHelpers.adminMacros.all().then(r => r.data),
  });

  const macros = macroData?.macros || [];
  const domainCount = macroData?.domainCount || 0;
  const totalMacros = macroData?.totalMacros || macros.length;

  // Group by domain, filter by search
  const grouped = useMemo(() => {
    const searchLower = macroSearch.toLowerCase();
    const filtered = macros.filter((m: { name: string; domain: string; description?: string }) =>
      !macroSearch || m.name.toLowerCase().includes(searchLower) || m.domain.toLowerCase().includes(searchLower) || (m.description || '').toLowerCase().includes(searchLower)
    );
    const groups: Record<string, Array<{ name: string; domain: string; description?: string; public?: boolean; plugin?: string | null }>> = {};
    for (const m of filtered) {
      if (!groups[m.domain]) groups[m.domain] = [];
      groups[m.domain].push(m);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [macros, macroSearch]);

  if (isLoading) {
    return <div className="px-4 pb-4 text-sm text-gray-400">Loading macros...</div>;
  }

  return (
    <div data-lens-theme="admin" className="px-4 pb-4 space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{totalMacros} macros across {domainCount} domains</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={macroSearch}
          onChange={e => setMacroSearch(e.target.value)}
          placeholder="Search macros by name, domain, or description..."
          className="w-full pl-10 pr-4 py-2 text-sm bg-lattice-deep border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50"
        />
      </div>

      {/* Grouped macro list */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No macros match your search</p>
        ) : (
          grouped.map(([domain, domainMacros]) => (
            <div key={domain}>
              <div className="flex items-center gap-2 mb-1.5">
                <Zap className="w-3.5 h-3.5 text-neon-cyan" />
                <span className="text-xs font-medium text-neon-cyan uppercase tracking-wider">{domain}</span>
                <span className="text-xs text-gray-600">({domainMacros.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {domainMacros.map(m => (
                  <div key={`${m.domain}.${m.name}`} className="flex items-center justify-between py-1.5 px-2 rounded bg-lattice-deep/50 hover:bg-lattice-deep transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white font-mono">{m.name}</span>
                      {m.description && <span className="text-xs text-gray-500 ml-2 truncate">{m.description}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.plugin && <span className="text-xs px-1.5 py-0.5 bg-neon-purple/10 text-neon-purple rounded">plugin</span>}
                      {m.public && <span className="text-xs px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded">public</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
