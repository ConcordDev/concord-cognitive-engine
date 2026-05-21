'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * MetricsAndAlerts — Datadog-style time-series metric charts plus
 * threshold alert rules.
 *
 * Wires the `debug` domain macros:
 *   metric-record · metric-series · alert-create · alert-list ·
 *   alert-update · alert-delete
 *
 * Metric samples are captured from real browser/runtime values
 * (performance.memory, navigation timing) — never seeded.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  BellRing,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';

interface MetricPoint {
  at: string;
  value: number;
  max?: number;
  min?: number;
}
interface MetricStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  latest: number;
}
interface AlertRule {
  id: string;
  name: string;
  metric: string;
  op: string;
  threshold: number;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  state: 'ok' | 'alerting';
  triggerCount: number;
  lastTriggeredAt: string | null;
  lastValue: number | null;
}

type PerfMemory = { usedJSHeapSize?: number };

// Capture genuine runtime metric values from the browser.
function sampleRuntime(): Array<{ metric: string; value: number; unit: string }> {
  const out: Array<{ metric: string; value: number; unit: string }> = [];
  const mem = (performance as Performance & { memory?: PerfMemory }).memory;
  if (mem?.usedJSHeapSize != null) {
    out.push({
      metric: 'heap_used_mb',
      value: Math.round((mem.usedJSHeapSize / 1048576) * 100) / 100,
      unit: 'MB',
    });
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) {
    out.push({
      metric: 'page_load_ms',
      value: Math.round(nav.duration),
      unit: 'ms',
    });
  }
  // Macro round-trip latency is captured by the caller and appended.
  return out;
}

