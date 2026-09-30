'use client';

import { useCallback, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useRunArtifact, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { ErrorState } from '@/components/ui/ErrorState';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Database,
  FileText,
  Globe,
  HardDrive,
  HeartPulse,
  Loader2,
  XCircle,
  Zap,
} from 'lucide-react';

export function AuditPanel() {
  return (
    <div className="space-y-8">
      <AuditLogSection />
      <SystemHealthScoringSection />
    </div>
  );
}

function AuditLogSection() {
  const runAction = useRunArtifact('admin');
  const createArtifact = useCreateArtifact('admin');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: logs } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => apiHelpers.admin.logs({ limit: 20 }).then((r) => r.data),
    refetchInterval: 10000,
  });

  const handleRun = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const entries = (logs?.logs || []).map((log: Record<string, unknown>) => ({
        timestamp: String(log.at || new Date().toISOString()),
        userId: String(log.userId || log.user || 'system'),
        action: String(log.type || 'unknown'),
        resource: String(log.resource || log.message || ''),
        ip: String(log.ip || '127.0.0.1'),
        success: log.success !== false,
      }));
      const created = await createArtifact.mutateAsync({
        type: 'AuditSnapshot',
        title: `Audit Log Analysis ${new Date().toLocaleString()}`,
        data: { entries } as Record<string, unknown>,
      });
      const res = await runAction.mutateAsync({
        id: created.artifact.id,
        action: 'auditLog',
        params: { windowMinutes: 60, stdDevThreshold: 2 },
      });
      if (res.ok === false) {
        setResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error('[Admin] Audit log action failed:', e);
      setErr(e instanceof Error ? e.message : 'Audit log analysis failed');
    } finally {
      setLoading(false);
    }
  }, [logs, createArtifact, runAction]);

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4" /> Audit log analysis
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">admin.auditLog</span>
          </h2>
          <p className={ds.textMuted}>
            Rapid-fire bursts, frequency spikes, dormancy, failed access, IP diversity — seeded from admin.logs.
          </p>
        </div>
        <button type="button" onClick={() => void handleRun()} disabled={loading} className={ds.btnPrimary}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {loading ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>
      {err && <ErrorState variant="inline" message={err} onRetry={() => void handleRun()} />}
      {result && <AuditLogResult result={result} />}
    </section>
  );
}

