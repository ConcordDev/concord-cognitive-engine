'use client';

/**
 * MetricsPanel — live time-series of process CPU / heap / memory / request
 * rate. Backed by the `system.metrics` macro, which returns the real
 * process.memoryUsage()/cpuUsage() ring buffer, plus `system.sample`
 * appended on each poll so the chart builds from genuine observations.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Cpu, MemoryStick, Activity, Loader2 } from 'lucide-react';

interface Sample {
  at: string;
  ts: number;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  heapPct: number;
  cpuPct: number;
  uptimeSec: number;
  loadAvg1: number;
  requestsTotal: number;
  requestRate: number;
}

interface MetricsResult {
  samples: Sample[];
  count: number;
  latest: Sample | null;
  peakHeapMB: number;
  avgCpuPct: number;
  capacity: number;
}

export function MetricsPanel({ live }: { live: boolean }) {
  const [data, setData] = useState<MetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const poll = useCallback(async () => {
    // Append a real sample, then read the full series back.
    await lensRun('system', 'sample', {});
    const r = await lensRun<MetricsResult>('system', 'metrics', { limit: 120 });
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'metrics unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    poll();
    if (!live) return;
    const t = setInterval(poll, 15_000);
    return () => clearInterval(t);
  }, [live, poll]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sampling process telemetry…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">
        {err || 'No metrics.'}
      </div>
    );
  }

  const chartData = data.samples.map((s) => ({
    t: new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    heapUsedMB: s.heapUsedMB,
    rssMB: s.rssMB,
    cpuPct: s.cpuPct,
    requestRate: s.requestRate,
    heapPct: s.heapPct,
  }));
  const latest = data.latest;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat icon={<Cpu className="h-3.5 w-3.5" aria-hidden />} label="CPU" value={`${latest?.cpuPct ?? 0}%`} sub={`avg ${data.avgCpuPct}%`} />
        <MiniStat icon={<MemoryStick className="h-3.5 w-3.5" aria-hidden />} label="Heap" value={`${latest?.heapUsedMB ?? 0} MB`} sub={`${latest?.heapPct ?? 0}% · peak ${data.peakHeapMB}`} />
        <MiniStat icon={<MemoryStick className="h-3.5 w-3.5" aria-hidden />} label="RSS" value={`${latest?.rssMB ?? 0} MB`} sub={`ext ${latest?.externalMB ?? 0} MB`} />
        <MiniStat icon={<Activity className="h-3.5 w-3.5" aria-hidden />} label="Req rate" value={`${latest?.requestRate ?? 0}/s`} sub={`uptime ${fmtUptime(latest?.uptimeSec ?? 0)}`} />
      </div>

      <ChartBlock title="Heap & RSS (MB)">
        <ChartKit
          kind="area"
          data={chartData}
          xKey="t"
          series={[
            { key: 'heapUsedMB', label: 'Heap Used', color: '#06b6d4' },
            { key: 'rssMB', label: 'RSS', color: '#a855f7' },
          ]}
          height={200}
        />
      </ChartBlock>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBlock title="CPU %">
          <ChartKit
            kind="line"
            data={chartData}
            xKey="t"
            series={[{ key: 'cpuPct', label: 'CPU %', color: '#f59e0b' }]}
            height={180}
          />
        </ChartBlock>
        <ChartBlock title="Request rate (req/s)">
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="t"
            series={[{ key: 'requestRate', label: 'req/s', color: '#22c55e' }]}
            height={180}
          />
        </ChartBlock>
      </div>
      <p className="text-[10px] text-cyan-700">
        {data.count}/{data.capacity} samples · {live ? 'auto-sampling every 15s' : 'paused'}
      </p>
    </div>
  );
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cyan-700">
        {icon} {label}
      </div>
      <div className="font-mono text-lg font-semibold text-cyan-100">{value}</div>
      <div className="mt-0.5 text-[10px] text-cyan-700">{sub}</div>
    </div>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <h3 className="mb-2 text-xs font-semibold text-cyan-300">{title}</h3>
      {children}
    </div>
  );
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