export function MetricsAndAlerts() {
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [activeMetric, setActiveMetric] = useState('');
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [stats, setStats] = useState<MetricStats | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ruleForm, setRuleForm] = useState({
    name: '',
    metric: '',
    op: '>',
    threshold: '',
    severity: 'warning',
  });

  const loadSeries = useCallback(async (metric: string) => {
    const r = await lensRun('debug', 'metric-series', {
      metric: metric || undefined,
      buckets: 40,
    });
    if (r.data?.ok && r.data.result) {
      setMetricNames(r.data.result.metrics || []);
      setPoints(r.data.result.points || []);
      setStats(r.data.result.stats || null);
    }
  }, []);

  const loadRules = useCallback(async () => {
    const r = await lensRun('debug', 'alert-list', {});
    if (r.data?.ok && r.data.result) setRules(r.data.result.rules || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadSeries(activeMetric), loadRules()]);
    setLoading(false);
  }, [activeMetric, loadSeries, loadRules]);

  useEffect(() => {
    refresh();
  }, [activeMetric]);

  // Record a fresh runtime sample, then reload the series.
  const captureSample = useCallback(async () => {
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    const probe = await lensRun('debug', 'alert-list', {});
    const latency = Math.round(performance.now() - t0);
    const samples = sampleRuntime();
    samples.push({ metric: 'macro_latency_ms', value: latency, unit: 'ms' });
    let lastBreach = 0;
    for (const sm of samples) {
      const r = await lensRun('debug', 'metric-record', sm);
      if (r.data?.ok && Array.isArray(r.data.result?.breaches)) {
        lastBreach += r.data.result.breaches.length;
      }
    }
    setBusy(false);
    if (!probe.data?.ok) setError('runtime probe failed');
    if (lastBreach > 0) setError(`${lastBreach} alert rule(s) breached`);
    const next = activeMetric || samples[0]?.metric || '';
    if (next !== activeMetric) setActiveMetric(next);
    else refresh();
  }, [activeMetric, refresh]);

  const createRule = useCallback(async () => {
    if (!ruleForm.name.trim() || !ruleForm.metric.trim() || ruleForm.threshold === '') return;
    setBusy(true);
    const r = await lensRun('debug', 'alert-create', {
      name: ruleForm.name,
      metric: ruleForm.metric,
      op: ruleForm.op,
      threshold: Number(ruleForm.threshold),
      severity: ruleForm.severity,
    });
    setBusy(false);
    if (r.data?.ok) {
      setRuleForm({ name: '', metric: '', op: '>', threshold: '', severity: 'warning' });
      loadRules();
    } else {
      setError(r.data?.error || 'Rule create failed');
    }
  }, [ruleForm, loadRules]);

  const toggleRule = useCallback(
    async (rule: AlertRule) => {
      const r = await lensRun('debug', 'alert-update', {
        id: rule.id,
        enabled: !rule.enabled,
      });
      if (r.data?.ok) loadRules();
    },
    [loadRules]
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const r = await lensRun('debug', 'alert-delete', { id });
      if (r.data?.ok) loadRules();
    },
    [loadRules]
  );

  const alertingCount = rules.filter((r) => r.state === 'alerting' && r.enabled).length;

  return (
    <div className="space-y-5">
      {/* ── Time-series charts ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-neon-blue" /> Time-Series Metrics
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={captureSample}
              disabled={busy}
              className="text-xs px-2 py-1 rounded bg-neon-blue/10 border border-neon-blue/30 text-neon-blue hover:bg-neon-blue/20 flex items-center gap-1 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Sample Runtime
            </button>
            <button
              onClick={refresh}
              className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        </div>

        {metricNames.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {metricNames.map((m) => (
              <button
                key={m}
                onClick={() => setActiveMetric(m)}
                className={`text-[11px] px-2 py-1 rounded font-mono border ${
                  activeMetric === m
                    ? 'bg-neon-blue/15 border-neon-blue/40 text-neon-blue'
                    : 'bg-lattice-surface border-lattice-border text-gray-400 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-500 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : points.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-lattice-border rounded-lg">
            <Gauge className="w-7 h-7 mx-auto mb-2 opacity-40" />
            No samples yet — click &ldquo;Sample Runtime&rdquo;
          </div>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-5 gap-2">
                {[
                  ['Latest', stats.latest],
                  ['Avg', stats.avg],
                  ['Min', stats.min],
                  ['Max', stats.max],
                  ['Samples', stats.count],
                ].map(([label, v]) => (
                  <div key={label} className="p-2 bg-lattice-deep rounded text-center">
                    <p className="text-sm font-bold text-neon-blue">{String(v)}</p>
                    <p className="text-[10px] text-gray-500">{label}</p>
                  </div>
                ))}
              </div>
            )}
            <ChartKit
              kind="area"
              height={220}
              data={points.map((p) => ({
                t: new Date(p.at).toLocaleTimeString(),
                value: p.value,
                max: p.max ?? p.value,
              }))}
              xKey="t"
              series={[
                { key: 'value', label: activeMetric || 'value', color: '#3b82f6' },
                { key: 'max', label: 'bucket max', color: '#f59e0b' },
              ]}
            />
          </>
        )}
      </div>

      {/* ── Alert rules ── */}
      <div className="space-y-3 pt-2 border-t border-white/5">
        <h3 className="font-semibold flex items-center gap-2">
          <BellRing className={`w-4 h-4 ${alertingCount > 0 ? 'text-red-400' : 'text-gray-400'}`} />
          Alert Rules
          {alertingCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
              {alertingCount} alerting
            </span>
          )}
        </h3>

        {/* Create rule */}
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border grid grid-cols-2 md:grid-cols-6 gap-2">
          <input
            value={ruleForm.name}
            onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Rule name"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs md:col-span-2"
          />
          <input
            value={ruleForm.metric}
            onChange={(e) => setRuleForm((f) => ({ ...f, metric: e.target.value }))}
            placeholder="metric"
            list="debug-metric-names"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <datalist id="debug-metric-names">
            {metricNames.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <select
            value={ruleForm.op}
            onChange={(e) => setRuleForm((f) => ({ ...f, op: e.target.value }))}
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          >
            {['>', '>=', '<', '<=', '=='].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            value={ruleForm.threshold}
            onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))}
            placeholder="threshold"
            type="number"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <select
            value={ruleForm.severity}
            onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
          >
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
          <button
            onClick={createRule}
            disabled={busy || !ruleForm.name.trim() || !ruleForm.metric.trim()}
            className="px-3 py-1.5 text-xs rounded bg-neon-purple/15 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/25 disabled:opacity-50 flex items-center justify-center gap-1 md:col-span-6"
          >
            <Plus className="w-3 h-3" /> Create Alert Rule
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Rule list */}
        {rules.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">No alert rules configured</p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                  rule.state === 'alerting' && rule.enabled
                    ? 'border-red-500/30 bg-red-500/[0.05]'
                    : 'border-lattice-border bg-lattice-deep'
                }`}
              >
                <button
                  onClick={() => toggleRule(rule)}
                  title={rule.enabled ? 'Disable' : 'Enable'}
                  className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${
                    rule.enabled ? 'bg-neon-green/40' : 'bg-gray-600/40'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      rule.enabled ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 truncate">{rule.name}</p>
                  <p className="text-[10px] text-gray-500 font-mono">
                    {rule.metric} {rule.op} {rule.threshold}
                  </p>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    rule.severity === 'critical'
                      ? 'bg-red-500/20 text-red-400'
                      : rule.severity === 'warning'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-neon-blue/20 text-neon-blue'
                  }`}
                >
                  {rule.severity}
                </span>
                <div className="text-right shrink-0">
                  <p
                    className={`text-[10px] ${
                      rule.state === 'alerting' && rule.enabled
                        ? 'text-red-400'
                        : 'text-neon-green'
                    }`}
                  >
                    {rule.enabled ? rule.state : 'disabled'}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {rule.triggerCount}× fired
                    {rule.lastValue != null && ` · last ${rule.lastValue}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="p-1 rounded text-red-400 hover:bg-red-400/10 shrink-0"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