function AuditLogResult({ result }: { result: Record<string, unknown> }) {
  const reduceMotion = useReducedMotion();
  const summary = (result.summary || {}) as Record<string, number>;
  const anomalies = (result.anomalies || []) as Array<Record<string, unknown>>;
  const failedAccessAlerts = (result.failedAccessAlerts || []) as Array<Record<string, unknown>>;
  const ipAlerts = (result.ipAlerts || []) as Array<Record<string, unknown>>;
  const timeSpan = result.timeSpan as { from: string; to: string } | null;

  const severityColor = (type: string) => {
    switch (type) {
      case 'rapid-fire':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'frequency-spike':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'long-dormancy-then-active':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    }
  };
  const typeLabel = (type: string) => {
    switch (type) {
      case 'rapid-fire':
        return 'Rapid-Fire Burst';
      case 'frequency-spike':
        return 'Frequency Spike';
      case 'long-dormancy-then-active':
        return 'Dormancy Alert';
      default:
        return type;
    }
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric n={result.totalEntries as number} label="Entries analyzed" />
        <Metric n={result.uniqueUsers as number} label="Unique users" />
        <Metric n={summary.totalAnomalies || 0} label="Anomalies" warn={(summary.totalAnomalies || 0) > 0} />
        <Metric
          n={summary.failedAccessAlertCount || 0}
          label="Failed access"
          warn={(summary.failedAccessAlertCount || 0) > 0}
        />
      </div>
      {timeSpan && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock className="w-3 h-3" />
          <span>
            {new Date(timeSpan.from).toLocaleString()} → {new Date(timeSpan.to).toLocaleString()}
          </span>
        </div>
      )}
      <div className="p-4 rounded-lg bg-black/30 border border-lattice-border flex gap-4 flex-wrap text-xs text-gray-300">
        <span>Rapid-fire {summary.rapidFireCount || 0}</span>
        <span>Spikes {summary.frequencySpikeCount || 0}</span>
        <span>Dormancy {summary.dormancyAlertCount || 0}</span>
        <span>Suspicious IPs {summary.suspiciousIpCount || 0}</span>
      </div>
      {anomalies.map((a, i) => (
        <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border ${severityColor(a.type as string)}`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{typeLabel(a.type as string)}</span>
              <span className="text-xs opacity-70">User: {String(a.userId)}</span>
              {!!a.timestamp && (
                <span className="text-xs opacity-50">{new Date(a.timestamp as string).toLocaleTimeString()}</span>
              )}
            </div>
            <div className="flex gap-3 mt-1 text-xs opacity-70">
              {a.zScore !== undefined && <span>z-score: {String(a.zScore)}</span>}
              {a.gapMs !== undefined && <span>gap: {Math.round(Number(a.gapMs) / 1000)}s</span>}
              {a.actionsInWindow !== undefined && <span>{String(a.actionsInWindow)} actions/window</span>}
              {!!a.action && <span>action: {String(a.action)}</span>}
            </div>
          </div>
        </div>
      ))}
      {failedAccessAlerts.map((fa, i) => (
        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/5 border border-red-500/15">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-white">{fa.userId as string}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>
              {fa.failedAttempts as number}/{fa.totalAttempts as number} failed
            </span>
            <span className="text-red-400 font-medium">{fa.failureRate as number}% failure</span>
          </div>
        </div>
      ))}
      {ipAlerts.map((ip, i) => (
        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/15">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-white">{ip.userId as string}</span>
          </div>
          <span className="text-xs text-purple-400">{ip.uniqueIps as number} unique IPs</span>
        </div>
      ))}
      {anomalies.length === 0 && failedAccessAlerts.length === 0 && ipAlerts.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm text-green-400 font-medium">No anomalies detected</p>
            <p className="text-xs text-gray-400">All access patterns are within normal parameters.</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SystemHealthScoringSection() {
  const runAction = useRunArtifact('admin');
  const createArtifact = useCreateArtifact('admin');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const live = await api
        .get<{
          ok: boolean;
          series: Array<{
            timestamp: string;
            cpu: number;
            memory: number;
            disk: number;
            latencyMs: number;
            errorRate: number;
          }>;
        }>('/api/admin/system-health/series?points=20')
        .then((r) => r.data);
      if (!live?.ok || !Array.isArray(live.series)) throw new Error('Failed to load health time series');
      const created = await createArtifact.mutateAsync({
        type: 'HealthSnapshot',
        title: `System Health Check ${new Date().toLocaleString()}`,
        data: { metrics: live.series } as Record<string, unknown>,
      });
      const res = await runAction.mutateAsync({
        id: created.artifact.id,
        action: 'systemHealth',
      });
      if (res.ok === false) {
        setResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error('[Admin] System health action failed:', e);
      setErr(e instanceof Error ? e.message : 'System health analysis failed');
    } finally {
      setLoading(false);
    }
  }, [createArtifact, runAction]);

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <HeartPulse className="w-4 h-4" /> System health scoring
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">admin.systemHealth</span>
          </h2>
          <p className={ds.textMuted}>
            Weighted CPU / memory / disk / latency / error-rate from /api/admin/system-health/series.
          </p>
        </div>
        <button type="button" onClick={() => void handleRun()} disabled={loading} className={ds.btnPrimary}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
          {loading ? 'Scoring…' : 'Run scoring'}
        </button>
      </div>
      {err && <ErrorState variant="inline" message={err} onRetry={() => void handleRun()} />}
      {result && <SystemHealthResult result={result} />}
    </section>
  );
}

function SystemHealthResult({ result }: { result: Record<string, unknown> }) {
  const reduceMotion = useReducedMotion();
  const compositeScore = result.compositeScore as number | null;
  const healthStatus = result.healthStatus as string;
  const currentValues = (result.currentValues || {}) as Record<string, number | null>;
  const componentScores = (result.componentScores || {}) as Record<string, number | null>;
  const trends = (result.trends || {}) as Record<
    string,
    { slope: number; direction: string; concern: string } | null
  >;
  const alerts = (result.alerts || []) as Array<{
    metric: string;
    value: number;
    threshold: number;
    severity: string;
  }>;
  const weights = (result.weights || {}) as Record<string, number>;

  const statusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-400';
      case 'degraded':
        return 'text-yellow-400';
      case 'unhealthy':
        return 'text-orange-400';
      case 'critical':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };
  const statusBg = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500/10 border-green-500/20';
      case 'degraded':
        return 'bg-yellow-500/10 border-yellow-500/20';
      case 'unhealthy':
        return 'bg-orange-500/10 border-orange-500/20';
      case 'critical':
        return 'bg-red-500/10 border-red-500/20';
      default:
        return 'bg-gray-500/10 border-gray-500/20';
    }
  };
  const trendIcon = (direction: string) => {
    if (direction === 'increasing') return '↑';
    if (direction === 'decreasing') return '↓';
    return '→';
  };
  const concernColor = (concern: string) =>
    concern === 'degrading' ? 'text-red-400' : concern === 'improving' ? 'text-green-400' : 'text-gray-400';
  const metricLabels: Record<
    string,
    { label: string; unit: string; icon: ComponentType<{ className?: string }> }
  > = {
    cpu: { label: 'CPU', unit: '%', icon: Cpu },
    memory: { label: 'Memory', unit: '%', icon: Database },
    disk: { label: 'Disk', unit: '%', icon: HardDrive },
    latency: { label: 'Latency', unit: 'ms', icon: Clock },
    errorRate: { label: 'Error Rate', unit: '%', icon: AlertCircle },
  };
  const scoreBarColor = (score: number | null) => {
    if (score === null) return 'bg-gray-600';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 30) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className={`flex items-center gap-6 p-5 rounded-xl border ${statusBg(healthStatus)}`}>
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="3"
            />
            <motion.path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke={
                healthStatus === 'healthy'
                  ? '#22c55e'
                  : healthStatus === 'degraded'
                    ? '#eab308'
                    : healthStatus === 'unhealthy'
                      ? '#f97316'
                      : '#ef4444'
              }
              strokeWidth="3"
              strokeLinecap="round"
              initial={reduceMotion ? false : { strokeDasharray: '0, 100' }}
              animate={{ strokeDasharray: `${compositeScore ?? 0}, 100` }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-lg font-mono font-bold ${statusColor(healthStatus)}`}>
              {compositeScore !== null ? Math.round(compositeScore) : '—'}
            </span>
          </div>
        </div>
        <div>
          <p className={`text-xl font-bold capitalize ${statusColor(healthStatus)}`}>{healthStatus}</p>
          <p className="text-xs text-gray-400 mt-1">
            Composite score · {result.dataPoints as number} data points
          </p>
        </div>
      </div>

      {['cpu', 'memory', 'disk', 'latency', 'errorRate'].map((key) => {
        const meta = metricLabels[key];
        const MetricIcon = meta.icon;
        const scoreVal = componentScores[key];
        const currentVal = key === 'latency' ? currentValues.latencyMs : currentValues[key];
        const trend = trends[key];
        const weight = weights[key];
        return (
          <div key={key} className="p-3 rounded-lg bg-lattice-deep border border-lattice-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MetricIcon className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-white font-medium">{meta.label}</span>
                <span className="text-xs text-gray-500">weight {(weight || 0) * 100}%</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {currentVal !== null && currentVal !== undefined && (
                  <span className="text-white font-mono">
                    {typeof currentVal === 'number' ? currentVal.toFixed(1) : currentVal}
                    {meta.unit}
                  </span>
                )}
                {trend && (
                  <span className={concernColor(trend.concern)}>
                    {trendIcon(trend.direction)} {trend.direction}
                  </span>
                )}
                <span className="font-mono font-bold">
                  {scoreVal !== null && scoreVal !== undefined ? scoreVal.toFixed(1) : 'N/A'}
                </span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${scoreBarColor(scoreVal ?? null)}`}
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: `${scoreVal ?? 0}%` }}
              />
            </div>
          </div>
        );
      })}

      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`flex items-center justify-between p-2.5 rounded-lg border ${
            alert.severity === 'critical'
              ? 'bg-red-500/5 border-red-500/15 text-red-400'
              : 'bg-yellow-500/5 border-yellow-500/15 text-yellow-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {alert.severity === 'critical' ? <XCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span className="text-sm font-medium capitalize">{alert.metric}</span>
            <span className="text-xs px-1.5 py-0.5 rounded uppercase">{alert.severity}</span>
          </div>
          <span className="text-xs font-mono">
            {alert.value.toFixed(1)} / {alert.threshold}
          </span>
        </div>
      ))}
      {alerts.length === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm text-green-400 font-medium">No active alerts</p>
            <p className="text-xs text-gray-400">All metrics are within configured thresholds.</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Metric({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-lattice-deep border border-lattice-border text-center">
      <p className={`text-xl font-mono tabular-nums ${warn ? 'text-red-400' : 'text-white'}`}>{n ?? 0}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
