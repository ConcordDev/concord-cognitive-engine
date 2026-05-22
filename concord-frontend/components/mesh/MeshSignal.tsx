'use client';

/**
 * MeshSignal — per-transport signal quality (RSSI, hop count, latency)
 * from `mesh.signalMetrics`, plus the range/coverage estimate from
 * `mesh.coverage`. RSSI bars are charted; coverage is a sortable table.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, SignalHigh } from 'lucide-react';

interface SignalMetric {
  transport: string;
  name: string;
  quality: number | null;
  rssiDbm: number | null;
  maxHopCount: number;
  latencyMs: number | null;
  bandwidthClass: string;
  peers: number;
}
interface CoverageEstimate {
  transport: string;
  name: string;
  rangeText: string;
  perHopMeters: number | null;
  multiHopMeters: number | null;
  unbounded: boolean;
  requiresInfrastructure: boolean;
  maxPayloadBytes: number;
}

function fmtMeters(m: number | null, unbounded: boolean): string {
  if (unbounded) return 'unbounded';
  if (m == null) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m < 1) return `${(m * 100).toFixed(0)} cm`;
  return `${Math.round(m)} m`;
}

export function MeshSignal() {
  const [hops, setHops] = useState(3);

  const signal = useQuery({
    queryKey: ['mesh-signal'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'signalMetrics', {});
      return (r.data?.result ?? r.data) as { metrics: SignalMetric[]; sampledNodes: number };
    },
    refetchInterval: 30_000,
  });

  const coverage = useQuery({
    queryKey: ['mesh-coverage', hops],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'coverage', { hops });
      return (r.data?.result ?? r.data) as { hops: number; estimates: CoverageEstimate[] };
    },
  });

  const metrics = signal.data?.metrics ?? [];
  const measured = metrics.filter((m) => m.rssiDbm != null);
  const chartData = measured.map((m) => ({
    transport: m.name,
    // Shift RSSI into a positive 0..100 scale for the bar height.
    signal: Math.round((m.rssiDbm! + 130) / 0.9),
  }));

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <SignalHigh className="h-4 w-4 text-teal-400" aria-hidden />
          <h3 className="text-sm font-semibold text-teal-200">Per-transport signal quality</h3>
          {signal.data && <span className="text-[11px] text-teal-700">{signal.data.sampledNodes} node samples</span>}
        </div>
        {signal.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
        ) : (
          <>
            {chartData.length > 0 && (
              <div className="mb-3 rounded-lg border border-teal-900/40 bg-black p-2">
                <ChartKit
                  kind="bar"
                  data={chartData}
                  xKey="transport"
                  series={[{ key: 'signal', label: 'Signal %', color: '#2dd4bf' }]}
                  height={180}
                  showLegend={false}
                />
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-teal-900/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-teal-950/30 text-[10px] uppercase tracking-wider text-teal-600">
                  <tr>
                    <th className="px-3 py-2">Transport</th>
                    <th className="px-3 py-2">RSSI</th>
                    <th className="px-3 py-2">Quality</th>
                    <th className="px-3 py-2">Max hops</th>
                    <th className="px-3 py-2">Latency</th>
                    <th className="px-3 py-2">Bandwidth</th>
                    <th className="px-3 py-2">Peers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-900/20">
                  {metrics.map((m) => (
                    <tr key={m.transport} className="text-teal-200">
                      <td className="px-3 py-1.5 font-mono">{m.name}</td>
                      <td className="px-3 py-1.5">{m.rssiDbm != null ? `${m.rssiDbm} dBm` : <span className="text-teal-700">no data</span>}</td>
                      <td className="px-3 py-1.5">{m.quality != null ? `${(m.quality * 100).toFixed(0)}%` : '—'}</td>
                      <td className="px-3 py-1.5">{m.maxHopCount || '—'}</td>
                      <td className="px-3 py-1.5">{m.latencyMs != null ? `${m.latencyMs}ms` : '—'}</td>
                      <td className="px-3 py-1.5">{m.bandwidthClass}</td>
                      <td className="px-3 py-1.5">{m.peers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-teal-200">Range / coverage estimate</h3>
          <label className="flex items-center gap-1.5 text-[11px] text-teal-600">
            Hops
            <input
              type="range"
              min={1}
              max={16}
              value={hops}
              onChange={(e) => setHops(+e.target.value)}
              className="accent-teal-400"
            />
            <span className="font-mono text-teal-300">{hops}</span>
          </label>
        </div>
        {coverage.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-teal-900/40">
            <table className="w-full text-left text-xs">
              <thead className="bg-teal-950/30 text-[10px] uppercase tracking-wider text-teal-600">
                <tr>
                  <th className="px-3 py-2">Transport</th>
                  <th className="px-3 py-2">Spec range</th>
                  <th className="px-3 py-2">Per-hop</th>
                  <th className="px-3 py-2">{hops}-hop reach</th>
                  <th className="px-3 py-2">Max payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-900/20">
                {(coverage.data?.estimates ?? []).map((c) => (
                  <tr key={c.transport} className="text-teal-200">
                    <td className="px-3 py-1.5 font-mono">{c.name}</td>
                    <td className="px-3 py-1.5 text-teal-500">{c.rangeText}</td>
                    <td className="px-3 py-1.5">{fmtMeters(c.perHopMeters, c.unbounded)}</td>
                    <td className="px-3 py-1.5 font-semibold">
                      {c.requiresInfrastructure ? <span className="text-teal-600">infra-bound</span> : fmtMeters(c.multiHopMeters, c.unbounded)}
                    </td>
                    <td className="px-3 py-1.5">{c.maxPayloadBytes.toLocaleString()} B</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
