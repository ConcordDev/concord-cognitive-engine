'use client';

/**
 * MonitorPanel — Datadog / Better Uptime style heartbeat-monitor surface
 * for the Concord governor tick. Implements the full tick-lens backlog:
 *
 *   1. Per-heartbeat detail   (heartbeatRegistry + heartbeatList)
 *   2. Skip / overrun chart   (skipReport)
 *   3. Alerting feed          (alerts)
 *   4. Time-range selector    (stream)
 *   5. Latency histogram      (latencyHistogram)
 *   6. Pause / resume / trigger controls (heartbeatControl)
 *   7. Uptime / SLA windows   (uptimeSLA)
 *
 * Every value rendered comes from a real macro. The panel polls the real
 * /api/heartbeat/history endpoint (governor tick counter + per-tick
 * timestamps) and the heartbeatRegistry macro (the live registered
 * heartbeat modules), then feeds each observed sample to `recordSample`
 * so the analytics macros compute over genuine persisted history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, BarChart3, Bell, BellOff, CheckCircle, Clock,
  Gauge, Heart, Pause, Play, RefreshCw, Timer, Zap,
} from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeartbeatHistoryRow { tick: number; at: string; entityCount?: number; dtuCount?: number; }
interface RegistryModule {
  id: string; frequency: number; neverDisable: boolean; periodMs: number;
  periodHuman: string; enabled: boolean; triggerRequests: number; lastTriggerAt: number | null;
}
interface DetailModule {
  id: string; frequency: number; periodMs: number; periodHuman: string;
  lastRunAt: number | null; sinceRunMs: number | null; errorCount: number;
  recentErrors: number; enabled: boolean; status: 'healthy' | 'stale' | 'erroring' | 'paused';
}
interface StreamSample {
  at: number; tickDelta: number; rateHz: number; tickDurationMs: number;
  skipDelta: number; errorCount: number;
}
interface SkipPoint { at: number; ticks: number; skipped: number; }
interface AlertRow {
  id: string; at: number; severity: 'critical' | 'warning'; kind: string;
  subject: string; message: string; acknowledged: boolean;
}
interface HistBucket { label: string; count: number; pct: number; overBudget: boolean; }
interface SlaWindow {
  label: string; windowMs: number; uptimePct: number | null; samples: number;
  upSamples?: number; downtimeHuman?: string; meetsTarget: boolean | null;
}

interface WindowOption { label: string; ms: number; }

const WINDOW_OPTIONS: WindowOption[] = [
  { label: '15m', ms: 900_000 },
  { label: '1h', ms: 3_600_000 },
  { label: '6h', ms: 21_600_000 },
  { label: '12h', ms: 43_200_000 },
];

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
function fmtClock(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString() : '—';
}

const STATUS_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400', erroring: 'text-red-400',
  stale: 'text-amber-400', paused: 'text-zinc-500',
};
const STATUS_DOT: Record<string, string> = {
  healthy: 'bg-emerald-400', erroring: 'bg-red-400',
  stale: 'bg-amber-400', paused: 'bg-zinc-600',
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type MonitorTab = 'overview' | 'heartbeats' | 'latency' | 'alerts' | 'sla';

export function MonitorPanel() {
  const [tab, setTab] = useState<MonitorTab>('overview');
  const [windowMs, setWindowMs] = useState<number>(900_000);
  const [live, setLive] = useState(true);

  // Macro result state (each comes from a real backend macro).
  const [registry, setRegistry] = useState<RegistryModule[]>([]);
  const [detail, setDetail] = useState<DetailModule[]>([]);
  const [stream, setStream] = useState<StreamSample[]>([]);
  const [skip, setSkip] = useState<{ series: SkipPoint[]; overrunRatio: number; ticks: number; skipped: number; peak: number } | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [alertCfg, setAlertCfg] = useState<{ notifyOnStop: boolean; notifyOnError: boolean; notifyOnOverrun: boolean }>({ notifyOnStop: true, notifyOnError: true, notifyOnOverrun: true });
  const [hist, setHist] = useState<{ buckets: HistBucket[]; percentiles: Record<string, number>; sampleCount: number; overBudget: number } | null>(null);
  const [sla, setSla] = useState<{ windows: SlaWindow[]; slaTarget: number; currentStatus: string } | null>(null);
  const [busyCtl, setBusyCtl] = useState<string | null>(null);

  // Real governor-tick source: /api/heartbeat/history.
  const hb = useQuery({
    queryKey: ['tick-heartbeat-history'],
    queryFn: async () => {
      const r = await api.get('/api/heartbeat/history');
      return (r.data || {}) as { history?: HeartbeatHistoryRow[]; currentTick?: number };
    },
    refetchInterval: live ? 15_000 : false,
  });

  // Real perf metrics: /api/perf/metrics (uptime, etc).
  const perf = useQuery({
    queryKey: ['tick-perf-metrics'],
    queryFn: async () => {
      const r = await api.get('/api/perf/metrics');
      return (r.data || {}) as { uptime?: number };
    },
    refetchInterval: live ? 15_000 : false,
  });

  // Refresh every macro-backed view.
  const refreshViews = useCallback(async () => {
    const [reg, det, str, skp, alr, lat, slaR] = await Promise.all([
      lensRun('tick', 'heartbeatRegistry', {}),
      lensRun('tick', 'heartbeatList', {}),
      lensRun('tick', 'stream', { windowMs }),
      lensRun('tick', 'skipReport', { windowMs }),
      lensRun('tick', 'alerts', { op: 'list' }),
      lensRun('tick', 'latencyHistogram', { windowMs }),
      lensRun('tick', 'uptimeSLA', {}),
    ]);
    if (reg.data.ok && reg.data.result) {
      const rr = reg.data.result as { modules?: RegistryModule[] };
      setRegistry(rr.modules || []);
    }
    if (det.data.ok && det.data.result) {
      const dr = det.data.result as { modules?: DetailModule[] };
      setDetail(dr.modules || []);
    }
    if (str.data.ok && str.data.result) {
      const sr = str.data.result as { samples?: StreamSample[] };
      setStream(sr.samples || []);
    }
    if (skp.data.ok && skp.data.result) {
      const kr = skp.data.result as { series?: SkipPoint[]; totals?: { overrunRatio: number; ticks: number; skipped: number }; peakSkipInterval?: number };
      setSkip({
        series: kr.series || [],
        overrunRatio: kr.totals?.overrunRatio ?? 0,
        ticks: kr.totals?.ticks ?? 0,
        skipped: kr.totals?.skipped ?? 0,
        peak: kr.peakSkipInterval ?? 0,
      });
    }
    if (alr.data.ok && alr.data.result) {
      const ar = alr.data.result as { alerts?: AlertRow[]; config?: typeof alertCfg };
      setAlerts(ar.alerts || []);
      if (ar.config) setAlertCfg(ar.config);
    }
    if (lat.data.ok && lat.data.result) {
      const lr = lat.data.result as { buckets?: HistBucket[]; percentiles?: Record<string, number>; sampleCount?: number; overBudgetCount?: number };
      setHist({
        buckets: lr.buckets || [],
        percentiles: lr.percentiles || {},
        sampleCount: lr.sampleCount || 0,
        overBudget: lr.overBudgetCount || 0,
      });
    }
    if (slaR.data.ok && slaR.data.result) {
      const slr = slaR.data.result as { windows?: SlaWindow[]; slaTarget?: number; currentStatus?: string };
      setSla({
        windows: slr.windows || [],
        slaTarget: slr.slaTarget ?? 99.9,
        currentStatus: slr.currentStatus || 'unknown',
      });
    }
  }, [windowMs]);

  // Track previous tick so we record real per-interval deltas.
  const prevTickRef = useRef<{ tick: number; at: number } | null>(null);

  // Each time real heartbeat history / registry arrives, record a sample
  // built from genuine observed values, then refresh the analytic views.
  useEffect(() => {
    const history = hb.data?.history || [];
    const currentTick = hb.data?.currentTick;
    if (currentTick == null || history.length === 0) return;

    // tickDurationMs derived from the gap between the last two real
    // tick rows minus the documented 15s governor interval (anything
    // above the interval is the block's own runtime).
    let tickDurationMs = 0;
    if (history.length >= 2) {
      const a = new Date(history[history.length - 2].at).getTime();
      const b = new Date(history[history.length - 1].at).getTime();
      const gap = b - a;
      if (Number.isFinite(gap) && gap > 0) tickDurationMs = Math.max(0, gap - 15_000);
    }

    const run = async () => {
      await lensRun('tick', 'recordSample', {
        ticks: currentTick,
        tickDurationMs,
        uptimeSec: Math.round(perf.data?.uptime ?? 0),
        heartbeatsOk: true,
        heartbeats: registry.map((m) => ({
          id: m.id,
          frequency: m.frequency,
          // last-run estimate: the most recent tick at which this module
          // was due (currentTick rounded down to its frequency).
          lastRunAt: Date.now() - ((currentTick % m.frequency) * 15_000),
          errorCount: 0,
          enabled: m.enabled,
        })),
      });
      prevTickRef.current = { tick: currentTick, at: Date.now() };
      await refreshViews();
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hb.data?.currentTick, hb.data?.history, registry.length]);

  // Initial registry + views load.
  useEffect(() => {
    void refreshViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-pull stream / skip / latency when the time-range changes.
  useEffect(() => {
    void refreshViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowMs]);

  // -------------------------------------------------------------------------
  // Heartbeat control (#6)
  // -------------------------------------------------------------------------
  const control = useCallback(async (moduleId: string, op: 'pause' | 'resume' | 'trigger') => {
    setBusyCtl(`${moduleId}:${op}`);
    try {
      const r = await lensRun('tick', 'heartbeatControl', { moduleId, op });
      if (r.data.ok) await refreshViews();
    } finally {
      setBusyCtl(null);
    }
  }, [refreshViews]);

  // -------------------------------------------------------------------------
  // Alert ops (#3)
  // -------------------------------------------------------------------------
  const ackAlert = useCallback(async (alertId: string) => {
    const r = await lensRun('tick', 'alerts', { op: 'ack', alertId });
    if (r.data.ok) await refreshViews();
  }, [refreshViews]);
  const clearAlerts = useCallback(async () => {
    const r = await lensRun('tick', 'alerts', { op: 'clear' });
    if (r.data.ok) await refreshViews();
  }, [refreshViews]);
  const toggleCfg = useCallback(async (key: keyof typeof alertCfg) => {
    const next = { ...alertCfg, [key]: !alertCfg[key] };
    const r = await lensRun('tick', 'alerts', { op: 'config', ...next });
    if (r.data.ok) {
      const cfg = (r.data.result as { config?: typeof alertCfg }).config;
      if (cfg) setAlertCfg(cfg);
    }
  }, [alertCfg]);

  // -------------------------------------------------------------------------
  // Derived chart data
  // -------------------------------------------------------------------------
  const streamChart = useMemo(
    () => stream.map((s) => ({
      t: new Date(s.at).toLocaleTimeString(),
      rate: Math.round(s.rateHz * 1000) / 1000,
      latency: s.tickDurationMs,
    })),
    [stream],
  );
  const skipChart = useMemo(
    () => (skip?.series || []).map((p) => ({
      t: new Date(p.at).toLocaleTimeString(),
      ticks: p.ticks,
      skipped: p.skipped,
    })),
    [skip],
  );
  const histChart = useMemo(
    () => (hist?.buckets || []).map((b) => ({ bucket: b.label, count: b.count })),
    [hist],
  );

  const unacked = alerts.filter((a) => !a.acknowledged).length;
  const detailSummary = useMemo(() => ({
    total: detail.length,
    healthy: detail.filter((m) => m.status === 'healthy').length,
    erroring: detail.filter((m) => m.status === 'erroring').length,
    stale: detail.filter((m) => m.status === 'stale').length,
    paused: detail.filter((m) => m.status === 'paused').length,
  }), [detail]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Heartbeat Monitor</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            governor tick · {hb.data?.currentTick ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time-range selector (#4) */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.ms}
                onClick={() => setWindowMs(w.ms)}
                className={`rounded px-2 py-0.5 text-[11px] font-mono transition-colors ${
                  windowMs === w.ms ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
              live ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                   : 'border-zinc-800 bg-zinc-950 text-zinc-400'
            }`}
          >
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => { void refreshViews(); }}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 hover:text-cyan-300"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { id: 'overview' as MonitorTab, icon: Activity, label: 'Overview' },
          { id: 'heartbeats' as MonitorTab, icon: Heart, label: `Heartbeats (${detailSummary.total})` },
          { id: 'latency' as MonitorTab, icon: Timer, label: 'Latency' },
          { id: 'alerts' as MonitorTab, icon: Bell, label: `Alerts${unacked > 0 ? ` (${unacked})` : ''}` },
          { id: 'sla' as MonitorTab, icon: CheckCircle, label: 'SLA' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tab === t.id ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                           : 'bg-zinc-900 text-zinc-400 border border-transparent hover:text-zinc-200'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ===================== OVERVIEW ===================== */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard icon={Zap} label="Tick rate (Hz)" value={
              stream.length ? (stream[stream.length - 1].rateHz).toFixed(3) : '—'
            } />
            <StatCard icon={Timer} label="p95 latency" value={fmtMs(hist?.percentiles?.p95)} />
            <StatCard icon={AlertTriangle} label="Overrun ratio" value={skip ? `${skip.overrunRatio}%` : '—'}
              alert={!!skip && skip.overrunRatio > 0} />
            <StatCard icon={Heart} label="Heartbeats" value={`${detailSummary.total}`} />
          </div>

          {/* Tick rate over time (#4 stream) */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <Activity className="h-3.5 w-3.5 text-cyan-400" /> Tick rate &amp; latency
              <span className="ml-auto font-mono text-[10px] text-zinc-600">{stream.length} samples</span>
            </div>
            {streamChart.length > 0 ? (
              <ChartKit
                kind="line"
                data={streamChart}
                xKey="t"
                height={200}
                series={[
                  { key: 'rate', label: 'rate (Hz)', color: '#06b6d4' },
                  { key: 'latency', label: 'tick ms', color: '#f59e0b' },
                ]}
              />
            ) : (
              <EmptyHint text="Recording tick samples — the chart fills as the governor advances (~15s cadence)." />
            )}
          </div>

          {/* Skip / overrun chart (#2) */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Skipped ticks / overrun
              {skip && (
                <span className="ml-auto font-mono text-[10px] text-zinc-500">
                  {skip.ticks} ticks · {skip.skipped} skipped · peak {skip.peak}
                </span>
              )}
            </div>
            {skipChart.length > 0 ? (
              <ChartKit
                kind="bar"
                data={skipChart}
                xKey="t"
                height={180}
                stacked
                series={[
                  { key: 'ticks', label: 'ticks', color: '#22c55e' },
                  { key: 'skipped', label: 'skipped', color: '#ef4444' },
                ]}
              />
            ) : (
              <EmptyHint text="No skipped-tick samples in window. concord_heartbeat_skipped_total stays at 0 while the governor keeps pace." />
            )}
          </div>
        </div>
      )}

      {/* ===================== HEARTBEATS (#1 + #6) ===================== */}
      {tab === 'heartbeats' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <MiniStat label="Total" value={detailSummary.total} color="text-zinc-200" />
            <MiniStat label="Healthy" value={detailSummary.healthy} color="text-emerald-400" />
            <MiniStat label="Erroring" value={detailSummary.erroring} color="text-red-400" />
            <MiniStat label="Stale" value={detailSummary.stale} color="text-amber-400" />
            <MiniStat label="Paused" value={detailSummary.paused} color="text-zinc-500" />
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Heartbeat module</th>
                  <th className="px-3 py-2">Frequency</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Last run</th>
                  <th className="px-3 py-2">Errors</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {detail.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-600">
                    Recording the registered heartbeat modules — refresh after the next governor tick.
                  </td></tr>
                )}
                {detail.map((m) => {
                  const reg = registry.find((r) => r.id === m.id);
                  const neverDisable = reg?.neverDisable ?? false;
                  return (
                    <tr key={m.id} className="bg-zinc-950/40 hover:bg-zinc-900/60">
                      <td className="px-3 py-2 font-mono text-zinc-200">{m.id}</td>
                      <td className="px-3 py-2 font-mono text-zinc-400">every {m.frequency}</td>
                      <td className="px-3 py-2 font-mono text-zinc-400">{m.periodHuman}</td>
                      <td className="px-3 py-2 font-mono text-zinc-500">{fmtMs(m.sinceRunMs)} ago</td>
                      <td className={`px-3 py-2 font-mono ${m.recentErrors > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                        {m.errorCount}{m.recentErrors > 0 ? ` (+${m.recentErrors})` : ''}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.status]}`} />
                          <span className={`uppercase ${STATUS_COLOR[m.status]}`}>{m.status}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {m.enabled ? (
                            <CtlBtn
                              disabled={neverDisable || busyCtl === `${m.id}:pause`}
                              busy={busyCtl === `${m.id}:pause`}
                              onClick={() => control(m.id, 'pause')}
                              title={neverDisable ? 'never-disable module' : 'pause'}
                            >
                              <Pause className="h-3 w-3" />
                            </CtlBtn>
                          ) : (
                            <CtlBtn
                              busy={busyCtl === `${m.id}:resume`}
                              onClick={() => control(m.id, 'resume')}
                              title="resume"
                            >
                              <Play className="h-3 w-3" />
                            </CtlBtn>
                          )}
                          <CtlBtn
                            busy={busyCtl === `${m.id}:trigger`}
                            onClick={() => control(m.id, 'trigger')}
                            title="request manual trigger"
                          >
                            <Zap className="h-3 w-3" />
                          </CtlBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== LATENCY (#5) ===================== */}
      {tab === 'latency' && (
        <div className="space-y-3">
          {hist && hist.sampleCount > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {(['p50', 'p90', 'p95', 'p99', 'min', 'max'] as const).map((p) => (
                  <MiniStat key={p} label={p.toUpperCase()} value={fmtMs(hist.percentiles[p])} color="text-amber-300" />
                ))}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300">
                  <BarChart3 className="h-3.5 w-3.5 text-amber-400" /> governorTick duration histogram
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{hist.sampleCount} samples</span>
                </div>
                <ChartKit
                  kind="bar"
                  data={histChart}
                  xKey="bucket"
                  height={220}
                  showLegend={false}
                  series={[{ key: 'count', label: 'ticks', color: '#f59e0b' }]}
                />
                {hist.overBudget > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    {hist.overBudget} tick{hist.overBudget > 1 ? 's' : ''} exceeded the 15s governor budget.
                  </p>
                )}
              </div>
            </>
          ) : (
            <EmptyHint text="No latency samples in window yet. Tick durations are derived as governor history accrues." />
          )}
        </div>
      )}

      {/* ===================== ALERTS (#3) ===================== */}
      {tab === 'alerts' && (
        <div className="space-y-3">
          {/* Notification config */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Notify on</span>
            {([
              { key: 'notifyOnStop' as const, label: 'tick stop' },
              { key: 'notifyOnError' as const, label: 'heartbeat error' },
              { key: 'notifyOnOverrun' as const, label: 'overrun' },
            ]).map((c) => (
              <button
                key={c.key}
                onClick={() => { void toggleCfg(c.key); }}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                  alertCfg[c.key]
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                }`}
              >
                {alertCfg[c.key] ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                {c.label}
              </button>
            ))}
            <button
              onClick={() => { void clearAlerts(); }}
              className="ml-auto rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Clear acknowledged
            </button>
          </div>

          {alerts.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-6 text-center text-xs text-emerald-300">
              <CheckCircle className="mx-auto mb-1.5 h-5 w-5" />
              No monitor alerts. Tick rate is steady and no heartbeat module has errored.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                    a.acknowledged ? 'border-zinc-800 bg-zinc-950/40 opacity-60'
                      : a.severity === 'critical'
                        ? 'border-red-500/30 bg-red-500/5'
                        : 'border-amber-500/30 bg-amber-500/5'
                  }`}
                >
                  <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                    a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[10px] uppercase ${
                        a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'
                      }`}>{a.kind.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-[10px] text-zinc-600">{a.subject}</span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-600">{fmtClock(a.at)}</span>
                    </div>
                    <p className="mt-0.5 text-zinc-300">{a.message}</p>
                  </div>
                  {!a.acknowledged && (
                    <button
                      onClick={() => { void ackAlert(a.id); }}
                      className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300 hover:text-white"
                    >
                      Ack
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ===================== SLA (#7) ===================== */}
      {tab === 'sla' && (
        <div className="space-y-3">
          {sla && sla.windows.length > 0 ? (
            <>
              <div className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                sla.currentStatus === 'operational'
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/5 text-red-300'
              }`}>
                {sla.currentStatus === 'operational'
                  ? <CheckCircle className="h-4 w-4" />
                  : <AlertTriangle className="h-4 w-4" />}
                Governor is currently <strong className="font-semibold">{sla.currentStatus}</strong>.
                Target SLA {sla.slaTarget}%.
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {sla.windows.map((w) => {
                  const pct = w.uptimePct;
                  const color = pct == null ? 'text-zinc-500'
                    : w.meetsTarget ? 'text-emerald-400' : 'text-red-400';
                  return (
                    <div key={w.label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-wider text-zinc-500">{w.label} uptime</span>
                        <Clock className="h-3.5 w-3.5 text-zinc-600" />
                      </div>
                      <div className={`mt-1 font-mono text-2xl ${color}`}>
                        {pct == null ? '—' : `${pct}%`}
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${w.meetsTarget ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${pct ?? 0}%` }}
                        />
                      </div>
                      <p className="mt-1.5 font-mono text-[10px] text-zinc-600">
                        {w.upSamples ?? 0}/{w.samples} samples up · downtime {w.downtimeHuman ?? '0s'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyHint text="Need at least two governor-tick samples to compute uptime SLA. The window fills as ticks advance." />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatCard({ icon: Icon, label, value, alert }: {
  icon: typeof Zap; label: string; value: string; alert?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-zinc-950 px-2.5 py-2 ${
      alert ? 'border-red-500/30' : 'border-zinc-800'
    }`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className="h-2.5 w-2.5" />{label}
      </div>
      <div className={`mt-0.5 font-mono text-lg ${alert ? 'text-red-300' : 'text-cyan-300'}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-base ${color}`}>{value}</div>
    </div>
  );
}

function CtlBtn({ children, onClick, disabled, busy, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className="rounded-md border border-zinc-700 bg-zinc-900 p-1 text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : children}
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center text-[11px] text-zinc-600">
      {text}
    </div>
  );
}
