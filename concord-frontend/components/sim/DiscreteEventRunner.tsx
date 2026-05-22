'use client';

/**
 * DiscreteEventRunner — runs the `sim.discreteEvent` M/M/c queue simulation
 * (event-driven next-event time advance) and reports queue performance
 * metrics: wait time, queue length, utilization, throughput, stability.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Play, RefreshCw, Boxes, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

interface DESResult {
  model: string;
  clock: number;
  jobsArrived: number;
  jobsServed: number;
  jobsBalked: number;
  trafficIntensity: number;
  stable: boolean;
  avgWaitTime: number;
  avgSystemTime: number;
  avgQueueLength: number;
  avgJobsInSystem: number;
  maxQueueLength: number;
  serverUtilization: number;
  throughput: number;
}

export function DiscreteEventRunner() {
  const [arrivalRate, setArrivalRate] = useState(0.9);
  const [serviceRate, setServiceRate] = useState(1.0);
  const [servers, setServers] = useState(1);
  const [maxJobs, setMaxJobs] = useState(5000);
  const [useCapacity, setUseCapacity] = useState(false);
  const [queueCapacity, setQueueCapacity] = useState(20);
  const [seed, setSeed] = useState(4242);
  const [result, setResult] = useState<DESResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const params: Record<string, unknown> = { arrivalRate, serviceRate, servers, maxJobs, seed };
    if (useCapacity) params.queueCapacity = queueCapacity;
    const r = await lensRun<DESResult>('sim', 'discreteEvent', params);
    if (r.data.ok && r.data.result) {
      setResult(r.data.result);
    } else {
      setResult(null);
      setError(r.data.error || 'Discrete-event simulation failed.');
    }
    setRunning(false);
  }, [arrivalRate, serviceRate, servers, maxJobs, useCapacity, queueCapacity, seed]);

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-3')}>
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-orange-400" />
          <h4 className={cn(ds.heading3, 'text-base')}>Discrete-Event Queue (M/M/c)</h4>
        </div>
        <p className={ds.textMuted}>
          Event-driven next-event time-advance simulation of a single-station queue with
          exponential interarrival and service times across c parallel servers.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className={ds.label}>Arrival Rate λ (jobs/unit)</label>
            <input type="number" step="0.05" className={ds.input} value={arrivalRate}
              onChange={(e) => setArrivalRate(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={ds.label}>Service Rate μ (per server)</label>
            <input type="number" step="0.05" className={ds.input} value={serviceRate}
              onChange={(e) => setServiceRate(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={ds.label}>Servers c</label>
            <input type="number" className={ds.input} value={servers}
              onChange={(e) => setServers(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div>
            <label className={ds.label}>Jobs to Simulate</label>
            <input type="number" className={ds.input} value={maxJobs}
              onChange={(e) => setMaxJobs(Math.max(10, parseInt(e.target.value) || 10))} />
          </div>
          <div>
            <label className={ds.label}>Seed</label>
            <input type="number" className={ds.input} value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label className={ds.label}>Queue Capacity</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useCapacity}
                onChange={(e) => setUseCapacity(e.target.checked)}
                className="w-4 h-4 accent-orange-500"
              />
              <input
                type="number"
                className={cn(ds.input, 'flex-1')}
                value={queueCapacity}
                disabled={!useCapacity}
                onChange={(e) => setQueueCapacity(Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
          </div>
        </div>

        <button onClick={run} disabled={running} className={ds.btnPrimary}>
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Processing events…' : 'Run Queue Simulation'}
        </button>
      </div>

      {error && (
        <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5 flex items-center gap-2')}>
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className={cn(
            ds.panel,
            'flex items-center gap-3',
            result.stable ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5',
          )}>
            {result.stable
              ? <CheckCircle2 className="w-5 h-5 text-green-400" />
              : <AlertTriangle className="w-5 h-5 text-red-400" />}
            <div>
              <p className={cn('font-semibold', result.stable ? 'text-green-400' : 'text-red-400')}>
                {result.stable ? 'System is stable' : 'System is unstable — queue grows unboundedly'}
              </p>
              <p className={ds.textMuted}>
                Traffic intensity ρ = {result.trafficIntensity} {result.stable ? '(< 1)' : '(≥ 1)'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Avg Wait Time" value={result.avgWaitTime} accent="text-orange-400" />
            <Metric label="Avg Time in System" value={result.avgSystemTime} accent="text-orange-400" />
            <Metric label="Avg Queue Length" value={result.avgQueueLength} accent="text-yellow-400" />
            <Metric label="Avg Jobs in System" value={result.avgJobsInSystem} accent="text-yellow-400" />
            <Metric label="Server Utilization" value={result.serverUtilization} accent="text-blue-400" suffix="" pct />
            <Metric label="Throughput" value={result.throughput} accent="text-green-400" />
            <Metric label="Max Queue Length" value={result.maxQueueLength} accent="text-purple-400" />
            <Metric label="Jobs Balked" value={result.jobsBalked} accent="text-red-400" />
          </div>

          <div className={ds.panel}>
            <h4 className={cn(ds.heading3, 'text-base mb-3')}>Run Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              <Row k="Model" v={result.model} />
              <Row k="Simulated Clock" v={result.clock} />
              <Row k="Jobs Arrived" v={result.jobsArrived.toLocaleString()} />
              <Row k="Jobs Served" v={result.jobsServed.toLocaleString()} />
              <Row k="Jobs Balked" v={result.jobsBalked.toLocaleString()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent, pct }: {
  label: string; value: number; accent: string; suffix?: string; pct?: boolean;
}) {
  return (
    <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
      <p className={ds.textMuted}>{label}</p>
      <p className={cn(ds.textMono, 'text-lg mt-1', accent)}>
        {pct ? `${(value * 100).toFixed(1)}%` : value.toLocaleString()}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex justify-between bg-lattice-surface/40 rounded px-2 py-1">
      <span className="text-gray-400">{k}</span>
      <span className="text-white font-mono">{v}</span>
    </div>
  );
}
